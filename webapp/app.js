const API_BASE = window.API_BASE || "https://tgmoney.onrender.com";
const tg = window.Telegram ? window.Telegram.WebApp : null;

const panels = {
  income: document.getElementById("panel-income"),
  expense: document.getElementById("panel-expense"),
  plans: document.getElementById("panel-plans"),
  invite: document.getElementById("panel-invite"),
  planCreate: document.getElementById("panel-plan-create"),
  error: document.getElementById("panel-error"),
};

const balanceEl = document.getElementById("balance");
const homeSections = [
  document.querySelector(".main-actions"),
  document.querySelector(".quick-actions"),
  document.querySelector(".plans"),
];
const fab = document.getElementById("plan-add");
const errorMessage = document.getElementById("error-message");

function showPanel(name) {
  Object.values(panels).forEach((panel) => panel.classList.add("hidden"));
  if (name === "home") {
    homeSections.forEach((section) => section.classList.remove("hidden"));
    fab.classList.remove("hidden");
    return;
  }
  homeSections.forEach((section) => section.classList.add("hidden"));
  fab.classList.add("hidden");
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
    await loadPlans();
  } catch (err) {
    errorMessage.textContent = err.message;
    showPanel("error");
  }
}

document.querySelectorAll(".back").forEach((btn) => {
  btn.addEventListener("click", () => {
    showPanel("home");
  });
});

document.querySelectorAll("[data-target]").forEach((btn) => {
  btn.addEventListener("click", () => {
    showPanel(btn.dataset.target);
    if (btn.dataset.target === "income") {
      loadTransactions("income");
    }
    if (btn.dataset.target === "expense") {
      loadTransactions("expense");
    }
  });
});

fab.addEventListener("click", () => {
  showPanel("planCreate");
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
    await loadTransactions("income");
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
    await loadTransactions("expense");
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
    await loadPlans();
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

document.getElementById("plan-save").addEventListener("click", async () => {
  if (!ensureTelegram()) return;
  const title = document.getElementById("plan-title").value.trim();
  const description = document.getElementById("plan-desc").value.trim();
  const targetAmount = parseFloat(
    document.getElementById("plan-amount").value.replace(",", ".")
  );
  const out = document.getElementById("plan-result");
  if (!title) {
    out.textContent = "Введите название.";
    return;
  }
  if (!targetAmount || Number.isNaN(targetAmount)) {
    out.textContent = "Введите сумму.";
    return;
  }
  try {
    await apiPost("/api/plan", {
      initData: tg.initData,
      title,
      description,
      target_amount: targetAmount,
    });
    out.textContent = "План сохранен.";
    await loadPlans();
    showPanel("home");
  } catch (err) {
    out.textContent = err.message;
  }
});

async function loadPlans() {
  if (!ensureTelegram()) return;
  const list = document.getElementById("plans-list");
  list.innerHTML = "";
  try {
    const data = await apiPost("/api/plans", { initData: tg.initData });
    if (!data.items.length) {
      list.innerHTML = "<div class=\"result\">Планов пока нет.</div>";
      return;
    }
    data.items.forEach((plan) => {
      const card = document.createElement("div");
      card.className = "plan-card";
      card.innerHTML = `
        <h4>${plan.title}</h4>
        <div>${plan.description || ""}</div>
        <div class="plan-meta">Цель: ${formatMoney(plan.target_amount)} · ${plan.created_by}</div>
      `;
      list.appendChild(card);
    });
  } catch (err) {
    list.innerHTML = `<div class="result">${err.message}</div>`;
  }
}

async function loadTransactions(tType) {
  if (!ensureTelegram()) return;
  const list = document.getElementById(
    tType === "income" ? "income-list" : "expense-list"
  );
  list.innerHTML = "";
  try {
    const data = await apiPost("/api/transactions", {
      initData: tg.initData,
      t_type: tType,
      period: "week",
    });
    if (!data.items.length) {
      list.innerHTML = "<div class=\"result\">Нет записей.</div>";
      return;
    }
    data.items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "list-item";
      row.innerHTML = `
        <span><strong>${formatMoney(item.amount)}</strong> · ${item.description || "Без описания"}</span>
        <span>${item.added_by || "—"}</span>
      `;
      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = `<div class="result">${err.message}</div>`;
  }
}

showPanel("home");
init();
