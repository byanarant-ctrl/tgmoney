const API_BASE = window.API_BASE || "https://YOUR-RENDER-APP.onrender.com";
const tg = window.Telegram ? window.Telegram.WebApp : null;

const panels = {
  income: document.getElementById("panel-income"),
  expense: document.getElementById("panel-expense"),
  plans: document.getElementById("panel-plans"),
  invite: document.getElementById("panel-invite"),
  error: document.getElementById("panel-error"),
};

const balanceEl = document.getElementById("balance");
const menuSection = document.querySelector(".menu");
const errorMessage = document.getElementById("error-message");

function showPanel(name) {
  Object.values(panels).forEach((panel) => panel.classList.add("hidden"));
  if (name === "menu") {
    menuSection.classList.remove("hidden");
    return;
  }
  menuSection.classList.add("hidden");
  if (panels[name]) panels[name].classList.remove("hidden");
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = data.detail || "Ошибка запроса";
    throw new Error(message);
  }
  return res.json();
}

function ensureTelegram() {
  if (!tg || !tg.initData) {
    errorMessage.textContent =
      "Откройте мини-приложение внутри Telegram.";
    showPanel("error");
    return false;
  }
  return true;
}

async function init() {
  if (!ensureTelegram()) return;
  tg.expand();
  try {
    const data = await apiPost("/api/init", { initData: tg.initData });
    balanceEl.textContent = formatMoney(data.balance);
    const kickForm = document.getElementById("kick-form");
    if (data.is_owner) {
      kickForm.classList.remove("hidden");
    }
  } catch (err) {
    errorMessage.textContent = err.message;
    showPanel("error");
  }
}

document.querySelectorAll(".card").forEach((btn) => {
  btn.addEventListener("click", () => {
    showPanel(btn.dataset.target);
  });
});

document.querySelectorAll(".back").forEach((btn) => {
  btn.addEventListener("click", () => {
    showPanel("menu");
  });
});

document.getElementById("income-add").addEventListener("click", async () => {
  if (!ensureTelegram()) return;
  const amount = parseFloat(
    document.getElementById("income-amount").value.replace(",", ".")
  );
  const description = document.getElementById("income-desc").value.trim();
  const result = document.getElementById("income-result");
  if (!amount || Number.isNaN(amount)) {
    result.textContent = "Введите сумму.";
    return;
  }
  try {
    const data = await apiPost("/api/transaction", {
      initData: tg.initData,
      t_type: "income",
      amount,
      description,
    });
    balanceEl.textContent = formatMoney(data.balance);
    result.textContent = "Доход добавлен.";
  } catch (err) {
    result.textContent = err.message;
  }
});

document.getElementById("expense-add").addEventListener("click", async () => {
  if (!ensureTelegram()) return;
  const amount = parseFloat(
    document.getElementById("expense-amount").value.replace(",", ".")
  );
  const description = document.getElementById("expense-desc").value.trim();
  const result = document.getElementById("expense-result");
  if (!amount || Number.isNaN(amount)) {
    result.textContent = "Введите сумму.";
    return;
  }
  try {
    const data = await apiPost("/api/transaction", {
      initData: tg.initData,
      t_type: "expense",
      amount,
      description,
    });
    balanceEl.textContent = formatMoney(data.balance);
    result.textContent = "Расход добавлен.";
  } catch (err) {
    result.textContent = err.message;
  }
});

document.querySelectorAll("[data-summary]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (!ensureTelegram()) return;
    const [t_type, period] = btn.dataset.summary.split(":");
    const resultEl =
      t_type === "income"
        ? document.getElementById("income-result")
        : document.getElementById("expense-result");
    try {
      const data = await apiPost("/api/summary", {
        initData: tg.initData,
        t_type,
        period,
      });
      const label = t_type === "income" ? "Доходы" : "Расходы";
      resultEl.textContent = `${label}: ${formatMoney(
        data.total
      )} (записей: ${data.count})`;
    } catch (err) {
      resultEl.textContent = err.message;
    }
  });
});

document.getElementById("invite-create").addEventListener("click", async () => {
  if (!ensureTelegram()) return;
  const out = document.getElementById("invite-code");
  try {
    const data = await apiPost("/api/invite", { initData: tg.initData });
    out.textContent = `Код: ${data.code}`;
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("join-submit").addEventListener("click", async () => {
  if (!ensureTelegram()) return;
  const code = document.getElementById("join-code").value.trim();
  const out = document.getElementById("invite-result");
  if (!code) {
    out.textContent = "Введите код приглашения.";
    return;
  }
  try {
    const data = await apiPost("/api/join", { initData: tg.initData, code });
    balanceEl.textContent = formatMoney(data.balance);
    out.textContent = "Бюджет объединен.";
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("leave-budget").addEventListener("click", async () => {
  if (!ensureTelegram()) return;
  const out = document.getElementById("invite-result");
  try {
    const data = await apiPost("/api/leave", { initData: tg.initData });
    balanceEl.textContent = formatMoney(data.balance);
    out.textContent = "Вы вышли из общего бюджета.";
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("kick-submit").addEventListener("click", async () => {
  if (!ensureTelegram()) return;
  const targetId = parseInt(document.getElementById("kick-id").value, 10);
  const out = document.getElementById("invite-result");
  if (!targetId) {
    out.textContent = "Введите Telegram ID.";
    return;
  }
  try {
    await apiPost("/api/kick", { initData: tg.initData, target_id: targetId });
    out.textContent = "Пользователь удален из бюджета.";
  } catch (err) {
    out.textContent = err.message;
  }
});

init();
