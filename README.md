# Telegram бюджет-бот + Mini App

Мини-приложение (Telegram Web App) с учетом доходов/расходов, общим бюджетом и приглашениями для объединения бюджета.

## Установка

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Запуск

```powershell
$env:TELEGRAM_API_KEY="ВАШ_КЛЮЧ"
python bot.py
```

## Команды

- `/start` — главное меню и текущий общий бюджет.
- `/join КОД` — присоединиться к общему бюджету по коду.
- `/leave` — выйти из общего бюджета и создать личный.
- `/kick TELEGRAM_ID` — удалить пользователя из общего бюджета (только владелец).

## Mini App (Cloudflare Pages + Render)

### Backend (Render)

1) Создайте новый Web Service в Render из этого репозитория.
2) Build Command:

```bash
pip install -r requirements.txt
```

3) Start Command:

```bash
uvicorn server:app --host 0.0.0.0 --port $PORT
```

4) Env Vars:
- `TELEGRAM_API_KEY` — токен бота.
- `DB_PATH` — путь к SQLite (например, `/data/bot.db`, если подключите диск).

### Frontend (Cloudflare Pages)

1) Создайте новый проект Pages и подключите репозиторий.
2) Build command — пусто.
3) Output directory — `webapp`.
4) В файле `webapp/app.js` замените `API_BASE` на URL Render, например:

```js
const API_BASE = "https://your-app.onrender.com";
```

### BotFather настройки

1) `/setdomain` — укажите домен Cloudflare Pages (например, `https://your-app.pages.dev`).
2) `/setmenubutton` → `Web App` → URL мини-приложения.

После этого Mini App будет открываться из меню бота.
