import os
import sqlite3
from datetime import datetime, timedelta
import secrets
import string

DB_PATH = os.getenv("DB_PATH", "bot.db")


def _connect() -> sqlite3.Connection:
    return sqlite3.connect(DB_PATH)


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS budgets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id INTEGER,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                telegram_id INTEGER PRIMARY KEY,
                budget_id INTEGER NOT NULL,
                display_name TEXT,
                personal_budget_id INTEGER,
                shared_budget_id INTEGER,
                created_at TEXT NOT NULL,
                FOREIGN KEY(budget_id) REFERENCES budgets(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                budget_id INTEGER NOT NULL,
                t_type TEXT NOT NULL,
                amount REAL NOT NULL,
                description TEXT NOT NULL,
                added_by TEXT,
                category TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(budget_id) REFERENCES budgets(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                budget_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                target_amount REAL NOT NULL,
                current_amount REAL NOT NULL,
                created_by TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(budget_id) REFERENCES budgets(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS invites (
                code TEXT PRIMARY KEY,
                budget_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                used_by INTEGER,
                used_at TEXT,
                FOREIGN KEY(budget_id) REFERENCES budgets(id)
            )
            """
        )
        cols = {row[1] for row in conn.execute("PRAGMA table_info(budgets)")}
        if "owner_id" not in cols:
            conn.execute("ALTER TABLE budgets ADD COLUMN owner_id INTEGER")
        user_cols = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
        if "display_name" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN display_name TEXT")
        if "personal_budget_id" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN personal_budget_id INTEGER")
        if "shared_budget_id" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN shared_budget_id INTEGER")
        tx_cols = {row[1] for row in conn.execute("PRAGMA table_info(transactions)")}
        if "added_by" not in tx_cols:
            conn.execute("ALTER TABLE transactions ADD COLUMN added_by TEXT")
        if "category" not in tx_cols:
            conn.execute("ALTER TABLE transactions ADD COLUMN category TEXT")
        plan_cols = {row[1] for row in conn.execute("PRAGMA table_info(plans)")}
        if "current_amount" not in plan_cols:
            conn.execute("ALTER TABLE plans ADD COLUMN current_amount REAL NOT NULL DEFAULT 0")

        conn.execute(
            """
            UPDATE budgets
            SET owner_id = (
                SELECT telegram_id FROM users WHERE users.budget_id = budgets.id LIMIT 1
            )
            WHERE owner_id IS NULL
            """
        )


def _now() -> str:
    return datetime.utcnow().isoformat(timespec="seconds")


def _create_budget(conn: sqlite3.Connection, owner_id: int) -> int:
    cur = conn.execute(
        "INSERT INTO budgets (owner_id, created_at) VALUES (?, ?)",
        (owner_id, _now()),
    )
    return int(cur.lastrowid)


def get_or_create_user(telegram_id: int, display_name: str | None = None) -> None:
    with _connect() as conn:
        cur = conn.execute(
            "SELECT budget_id, personal_budget_id FROM users WHERE telegram_id = ?",
            (telegram_id,),
        )
        row = cur.fetchone()
        if row:
            if display_name:
                conn.execute(
                    "UPDATE users SET display_name = ? WHERE telegram_id = ?",
                    (display_name, telegram_id),
                )
            budget_id, personal_budget_id = row
            if personal_budget_id is None:
                conn.execute(
                    "UPDATE users SET personal_budget_id = ? WHERE telegram_id = ?",
                    (budget_id, telegram_id),
                )
            return
        budget_id = _create_budget(conn, telegram_id)
        conn.execute(
            """
            INSERT INTO users (
                telegram_id, budget_id, display_name, personal_budget_id, created_at
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            (telegram_id, budget_id, display_name, budget_id, _now()),
        )


def _get_budget_id(conn: sqlite3.Connection, telegram_id: int) -> int:
    cur = conn.execute(
        "SELECT budget_id FROM users WHERE telegram_id = ?", (telegram_id,)
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError("User not found")
    return int(row[0])


def get_budget_summary(telegram_id: int) -> float:
    with _connect() as conn:
        budget_id = _get_budget_id(conn, telegram_id)
        cur = conn.execute(
            """
            SELECT COALESCE(
                SUM(CASE WHEN t_type = 'income' THEN amount ELSE -amount END),
                0
            )
            FROM transactions
            WHERE budget_id = ?
            """,
            (budget_id,),
        )
        return float(cur.fetchone()[0])


def add_transaction(
    telegram_id: int,
    t_type: str,
    amount: float,
    description: str,
    added_by: str | None,
    category: str | None,
) -> None:
    with _connect() as conn:
        budget_id = _get_budget_id(conn, telegram_id)
        conn.execute(
            """
            INSERT INTO transactions (
                budget_id, t_type, amount, description, added_by, category, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (budget_id, t_type, amount, description, added_by, category, _now()),
        )


def get_period_summary(
    telegram_id: int, t_type: str, days: int
) -> tuple[float, int]:
    start = (datetime.utcnow() - timedelta(days=days)).isoformat(timespec="seconds")
    with _connect() as conn:
        budget_id = _get_budget_id(conn, telegram_id)
        cur = conn.execute(
            """
            SELECT COALESCE(SUM(amount), 0), COUNT(*)
            FROM transactions
            WHERE budget_id = ? AND t_type = ? AND created_at >= ?
            """,
            (budget_id, t_type, start),
        )
        total, count = cur.fetchone()
        return float(total), int(count)


def get_recent_transactions(
    telegram_id: int, t_type: str, limit: int = 10
) -> list[tuple[int, float, str, str, str, str]]:
    with _connect() as conn:
        budget_id = _get_budget_id(conn, telegram_id)
        cur = conn.execute(
            """
            SELECT id, amount, description, COALESCE(added_by, ''), COALESCE(category, ''), created_at
            FROM transactions
            WHERE budget_id = ? AND t_type = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (budget_id, t_type, limit),
        )
        return list(cur.fetchall())


def list_transactions(
    telegram_id: int,
    t_type: str,
    start: str | None,
    end: str | None,
    limit: int = 50,
) -> list[tuple[int, float, str, str, str, str]]:
    with _connect() as conn:
        budget_id = _get_budget_id(conn, telegram_id)
        query = """
            SELECT id, amount, description, COALESCE(added_by, ''), COALESCE(category, ''), created_at
            FROM transactions
            WHERE budget_id = ? AND t_type = ?
        """
        params: list = [budget_id, t_type]
        if start:
            query += " AND created_at >= ?"
            params.append(start)
        if end:
            query += " AND created_at <= ?"
            params.append(end)
        query += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        cur = conn.execute(query, tuple(params))
        return list(cur.fetchall())


def update_transaction(
    telegram_id: int,
    transaction_id: int,
    amount: float,
    description: str,
    category: str,
) -> bool:
    with _connect() as conn:
        budget_id = _get_budget_id(conn, telegram_id)
        cur = conn.execute(
            """
            UPDATE transactions
            SET amount = ?, description = ?, category = ?
            WHERE id = ? AND budget_id = ?
            """,
            (amount, description, category, transaction_id, budget_id),
        )
        return cur.rowcount > 0


def list_categories(telegram_id: int, t_type: str) -> list[str]:
    with _connect() as conn:
        budget_id = _get_budget_id(conn, telegram_id)
        cur = conn.execute(
            """
            SELECT DISTINCT category
            FROM transactions
            WHERE budget_id = ? AND t_type = ? AND category IS NOT NULL AND category != ''
            ORDER BY category ASC
            """,
            (budget_id, t_type),
        )
        return [row[0] for row in cur.fetchall()]


def category_summary(
    telegram_id: int, t_type: str, start: str | None, end: str | None
) -> list[tuple[str, float]]:
    with _connect() as conn:
        budget_id = _get_budget_id(conn, telegram_id)
        query = """
            SELECT COALESCE(category, 'Без категории') AS cat, SUM(amount)
            FROM transactions
            WHERE budget_id = ? AND t_type = ?
        """
        params: list = [budget_id, t_type]
        if start:
            query += " AND created_at >= ?"
            params.append(start)
        if end:
            query += " AND created_at <= ?"
            params.append(end)
        query += " GROUP BY cat ORDER BY SUM(amount) DESC"
        cur = conn.execute(query, tuple(params))
        return [(row[0] or "Без категории", float(row[1] or 0)) for row in cur.fetchall()]


def _generate_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def create_invite(telegram_id: int) -> str:
    with _connect() as conn:
        budget_id = _get_budget_id(conn, telegram_id)
        conn.execute(
            """
            UPDATE users
            SET shared_budget_id = ?
            WHERE telegram_id = ? AND shared_budget_id IS NULL
            """,
            (budget_id, telegram_id),
        )
        while True:
            code = _generate_code()
            try:
                conn.execute(
                    "INSERT INTO invites (code, budget_id, created_at) VALUES (?, ?, ?)",
                    (code, budget_id, _now()),
                )
                return code
            except sqlite3.IntegrityError:
                continue


def use_invite(telegram_id: int, code: str) -> bool:
    with _connect() as conn:
        cur = conn.execute(
            "SELECT budget_id, used_by FROM invites WHERE code = ?", (code,)
        )
        row = cur.fetchone()
        if not row:
            return False
        budget_id, used_by = row
        if used_by is not None:
            return False
        conn.execute(
            "UPDATE users SET budget_id = ?, shared_budget_id = ? WHERE telegram_id = ?",
            (budget_id, budget_id, telegram_id),
        )
        conn.execute(
            "UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?",
            (telegram_id, _now(), code),
        )
        return True


def leave_budget(telegram_id: int) -> None:
    with _connect() as conn:
        cur = conn.execute(
            "SELECT personal_budget_id FROM users WHERE telegram_id = ?",
            (telegram_id,),
        )
        row = cur.fetchone()
        if not row:
            return
        personal_budget_id = row[0]
        if personal_budget_id is None:
            personal_budget_id = _create_budget(conn, telegram_id)
        conn.execute(
            """
            UPDATE users
            SET budget_id = ?, personal_budget_id = ?, shared_budget_id = NULL
            WHERE telegram_id = ?
            """,
            (personal_budget_id, personal_budget_id, telegram_id),
        )


def _get_budget_owner(conn: sqlite3.Connection, budget_id: int) -> int | None:
    cur = conn.execute(
        "SELECT owner_id FROM budgets WHERE id = ?", (budget_id,)
    )
    row = cur.fetchone()
    if not row:
        return None
    return row[0]


def add_plan(
    telegram_id: int, title: str, description: str, target_amount: float, created_by: str
) -> None:
    with _connect() as conn:
        budget_id = _get_budget_id(conn, telegram_id)
        conn.execute(
            """
            INSERT INTO plans (
                budget_id,
                title,
                description,
                target_amount,
                current_amount,
                created_by,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (budget_id, title, description, target_amount, 0.0, created_by, _now()),
        )


def list_plans(
    telegram_id: int,
) -> list[tuple[int, str, str, float, float, str, str]]:
    with _connect() as conn:
        budget_id = _get_budget_id(conn, telegram_id)
        cur = conn.execute(
            """
            SELECT
                id,
                title,
                description,
                target_amount,
                current_amount,
                COALESCE(created_by, ''),
                created_at
            FROM plans
            WHERE budget_id = ?
            ORDER BY id DESC
            """,
            (budget_id,),
        )
        return list(cur.fetchall())


def get_plan(
    telegram_id: int, plan_id: int
) -> tuple[int, str, str, float, float, str, str] | None:
    with _connect() as conn:
        budget_id = _get_budget_id(conn, telegram_id)
        cur = conn.execute(
            """
            SELECT
                id,
                title,
                description,
                target_amount,
                current_amount,
                COALESCE(created_by, ''),
                created_at
            FROM plans
            WHERE budget_id = ? AND id = ?
            """,
            (budget_id, plan_id),
        )
        return cur.fetchone()


def update_plan(
    telegram_id: int, plan_id: int, title: str, description: str, target_amount: float
) -> bool:
    with _connect() as conn:
        budget_id = _get_budget_id(conn, telegram_id)
        cur = conn.execute(
            """
            UPDATE plans
            SET title = ?, description = ?, target_amount = ?
            WHERE id = ? AND budget_id = ?
            """,
            (title, description, target_amount, plan_id, budget_id),
        )
        return cur.rowcount > 0


def deposit_plan(telegram_id: int, plan_id: int, amount: float) -> bool:
    with _connect() as conn:
        budget_id = _get_budget_id(conn, telegram_id)
        cur = conn.execute(
            """
            UPDATE plans
            SET current_amount = current_amount + ?
            WHERE id = ? AND budget_id = ?
            """,
            (amount, plan_id, budget_id),
        )
        return cur.rowcount > 0


def get_budget_users(telegram_id: int, use_shared: bool) -> list[tuple[int, str]]:
    with _connect() as conn:
        cur = conn.execute(
            "SELECT personal_budget_id, shared_budget_id FROM users WHERE telegram_id = ?",
            (telegram_id,),
        )
        row = cur.fetchone()
        if not row:
            return []
        personal_budget_id, shared_budget_id = row
        budget_id = shared_budget_id if use_shared else personal_budget_id
        if budget_id is None:
            return []
        if use_shared:
            cur = conn.execute(
                """
                SELECT telegram_id, COALESCE(display_name, '')
                FROM users
                WHERE shared_budget_id = ?
                ORDER BY telegram_id ASC
                """,
                (budget_id,),
            )
            return list(cur.fetchall())
        cur = conn.execute(
            """
            SELECT telegram_id, COALESCE(display_name, '')
            FROM users
            WHERE budget_id = ?
            ORDER BY telegram_id ASC
            """,
            (budget_id,),
        )
        return list(cur.fetchall())


def get_budget_state(telegram_id: int) -> tuple[int | None, int | None, int | None]:
    with _connect() as conn:
        cur = conn.execute(
            """
            SELECT budget_id, personal_budget_id, shared_budget_id
            FROM users
            WHERE telegram_id = ?
            """,
            (telegram_id,),
        )
        row = cur.fetchone()
        if not row:
            return None, None, None
        return row[0], row[1], row[2]


def switch_budget(telegram_id: int, mode: str) -> bool:
    with _connect() as conn:
        cur = conn.execute(
            """
            SELECT personal_budget_id, shared_budget_id
            FROM users
            WHERE telegram_id = ?
            """,
            (telegram_id,),
        )
        row = cur.fetchone()
        if not row:
            return False
        personal_budget_id, shared_budget_id = row
        if mode == "personal":
            if personal_budget_id is None:
                personal_budget_id = _create_budget(conn, telegram_id)
            conn.execute(
                "UPDATE users SET budget_id = ?, personal_budget_id = ? WHERE telegram_id = ?",
                (personal_budget_id, personal_budget_id, telegram_id),
            )
            return True
        if mode == "shared":
            if shared_budget_id is None:
                return False
            conn.execute(
                "UPDATE users SET budget_id = ? WHERE telegram_id = ?",
                (shared_budget_id, telegram_id),
            )
            return True
        return False


def get_budget_owner_id(telegram_id: int) -> int | None:
    with _connect() as conn:
        budget_id = _get_budget_id(conn, telegram_id)
        return _get_budget_owner(conn, budget_id)


def remove_user_from_budget(owner_id: int, target_telegram_id: int) -> bool:
    with _connect() as conn:
        owner_budget_id = _get_budget_id(conn, owner_id)
        owner_of_budget = _get_budget_owner(conn, owner_budget_id)
        if owner_of_budget != owner_id:
            return False
        target_budget_id = _get_budget_id(conn, target_telegram_id)
        if target_budget_id != owner_budget_id:
            return False
        if target_telegram_id == owner_id:
            return False
        cur = conn.execute(
            "SELECT personal_budget_id FROM users WHERE telegram_id = ?",
            (target_telegram_id,),
        )
        row = cur.fetchone()
        personal_budget_id = row[0] if row else None
        if personal_budget_id is None:
            personal_budget_id = _create_budget(conn, target_telegram_id)
        conn.execute(
            """
            UPDATE users
            SET budget_id = ?, personal_budget_id = ?, shared_budget_id = NULL
            WHERE telegram_id = ?
            """,
            (personal_budget_id, personal_budget_id, target_telegram_id),
        )
        return True


def remove_user_from_budget_by_name(owner_id: int, target_name: str) -> bool:
    with _connect() as conn:
        owner_budget_id = _get_budget_id(conn, owner_id)
        owner_of_budget = _get_budget_owner(conn, owner_budget_id)
        if owner_of_budget != owner_id:
            return False
        cur = conn.execute(
            """
            SELECT telegram_id FROM users
            WHERE budget_id = ? AND LOWER(COALESCE(display_name, '')) = LOWER(?)
            """,
            (owner_budget_id, target_name),
        )
        row = cur.fetchone()
        if not row:
            return False
        target_telegram_id = int(row[0])
        if target_telegram_id == owner_id:
            return False
        return remove_user_from_budget(owner_id, target_telegram_id)
