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

  var CATEGORY_COLORS = {
    "Makan Pokok": "#00f0ff",
    "Jajan": "#ff2bd6",
    "Masak Kos": "#b6ff3b",
    "Transport": "#ffb020",
    "Kebutuhan": "#8b5cff",
    "Lainnya": "#7f9db0",
    "Budget": "#00f0ff"
  };

  var PALETTE = ["#00f0ff", "#ff2bd6", "#b6ff3b", "#ffb020", "#8b5cff", "#ff4d6d", "#3ddc97"];

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
    entering: false
  };

  document.addEventListener("DOMContentLoaded", init);

  /* ==========================================================
   * BOOT
   * ========================================================== */
  async function init() {
    bindStaticEvents();

    var monthInput = $("#month-input");
    if (monthInput) monthInput.value = state.month;

    fillCategorySelect($("#expense-category"));
    var expCat = $("#expense-category");
    if (expCat) expCat.value = "Makan Pokok";
    fillCategorySelect($("#expense-filter-category"), true);
    fillMenuCategorySelect($("#menu-category"));

    if (!Store.hasBackend) {
      showScreen("welcome");
      return;
    }

    try {
      var session = await Store.init();
      Store.onAuthChange(handleAuthChange);
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

    return {
      budgets: budgets,
      expenses: expenses,
      totalBudget: totalBudget,
      totalExpense: totalExpense,
      remaining: remaining,
      pct: pct,
      days: range.days,
      daysLeft: daysLeft,
      dailySafe: dailySafe,
      isCurrent: isCurrent,
      isFuture: isFuture,
      isPast: !isCurrent && !isFuture
    };
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
      insight = "Belum ada budget untuk bulan ini. Tambahkan budget awal di menu Budget supaya sisa otomatis terhitung.";
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
          '<span class="recent-meta">' + esc(EFB.dateLabel(e.date)) + " · " + esc(e.category) + "</span>" +
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
    var base = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: {
            color: "#9fc7d8",
            font: { family: "Rajdhani", size: 12 },
            boxWidth: 12,
            boxHeight: 12
          }
        },
        tooltip: {
          backgroundColor: "rgba(4,8,18,.96)",
          borderColor: "rgba(0,240,255,.35)",
          borderWidth: 1,
          titleColor: "#e6faff",
          bodyColor: "#b7dbe8",
          padding: 10,
          callbacks: {
            label: function (ctx) {
              return " " + ctx.dataset.label + ": " + EFB.money(ctx.parsed.y);
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(0,240,255,.06)" },
          ticks: {
            color: "#6f93a6",
            font: { family: "Rajdhani" },
            maxRotation: 0,
            autoSkip: true
          }
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(0,240,255,.06)" },
          ticks: {
            color: "#6f93a6",
            font: { family: "Rajdhani" },
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
        borderColor: "#00f0ff",
        backgroundColor: "rgba(0,240,255,.10)",
        fill: true,
        tension: 0.35,
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
        borderColor: "#ff2bd6",
        borderDash: [6, 6],
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
            borderColor: "#04060e",
            borderWidth: 2,
            hoverOffset: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "66%",
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: "#9fc7d8",
              font: { family: "Rajdhani", size: 11 },
              boxWidth: 10,
              boxHeight: 10
            }
          },
          tooltip: {
            backgroundColor: "rgba(4,8,18,.96)",
            borderColor: "rgba(255,43,214,.35)",
            borderWidth: 1,
            titleColor: "#e6faff",
            bodyColor: "#b7dbe8",
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
      return index + 1 === todayDay ? "#ff2bd6" : "rgba(0,240,255,.55)";
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
            '<span class="entry-date">' + esc(EFB.dateLabel(e.date)) + "</span>" +
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
    var all = state.entries.filter(function (e) {
      return e.type === "expense";
    });

    setText("#expense-month-title", EFB.monthLabel(state.month));
    setText("#expense-total", EFB.money(EFB.sum(all, function (e) { return e.amount; })));
    setText("#expense-count", all.length + " transaksi");

    var query = ($("#expense-search") && $("#expense-search").value.trim().toLowerCase()) || "";
    var category = ($("#expense-filter-category") && $("#expense-filter-category").value) || "all";

    var filtered = all.filter(function (e) {
      var matchQuery =
        !query ||
        e.description.toLowerCase().indexOf(query) >= 0 ||
        e.category.toLowerCase().indexOf(query) >= 0;
      var matchCategory = category === "all" || e.category === category;
      return matchQuery && matchCategory;
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

    masak.sort(menuSorter);
    jajan.sort(menuSorter);

    setText("#menu-masak-count", masak.length + " item");
    setText("#menu-jajan-count", jajan.length + " item");

    var masakList = $("#menu-masak-list");
    if (masakList) masakList.innerHTML = masak.map(menuRow).join("");

    var jajanList = $("#menu-jajan-list");
    if (jajanList) jajanList.innerHTML = jajan.map(menuRow).join("");

    var masakEmpty = $("#menu-masak-empty");
    if (masakEmpty) masakEmpty.hidden = masak.length > 0;
    var jajanEmpty = $("#menu-jajan-empty");
    if (jajanEmpty) jajanEmpty.hidden = jajan.length > 0;
  }

  function menuSorter(a, b) {
    return (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name);
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
      var desired = (item && item.category) || "Masak Kos";
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
      amount: amount
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
    var category = ($("#menu-category") && $("#menu-category").value) || (kind === "masak" ? "Masak Kos" : "Jajan");
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
        amount: amount
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
        amount: amount
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

    var nameWrap = $("#auth-name-wrap");
    if (nameWrap) nameWrap.hidden = tab !== "register";

    setText("#auth-title", tab === "login" ? "Selamat datang kembali" : "Buat akun baru");
    setText(
      "#auth-subtitle",
      tab === "login"
        ? "Masuk dengan email dan password."
        : "Daftar 2 akun untuk dipakai berdua."
    );

    var submit = $("#auth-submit");
    if (submit) submit.textContent = tab === "login" ? "Masuk" : "Daftar";

    var password = $("#auth-password");
    if (password) {
      password.autocomplete = tab === "login" ? "current-password" : "new-password";
    }

    showFormError("#auth-error", "");
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
    var categories = ["Masak Kos", "Jajan", "Makan Pokok", "Kebutuhan", "Lainnya"];
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
      [/JWT|token/i, "Sesi login bermasalah. Coba masuk ulang."],
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

    var menuAdd = $("#menu-add-btn");
    if (menuAdd) {
      menuAdd.addEventListener("click", function () {
        openMenuDialog(null);
      });
    }

    var menuKind = $("#menu-kind");
    if (menuKind) {
      menuKind.addEventListener("change", function () {
        var catEl = $("#menu-category");
        if (catEl) catEl.value = menuKind.value === "masak" ? "Masak Kos" : "Jajan";
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
