/* Aplikasi utama: auth, onboarding, dashboard, budget, pengeluaran, menu, settings. */
(function () {
  "use strict";

  var EFB = window.EFB;
  var Store = window.Store;

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function esc(value) {
    return EFB.escapeHtml(value);
  }

  function pocketMember(role) {
    return state.members.filter(function (m) { return m.role === role; })[0] || null;
  }

  function pocketMeta(key) {
    var owner = pocketMember("owner");
    var partner = pocketMember("member");
    var label = POCKET_FALLBACK_LABELS[key] || key;
    if (key === "owner" && owner && owner.displayName) label = owner.displayName;
    if (key === "partner" && partner && partner.displayName) label = partner.displayName;
    return {
      key: key,
      label: label,
      color: POCKET_COLORS[key] || POCKET_COLORS.shared
    };
  }

  function pocketBadge(key) {
    var meta = pocketMeta(key || "shared");
    return (
      '<span class="pocket-badge" style="--pocket-color:' + meta.color + '">' +
      '<span class="pocket-dot"></span>' + esc(meta.label) +
      "</span>"
    );
  }

  function fillPocketSelect(select, includeAll) {
    if (!select) return;
    var current = select.value;
    var keys = includeAll ? ["all", "owner", "partner", "shared"] : ["owner", "partner", "shared"];
    select.innerHTML = keys
      .map(function (key) {
        var label = key === "all" ? "Semua saku" : pocketMeta(key).label;
        return '<option value="' + esc(key) + '">' + esc(label) + "</option>";
      })
      .join("");
    if (current && keys.indexOf(current) >= 0) select.value = current;
  }

  function defaultPocketFor(type) {
    if (type === "budget") {
      return state.membership && state.membership.role === "member" ? "partner" : "owner";
    }
    return "shared";
  }

  function refreshPocketSelects() {
    var budgetPocket = $("#budget-pocket");
    if (budgetPocket) {
      fillPocketSelect(budgetPocket);
      if (!budgetPocket.value) budgetPocket.value = defaultPocketFor("budget");
    }

    var expensePocket = $("#expense-pocket");
    if (expensePocket) {
      fillPocketSelect(expensePocket);
      if (!expensePocket.value) expensePocket.value = "shared";
    }

    var filterPocket = $("#expense-filter-pocket");
    if (filterPocket) fillPocketSelect(filterPocket, true);

    var entryPocket = $("#entry-pocket");
    if (entryPocket) fillPocketSelect(entryPocket);
  }

  var CATEGORY_COLORS = {
    "Makan Pokok": "#8a6a3f",
    "Jajan": "#a04a3a",
    "Masak Kos": "#3f6b52",
    "Makan di Luar": "#8f5f3f",
    "Transport": "#b08a57",
    "Kebutuhan": "#5b6b7a",
    "Lainnya": "#9a9084",
    "Budget": "#3f6b52"
  };

  var PALETTE = ["#8a6a3f", "#a04a3a", "#3f6b52", "#b08a57", "#5b6b7a", "#9a9084", "#6f7d6a"];

  var POCKET_COLORS = {
    owner: "#1f8a9e",
    partner: "#c05c7e",
    shared: "#b08a57"
  };
  var POCKET_FALLBACK_LABELS = {
    owner: "Malik",
    partner: "Irna",
    shared: "Bareng"
  };

  var state = {
    screen: "welcome",
    user: null,
    membership: null,
    household: null,
    members: [],
    entries: [],
    menu: [],
    month: EFB.monthKey(),
    tab: "dashboard",
    charts: {},
    editing: null,
    authTab: "login",
    demo: false,
    subscription: null,
    entering: false,
    access: null,
    accessLoading: false,
    accessLoaded: false,
    accessQrToken: null
  };

  var THEME_KEY = "efb_theme";

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function applyTheme(theme) {
    var next = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    document.documentElement.style.colorScheme = next;

    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {}

    var scheme = $('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute("content", next);
    var color = $('meta[name="theme-color"]');
    if (color) color.setAttribute("content", next === "dark" ? "#111512" : "#f4efe6");

    renderThemeSetting();
  }

  function renderThemeSetting() {
    var theme = currentTheme();
    setText("#theme-current", theme === "dark" ? "Gelap" : "Terang");
    $$("[data-theme-choice]").forEach(function (button) {
      var active = button.getAttribute("data-theme-choice") === theme;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function themeColor(name, fallback) {
    var value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  document.addEventListener("DOMContentLoaded", init);

  /* ==========================================================
   * BOOT
   * ========================================================== */
  async function init() {
    bindStaticEvents();
    applyTheme(currentTheme());

    var monthInput = $("#month-input");
    if (monthInput) monthInput.value = state.month;

    fillCategorySelect($("#expense-category"));
    var expCat = $("#expense-category");
    if (expCat) expCat.value = "Makan Pokok";
    fillCategorySelect($("#expense-filter-category"), true);
    fillMenuCategorySelect($("#menu-category"));
    refreshPocketSelects();

    var resetConfig = $("#auth-reset-config");
    if (resetConfig && localStorage.getItem("efb_config")) resetConfig.hidden = false;

    var pendingAccess = takeAccessFromUrl();

    if (!Store.hasBackend) {
      showScreen("welcome");
      return;
    }

    try {
      var session = await Store.init();
      Store.onAuthChange(handleAuthChange);

      if (pendingAccess) {
        showScreen("auth");
        if (pendingAccess.code) {
          setAuthTab("code");
          var codeInput = $("#auth-code");
          if (codeInput) codeInput.value = pendingAccess.code;
        } else {
          await loginWithAccess(pendingAccess, true);
        }
        return;
      }

      if (session && session.user) {
        await enterApp();
      } else {
        showScreen("auth");
      }
    } catch (err) {
      console.error(err);
      showScreen("auth");
      showFormError("#auth-error", friendlyError(err));
    }
  }

  function normalizeAccessCode(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 5);
  }

  function takeAccessFromUrl() {
    var params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (e) {
      return null;
    }

    var token = params.get("access");
    var code = params.get("code");
    if (!token && !code) return null;

    params.delete("access");
    params.delete("code");
    var query = params.toString();
    var cleanUrl =
      window.location.pathname + (query ? "?" + query : "") + window.location.hash;
    window.history.replaceState(null, "", cleanUrl);

    if (token) return { token: token.trim() };

    var normalized = normalizeAccessCode(code);
    return normalized.length === 5 ? { code: normalized } : null;
  }

  async function loginWithAccess(access, fromQr) {
    showScreen("auth");
    setAuthTab("code");

    var submitBtn = $("#auth-submit");
    setBusy(submitBtn, true);
    showFormError("#auth-error", "");

    if (fromQr) {
      setText("#auth-title", "Membuka akses...");
      setText("#auth-subtitle", "Memvalidasi QR rumah tangga.");
    }

    try {
      if (access.token) {
        await Store.signInWithAccessToken(access.token);
      } else {
        await Store.signInWithAccessCode(access.code);
      }
      await enterApp();
    } catch (err) {
      setAuthTab("code");
      if (access.code) {
        var input = $("#auth-code");
        if (input) input.value = access.code;
      }
      showFormError("#auth-error", (err && err.message) || "Kode akses tidak valid.");
    } finally {
      setBusy(submitBtn, false);
    }
  }

  async function handleAuthChange(event, session) {
    if (event === "SIGNED_OUT" || !session) {
      resetState();
      showScreen(Store.hasBackend ? "auth" : "welcome");
      return;
    }

    if (state.entering) return;
    if (state.user && session.user && state.user.id === session.user.id && state.screen === "app") {
      return;
    }

    await enterApp();
  }

  async function enterApp() {
    if (state.entering) return;
    state.entering = true;

    try {
      var ctx = await Store.getContext();

      if (!ctx || !ctx.user) {
        resetState();
        showScreen(Store.hasBackend ? "auth" : "welcome");
        return;
      }

      state.user = ctx.user;
      state.membership = ctx.membership;
      state.household = ctx.household;
      state.demo = Store.mode === "demo";
      state.access = null;
      state.accessLoaded = false;
      state.accessQrToken = null;

      if (!ctx.membership) {
        showScreen("onboarding");
        var emailEl = $("#onboarding-email");
        if (emailEl) emailEl.textContent = ctx.user.email || "";
        return;
      }

      showScreen("app");
      var monthInput = $("#month-input");
      if (monthInput) monthInput.value = state.month;
      var expDate = $("#expense-date");
      if (expDate) expDate.value = defaultDate();
      var budDate = $("#budget-date");
      if (budDate) budDate.value = defaultBudgetDate();

      updateHeader();
      await loadData();
      subscribeRealtime();

      if (state.demo) {
        toast("Mode demo aktif. Data tersimpan di browser ini.", "info");
      }
    } catch (err) {
      console.error(err);
      toast(friendlyError(err), "error");
      showScreen(Store.hasBackend ? "auth" : "welcome");
    } finally {
      state.entering = false;
    }
  }

  function resetState() {
    Object.keys(state.charts).forEach(function (id) {
      if (state.charts[id]) state.charts[id].destroy();
    });
    state.charts = {};

    if (state.subscription) {
      Store.unsubscribe(state.subscription);
      state.subscription = null;
    }

    state.user = null;
    state.membership = null;
    state.household = null;
    state.members = [];
    state.entries = [];
    state.menu = [];
    state.editing = null;
    state.demo = false;
    state.access = null;
    state.accessLoading = false;
    state.accessLoaded = false;
    state.accessQrToken = null;
  }

  function showScreen(name) {
    state.screen = name;
    ["welcome", "auth", "onboarding", "app"].forEach(function (key) {
      var el = document.getElementById("screen-" + key);
      if (el) el.hidden = key !== name;
    });
    document.body.setAttribute("data-screen", name);
    window.scrollTo(0, 0);
  }

  /* ==========================================================
   * DATA
   * ========================================================== */
  async function loadData(options) {
    var silent = options && options.silent;

    try {
      var results = await Promise.all([
        Store.listMembers(),
        Store.listMenu(),
        Store.listEntries(state.month)
      ]);

      state.members = results[0] || [];
      state.menu = results[1] || [];
      state.entries = results[2] || [];
      refreshPocketSelects();

      if (state.screen === "app") renderAll();
    } catch (err) {
      console.error(err);
      if (!silent) toast(friendlyError(err), "error");
    }
  }

  function subscribeRealtime() {
    if (state.subscription) {
      Store.unsubscribe(state.subscription);
      state.subscription = null;
    }

    state.subscription = Store.subscribe(
      EFB.debounce(function () {
        loadData({ silent: true });
      }, 450)
    );
  }

  function computeWarning(summary) {
    var cap = Number(state.household && state.household.dailyCap) || 100000;
    var warnAt = Number(state.household && state.household.warnThreshold) || 1000000;
    var criticalAt = Number(state.household && state.household.criticalThreshold) || 500000;

    if (summary.isFuture) {
      return {
        status: "neutral",
        title: "Bulan belum dimulai",
        copy: "Budget " + EFB.money(summary.totalBudget) + " siap dipakai bulan ini."
      };
    }

    if (summary.isPast) {
      return {
        status: "neutral",
        title: "Bulan sudah lewat",
        copy: "Sisa akhir bulan " + EFB.money(summary.remaining) + "."
      };
    }

    if (summary.totalBudget <= 0) {
      return {
        status: "neutral",
        title: "Tambahkan budget untuk melihat status dana.",
        copy: "Peringatan otomatis muncul saat dana mulai tipis."
      };
    }

    if (summary.remaining < 0) {
      return {
        status: "critical",
        title: "Dana sudah minus " + EFB.money(Math.abs(summary.remaining)),
        copy: "Pengeluaran melebihi budget. Tambah budget atau kurangi pengeluaran."
      };
    }

    if (summary.remaining < criticalAt) {
      var needed = cap * summary.daysLeft;
      var shortfall = Math.max(0, needed - summary.remaining);
      return {
        status: "critical",
        title: "Dana tidak akan cukup hingga tanggal 1",
        copy:
          "Sisa " + EFB.money(summary.remaining) + " untuk " + summary.daysLeft + " hari. " +
          "Dana di bawah batas kritis " + EFB.money(criticalAt) + ". " +
          (shortfall > 0
            ? "Butuh " + EFB.money(shortfall) + " lagi agar aman di " + EFB.money(cap) + "/hari."
            : "Segera tahan pengeluaran.")
      };
    }

    if (summary.remaining <= warnAt) {
      var safeDaily = summary.daysLeft > 0 ? summary.remaining / summary.daysLeft : 0;
      var cut = Math.max(0, cap - safeDaily);
      return {
        status: "warn",
        title: "Wajib hemat: maks " + EFB.money(cap) + "/hari",
        copy:
          "Sisa " + EFB.money(summary.remaining) + " untuk " + summary.daysLeft + " hari = " +
          EFB.money(safeDaily) + "/hari. " +
          (cut > 0
            ? "Kurangi " + EFB.money(cut) + "/hari dari batas " + EFB.money(cap) + "."
            : "Dana sudah di bawah ambang waspada " + EFB.money(warnAt) + ".")
      };
    }

    var coverDays = Math.max(1, Math.floor(summary.remaining / cap));
    var todayDay = new Date().getDate();
    var safeDay = todayDay + coverDays - 1;
    var until = safeDay >= summary.days ? "akhir bulan" : "tanggal " + safeDay;

    return {
      status: "safe",
      title: "Dana aman hingga " + until,
      copy:
        "Estimasi " + EFB.money(cap) + "/hari. Sisa " + EFB.money(summary.remaining) +
        " untuk " + summary.daysLeft + " hari."
    };
  }

  function computeSummary() {
    var budgets = state.entries.filter(function (e) {
      return e.type === "budget";
    });
    var expenses = state.entries.filter(function (e) {
      return e.type === "expense";
    });

    var totalBudget = EFB.sum(budgets, function (e) { return e.amount; });
    var totalExpense = EFB.sum(expenses, function (e) { return e.amount; });
    var remaining = totalBudget - totalExpense;
    var range = EFB.monthRange(state.month);
    var todayKey = EFB.monthKey();
    var isCurrent = state.month === todayKey;
    var isFuture = state.month > todayKey;
    var daysLeft;

    if (isCurrent) {
      daysLeft = range.days - new Date().getDate() + 1;
    } else if (isFuture) {
      daysLeft = range.days;
    } else {
      daysLeft = 0;
    }

    var pct = totalBudget > 0 ? (totalExpense / totalBudget) * 100 : totalExpense > 0 ? 100 : 0;
    var dailySafe = daysLeft > 0 ? remaining / daysLeft : 0;

    var byPocket = {};
    ["owner", "partner", "shared"].forEach(function (key) {
      byPocket[key] = {
        budget: 0,
        expense: 0,
        sharedShare: 0,
        remaining: 0,
        pct: 0,
        budgetCount: 0,
        expenseCount: 0
      };
    });

    budgets.forEach(function (e) {
      var key = byPocket[e.pocket] ? e.pocket : "shared";
      byPocket[key].budget += e.amount;
      byPocket[key].budgetCount += 1;
    });

    expenses.forEach(function (e) {
      var key = byPocket[e.pocket] ? e.pocket : "shared";

      if (key === "shared") {
        var half = e.amount / 2;
        byPocket.shared.expense += e.amount;
        byPocket.shared.expenseCount += 1;
        byPocket.owner.expense += half;
        byPocket.owner.sharedShare += half;
        byPocket.owner.expenseCount += 1;
        byPocket.partner.expense += half;
        byPocket.partner.sharedShare += half;
        byPocket.partner.expenseCount += 1;
        return;
      }

      byPocket[key].expense += e.amount;
      byPocket[key].expenseCount += 1;
    });

    Object.keys(byPocket).forEach(function (key) {
      var pocket = byPocket[key];
      pocket.remaining = pocket.budget - pocket.expense;
      pocket.pct = pocket.budget > 0 ? (pocket.expense / pocket.budget) * 100 : pocket.expense > 0 ? 100 : 0;
    });

    var summary = {
      budgets: budgets,
      expenses: expenses,
      totalBudget: totalBudget,
      totalExpense: totalExpense,
      remaining: remaining,
      pct: pct,
      days: range.days,
      daysLeft: daysLeft,
      dailySafe: dailySafe,
      byPocket: byPocket,
      isCurrent: isCurrent,
      isFuture: isFuture,
      isPast: !isCurrent && !isFuture
    };
    summary.warning = computeWarning(summary);
    return summary;
  }

  function renderWarning(summary) {
    var warning = summary.warning;
    ["#dash-warning", "#budget-warning"].forEach(function (selector) {
      var panel = $(selector);
      if (!panel) return;

      panel.classList.remove("is-neutral", "is-safe", "is-warn", "is-critical");
      panel.classList.add("is-" + warning.status);

      var title = $("[id$='-warning-title']", panel);
      var copy = $("[id$='-warning-copy']", panel);
      if (title) title.textContent = warning.title;
      if (copy) copy.textContent = warning.copy;
    });
  }

  function renderPocketCards(summary) {
    var html = ["owner", "partner", "shared"]
      .map(function (key) {
        var meta = pocketMeta(key);
        var pocket = summary.byPocket[key];
        var isShared = key === "shared";
        var title = isShared ? "Total Bareng" : "Saku " + meta.label;
        var budget = isShared ? summary.totalBudget : pocket.budget;
        var expense = isShared ? summary.totalExpense : pocket.expense;
        var remaining = isShared ? summary.remaining : pocket.remaining;
        var pct = isShared ? summary.pct : pocket.pct;
        var count = isShared ? summary.expenses.length : pocket.expenseCount;
        var sub =
          "Budget " + EFB.money(budget) + " · terpakai " + EFB.money(expense);
        if (!isShared && pocket.sharedShare > 0) {
          sub += " · bagi 2 bareng " + EFB.money(pocket.sharedShare);
        }
        return (
          '<article class="pocket-card" style="--pocket-color:' + meta.color + '">' +
          '<div class="pocket-card-head"><span class="pocket-dot"></span><span>' + esc(title) + "</span></div>" +
          "<strong>" + EFB.money(remaining) + "</strong>" +
          '<span class="pocket-card-sub">' + sub + "</span>" +
          '<div class="pocket-card-meta"><span>' + Math.round(pct) + "% terpakai</span><span>" +
          count + " transaksi</span></div>" +
          "</article>"
        );
      })
      .join("");

    ["#dash-pockets", "#budget-pockets"].forEach(function (selector) {
      var target = $(selector);
      if (target) target.innerHTML = html;
    });
  }

  function renderExpensePocketSummary(summary) {
    var target = $("#expense-pocket-summary");
    if (!target) return;

    target.innerHTML = ["owner", "partner", "shared"]
      .map(function (key) {
        var meta = pocketMeta(key);
        var pocket = summary.byPocket[key];
        var isShared = key === "shared";
        var expense = isShared ? summary.totalExpense : pocket.expense;
        var remaining = isShared ? summary.remaining : pocket.remaining;
        return (
          '<div class="pocket-summary-item" style="--pocket-color:' + meta.color + '">' +
          '<span class="pocket-summary-name"><span class="pocket-dot"></span>' +
          esc(isShared ? "Total" : meta.label) + "</span>" +
          '<strong>' + EFB.money(remaining) + "</strong>" +
          '<span class="pocket-summary-sub">sisa · ' + EFB.money(expense) + " terpakai</span>" +
          "</div>"
        );
      })
      .join("");
  }

  /* ==========================================================
   * RENDER
   * ========================================================== */
  function renderAll() {
    updateHeader();
    if (state.tab === "dashboard") renderDashboard();
    else if (state.tab === "budget") renderBudget();
    else if (state.tab === "expenses") renderExpenses();
    else if (state.tab === "menu") renderMenu();
    else if (state.tab === "settings") renderSettings();
  }

  function updateHeader() {
    var householdEl = $("#header-household");
    var userEl = $("#header-user");
    var demoBadge = $("#demo-badge");
    var monthInput = $("#month-input");

    if (householdEl) householdEl.textContent = state.household ? state.household.name : "Rumah Tangga";
    if (userEl) {
      userEl.textContent =
        (state.membership && state.membership.displayName) ||
        (state.user && state.user.email) ||
        "User";
    }
    if (demoBadge) demoBadge.hidden = !state.demo;
    if (monthInput) monthInput.value = state.month;

    document.title =
      (state.household ? state.household.name : "Efektivitas Bulanan") +
      " · " +
      EFB.monthLabel(state.month);
  }

  function setText(selector, text) {
    var el = $(selector);
    if (el) el.textContent = text;
  }

  function renderDashboard() {
    var s = computeSummary();

    setText("#dash-month-title", EFB.monthLabel(state.month));
    setText("#stat-budget", EFB.money(s.totalBudget));
    setText("#stat-spent", EFB.money(s.totalExpense));
    setText("#stat-remaining", EFB.money(s.remaining));
    setText("#stat-daily", s.daysLeft > 0 ? EFB.money(s.dailySafe) : "—");

    setText("#stat-spent-sub", s.expenses.length + " transaksi");
    setText(
      "#stat-remaining-sub",
      s.totalBudget <= 0 ? "Belum ada budget" : s.remaining < 0 ? "Over budget" : "Aman"
    );
    setText("#stat-daily-sub", s.daysLeft > 0 ? s.daysLeft + " hari tersisa" : "Bulan sudah lewat");

    var remainingCard = $("#stat-remaining-card");
    if (remainingCard) remainingCard.classList.toggle("is-negative", s.remaining < 0);

    renderWarning(s);
    renderPocketCards(s);

    var pct = s.pct;
    var fill = $("#progress-fill");
    if (fill) {
      fill.style.width = EFB.clamp(pct, 0, 100) + "%";
      fill.classList.toggle("over", pct > 100);
    }
    setText("#progress-label", Math.round(pct) + "%");
    setText("#progress-detail", EFB.money(s.totalExpense) + " dari " + EFB.money(s.totalBudget));

    var insight;
    if (s.totalBudget <= 0) {
      insight =
        s.totalExpense > 0
          ? "Belum ada budget, tapi sudah ada pengeluaran " +
            EFB.money(s.totalExpense) +
            ". Tambahkan budget awal di menu Budget."
          : "Belum ada budget untuk bulan ini. Tambahkan budget awal di menu Budget supaya sisa otomatis terhitung.";
    } else if (s.remaining < 0) {
      insight = "Over budget " + EFB.money(Math.abs(s.remaining)) + ". Kurangi pengeluaran atau tambah budget.";
    } else if (s.daysLeft > 0) {
      insight =
        "Sisa " +
        EFB.money(s.remaining) +
        " untuk " +
        s.daysLeft +
        " hari = " +
        EFB.money(s.dailySafe) +
        " per hari.";
    } else {
      insight = "Sisa budget " + EFB.money(s.remaining) + ".";
    }
    setText("#dash-insight", insight);

    renderTopCategories(s);
    renderRecent();
    renderCharts(s);
  }

  function renderTopCategories(s) {
    var target = $("#dash-top-cat");
    if (!target) return;

    var map = {};
    s.expenses.forEach(function (e) {
      map[e.category] = (map[e.category] || 0) + e.amount;
    });

    var rows = Object.keys(map)
      .map(function (cat) {
        return { cat: cat, total: map[cat] };
      })
      .sort(function (a, b) {
        return b.total - a.total;
      })
      .slice(0, 3);

    if (!rows.length) {
      target.innerHTML = "";
      return;
    }

    var max = rows[0].total || 1;
    target.innerHTML = rows
      .map(function (row) {
        var color = CATEGORY_COLORS[row.cat] || "#7f9db0";
        var width = Math.max(4, (row.total / max) * 100);
        return (
          '<div class="top-cat-row">' +
          '<span class="top-cat-name">' + esc(row.cat) + "</span>" +
          '<span class="top-cat-track"><span class="top-cat-fill" style="width:' +
          width +
          "%;background:" +
          color +
          ";box-shadow:0 0 10px " +
          color +
          '"></span></span>' +
          '<span class="top-cat-amount">' + EFB.money(row.total) + "</span>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderRecent() {
    var target = $("#dash-recent");
    if (!target) return;

    var items = state.entries.slice().sort(function (a, b) {
      return (
        b.date.localeCompare(a.date) ||
        String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
      );
    }).slice(0, 6);

    if (!items.length) {
      target.innerHTML = '<li class="empty-row">Belum ada transaksi bulan ini.</li>';
      return;
    }

    target.innerHTML = items
      .map(function (e) {
        var isBudget = e.type === "budget";
        return (
          '<li class="recent-row">' +
          '<span class="recent-dot ' + e.type + '"></span>' +
          '<div class="recent-main">' +
          '<span class="recent-desc">' + esc(e.description) + "</span>" +
          '<span class="recent-meta">' + esc(EFB.dateLabel(e.date)) + " · " + esc(e.category) +
          " " + pocketBadge(e.pocket) + "</span>" +
          "</div>" +
          '<span class="recent-amount ' + e.type + '">' +
          (isBudget ? "+" : "−") + " " + EFB.money(e.amount) +
          "</span>" +
          "</li>"
        );
      })
      .join("");
  }

  function chartBaseOptions(extra) {
    var legendColor = themeColor("--ink-2", "#4a453d");
    var tickColor = themeColor("--muted", "#8a8175");
    var gridColor = themeColor("--line", "rgba(28,26,23,.07)");
    var tooltipBg = themeColor("--forest", "#1f2e27");
    var tooltipTitle = themeColor("--paper", "#f5efe4");
    var tooltipBody = themeColor("--muted", "#d8d2c6");

    var base = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: {
            color: legendColor,
            font: { family: "Manrope", size: 11 },
            boxWidth: 10,
            boxHeight: 10
          }
        },
        tooltip: {
          backgroundColor: tooltipBg,
          borderColor: tooltipBg,
          borderWidth: 1,
          titleColor: tooltipTitle,
          bodyColor: tooltipBody,
          padding: 12,
          cornerRadius: 2,
          callbacks: {
            label: function (ctx) {
              return " " + ctx.dataset.label + ": " + EFB.money(ctx.parsed.y);
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: {
            color: tickColor,
            font: { family: "Manrope", size: 11 },
            maxRotation: 0,
            autoSkip: true
          }
        },
        y: {
          beginAtZero: true,
          grid: { color: gridColor },
          ticks: {
            color: tickColor,
            font: { family: "Manrope", size: 11 },
            callback: function (value) {
              return EFB.shortMoney(value);
            }
          }
        }
      }
    };

    if (extra) {
      Object.keys(extra).forEach(function (key) {
        base[key] = extra[key];
      });
    }
    return base;
  }

  function makeChart(id, config) {
    var canvas = document.getElementById(id);
    if (!canvas || !window.Chart) return;
    if (state.charts[id]) {
      state.charts[id].destroy();
      delete state.charts[id];
    }
    state.charts[id] = new window.Chart(canvas, config);
  }

  function renderCharts(s) {
    if (!window.Chart) return;

    var labels = [];
    var daily = [];
    for (var i = 0; i < s.days; i++) {
      labels.push(String(i + 1));
      daily.push(0);
    }

    s.expenses.forEach(function (e) {
      var day = Number(String(e.date).slice(8, 10));
      if (day >= 1 && day <= s.days) daily[day - 1] += e.amount;
    });

    var running = 0;
    var cumulative = daily.map(function (value) {
      running += value;
      return running;
    });

    var flowDatasets = [
      {
        label: "Kumulatif pengeluaran",
        data: cumulative,
        borderColor: themeColor("--accent", "#8a6a3f"),
        backgroundColor: themeColor("--accent-soft", "rgba(138,106,63,.10)"),
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2
      }
    ];

    if (s.totalBudget > 0) {
      flowDatasets.push({
        label: "Budget",
        data: labels.map(function () {
          return s.totalBudget;
        }),
        borderColor: themeColor("--ink-2", "#1f2e27"),
        borderDash: [4, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false
      });
    }

    makeChart("chart-flow", {
      type: "line",
      data: { labels: labels, datasets: flowDatasets },
      options: chartBaseOptions()
    });

    var catMap = {};
    s.expenses.forEach(function (e) {
      catMap[e.category] = (catMap[e.category] || 0) + e.amount;
    });
    var catLabels = Object.keys(catMap);
    var catData = catLabels.map(function (key) {
      return catMap[key];
    });
    var catColors = catLabels.map(function (label, index) {
      return CATEGORY_COLORS[label] || PALETTE[index % PALETTE.length];
    });

    var catEmpty = $("#category-empty");
    if (catEmpty) catEmpty.hidden = catLabels.length > 0;

    makeChart("chart-categories", {
      type: "doughnut",
      data: {
        labels: catLabels,
        datasets: [
          {
            data: catData,
            backgroundColor: catColors,
            borderColor: themeColor("--surface", "#fffdf8"),
            borderWidth: 2,
            hoverOffset: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: themeColor("--ink-2", "#4a453d"),
              font: { family: "Manrope", size: 10 },
              boxWidth: 9,
              boxHeight: 9
            }
          },
          tooltip: {
            backgroundColor: themeColor("--forest", "#1f2e27"),
            borderColor: themeColor("--forest", "#1f2e27"),
            borderWidth: 1,
            titleColor: themeColor("--paper", "#f5efe4"),
            bodyColor: themeColor("--muted", "#d8d2c6"),
            padding: 12,
            cornerRadius: 2,
            callbacks: {
              label: function (ctx) {
                return " " + ctx.label + ": " + EFB.money(ctx.parsed);
              }
            }
          }
        }
      }
    });

    var todayDay = state.month === EFB.monthKey() ? new Date().getDate() : -1;
    var barColors = daily.map(function (value, index) {
      return index + 1 === todayDay
        ? themeColor("--accent", "#8a6a3f")
        : themeColor("--line-strong", "rgba(31,46,39,.28)");
    });

    makeChart("chart-daily", {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Pengeluaran harian",
            data: daily,
            backgroundColor: barColors,
            borderRadius: 3,
            borderSkipped: false
          }
        ]
      },
      options: chartBaseOptions()
    });
  }

  function renderBudget() {
    var s = computeSummary();

    setText("#budget-month-title", EFB.monthLabel(state.month));
    setText("#budget-total", EFB.money(s.totalBudget));
    setText("#budget-spent", EFB.money(s.totalExpense));
    setText("#budget-remaining", EFB.money(s.remaining));

    var remainingEl = $("#budget-remaining");
    if (remainingEl) remainingEl.classList.toggle("text-danger", s.remaining < 0);

    renderWarning(s);
    renderPocketCards(s);

    var budgets = s.budgets.slice().sort(function (a, b) {
      return (
        b.date.localeCompare(a.date) ||
        String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
      );
    });

    setText("#budget-count", budgets.length + " entri");

    var list = $("#budget-list");
    if (list) {
      list.innerHTML = budgets
        .map(function (e) {
          return (
            '<li class="entry-row">' +
            '<div class="entry-main">' +
            '<span class="entry-date">' + esc(EFB.dateLabel(e.date)) + " " + pocketBadge(e.pocket) + "</span>" +
            '<span class="entry-desc">' + esc(e.description) + "</span>" +
            "</div>" +
            '<span class="entry-amount plus">+ ' + EFB.money(e.amount) + "</span>" +
            '<div class="row-actions">' +
            '<button type="button" data-action="edit" data-id="' + esc(e.id) + '">Edit</button>' +
            '<button type="button" data-action="delete" data-id="' + esc(e.id) + '">Hapus</button>' +
            "</div>" +
            "</li>"
          );
        })
        .join("");
    }

    var empty = $("#budget-empty");
    if (empty) empty.hidden = budgets.length > 0;
  }

  function renderExpenses() {
    var s = computeSummary();
    var all = s.expenses;

    setText("#expense-month-title", EFB.monthLabel(state.month));
    setText("#expense-total", EFB.money(s.totalExpense));
    setText("#expense-count", all.length + " transaksi");
    renderExpensePocketSummary(s);

    var query = ($("#expense-search") && $("#expense-search").value.trim().toLowerCase()) || "";
    var category = ($("#expense-filter-category") && $("#expense-filter-category").value) || "all";
    var pocket = ($("#expense-filter-pocket") && $("#expense-filter-pocket").value) || "all";

    var filtered = all.filter(function (e) {
      var matchQuery =
        !query ||
        e.description.toLowerCase().indexOf(query) >= 0 ||
        e.category.toLowerCase().indexOf(query) >= 0;
      var matchCategory = category === "all" || e.category === category;
      var matchPocket = pocket === "all" || (e.pocket || "shared") === pocket;
      return matchQuery && matchCategory && matchPocket;
    });

    filtered.sort(function (a, b) {
      return (
        b.date.localeCompare(a.date) ||
        String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
      );
    });

    setText("#expense-filter-count", filtered.length + " tampil");

    var groups = {};
    filtered.forEach(function (e) {
      if (!groups[e.date]) groups[e.date] = [];
      groups[e.date].push(e);
    });

    var dates = Object.keys(groups).sort(function (a, b) {
      return b.localeCompare(a);
    });

    var list = $("#expense-list");
    if (list) {
      list.innerHTML = dates
        .map(function (date) {
          var items = groups[date];
          var dayTotal = EFB.sum(items, function (e) { return e.amount; });
          var rows = items
            .map(function (e) {
              var color = CATEGORY_COLORS[e.category] || "#7f9db0";
              return (
                '<div class="expense-row">' +
                '<span class="expense-cat" style="--cat-color:' + color + '">' + esc(e.category) + "</span>" +
                pocketBadge(e.pocket) +
                '<div class="expense-main">' +
                '<span class="expense-desc">' + esc(e.description) + "</span>" +
                '<span class="expense-meta">' + esc(EFB.dateLabel(e.date)) + "</span>" +
                "</div>" +
                '<span class="expense-amount">' + EFB.money(e.amount) + "</span>" +
                '<div class="row-actions">' +
                '<button type="button" data-action="edit" data-id="' + esc(e.id) + '">Edit</button>' +
                '<button type="button" data-action="delete" data-id="' + esc(e.id) + '">Hapus</button>' +
                "</div>" +
                "</div>"
              );
            })
            .join("");

          return (
            '<div class="date-group">' +
            '<div class="date-group-head">' +
            "<span>" + esc(EFB.dateLabel(date)) + "</span>" +
            '<span class="date-group-total">' + EFB.money(dayTotal) + "</span>" +
            "</div>" +
            rows +
            "</div>"
          );
        })
        .join("");
    }

    var empty = $("#expense-empty");
    if (empty) {
      empty.hidden = filtered.length > 0;
      empty.textContent = all.length
        ? "Tidak ada pengeluaran yang cocok dengan filter."
        : "Belum ada pengeluaran. Catat yang pertama di atas.";
    }
  }

  function renderMenu() {
    var masak = state.menu.filter(function (m) { return m.kind === "masak"; });
    var jajan = state.menu.filter(function (m) { return m.kind === "jajan"; });
    var diluar = state.menu.filter(function (m) { return m.kind === "diluar"; });
    var kebutuhan = state.menu.filter(function (m) { return m.kind === "kebutuhan"; });

    masak.sort(menuSorter);
    jajan.sort(menuSorter);
    diluar.sort(menuSorter);
    kebutuhan.sort(menuSorter);

    setText("#menu-masak-count", masak.length + " item");
    setText("#menu-jajan-count", jajan.length + " item");
    setText("#menu-diluar-count", diluar.length + " item");
    setText("#menu-kebutuhan-count", kebutuhan.length + " item");

    var masakList = $("#menu-masak-list");
    if (masakList) masakList.innerHTML = masak.map(menuRow).join("");

    var jajanList = $("#menu-jajan-list");
    if (jajanList) jajanList.innerHTML = jajan.map(menuRow).join("");

    var diluarList = $("#menu-diluar-list");
    if (diluarList) diluarList.innerHTML = diluar.map(menuRow).join("");

    var kebutuhanList = $("#menu-kebutuhan-list");
    if (kebutuhanList) kebutuhanList.innerHTML = kebutuhan.map(menuRow).join("");

    var masakEmpty = $("#menu-masak-empty");
    if (masakEmpty) masakEmpty.hidden = masak.length > 0;
    var jajanEmpty = $("#menu-jajan-empty");
    if (jajanEmpty) jajanEmpty.hidden = jajan.length > 0;
    var diluarEmpty = $("#menu-diluar-empty");
    if (diluarEmpty) diluarEmpty.hidden = diluar.length > 0;
    var kebutuhanEmpty = $("#menu-kebutuhan-empty");
    if (kebutuhanEmpty) kebutuhanEmpty.hidden = kebutuhan.length > 0;
  }

  function menuSorter(a, b) {
    return (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name);
  }

  function menuDefaultCategory(kind) {
    if (kind === "jajan") return "Jajan";
    if (kind === "diluar") return "Makan di Luar";
    if (kind === "kebutuhan") return "Kebutuhan";
    return "Masak Kos";
  }

  function menuRow(item) {
    var color = CATEGORY_COLORS[item.category] || "#7f9db0";
    return (
      '<li class="menu-row">' +
      '<div class="menu-info">' +
      '<span class="menu-name">' + esc(item.name) + "</span>" +
      '<span class="menu-meta"><span class="mini-dot" style="background:' + color + '"></span>' + esc(item.category) + "</span>" +
      "</div>" +
      '<span class="menu-price">' + EFB.money(item.defaultAmount) + "</span>" +
      '<div class="row-actions">' +
      '<button type="button" data-action="use" data-id="' + esc(item.id) + '">Catat</button>' +
      '<button type="button" data-action="edit-menu" data-id="' + esc(item.id) + '">Edit</button>' +
      '<button type="button" data-action="delete-menu" data-id="' + esc(item.id) + '">Hapus</button>' +
      "</div>" +
      "</li>"
    );
  }

  function renderSettings() {
    if (!state.user) return;

    renderThemeSetting();
    setText("#settings-email", state.user.email || "—");
    setText("#settings-member-count", state.members.length + " anggota");

    var householdName = $("#settings-household-name");
    if (householdName && document.activeElement !== householdName) {
      householdName.value = state.household ? state.household.name : "";
    }

    var displayName = $("#settings-display-name");
    if (displayName && document.activeElement !== displayName) {
      displayName.value = (state.membership && state.membership.displayName) || "";
    }

    setText("#settings-invite-code", (state.household && state.household.inviteCode) || "—");

    var dailyCap = $("#settings-daily-cap");
    if (dailyCap && document.activeElement !== dailyCap) {
      dailyCap.value = (state.household && state.household.dailyCap) || 100000;
    }
    var warnThreshold = $("#settings-warn-threshold");
    if (warnThreshold && document.activeElement !== warnThreshold) {
      warnThreshold.value = (state.household && state.household.warnThreshold) || 1000000;
    }
    var criticalThreshold = $("#settings-critical-threshold");
    if (criticalThreshold && document.activeElement !== criticalThreshold) {
      criticalThreshold.value = (state.household && state.household.criticalThreshold) || 500000;
    }

    var legend = $("#settings-pocket-legend");
    if (legend) {
      legend.innerHTML = ["owner", "partner", "shared"]
        .map(function (key) {
          var meta = pocketMeta(key);
          return (
            '<span class="pocket-legend-item" style="--pocket-color:' + meta.color + '">' +
            '<span class="pocket-dot"></span>' +
            esc(key === "shared" ? "Bareng" : meta.label) +
            "</span>"
          );
        })
        .join("");
    }

    var isOwner = state.membership && state.membership.role === "owner";
    var accessPanel = $("#access-panel");
    if (accessPanel) accessPanel.hidden = !isOwner;

    if (isOwner) {
      if (!state.accessLoaded && !state.accessLoading) loadAccessSettings();
      renderAccessSettings();
    }

    var memberList = $("#settings-members");
    if (memberList) {
      memberList.innerHTML = state.members
        .map(function (member) {
          var isMe = state.user && member.userId === state.user.id;
          var suffix = isMe && !/kamu/i.test(member.displayName) ? " (kamu)" : "";
          var badgeClass = member.role === "owner" ? "badge owner" : "badge";
          return (
            '<li class="member-row">' +
            '<span class="member-name">' + esc(member.displayName) + suffix + "</span>" +
            '<span class="' + badgeClass + '">' + esc(member.role) + "</span>" +
            "</li>"
          );
        })
        .join("");
    }

    var demoNote = $("#demo-settings-note");
    if (demoNote) demoNote.hidden = !state.demo;

    var resetBtn = $("#settings-reset-demo");
    if (resetBtn) resetBtn.hidden = !state.demo;

    var leaveBtn = $("#settings-leave");
    if (leaveBtn) leaveBtn.hidden = state.demo;
  }

  async function loadAccessSettings() {
    if (state.accessLoading) return;
    if (!state.membership || state.membership.role !== "owner") return;

    state.accessLoading = true;
    try {
      state.access = (await Store.getAccessSettings()) || null;
      state.accessLoaded = true;
      if (state.screen === "app" && state.tab === "settings") renderSettings();
    } catch (err) {
      state.accessLoaded = true;
      console.error(err);
    } finally {
      state.accessLoading = false;
    }
  }

  function renderAccessSettings() {
    var code = state.access && state.access.code;
    setText("#settings-access-code", code || "-----");

    var input = $("#settings-access-input");
    if (input && document.activeElement !== input) input.value = code || "";

    var demoNote = $("#demo-access-note");
    if (demoNote) demoNote.hidden = !state.demo;

    renderAccessQr();
  }

  function accessLink(token) {
    return (
      window.location.origin +
      window.location.pathname +
      "?access=" +
      encodeURIComponent(token)
    );
  }

  function renderAccessQr() {
    var box = $("#access-qr");
    if (!box) return;

    var token = state.access && state.access.token;
    if (!token) {
      box.innerHTML = '<span class="access-qr-empty">Belum ada QR</span>';
      state.accessQrToken = null;
      return;
    }

    if (state.accessQrToken === token && box.querySelector("canvas, img")) return;

    if (!window.QRCode) {
      box.innerHTML = '<span class="access-qr-empty">QR tidak tersedia</span>';
      return;
    }

    box.innerHTML = "";
    try {
      new window.QRCode(box, {
        text: accessLink(token),
        width: 168,
        height: 168,
        colorDark: "#1f2e27",
        colorLight: "#fffdf8",
        correctLevel: window.QRCode.CorrectLevel.M
      });
      state.accessQrToken = token;
    } catch (err) {
      box.innerHTML = '<span class="access-qr-empty">QR tidak tersedia</span>';
      state.accessQrToken = null;
    }
  }

  /* ==========================================================
   * TABS & MONTH
   * ========================================================== */
  function setTab(tab) {
    state.tab = tab;

    $$(".nav-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
    });

    $$(".tab-panel").forEach(function (panel) {
      panel.hidden = panel.id !== "tab-" + tab;
    });

    renderAll();

    if (tab === "dashboard") {
      window.requestAnimationFrame(function () {
        renderDashboard();
      });
    }

    var main = $(".main");
    if (main) main.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setMonth(key) {
    if (!key) return;
    state.month = key;

    var monthInput = $("#month-input");
    if (monthInput) monthInput.value = key;

    var date = defaultDate();
    var expenseDate = $("#expense-date");
    if (expenseDate) expenseDate.value = date;
    var budgetDate = $("#budget-date");
    if (budgetDate) budgetDate.value = defaultBudgetDate();

    loadData();
  }

  function defaultDate() {
    if (state.month === EFB.monthKey()) return EFB.todayISO();
    return state.month + "-01";
  }

  function defaultBudgetDate() {
    return state.month + "-01";
  }

  /* ==========================================================
   * ENTRY DIALOG
   * ========================================================== */
  function categoryOptions(type) {
    var categories = type === "budget" ? [Store.BUDGET_CATEGORY] : Store.CATEGORIES.slice();
    return categories
      .map(function (cat) {
        return '<option value="' + esc(cat) + '">' + esc(cat) + "</option>";
      })
      .join("");
  }

  function openEntryDialog(options) {
    options = options || {};
    var entry = options.entry || null;
    var preset = options.preset || null;
    var type = entry ? entry.type : options.type || "expense";

    state.editing = entry;

    var title = entry
      ? "Edit transaksi"
      : type === "budget"
      ? "Tambah budget"
      : "Catat pengeluaran";

    setText("#entry-dialog-title", title);

    var idEl = $("#entry-id");
    if (idEl) idEl.value = entry ? entry.id : "";
    var typeEl = $("#entry-type");
    if (typeEl) typeEl.value = type;
    var dateEl = $("#entry-date");
    if (dateEl) dateEl.value = (entry && entry.date) || (type === "budget" ? defaultBudgetDate() : defaultDate());
    var descEl = $("#entry-description");
    if (descEl) descEl.value = (entry && entry.description) || (preset && preset.name) || "";
    var catEl = $("#entry-category");
    if (catEl) {
      catEl.innerHTML = categoryOptions(type);
      var desired = (entry && entry.category) || (preset && preset.category) || (type === "budget" ? Store.BUDGET_CATEGORY : "Makan Pokok");
      if (!Array.prototype.some.call(catEl.options, function (opt) { return opt.value === desired; })) {
        var extra = document.createElement("option");
        extra.value = desired;
        extra.textContent = desired;
        catEl.appendChild(extra);
      }
      catEl.value = desired;
    }
    var pocketEl = $("#entry-pocket");
    if (pocketEl) {
      fillPocketSelect(pocketEl);
      pocketEl.value = (entry && entry.pocket) || defaultPocketFor(type);
    }
    var amountEl = $("#entry-amount");
    if (amountEl) {
      amountEl.value = (entry && entry.amount) || (preset && preset.defaultAmount) || "";
    }

    var deleteBtn = $("#entry-delete");
    if (deleteBtn) deleteBtn.hidden = !entry;

    var submitBtn = $("#entry-submit");
    if (submitBtn) submitBtn.textContent = entry ? "Simpan perubahan" : "Simpan";

    showFormError("#entry-error", "");

    var dialog = $("#entry-dialog");
    if (dialog && typeof dialog.showModal === "function") {
      dialog.showModal();
      setTimeout(function () {
        var focusEl = entry ? amountEl : descEl;
        if (focusEl) focusEl.focus();
      }, 60);
    }
  }

  function openMenuDialog(item) {
    setText("#menu-dialog-title", item ? "Edit menu" : "Tambah menu");

    var idEl = $("#menu-id");
    if (idEl) idEl.value = item ? item.id : "";
    var nameEl = $("#menu-name");
    if (nameEl) nameEl.value = item ? item.name : "";
    var kindEl = $("#menu-kind");
    if (kindEl) kindEl.value = item ? item.kind : "masak";
    var catEl = $("#menu-category");
    if (catEl) {
      var desired = (item && item.category) || menuDefaultCategory(item ? item.kind : "masak");
      if (!Array.prototype.some.call(catEl.options, function (opt) { return opt.value === desired; })) {
        var extra = document.createElement("option");
        extra.value = desired;
        extra.textContent = desired;
        catEl.appendChild(extra);
      }
      catEl.value = desired;
    }
    var amountEl = $("#menu-amount");
    if (amountEl) amountEl.value = item ? item.defaultAmount : "";

    var deleteBtn = $("#menu-delete");
    if (deleteBtn) deleteBtn.hidden = !item;

    showFormError("#menu-error", "");

    var dialog = $("#menu-dialog");
    if (dialog && typeof dialog.showModal === "function") {
      dialog.showModal();
      setTimeout(function () {
        if (nameEl) nameEl.focus();
      }, 60);
    }
  }

  /* ==========================================================
   * ACTIONS
   * ========================================================== */
  async function submitEntryForm(event) {
    event.preventDefault();

    var id = ($("#entry-id") && $("#entry-id").value) || "";
    var type = ($("#entry-type") && $("#entry-type").value) || "expense";
    var date = ($("#entry-date") && $("#entry-date").value) || "";
    var description = ($("#entry-description") && $("#entry-description").value.trim()) || "";
    var category = ($("#entry-category") && $("#entry-category").value) || "Lainnya";
    var pocket = ($("#entry-pocket") && $("#entry-pocket").value) || defaultPocketFor(type);
    var amount = Number(($("#entry-amount") && $("#entry-amount").value) || 0);

    if (!date || !description || !(amount > 0)) {
      showFormError("#entry-error", "Lengkapi tanggal, deskripsi, dan jumlah lebih dari 0.");
      return;
    }

    var payload = {
      date: date,
      type: type,
      category: category,
      description: description,
      amount: amount,
      pocket: pocket
    };

    var submitBtn = $("#entry-submit");
    setBusy(submitBtn, true);

    try {
      if (id) await Store.updateEntry(id, payload);
      else await Store.addEntry(payload);

      var dialog = $("#entry-dialog");
      if (dialog) dialog.close();
      state.editing = null;

      await loadData();
      var s = computeSummary();

      if (type === "budget") {
        toast("Budget diperbarui. Total budget " + EFB.money(s.totalBudget) + ".", "success");
      } else {
        toast(
          "Pengeluaran tersimpan. Sisa budget " + EFB.money(s.remaining) + ".",
          s.remaining < 0 ? "warn" : "success"
        );
      }
    } catch (err) {
      showFormError("#entry-error", friendlyError(err));
    } finally {
      setBusy(submitBtn, false);
    }
  }

  async function submitMenuForm(event) {
    event.preventDefault();

    var id = ($("#menu-id") && $("#menu-id").value) || "";
    var name = ($("#menu-name") && $("#menu-name").value.trim()) || "";
    var kind = ($("#menu-kind") && $("#menu-kind").value) || "masak";
    var category = ($("#menu-category") && $("#menu-category").value) || menuDefaultCategory(kind);
    var amount = Number(($("#menu-amount") && $("#menu-amount").value) || 0);

    if (!name) {
      showFormError("#menu-error", "Nama menu wajib diisi.");
      return;
    }

    var payload = {
      name: name,
      kind: kind,
      category: category,
      defaultAmount: amount
    };

    var submitBtn = $("#menu-submit");
    setBusy(submitBtn, true);

    try {
      if (id) await Store.updateMenuItem(id, payload);
      else await Store.addMenuItem(payload);

      var dialog = $("#menu-dialog");
      if (dialog) dialog.close();

      await loadData();
      toast(id ? "Menu diperbarui." : "Menu ditambahkan.", "success");
    } catch (err) {
      showFormError("#menu-error", friendlyError(err));
    } finally {
      setBusy(submitBtn, false);
    }
  }

  async function deleteEntry(id) {
    var entry = state.entries.filter(function (e) { return e.id === id; })[0];
    if (!entry) return;
    if (!window.confirm('Hapus "' + entry.description + '"?')) return;

    try {
      await Store.deleteEntry(id);
      await loadData();
      toast("Transaksi dihapus.", "success");
    } catch (err) {
      toast(friendlyError(err), "error");
    }
  }

  async function deleteMenu(id) {
    var item = state.menu.filter(function (m) { return m.id === id; })[0];
    if (!item) return;
    if (!window.confirm('Hapus menu "' + item.name + '"?')) return;

    try {
      await Store.deleteMenuItem(id);
      await loadData();
      toast("Menu dihapus.", "success");
    } catch (err) {
      toast(friendlyError(err), "error");
    }
  }

  async function submitExpenseForm(event) {
    event.preventDefault();

    var date = ($("#expense-date") && $("#expense-date").value) || "";
    var description = ($("#expense-description") && $("#expense-description").value.trim()) || "";
    var category = ($("#expense-category") && $("#expense-category").value) || "Lainnya";
    var pocket = ($("#expense-pocket") && $("#expense-pocket").value) || "shared";
    var amount = Number(($("#expense-amount") && $("#expense-amount").value) || 0);

    if (!date || !description || !(amount > 0)) {
      toast("Lengkapi tanggal, deskripsi, dan jumlah.", "error");
      return;
    }

    var submitBtn = event.target.querySelector('button[type="submit"]');
    setBusy(submitBtn, true);

    try {
      await Store.addEntry({
        date: date,
        type: "expense",
        category: category,
        description: description,
        amount: amount,
        pocket: pocket
      });

      var descEl = $("#expense-description");
      if (descEl) descEl.value = "";
      var amountEl = $("#expense-amount");
      if (amountEl) amountEl.value = "";

      await loadData();
      var s = computeSummary();
      toast(
        "Pengeluaran dicatat. Sisa budget " + EFB.money(s.remaining) + ".",
        s.remaining < 0 ? "warn" : "success"
      );
    } catch (err) {
      toast(friendlyError(err), "error");
    } finally {
      setBusy(submitBtn, false);
    }
  }

  async function submitBudgetForm(event) {
    event.preventDefault();

    var date = ($("#budget-date") && $("#budget-date").value) || "";
    var description = ($("#budget-description") && $("#budget-description").value.trim()) || "";
    var pocket = ($("#budget-pocket") && $("#budget-pocket").value) || defaultPocketFor("budget");
    var amount = Number(($("#budget-amount") && $("#budget-amount").value) || 0);

    if (!date || !description || !(amount > 0)) {
      toast("Lengkapi tanggal, keterangan, dan jumlah budget.", "error");
      return;
    }

    var submitBtn = event.target.querySelector('button[type="submit"]');
    setBusy(submitBtn, true);

    try {
      await Store.addEntry({
        date: date,
        type: "budget",
        category: Store.BUDGET_CATEGORY,
        description: description,
        amount: amount,
        pocket: pocket
      });

      var amountEl = $("#budget-amount");
      if (amountEl) amountEl.value = "";

      await loadData();
      var s = computeSummary();
      toast("Budget ditambahkan. Total budget " + EFB.money(s.totalBudget) + ".", "success");
    } catch (err) {
      toast(friendlyError(err), "error");
    } finally {
      setBusy(submitBtn, false);
    }
  }

  async function submitAuthForm(event) {
    event.preventDefault();

    if (state.authTab === "code") {
      var accessCode = normalizeAccessCode($("#auth-code") && $("#auth-code").value);
      if (accessCode.length !== 5) {
        showFormError("#auth-error", "Kode akses harus 5 karakter huruf/angka.");
        return;
      }

      var codeBtn = $("#auth-submit");
      setBusy(codeBtn, true);
      showFormError("#auth-error", "");

      try {
        await Store.signInWithAccessCode(accessCode);
        await enterApp();
      } catch (err) {
        showFormError("#auth-error", (err && err.message) || "Kode akses tidak valid.");
      } finally {
        setBusy(codeBtn, false);
      }
      return;
    }

    var email = ($("#auth-email") && $("#auth-email").value.trim()) || "";
    var password = ($("#auth-password") && $("#auth-password").value) || "";
    var name = ($("#auth-name") && $("#auth-name").value.trim()) || "";

    if (!email || !password) {
      showFormError("#auth-error", "Email dan password wajib diisi.");
      return;
    }

    var submitBtn = $("#auth-submit");
    setBusy(submitBtn, true);
    showFormError("#auth-error", "");

    try {
      if (state.authTab === "login") {
        await Store.signIn(email, password);
        await enterApp();
      } else {
        var result = await Store.signUp(email, password, name);
        if (result && result.user && !result.session) {
          showFormError(
            "#auth-error",
            "Akun dibuat. Cek email untuk konfirmasi, lalu masuk. Atau matikan konfirmasi email di Supabase."
          );
          setAuthTab("login");
          return;
        }
        await enterApp();
      }
    } catch (err) {
      showFormError("#auth-error", friendlyError(err));
    } finally {
      setBusy(submitBtn, false);
    }
  }

  async function submitCreateHousehold(event) {
    event.preventDefault();

    var name = ($("#create-household-name") && $("#create-household-name").value.trim()) || "";
    var displayName = ($("#create-display-name") && $("#create-display-name").value.trim()) || "";

    if (!name) {
      showFormError("#onboarding-error", "Nama rumah tangga wajib diisi.");
      return;
    }

    try {
      showFormError("#onboarding-error", "");
      await Store.createHousehold(name, displayName);
      await enterApp();
      toast("Rumah tangga dibuat. Bagikan kode undangan ke pasangan.", "success");
    } catch (err) {
      showFormError("#onboarding-error", friendlyError(err));
    }
  }

  async function submitJoinHousehold(event) {
    event.preventDefault();

    var code = ($("#join-code") && $("#join-code").value.trim()) || "";
    var displayName = ($("#join-display-name") && $("#join-display-name").value.trim()) || "";

    if (!code) {
      showFormError("#onboarding-error", "Kode undangan wajib diisi.");
      return;
    }

    try {
      showFormError("#onboarding-error", "");
      await Store.joinHousehold(code, displayName);
      await enterApp();
      toast("Berhasil bergabung ke rumah tangga.", "success");
    } catch (err) {
      showFormError("#onboarding-error", friendlyError(err));
    }
  }

  async function doSignOut() {
    try {
      await Store.signOut();
    } catch (err) {
      console.error(err);
    }
    resetState();
    showScreen(Store.hasBackend ? "auth" : "welcome");
    setAuthTab("login");
  }

  async function exportData() {
    try {
      var data = await Store.exportAll();
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "efektivitas-" + EFB.todayISO() + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
      toast("Data diekspor sebagai JSON.", "success");
    } catch (err) {
      toast(friendlyError(err), "error");
    }
  }

  /* ==========================================================
   * UI HELPERS
   * ========================================================== */
  function setAuthTab(tab) {
    state.authTab = tab;

    $$(".auth-tab").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-auth-tab") === tab);
    });

    var isCode = tab === "code";
    var isRegister = tab === "register";

    var nameWrap = $("#auth-name-wrap");
    if (nameWrap) nameWrap.hidden = !isRegister;

    var emailWrap = $("#auth-email-wrap");
    if (emailWrap) emailWrap.hidden = isCode;

    var passwordWrap = $("#auth-password-wrap");
    if (passwordWrap) passwordWrap.hidden = isCode;

    var codeWrap = $("#auth-code-wrap");
    if (codeWrap) codeWrap.hidden = !isCode;

    var codeHint = $("#auth-code-hint");
    if (codeHint) codeHint.hidden = !isCode;

    var email = $("#auth-email");
    if (email) email.required = !isCode;

    var password = $("#auth-password");
    if (password) {
      password.required = !isCode;
      password.autocomplete = isRegister ? "new-password" : "current-password";
    }

    var codeInput = $("#auth-code");
    if (codeInput) codeInput.required = isCode;

    if (isCode) {
      setText("#auth-title", "Masuk dengan kode");
      setText("#auth-subtitle", "Masukkan kode akses 5 karakter dari Pengaturan.");
    } else if (isRegister) {
      setText("#auth-title", "Buat akun baru");
      setText("#auth-subtitle", "Daftar 2 akun untuk dipakai berdua.");
    } else {
      setText("#auth-title", "Selamat datang kembali");
      setText("#auth-subtitle", "Masuk dengan email dan password.");
    }

    var submit = $("#auth-submit");
    if (submit) submit.textContent = isRegister ? "Daftar" : "Masuk";

    showFormError("#auth-error", "");

    if (isCode && codeInput) {
      window.requestAnimationFrame(function () {
        codeInput.focus();
      });
    }
  }

  function fillCategorySelect(select, includeAll) {
    if (!select) return;
    var current = select.value;
    select.innerHTML = "";

    if (includeAll) {
      var all = document.createElement("option");
      all.value = "all";
      all.textContent = "Semua kategori";
      select.appendChild(all);
    }

    Store.CATEGORIES.forEach(function (cat) {
      var opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      select.appendChild(opt);
    });

    if (current) select.value = current;
  }

  function fillMenuCategorySelect(select) {
    if (!select) return;
    var categories = ["Masak Kos", "Jajan", "Makan di Luar", "Kebutuhan", "Makan Pokok", "Lainnya"];
    select.innerHTML = categories
      .map(function (cat) {
        return '<option value="' + esc(cat) + '">' + esc(cat) + "</option>";
      })
      .join("");
  }

  function showFormError(selector, message) {
    var el = $(selector);
    if (!el) return;
    el.textContent = message || "";
    el.hidden = !message;
  }

  function setBusy(button, busy) {
    if (!button) return;
    button.disabled = busy;
    button.classList.toggle("is-busy", busy);
  }

  function toast(message, type) {
    var stack = $("#toast-stack");
    if (!stack) return;

    var el = document.createElement("div");
    el.className = "toast toast-" + (type || "info");
    el.textContent = message;
    stack.appendChild(el);

    setTimeout(function () {
      el.classList.add("is-out");
    }, 3600);

    setTimeout(function () {
      el.remove();
    }, 4200);
  }

  function friendlyError(err) {
    var msg =
      (err && (err.message || err.error_description || err.msg)) ||
      (typeof err === "string" ? err : "Terjadi kesalahan.");

    var rules = [
      [/Invalid login credentials/i, "Email atau password salah."],
      [/Email not confirmed/i, "Email belum dikonfirmasi. Cek inbox atau matikan konfirmasi email di Supabase."],
      [/User already registered/i, "Email sudah terdaftar. Coba masuk."],
      [/Password should be at least/i, "Password minimal 6 karakter."],
      [/Kode undangan tidak ditemukan/i, "Kode undangan tidak ditemukan."],
      [/sudah tergabung/i, "Akun ini sudah tergabung dalam rumah tangga."],
      [/Failed to fetch|NetworkError|Load failed/i, "Tidak bisa menghubungi server. Cek koneksi internet dan konfigurasi Supabase."],
      [/Invalid API key|apikey/i, "Anon key Supabase tidak valid. Cek konfigurasi."],
      [/Invalid URL|Failed to construct/i, "URL Supabase tidak valid. Cek konfigurasi."],
      [/JWT|token/i, "Sesi login bermasalah. Coba masuk ulang."],
      [/column .* does not exist|Could not find the '.*' column|schema cache/i, "Database belum diperbarui. Jalankan ulang supabase/schema.sql di Supabase SQL Editor."],
      [/duplicate key|unique constraint/i, "Data sudah ada. Coba lagi."]
    ];

    for (var i = 0; i < rules.length; i++) {
      if (rules[i][0].test(msg)) return rules[i][1];
    }

    return msg;
  }

  /* ==========================================================
   * EVENTS
   * ========================================================== */
  function bindStaticEvents() {
    $$("[data-theme-choice]").forEach(function (button) {
      button.addEventListener("click", function () {
        applyTheme(button.getAttribute("data-theme-choice"));
        if (state.user) renderAll();
      });
    });

    var welcomeDemo = $("#welcome-demo-btn");
    if (welcomeDemo) {
      welcomeDemo.addEventListener("click", async function () {
        try {
          await Store.startDemo();
          await enterApp();
        } catch (err) {
          toast(friendlyError(err), "error");
        }
      });
    }

    var setupToggle = $("#welcome-setup-toggle");
    if (setupToggle) {
      setupToggle.addEventListener("click", function () {
        var panel = $("#welcome-setup-panel");
        if (panel) panel.hidden = !panel.hidden;
      });
    }

    var setupForm = $("#setup-form");
    if (setupForm) {
      setupForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var url = ($("#setup-url") && $("#setup-url").value.trim().replace(/\/+$/, "")) || "";
        var key = ($("#setup-key") && $("#setup-key").value.trim()) || "";

        if (!/^https?:\/\//i.test(url) || key.length < 20) {
          showFormError("#setup-error", "URL harus http(s) dan anon key terlihat valid.");
          return;
        }

        localStorage.setItem(
          "efb_config",
          JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key })
        );
        window.location.reload();
      });
    }

    $$(".auth-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setAuthTab(btn.getAttribute("data-auth-tab"));
      });
    });

    var authForm = $("#auth-form");
    if (authForm) authForm.addEventListener("submit", submitAuthForm);

    var authCode = $("#auth-code");
    if (authCode) {
      authCode.addEventListener("input", function () {
        this.value = normalizeAccessCode(this.value);
      });
    }

    var resetConfig = $("#auth-reset-config");
    if (resetConfig) {
      resetConfig.addEventListener("click", function () {
        if (!window.confirm("Hapus konfigurasi Supabase yang tersimpan di browser ini?")) return;
        localStorage.removeItem("efb_config");
        window.location.reload();
      });
    }

    var createForm = $("#create-household-form");
    if (createForm) createForm.addEventListener("submit", submitCreateHousehold);

    var joinForm = $("#join-household-form");
    if (joinForm) joinForm.addEventListener("submit", submitJoinHousehold);

    var onboardingSignout = $("#onboarding-signout");
    if (onboardingSignout) onboardingSignout.addEventListener("click", doSignOut);

    $$(".nav-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setTab(btn.getAttribute("data-tab"));
      });
    });

    var prevBtn = $("#month-prev");
    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        setMonth(EFB.plusMonth(state.month, -1));
      });
    }

    var nextBtn = $("#month-next");
    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        setMonth(EFB.plusMonth(state.month, 1));
      });
    }

    var monthInput = $("#month-input");
    if (monthInput) {
      monthInput.addEventListener("change", function () {
        if (monthInput.value) setMonth(monthInput.value);
      });
    }

    var signoutBtn = $("#signout-btn");
    if (signoutBtn) signoutBtn.addEventListener("click", doSignOut);

    var dashAdd = $("#dash-add-expense");
    if (dashAdd) {
      dashAdd.addEventListener("click", function () {
        openEntryDialog({ type: "expense" });
      });
    }

    var expenseForm = $("#expense-form");
    if (expenseForm) expenseForm.addEventListener("submit", submitExpenseForm);

    var budgetForm = $("#budget-form");
    if (budgetForm) budgetForm.addEventListener("submit", submitBudgetForm);

    $$("[data-budget-preset]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var preset = btn.getAttribute("data-budget-preset");
        var range = EFB.monthRange(state.month);
        var dateEl = $("#budget-date");
        var descEl = $("#budget-description");
        var amountEl = $("#budget-amount");

        if (preset === "awal") {
          if (dateEl) dateEl.value = range.start;
          if (descEl) descEl.value = "Budget awal " + EFB.monthLabel(state.month);
        } else {
          if (dateEl) dateEl.value = defaultDate();
          if (descEl) descEl.value = "Tambahan budget";
        }

        if (amountEl) amountEl.focus();
      });
    });

    var search = $("#expense-search");
    if (search) search.addEventListener("input", renderExpenses);

    var filterCategory = $("#expense-filter-category");
    if (filterCategory) filterCategory.addEventListener("change", renderExpenses);

    var filterPocket = $("#expense-filter-pocket");
    if (filterPocket) filterPocket.addEventListener("change", renderExpenses);

    var menuAdd = $("#menu-add-btn");
    if (menuAdd) {
      menuAdd.addEventListener("click", function () {
        openMenuDialog(null);
      });
    }

    $$("[data-menu-toggle]").forEach(function (toggle) {
      toggle.addEventListener("click", function () {
        var group = toggle.closest(".menu-group");
        if (!group) return;
        var isOpen = group.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      });
    });

    var menuKind = $("#menu-kind");
    if (menuKind) {
      menuKind.addEventListener("change", function () {
        var catEl = $("#menu-category");
        if (catEl) catEl.value = menuDefaultCategory(menuKind.value);
      });
    }

    var menuForm = $("#menu-dialog-form");
    if (menuForm) menuForm.addEventListener("submit", submitMenuForm);

    var menuCancel = $("#menu-cancel");
    if (menuCancel) {
      menuCancel.addEventListener("click", function () {
        var dialog = $("#menu-dialog");
        if (dialog) dialog.close();
      });
    }

    var menuDelete = $("#menu-delete");
    if (menuDelete) {
      menuDelete.addEventListener("click", async function () {
        var id = $("#menu-id") && $("#menu-id").value;
        if (!id) return;
        if (!window.confirm("Hapus menu ini?")) return;

        try {
          await Store.deleteMenuItem(id);
          var dialog = $("#menu-dialog");
          if (dialog) dialog.close();
          await loadData();
          toast("Menu dihapus.", "success");
        } catch (err) {
          showFormError("#menu-error", friendlyError(err));
        }
      });
    }

    var entryForm = $("#entry-form");
    if (entryForm) entryForm.addEventListener("submit", submitEntryForm);

    var entryCancel = $("#entry-cancel");
    if (entryCancel) {
      entryCancel.addEventListener("click", function () {
        var dialog = $("#entry-dialog");
        if (dialog) dialog.close();
      });
    }

    var entryDelete = $("#entry-delete");
    if (entryDelete) {
      entryDelete.addEventListener("click", async function () {
        var id = $("#entry-id") && $("#entry-id").value;
        if (!id) return;
        if (!window.confirm("Hapus transaksi ini?")) return;

        try {
          await Store.deleteEntry(id);
          var dialog = $("#entry-dialog");
          if (dialog) dialog.close();
          state.editing = null;
          await loadData();
          toast("Transaksi dihapus.", "success");
        } catch (err) {
          showFormError("#entry-error", friendlyError(err));
        }
      });
    }

    var settingsDisplayForm = $("#settings-display-form");
    if (settingsDisplayForm) {
      settingsDisplayForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        var name = ($("#settings-display-name") && $("#settings-display-name").value.trim()) || "";
        if (!name) return;

        try {
          await Store.updateDisplayName(name);
          state.membership.displayName = name;
          await loadData();
          toast("Nama tampilan diperbarui.", "success");
        } catch (err) {
          toast(friendlyError(err), "error");
        }
      });
    }

    var settingsHouseholdForm = $("#settings-household-form");
    if (settingsHouseholdForm) {
      settingsHouseholdForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        var name = ($("#settings-household-name") && $("#settings-household-name").value.trim()) || "";
        if (!name) return;

        try {
          var updated = await Store.updateHousehold(name);
          state.household = updated;
          updateHeader();
          renderSettings();
          toast("Nama rumah tangga diperbarui.", "success");
        } catch (err) {
          toast(friendlyError(err), "error");
        }
      });
    }

    var settingsWarningForm = $("#settings-warning-form");
    if (settingsWarningForm) {
      settingsWarningForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        var dailyCap = Number(($("#settings-daily-cap") && $("#settings-daily-cap").value) || 0);
        var warnThreshold = Number(($("#settings-warn-threshold") && $("#settings-warn-threshold").value) || 0);
        var criticalThreshold = Number(($("#settings-critical-threshold") && $("#settings-critical-threshold").value) || 0);

        if (!(dailyCap > 0)) {
          toast("Batas harian harus lebih dari 0.", "error");
          return;
        }
        if (!(warnThreshold > criticalThreshold)) {
          toast("Ambang waspada harus lebih besar dari ambang kritis.", "error");
          return;
        }

        var submitBtn = event.target.querySelector('button[type="submit"]');
        setBusy(submitBtn, true);

        try {
          var updated = await Store.updateHouseholdSettings({
            dailyCap: dailyCap,
            warnThreshold: warnThreshold,
            criticalThreshold: criticalThreshold
          });
          state.household = updated;
          renderAll();
          toast("Pengaturan saku dan peringatan disimpan.", "success");
        } catch (err) {
          toast(friendlyError(err), "error");
        } finally {
          setBusy(submitBtn, false);
        }
      });
    }

    var copyInvite = $("#copy-invite");
    if (copyInvite) {
      copyInvite.addEventListener("click", async function () {
        var code = state.household && state.household.inviteCode;
        if (!code) return;

        try {
          await navigator.clipboard.writeText(code);
          toast("Kode undangan disalin.", "success");
        } catch (err) {
          window.prompt("Salin kode undangan:", code);
        }
      });
    }

    var rotateInvite = $("#rotate-invite");
    if (rotateInvite) {
      rotateInvite.addEventListener("click", async function () {
        if (!window.confirm("Ganti kode undangan? Kode lama tidak bisa dipakai lagi.")) return;

        try {
          var code = await Store.rotateInviteCode();
          state.household.inviteCode = code;
          renderSettings();
          toast("Kode undangan baru: " + code, "success");
        } catch (err) {
          toast(friendlyError(err), "error");
        }
      });
    }

    var accessInput = $("#settings-access-input");
    if (accessInput) {
      accessInput.addEventListener("input", function () {
        this.value = normalizeAccessCode(this.value);
      });
    }

    var accessForm = $("#settings-access-form");
    if (accessForm) {
      accessForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        var code = normalizeAccessCode(accessInput && accessInput.value);
        if (code.length !== 5) {
          toast("Kode akses harus 5 karakter huruf/angka.", "error");
          return;
        }

        var btn = $("#settings-access-submit");
        setBusy(btn, true);
        try {
          var access = await Store.setAccessCode(code);
          state.access = access;
          state.accessLoaded = true;
          state.accessQrToken = null;
          renderSettings();
          toast("Kode akses diperbarui. QR lama tidak berlaku.", "success");
        } catch (err) {
          toast(friendlyError(err), "error");
        } finally {
          setBusy(btn, false);
        }
      });
    }

    var rotateAccess = $("#rotate-access-code");
    if (rotateAccess) {
      rotateAccess.addEventListener("click", async function () {
        if (!window.confirm("Acak kode akses? QR lama tidak berlaku.")) return;

        var btn = $("#settings-access-submit");
        setBusy(btn, true);
        try {
          var access = await Store.regenerateAccessCode();
          state.access = access;
          state.accessLoaded = true;
          state.accessQrToken = null;
          renderSettings();
          toast("Kode akses baru dibuat. QR lama tidak berlaku.", "success");
        } catch (err) {
          toast(friendlyError(err), "error");
        } finally {
          setBusy(btn, false);
        }
      });
    }

    var copyAccessCode = $("#copy-access-code");
    if (copyAccessCode) {
      copyAccessCode.addEventListener("click", async function () {
        var code = state.access && state.access.code;
        if (!code) return;

        try {
          await navigator.clipboard.writeText(code);
          toast("Kode akses disalin.", "success");
        } catch (err) {
          window.prompt("Salin kode akses:", code);
        }
      });
    }

    var copyAccessLink = $("#copy-access-link");
    if (copyAccessLink) {
      copyAccessLink.addEventListener("click", async function () {
        var token = state.access && state.access.token;
        if (!token) return;

        var link = accessLink(token);
        try {
          await navigator.clipboard.writeText(link);
          toast("Tautan QR disalin.", "success");
        } catch (err) {
          window.prompt("Salin tautan QR:", link);
        }
      });
    }

    var exportBtn = $("#settings-export");
    if (exportBtn) exportBtn.addEventListener("click", exportData);

    var resetDemo = $("#settings-reset-demo");
    if (resetDemo) {
      resetDemo.addEventListener("click", async function () {
        if (!window.confirm("Reset semua data demo ke contoh awal?")) return;

        try {
          await Store.resetDemo();
          state.month = EFB.monthKey();
          await enterApp();
          toast("Data demo direset.", "success");
        } catch (err) {
          toast(friendlyError(err), "error");
        }
      });
    }

    var leaveBtn = $("#settings-leave");
    if (leaveBtn) {
      leaveBtn.addEventListener("click", async function () {
        if (!window.confirm("Keluar dari rumah tangga? Kamu tidak akan bisa melihat data ini lagi.")) return;

        try {
          await Store.leaveHousehold();
          if (state.subscription) {
            Store.unsubscribe(state.subscription);
            state.subscription = null;
          }
          state.membership = null;
          state.household = null;
          state.entries = [];
          state.menu = [];
          state.members = [];
          await enterApp();
          toast("Kamu keluar dari rumah tangga.", "success");
        } catch (err) {
          toast(friendlyError(err), "error");
        }
      });
    }

    var settingsSignout = $("#settings-signout");
    if (settingsSignout) settingsSignout.addEventListener("click", doSignOut);

    bindRowActions("#budget-list");
    bindRowActions("#expense-list");
    bindRowActions("#menu-masak-list");
    bindRowActions("#menu-jajan-list");
    bindRowActions("#menu-diluar-list");
    bindRowActions("#menu-kebutuhan-list");

    document.addEventListener("click", function (event) {
      var goto = event.target.closest("[data-goto]");
      if (goto) setTab(goto.getAttribute("data-goto"));
    });

    var entryDialog = $("#entry-dialog");
    if (entryDialog) {
      entryDialog.addEventListener("close", function () {
        state.editing = null;
      });
    }
  }

  function bindRowActions(selector) {
    var container = $(selector);
    if (!container) return;

    container.addEventListener("click", async function (event) {
      var button = event.target.closest("button[data-action]");
      if (!button) return;

      var id = button.getAttribute("data-id");
      var action = button.getAttribute("data-action");

      if (action === "edit") {
        var entry = state.entries.filter(function (e) { return e.id === id; })[0];
        if (entry) openEntryDialog({ entry: entry });
        return;
      }

      if (action === "delete") {
        await deleteEntry(id);
        return;
      }

      if (action === "use") {
        var item = state.menu.filter(function (m) { return m.id === id; })[0];
        if (item) openEntryDialog({ type: "expense", preset: item });
        return;
      }

      if (action === "edit-menu") {
        var menuItem = state.menu.filter(function (m) { return m.id === id; })[0];
        if (menuItem) openMenuDialog(menuItem);
        return;
      }

      if (action === "delete-menu") {
        await deleteMenu(id);
      }
    });
  }
})();
