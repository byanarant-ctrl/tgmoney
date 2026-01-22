import logging
import os
from datetime import datetime

from telegram import ReplyKeyboardMarkup, Update
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from db import (
    add_transaction,
    create_invite,
    get_budget_summary,
    get_period_summary,
    get_or_create_user,
    init_db,
    leave_budget,
    remove_user_from_budget,
    use_invite,
)

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO
)

AMOUNT, DESCRIPTION = range(2)

MAIN_MENU = ReplyKeyboardMarkup(
    [["Расходы", "Доходы"], ["Планы", "Пригласить"]], resize_keyboard=True
)
INCOME_MENU = ReplyKeyboardMarkup(
    [["Добавить доход"], ["Доходы: неделя", "Доходы: месяц"], ["Доходы: год", "Назад"]],
    resize_keyboard=True,
)
EXPENSE_MENU = ReplyKeyboardMarkup(
    [
        ["Добавить расход"],
        ["Расходы: неделя", "Расходы: месяц"],
        ["Расходы: год", "Назад"],
    ],
    resize_keyboard=True,
)


def format_money(value: float) -> str:
    return f"{value:.2f}"


async def show_main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    balance = get_budget_summary(update.effective_user.id)
    await update.message.reply_text(
        f"Ваш общий бюджет: {format_money(balance)}", reply_markup=MAIN_MENU
    )


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    display_name = f"@{user.username}" if user.username else user.full_name
    get_or_create_user(user.id, display_name)
    await show_main_menu(update, context)


async def join(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    display_name = f"@{user.username}" if user.username else user.full_name
    get_or_create_user(user.id, display_name)
    if not context.args:
        await update.message.reply_text("Использование: /join КОД")
        return
    code = context.args[0].strip().upper()
    result = use_invite(update.effective_user.id, code)
    if result:
        await update.message.reply_text(
            "Бюджет объединен. Теперь вы видите общие доходы и расходы."
        )
        await show_main_menu(update, context)
    else:
        await update.message.reply_text("Код недействителен или уже использован.")


async def leave(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    get_or_create_user(update.effective_user.id)
    leave_budget(update.effective_user.id)
    await update.message.reply_text(
        "Вы вышли из общего бюджета и получили личный бюджет."
    )
    await show_main_menu(update, context)


async def kick(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    get_or_create_user(update.effective_user.id)
    if not context.args:
        await update.message.reply_text("Использование: /kick TELEGRAM_ID")
        return
    raw = context.args[0].strip()
    try:
        target_id = int(raw)
    except ValueError:
        await update.message.reply_text("TELEGRAM_ID должен быть числом.")
        return
    success = remove_user_from_budget(update.effective_user.id, target_id)
    if success:
        await update.message.reply_text("Пользователь удален из общего бюджета.")
    else:
        await update.message.reply_text(
            "Не удалось удалить. Проверьте, что вы владелец бюджета и пользователь в нем."
        )


async def menu_router(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    display_name = f"@{user.username}" if user.username else user.full_name
    get_or_create_user(user.id, display_name)
    text = update.message.text.strip()
    if text == "Доходы":
        await update.message.reply_text("Выберите действие:", reply_markup=INCOME_MENU)
        return
    if text == "Расходы":
        await update.message.reply_text(
            "Выберите действие:", reply_markup=EXPENSE_MENU
        )
        return
    if text == "Планы":
        await update.message.reply_text(
            "Раздел \"Планы\" в разработке.", reply_markup=MAIN_MENU
        )
        return
    if text == "Пригласить":
        code = create_invite(update.effective_user.id)
        await update.message.reply_text(
            "Передайте этот код другому пользователю:\n"
            f"{code}\n"
            "Он должен отправить команду /join КОД",
            reply_markup=MAIN_MENU,
        )
        return
    if text == "Назад":
        await show_main_menu(update, context)
        return
    if text.startswith("Доходы: "):
        period = text.replace("Доходы: ", "")
        await show_period_summary(update, context, "income", period)
        return
    if text.startswith("Расходы: "):
        period = text.replace("Расходы: ", "")
        await show_period_summary(update, context, "expense", period)
        return
    await update.message.reply_text("Не понял команду.", reply_markup=MAIN_MENU)


def period_to_days(period: str) -> int | None:
    return {"неделя": 7, "месяц": 30, "год": 365}.get(period)


async def show_period_summary(
    update: Update, context: ContextTypes.DEFAULT_TYPE, t_type: str, period: str
) -> None:
    days = period_to_days(period)
    if not days:
        await update.message.reply_text("Неизвестный период.", reply_markup=MAIN_MENU)
        return
    total, count = get_period_summary(update.effective_user.id, t_type, days)
    label = "Доходы" if t_type == "income" else "Расходы"
    await update.message.reply_text(
        f"{label} за {period}: {format_money(total)}\n"
        f"Записей: {count}",
        reply_markup=MAIN_MENU,
    )


async def add_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    user = update.effective_user
    display_name = f"@{user.username}" if user.username else user.full_name
    get_or_create_user(user.id, display_name)
    text = update.message.text.strip()
    if text == "Добавить доход":
        context.user_data["pending_type"] = "income"
    elif text == "Добавить расход":
        context.user_data["pending_type"] = "expense"
    else:
        await update.message.reply_text("Не понял команду.", reply_markup=MAIN_MENU)
        return ConversationHandler.END
    await update.message.reply_text("Введите сумму:")
    return AMOUNT


async def add_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    raw = update.message.text.strip().replace(",", ".")
    try:
        amount = float(raw)
        if amount <= 0:
            raise ValueError
    except ValueError:
        await update.message.reply_text("Введите положительное число.")
        return AMOUNT
    context.user_data["pending_amount"] = amount
    await update.message.reply_text("Введите описание:")
    return DESCRIPTION


async def add_description(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    description = update.message.text.strip()
    t_type = context.user_data.get("pending_type")
    amount = context.user_data.get("pending_amount")
    if not t_type or amount is None:
        await update.message.reply_text("Что-то пошло не так.", reply_markup=MAIN_MENU)
        return ConversationHandler.END
    user = update.effective_user
    display_name = f"@{user.username}" if user.username else user.full_name
    add_transaction(user.id, t_type, amount, description, display_name)
    when = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    await update.message.reply_text(
        f"Запись добавлена ({when}).", reply_markup=MAIN_MENU
    )
    await show_main_menu(update, context)
    return ConversationHandler.END


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    await update.message.reply_text("Операция отменена.", reply_markup=MAIN_MENU)
    return ConversationHandler.END


def main() -> None:
    api_key = os.getenv("TELEGRAM_API_KEY")
    if not api_key:
        raise RuntimeError("Не задан TELEGRAM_API_KEY")
    init_db()
    app = ApplicationBuilder().token(api_key).build()

    add_conv = ConversationHandler(
        entry_points=[
            MessageHandler(
                filters.Regex("^Добавить доход$|^Добавить расход$"), add_start
            )
        ],
        states={
            AMOUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, add_amount)],
            DESCRIPTION: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, add_description)
            ],
        },
        fallbacks=[CommandHandler("cancel", cancel)],
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("join", join))
    app.add_handler(CommandHandler("leave", leave))
    app.add_handler(CommandHandler("kick", kick))
    app.add_handler(add_conv)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, menu_router))

    app.run_polling()


if __name__ == "__main__":
    main()
