const API_BASE = window.API_BASE || "https://tgmoney.onrender.com";
const tg = window.Telegram ? window.Telegram.WebApp : null;

const panels = {
  income: document.getElementById("panel-income"),
  expense: document.getElementById("panel-expense"),
  plans: document.getElementById("panel-plans"),
  planCreate: document.getElementById("panel-plan-create"),
  planDetail: document.getElementById("panel-plan-detail"),
  settings: document.getElementById("panel-settings"),
  transactionEdit: document.getElementById("panel-transaction-edit"),
  stats: document.getElementById("panel-stats"),
  error: document.getElementById("panel-error"),
};

const balanceEl = document.getElementById("balance");
const homeSections = [document.querySelector(".main-actions")];
const settingsButton = document.getElementById("settings-open");
const errorMessage = document.getElementById("error-message");

let currentPlanId = null;
let currentMode = "personal";
let currentTxId = null;
let currentTxType = null;
let statsType = "expense";
let statsChart = null;
let isOwner = false;
let currentUserId = null;

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
    isOwner = data.is_owner;
    currentUserId = data.telegram_id;
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
    if (btn.dataset.target === "income") loadTransactions("income");
    if (btn.dataset.target === "expense") loadTransactions("expense");
    if (btn.dataset.target === "plans") loadPlans();
    if (btn.dataset.target === "stats") renderStats();
    if (btn.dataset.target === "income") loadCategories("income");
    if (btn.dataset.target === "expense") loadCategories("expense");
  });
});

settingsButton.addEventListener("click", () => {
  showPanel("settings");
  loadUsers();
  loadCategories("income");
  loadCategories("expense");
});

document.getElementById("income-add").addEventListener("click", async () => {
  if (!ensureTelegram()) return;
  const amount = parseFloat(
    document.getElementById("income-amount").value.replace(",", ".")
  );
  const description = document.getElementById("income-desc").value.trim();
  const category =
    document.getElementById("income-category").value.trim() ||
    document.getElementById("income-category-select").value;
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
      category,
    });
    balanceEl.textContent = formatMoney(data.balance);
    result.textContent = "Доход добавлен.";
    document.getElementById("income-amount").value = "";
    document.getElementById("income-desc").value = "";
    document.getElementById("income-category").value = "";
    document.getElementById("income-category-select").value = "";
    await loadCategories("income");
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
  const category =
    document.getElementById("expense-category").value.trim() ||
    document.getElementById("expense-category-select").value;
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
      category,
    });
    balanceEl.textContent = formatMoney(data.balance);
    result.textContent = "Расход добавлен.";
    document.getElementById("expense-amount").value = "";
    document.getElementById("expense-desc").value = "";
    document.getElementById("expense-category").value = "";
    document.getElementById("expense-category-select").value = "";
    await loadCategories("expense");
    await loadTransactions("expense");
  } catch (err) {
    result.textContent = err.message;
  }
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

document.getElementById("leave-budget").addEventListener("click", async () => {
  if (!ensureTelegram()) return;
  const out = document.getElementById("settings-result");
  try {
    const data = await apiPost("/api/leave", { initData: tg.initData });
    balanceEl.textContent = formatMoney(data.balance);
    out.textContent = "Вы вышли из общего бюджета.";
    await loadUsers();
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("income-category-add").addEventListener("click", async () => {
  if (!ensureTelegram()) return;
  const name = document.getElementById("income-category-new").value.trim();
  const out = document.getElementById("settings-result");
  if (!name) {
    out.textContent = "Введите категорию дохода.";
    return;
  }
  try {
    await apiPost("/api/category/add", {
      initData: tg.initData,
      t_type: "income",
      name,
    });
    document.getElementById("income-category-new").value = "";
    out.textContent = "Категория добавлена.";
    await loadCategories("income");
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("expense-category-add").addEventListener("click", async () => {
  if (!ensureTelegram()) return;
  const name = document.getElementById("expense-category-new").value.trim();
  const out = document.getElementById("settings-result");
  if (!name) {
    out.textContent = "Введите категорию расхода.";
    return;
  }
  try {
    await apiPost("/api/category/add", {
      initData: tg.initData,
      t_type: "expense",
      name,
    });
    document.getElementById("expense-category-new").value = "";
    out.textContent = "Категория добавлена.";
    await loadCategories("expense");
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

document.getElementById("tx-edit-save").addEventListener("click", async () => {
  if (!ensureTelegram() || !currentTxId) return;
  const amount = parseFloat(
    document.getElementById("tx-edit-amount").value.replace(",", ".")
  );
  const description = document.getElementById("tx-edit-desc").value.trim();
  const category = document.getElementById("tx-edit-category").value.trim();
  const out = document.getElementById("tx-edit-result");
  if (!amount || Number.isNaN(amount)) {
    out.textContent = "Введите сумму.";
    return;
  }
  try {
    const data = await apiPost("/api/transaction/update", {
      initData: tg.initData,
      transaction_id: currentTxId,
      amount,
      description,
      category,
    });
    balanceEl.textContent = formatMoney(data.balance);
    out.textContent = "Запись обновлена.";
    await loadTransactions(currentTxType || "expense");
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("stats-income").addEventListener("click", () => {
  statsType = "income";
  renderStats();
});

document.getElementById("stats-expense").addEventListener("click", () => {
  statsType = "expense";
  renderStats();
});

document.getElementById("stats-apply").addEventListener("click", () => {
  renderStats();
});

document.querySelectorAll("[data-period]").forEach((btn) => {
  btn.addEventListener("click", () => {
    renderStats(btn.dataset.period);
  });
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
      const progress = Math.min(
        100,
        plan.target_amount ? (plan.current_amount / plan.target_amount) * 100 : 0
      );
      const remaining = Math.max(plan.target_amount - plan.current_amount, 0);
      card.innerHTML = `
        <h4>${plan.title}</h4>
        <div>${plan.description || ""}</div>
        <div class="plan-meta">Цель: ${formatMoney(plan.target_amount)}</div>
        <div class="plan-meta">Накоплено: ${formatMoney(
          plan.current_amount
        )} · Осталось: ${formatMoney(remaining)}</div>
        <div class="plan-progress"><span style="width:${progress.toFixed(
          1
        )}%"></span></div>
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
    const remaining = Math.max(data.target_amount - data.current_amount, 0);
    current.textContent = `Накоплено: ${formatMoney(
      data.current_amount
    )} · Осталось: ${formatMoney(remaining)}`;
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
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const start = `${yyyy}-${mm}-${dd}T00:00:00`;
  const end = `${yyyy}-${mm}-${dd}T23:59:59`;
  try {
    const data = await apiPost("/api/transactions/list", {
      initData: tg.initData,
      t_type: tType,
      start,
      end,
    });
    if (!data.items.length) {
      list.innerHTML = "<div class=\"result\">Нет записей.</div>";
      return;
    }
    data.items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "list-item";
      row.innerHTML = `
        <span><strong>${formatMoney(item.amount)}</strong> · ${
          item.description || "Без описания"
        } · ${item.category || "Без категории"}</span>
        <span>${item.added_by || "—"}</span>
      `;
      row.addEventListener("click", () => {
        currentTxId = item.id;
        currentTxType = tType;
        document.getElementById("tx-edit-amount").value = item.amount;
        document.getElementById("tx-edit-desc").value = item.description;
        document.getElementById("tx-edit-category").value = item.category || "";
        document.getElementById("tx-edit-result").textContent = "";
        showPanel("transactionEdit");
      });
      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = `<div class="result">${err.message}</div>`;
  }
}

async function loadUsers() {
  if (!ensureTelegram()) return;
  const list = document.getElementById("users-list");
  const usersSection = document.getElementById("users-section");
  const leaveSection = document.getElementById("leave-budget-section");
  list.innerHTML = "";
  try {
    const data = await apiPost("/api/users", { initData: tg.initData });
    currentMode = data.mode;
    const switchButton = document.getElementById("switch-budget");
    if (!data.has_shared) {
      switchButton.textContent = "Переключить бюджет";
      switchButton.disabled = true;
      usersSection.classList.add("hidden");
      leaveSection.classList.add("hidden");
      return;
    } else {
      switchButton.disabled = false;
      switchButton.textContent =
        currentMode === "shared"
          ? "Переключить на личный"
          : "Переключить на общий";
      usersSection.classList.remove("hidden");
      leaveSection.classList.remove("hidden");
    }
    if (!data.users.length) {
      list.innerHTML = "<div class=\"result\">Пока никого нет.</div>";
      return;
    }
    data.users.forEach((user) => {
      const row = document.createElement("div");
      row.className = "user-row";
      row.innerHTML = `
        <span><strong>${user.display_name || "Без имени"}</strong> · ${
          user.telegram_id
        }</span>
      `;
      if (isOwner && user.telegram_id !== currentUserId) {
        const btn = document.createElement("button");
        btn.textContent = "Удалить";
        btn.addEventListener("click", async () => {
          const out = document.getElementById("settings-result");
          try {
            await apiPost("/api/kick", {
              initData: tg.initData,
              target_id: user.telegram_id,
            });
            out.textContent = "Пользователь удален из бюджета.";
            await loadUsers();
          } catch (err) {
            out.textContent = err.message;
          }
        });
        row.appendChild(btn);
      }
      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = `<div class="result">${err.message}</div>`;
  }
}

async function loadCategories(tType) {
  if (!ensureTelegram()) return;
  const selectId =
    tType === "income" ? "income-category-select" : "expense-category-select";
  const listId =
    tType === "income" ? "income-categories-list" : "expense-categories-list";
  const select = document.getElementById(selectId);
  const list = document.getElementById(listId);
  try {
    const data = await apiPost("/api/categories/list", {
      initData: tg.initData,
      t_type: tType,
    });
    select.innerHTML = "<option value=\"\">Выбрать категорию</option>";
    list.innerHTML = "";
    data.items.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.name;
      opt.textContent = item.name;
      select.appendChild(opt);

      const row = document.createElement("div");
      row.className = "user-row";
      row.innerHTML = `<span><strong>${item.name}</strong></span>`;
      const editBtn = document.createElement("button");
      editBtn.textContent = "Редактировать";
      editBtn.addEventListener("click", async () => {
        const next = window.prompt("Новое название", item.name);
        if (!next) return;
        await apiPost("/api/category/update", {
          initData: tg.initData,
          category_id: item.id,
          name: next.trim(),
        });
        await loadCategories(tType);
      });
      const delBtn = document.createElement("button");
      delBtn.textContent = "Удалить";
      delBtn.addEventListener("click", async () => {
        await apiPost("/api/category/delete", {
          initData: tg.initData,
          category_id: item.id,
        });
        await loadCategories(tType);
      });
      row.appendChild(editBtn);
      row.appendChild(delBtn);
      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = `<div class="result">${err.message}</div>`;
  }
}

async function renderStats(period = null) {
  if (!ensureTelegram()) return;
  const start = document.getElementById("stats-start").value;
  const end = document.getElementById("stats-end").value;
  const canvas = document.getElementById("stats-chart-canvas");
  const result = document.getElementById("stats-result");
  try {
    if (period) {
      const range = getPeriodRange(period);
      const summary = await apiPost("/api/summary", {
        initData: tg.initData,
        t_type: statsType,
        period,
      });
      result.textContent = `Всего: ${formatMoney(
        summary.total
      )} · Записей: ${summary.count}`;
      const catData = await apiPost("/api/categories/summary", {
        initData: tg.initData,
        t_type: statsType,
        start: range.start,
        end: range.end,
      });
      drawStatsChart(catData, canvas);
      return;
    }
    const startIso = start ? `${start}T00:00:00` : null;
    const endIso = end ? `${end}T23:59:59` : null;
    const summary = await apiPost("/api/summary/range", {
      initData: tg.initData,
      t_type: statsType,
      start: startIso,
      end: endIso,
    });
    result.textContent = `Всего: ${formatMoney(
      summary.total
    )} · Записей: ${summary.count}`;
    const data = await apiPost("/api/categories/summary", {
      initData: tg.initData,
      t_type: statsType,
      start: startIso,
      end: endIso,
    });
    drawStatsChart(data, canvas);
  } catch (err) {
    result.textContent = err.message;
  }
}

function getPeriodRange(period) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  let start;
  if (period === "week") {
    start = new Date(end);
    start.setDate(start.getDate() - 6);
  } else if (period === "month") {
    start = new Date(end);
    start.setDate(start.getDate() - 29);
  } else {
    start = new Date(end);
    start.setDate(start.getDate() - 364);
  }
  const startIso = start.toISOString().slice(0, 19);
  const endIso = end.toISOString().slice(0, 19);
  return { start: startIso, end: endIso };
}

function drawStatsChart(data, canvas) {
  const labels = data.items.map((item) => item.category);
  const values = data.items.map((item) => item.total);
  const colors = labels.map((_, idx) => {
    const hue = (idx * 47) % 360;
    return `hsl(${hue}, 55%, 60%)`;
  });
  const chartData = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: colors,
      },
    ],
  };
  const config = { type: "pie", data: chartData };
  if (statsChart) statsChart.destroy();
  statsChart = new Chart(canvas, config);
}

showPanel("home");
init();
