const API_BASE = window.API_BASE || "https://tgmoney.onrender.com";
const tg = window.Telegram ? window.Telegram.WebApp : null;

const panels = {
  income: document.getElementById("panel-income"),
  expense: document.getElementById("panel-expense"),
  plans: document.getElementById("panel-plans"),
  planCreate: document.getElementById("panel-plan-create"),
  planDetail: document.getElementById("panel-plan-detail"),
  settings: document.getElementById("panel-settings"),
  error: document.getElementById("panel-error"),
};

const balanceEl = document.getElementById("balance");
const homeSections = [
  document.querySelector(".main-actions"),
];
const settingsButton = document.getElementById("settings-open");
let currentPlanId = null;
let currentMode = "personal";
const errorMessage = document.getElementById("error-message");

function showPanel(name) {
  Object.values(panels).forEach((panel) => panel.classList.add("hidden"));
  if (name === "home") {
    homeSections.forEach((section) => section.classList.remove("hidden"));
    settingsButton.classList.remove("hidden");
    return;
  }
  homeSections.forEach((section) => section.classList.add("hidden"));
  settingsButton.classList.add("hidden");
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
    currentMode = data.mode;
    await loadPlans();
    await loadUsers();
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
    if (btn.dataset.target === "plans") {
      loadPlans();
    }
  });
});

settingsButton.addEventListener("click", () => {
  showPanel("settings");
  loadUsers();
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
    document.getElementById("income-amount").value = "";
    document.getElementById("income-desc").value = "";
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
    document.getElementById("expense-amount").value = "";
    document.getElementById("expense-desc").value = "";
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
  const out = document.getElementById("settings-result");
  if (!code) {
    out.textContent = "Введите код приглашения.";
    return;
  }
  try {
    const data = await apiPost("/api/join", { initData: tg.initData, code });
    balanceEl.textContent = formatMoney(data.balance);
    out.textContent = "Бюджет объединен.";
    document.getElementById("join-code").value = "";
    await loadUsers();
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("kick-submit").addEventListener("click", async () => {
  if (!ensureTelegram()) return;
  const targetId = parseInt(document.getElementById("kick-id").value, 10);
  const out = document.getElementById("settings-result");
  if (!targetId) {
    out.textContent = "Введите Telegram ID.";
    return;
  }
  try {
    await apiPost("/api/kick", { initData: tg.initData, target_id: targetId });
    out.textContent = "Пользователь удален из бюджета.";
    document.getElementById("kick-id").value = "";
    await loadUsers();
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
    document.getElementById("plan-title").value = "";
    document.getElementById("plan-desc").value = "";
    document.getElementById("plan-amount").value = "";
    await loadPlans();
    showPanel("plans");
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("plan-add-open").addEventListener("click", () => {
  showPanel("planCreate");
});

document.getElementById("plan-edit-save").addEventListener("click", async () => {
  if (!ensureTelegram() || !currentPlanId) return;
  const title = document.getElementById("plan-edit-title").value.trim();
  const description = document.getElementById("plan-edit-desc").value.trim();
  const targetAmount = parseFloat(
    document.getElementById("plan-edit-target").value.replace(",", ".")
  );
  const out = document.getElementById("plan-edit-result");
  if (!title) {
    out.textContent = "Введите название.";
    return;
  }
  if (!targetAmount || Number.isNaN(targetAmount)) {
    out.textContent = "Введите сумму.";
    return;
  }
  try {
    await apiPost("/api/plan/update", {
      initData: tg.initData,
      plan_id: currentPlanId,
      title,
      description,
      target_amount: targetAmount,
    });
    out.textContent = "План обновлен.";
    await loadPlans();
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("plan-deposit").addEventListener("click", async () => {
  if (!ensureTelegram() || !currentPlanId) return;
  const amount = parseFloat(
    document.getElementById("plan-deposit-amount").value.replace(",", ".")
  );
  const out = document.getElementById("plan-edit-result");
  if (!amount || Number.isNaN(amount)) {
    out.textContent = "Введите сумму.";
    return;
  }
  try {
    await apiPost("/api/plan/deposit", {
      initData: tg.initData,
      plan_id: currentPlanId,
      amount,
    });
    out.textContent = "Баланс плана пополнен.";
    document.getElementById("plan-deposit-amount").value = "";
    await loadPlanDetail(currentPlanId);
    await loadPlans();
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("switch-budget").addEventListener("click", async () => {
  if (!ensureTelegram()) return;
  const out = document.getElementById("settings-result");
  const nextMode = currentMode === "shared" ? "personal" : "shared";
  try {
    const data = await apiPost("/api/budget/switch", {
      initData: tg.initData,
      mode: nextMode,
    });
    currentMode = nextMode;
    balanceEl.textContent = formatMoney(data.balance);
    out.textContent = `Активен бюджет: ${currentMode}`;
    await loadUsers();
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
      card.dataset.planId = plan.id;
      card.innerHTML = `
        <h4>${plan.title}</h4>
        <div>${plan.description || ""}</div>
        <div class="plan-meta">Цель: ${formatMoney(plan.target_amount)}</div>
        <div class="plan-meta">Накоплено: ${formatMoney(plan.current_amount)} · ${plan.created_by}</div>
      `;
      card.addEventListener("click", () => {
        loadPlanDetail(plan.id);
      });
      list.appendChild(card);
    });
  } catch (err) {
    list.innerHTML = `<div class="result">${err.message}</div>`;
  }
}

async function loadPlanDetail(planId) {
  if (!ensureTelegram()) return;
  currentPlanId = planId;
  const out = document.getElementById("plan-edit-result");
  const current = document.getElementById("plan-current");
  out.textContent = "";
  try {
    const data = await apiPost("/api/plan/get", {
      initData: tg.initData,
      plan_id: planId,
    });
    document.getElementById("plan-edit-title").value = data.title;
    document.getElementById("plan-edit-desc").value = data.description;
    document.getElementById("plan-edit-target").value = data.target_amount;
    current.textContent = `Накоплено: ${formatMoney(data.current_amount)}`;
    showPanel("planDetail");
  } catch (err) {
    out.textContent = err.message;
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

async function loadUsers() {
  if (!ensureTelegram()) return;
  const list = document.getElementById("users-list");
  list.innerHTML = "";
  try {
    const data = await apiPost("/api/users", { initData: tg.initData });
    currentMode = data.mode;
    const switchButton = document.getElementById("switch-budget");
    if (!data.has_shared) {
      switchButton.textContent = "Нет общего бюджета";
      switchButton.disabled = true;
    } else {
      switchButton.disabled = false;
      switchButton.textContent =
        currentMode === "shared"
          ? "Переключить на личный"
          : "Переключить на общий";
    }
    if (!data.users.length) {
      list.innerHTML = "<div class=\"result\">Пока никого нет.</div>";
      return;
    }
    data.users.forEach((user) => {
      const row = document.createElement("div");
      row.className = "list-item";
      row.innerHTML = `
        <span><strong>${user.display_name || "Без имени"}</strong></span>
        <span>${user.telegram_id}</span>
      `;
      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = `<div class="result">${err.message}</div>`;
  }
}

showPanel("home");
init();
