import hashlib
import hmac
import json
import os
from urllib.parse import parse_qsl

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from db import (
    add_transaction,
    create_invite,
    get_budget_owner_id,
    get_budget_summary,
    get_or_create_user,
    get_period_summary,
    leave_budget,
    remove_user_from_budget,
    use_invite,
    init_db,
)


BOT_TOKEN = os.getenv("TELEGRAM_API_KEY", "").strip()


class InitPayload(BaseModel):
    initData: str


class TransactionPayload(InitPayload):
    t_type: str
    amount: float
    description: str


class SummaryPayload(InitPayload):
    t_type: str
    period: str


class JoinPayload(InitPayload):
    code: str


class KickPayload(InitPayload):
    target_id: int


def _verify_init_data(init_data: str) -> dict:
    if not BOT_TOKEN:
        raise HTTPException(status_code=500, detail="Missing TELEGRAM_API_KEY")
    data = dict(parse_qsl(init_data, strict_parsing=True, keep_blank_values=True))
    received_hash = data.pop("hash", None)
    if not received_hash:
        raise HTTPException(status_code=401, detail="Missing hash")
    data_check = "\n".join(f"{k}={data[k]}" for k in sorted(data))
    secret_key = hmac.new(
        b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256
    ).digest()
    computed_hash = hmac.new(secret_key, data_check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(computed_hash, received_hash):
        raise HTTPException(status_code=401, detail="Invalid hash")
    user_raw = data.get("user")
    if not user_raw:
        raise HTTPException(status_code=401, detail="Missing user")
    try:
        user = json.loads(user_raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=401, detail="Invalid user payload") from exc
    return user


def _period_to_days(period: str) -> int | None:
    return {"week": 7, "month": 30, "year": 365}.get(period)


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/api/init")
def api_init(payload: InitPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    get_or_create_user(telegram_id)
    balance = get_budget_summary(telegram_id)
    owner_id = get_budget_owner_id(telegram_id)
    return {"telegram_id": telegram_id, "balance": balance, "is_owner": owner_id == telegram_id}


@app.post("/api/transaction")
def api_transaction(payload: TransactionPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    get_or_create_user(telegram_id)
    t_type = payload.t_type
    if t_type not in {"income", "expense"}:
        raise HTTPException(status_code=400, detail="Invalid type")
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    add_transaction(telegram_id, t_type, payload.amount, payload.description.strip())
    balance = get_budget_summary(telegram_id)
    return {"ok": True, "balance": balance}


@app.post("/api/summary")
def api_summary(payload: SummaryPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    get_or_create_user(telegram_id)
    if payload.t_type not in {"income", "expense"}:
        raise HTTPException(status_code=400, detail="Invalid type")
    days = _period_to_days(payload.period)
    if not days:
        raise HTTPException(status_code=400, detail="Invalid period")
    total, count = get_period_summary(telegram_id, payload.t_type, days)
    return {"total": total, "count": count}


@app.post("/api/invite")
def api_invite(payload: InitPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    get_or_create_user(telegram_id)
    code = create_invite(telegram_id)
    return {"code": code}


@app.post("/api/join")
def api_join(payload: JoinPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    get_or_create_user(telegram_id)
    ok = use_invite(telegram_id, payload.code.strip().upper())
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid or used code")
    balance = get_budget_summary(telegram_id)
    return {"ok": True, "balance": balance}


@app.post("/api/leave")
def api_leave(payload: InitPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    get_or_create_user(telegram_id)
    leave_budget(telegram_id)
    balance = get_budget_summary(telegram_id)
    return {"ok": True, "balance": balance}


@app.post("/api/kick")
def api_kick(payload: KickPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    get_or_create_user(telegram_id)
    ok = remove_user_from_budget(telegram_id, payload.target_id)
    if not ok:
        raise HTTPException(status_code=400, detail="Not allowed")
    return {"ok": True}
