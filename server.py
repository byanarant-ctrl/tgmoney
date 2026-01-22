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
    add_plan,
    create_invite,
    get_budget_owner_id,
    get_budget_state,
    get_budget_summary,
    get_or_create_user,
    get_period_summary,
    get_recent_transactions,
    get_plan,
    get_budget_users,
    switch_budget,
    leave_budget,
    list_plans,
    remove_user_from_budget,
    update_plan,
    deposit_plan,
    use_invite,
    init_db,
    list_transactions,
    update_transaction,
    list_categories,
    category_summary,
)


BOT_TOKEN = os.getenv("TELEGRAM_API_KEY", "").strip()


class InitPayload(BaseModel):
    initData: str


class TransactionPayload(InitPayload):
    t_type: str
    amount: float
    description: str
    category: str | None = None


class SummaryPayload(InitPayload):
    t_type: str
    period: str


class JoinPayload(InitPayload):
    code: str


class KickPayload(InitPayload):
    target_id: int


class PlanPayload(InitPayload):
    title: str
    description: str
    target_amount: float


class PlanUpdatePayload(InitPayload):
    plan_id: int
    title: str
    description: str
    target_amount: float


class PlanDepositPayload(InitPayload):
    plan_id: int
    amount: float


class PlanGetPayload(InitPayload):
    plan_id: int


class BudgetSwitchPayload(InitPayload):
    mode: str


class TransactionListPayload(InitPayload):
    t_type: str
    start: str | None = None
    end: str | None = None


class TransactionUpdatePayload(InitPayload):
    transaction_id: int
    amount: float
    description: str
    category: str


class CategoryPayload(InitPayload):
    t_type: str


class CategorySummaryPayload(InitPayload):
    t_type: str
    start: str | None = None
    end: str | None = None


class SummaryRangePayload(InitPayload):
    t_type: str
    start: str | None = None
    end: str | None = None


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


def _display_name(user: dict) -> str:
    username = user.get("username")
    if username:
        return f"@{username}"
    parts = [user.get("first_name", ""), user.get("last_name", "")]
    name = " ".join(p for p in parts if p)
    return name or f"id:{user.get('id')}"


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
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    balance = get_budget_summary(telegram_id)
    owner_id = get_budget_owner_id(telegram_id)
    active_budget, personal_budget, shared_budget = get_budget_state(telegram_id)
    return {
        "telegram_id": telegram_id,
        "balance": balance,
        "is_owner": owner_id == telegram_id,
        "mode": "shared" if shared_budget and active_budget == shared_budget else "personal",
        "has_shared": bool(shared_budget),
    }


@app.post("/api/transaction")
def api_transaction(payload: TransactionPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    t_type = payload.t_type
    if t_type not in {"income", "expense"}:
        raise HTTPException(status_code=400, detail="Invalid type")
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    add_transaction(
        telegram_id,
        t_type,
        payload.amount,
        payload.description.strip(),
        display_name,
        (payload.category or "").strip() or None,
    )
    balance = get_budget_summary(telegram_id)
    return {"ok": True, "balance": balance}


@app.post("/api/summary")
def api_summary(payload: SummaryPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
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
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    code = create_invite(telegram_id)
    return {"code": code}


@app.post("/api/join")
def api_join(payload: JoinPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    ok = use_invite(telegram_id, payload.code.strip().upper())
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid or used code")
    balance = get_budget_summary(telegram_id)
    return {"ok": True, "balance": balance}


@app.post("/api/leave")
def api_leave(payload: InitPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    leave_budget(telegram_id)
    balance = get_budget_summary(telegram_id)
    return {"ok": True, "balance": balance}


@app.post("/api/kick")
def api_kick(payload: KickPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    ok = remove_user_from_budget(telegram_id, payload.target_id)
    if not ok:
        raise HTTPException(status_code=400, detail="Not allowed")
    return {"ok": True}


@app.post("/api/transactions")
def api_transactions(payload: SummaryPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    if payload.t_type not in {"income", "expense"}:
        raise HTTPException(status_code=400, detail="Invalid type")
    rows = get_recent_transactions(telegram_id, payload.t_type, limit=10)
    items = [
        {
            "id": tx_id,
            "amount": amount,
            "description": description,
            "added_by": added_by,
            "category": category,
            "created_at": created_at,
        }
        for tx_id, amount, description, added_by, category, created_at in rows
    ]
    return {"items": items}


@app.post("/api/plans")
def api_plans(payload: InitPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    rows = list_plans(telegram_id)
    items = [
        {
            "id": plan_id,
            "title": title,
            "description": description,
            "target_amount": target_amount,
            "current_amount": current_amount,
            "created_by": created_by,
            "created_at": created_at,
        }
        for plan_id, title, description, target_amount, current_amount, created_by, created_at in rows
    ]
    return {"items": items}


@app.post("/api/plan")
def api_plan_create(payload: PlanPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    title = payload.title.strip()
    description = payload.description.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title required")
    if payload.target_amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    add_plan(telegram_id, title, description, payload.target_amount, display_name)
    return {"ok": True}


@app.post("/api/plan/get")
def api_plan_get(payload: PlanGetPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    row = get_plan(telegram_id, payload.plan_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    plan_id, title, description, target_amount, current_amount, created_by, created_at = row
    return {
        "id": plan_id,
        "title": title,
        "description": description,
        "target_amount": target_amount,
        "current_amount": current_amount,
        "created_by": created_by,
        "created_at": created_at,
    }


@app.post("/api/plan/update")
def api_plan_update(payload: PlanUpdatePayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    if payload.target_amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    ok = update_plan(
        telegram_id,
        payload.plan_id,
        payload.title.strip(),
        payload.description.strip(),
        payload.target_amount,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@app.post("/api/plan/deposit")
def api_plan_deposit(payload: PlanDepositPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    ok = deposit_plan(telegram_id, payload.plan_id, payload.amount)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@app.post("/api/users")
def api_users(payload: InitPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    active_budget, personal_budget, shared_budget = get_budget_state(telegram_id)
    items = []
    if shared_budget:
        rows = get_budget_users(telegram_id, use_shared=True)
        items = [{"telegram_id": uid, "display_name": name} for uid, name in rows]
    return {
        "telegram_id": telegram_id,
        "users": items,
        "mode": "shared" if shared_budget and active_budget == shared_budget else "personal",
        "has_shared": bool(shared_budget),
    }


@app.post("/api/budget/switch")
def api_budget_switch(payload: BudgetSwitchPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    mode = payload.mode.strip().lower()
    ok = switch_budget(telegram_id, mode)
    if not ok:
        raise HTTPException(status_code=400, detail="Not allowed")
    balance = get_budget_summary(telegram_id)
    return {"ok": True, "balance": balance}


@app.post("/api/transactions/list")
def api_transactions_list(payload: TransactionListPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    if payload.t_type not in {"income", "expense"}:
        raise HTTPException(status_code=400, detail="Invalid type")
    rows = list_transactions(
        telegram_id,
        payload.t_type,
        payload.start,
        payload.end,
        limit=50,
    )
    items = [
        {
            "id": tx_id,
            "amount": amount,
            "description": description,
            "added_by": added_by,
            "category": category,
            "created_at": created_at,
        }
        for tx_id, amount, description, added_by, category, created_at in rows
    ]
    return {"items": items}


@app.post("/api/transaction/update")
def api_transaction_update(payload: TransactionUpdatePayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    ok = update_transaction(
        telegram_id,
        payload.transaction_id,
        payload.amount,
        payload.description.strip(),
        payload.category.strip(),
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Not found")
    balance = get_budget_summary(telegram_id)
    return {"ok": True, "balance": balance}


@app.post("/api/categories")
def api_categories(payload: CategoryPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    if payload.t_type not in {"income", "expense"}:
        raise HTTPException(status_code=400, detail="Invalid type")
    items = list_categories(telegram_id, payload.t_type)
    return {"items": items}


@app.post("/api/categories/summary")
def api_category_summary(payload: CategorySummaryPayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    if payload.t_type not in {"income", "expense"}:
        raise HTTPException(status_code=400, detail="Invalid type")
    items = category_summary(telegram_id, payload.t_type, payload.start, payload.end)
    return {
        "items": [{"category": cat, "total": total} for cat, total in items]
    }


@app.post("/api/summary/range")
def api_summary_range(payload: SummaryRangePayload) -> dict:
    user = _verify_init_data(payload.initData)
    telegram_id = int(user["id"])
    display_name = _display_name(user)
    get_or_create_user(telegram_id, display_name)
    if payload.t_type not in {"income", "expense"}:
        raise HTTPException(status_code=400, detail="Invalid type")
    rows = list_transactions(
        telegram_id,
        payload.t_type,
        payload.start,
        payload.end,
        limit=500,
    )
    total = sum(row[1] for row in rows)
    return {"total": total, "count": len(rows)}
