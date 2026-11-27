/* Utilitas bersama (format uang, tanggal, helper DOM). */
(function (global) {
  "use strict";

  var EFB = global.EFB || (global.EFB = {});

  var moneyFmt = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  });
  var numFmt = new Intl.NumberFormat("id-ID");
  var shortFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

  EFB.money = function (n) {
    return moneyFmt.format(Number(n) || 0);
  };

  EFB.number = function (n) {
    return numFmt.format(Number(n) || 0);
  };

  EFB.shortMoney = function (n) {
    n = Number(n) || 0;
    var abs = Math.abs(n);
    if (abs >= 1e9) return shortFmt.format(n / 1e9) + " M";
    if (abs >= 1e6) return shortFmt.format(n / 1e6) + " jt";
    if (abs >= 1e3) return Math.round(n / 1e3) + " rb";
    return numFmt.format(n);
  };

  EFB.pad2 = function (n) {
    return String(n).padStart(2, "0");
  };

  EFB.toISO = function (d) {
    return d.getFullYear() + "-" + EFB.pad2(d.getMonth() + 1) + "-" + EFB.pad2(d.getDate());
  };

  EFB.todayISO = function () {
    return EFB.toISO(new Date());
  };

  EFB.monthKey = function (d) {
    return EFB.toISO(d || new Date()).slice(0, 7);
  };

  EFB.monthRange = function (key) {
    var parts = String(key).split("-");
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    var days = new Date(year, month, 0).getDate();
    return {
      year: year,
      month: month,
      days: days,
      start: key + "-01",
      end: key + "-" + EFB.pad2(days)
    };
  };

  EFB.monthLabel = function (key) {
    var r = EFB.monthRange(key);
    return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(
      new Date(r.year, r.month - 1, 1)
    );
  };

  EFB.dateLabel = function (iso) {
    var p = String(iso).split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return new Intl.DateTimeFormat("id-ID", {
      weekday: "short",
      day: "numeric",
      month: "short"
    }).format(d);
  };

  EFB.longDate = function (iso) {
    var p = String(iso).split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return new Intl.DateTimeFormat("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(d);
  };

  EFB.plusMonth = function (key, delta) {
    var p = String(key).split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1 + delta, 1);
    return d.getFullYear() + "-" + EFB.pad2(d.getMonth() + 1);
  };

  EFB.sum = function (arr, fn) {
    return arr.reduce(function (acc, item) {
      return acc + Number((fn ? fn(item) : item) || 0);
    }, 0);
  };

  EFB.clamp = function (n, min, max) {
    return Math.max(min, Math.min(max, n));
  };

  EFB.escapeHtml = function (value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  };

  EFB.uid = function () {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  };

  EFB.debounce = function (fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(ctx, args);
      }, wait);
    };
  };

  EFB.hexToRgba = function (hex, alpha) {
    var h = String(hex).replace("#", "");
    if (h.length === 3) {
      h = h.split("").map(function (c) { return c + c; }).join("");
    }
    var num = parseInt(h, 16);
    return "rgba(" + ((num >> 16) & 255) + "," + ((num >> 8) & 255) + "," + (num & 255) + "," + alpha + ")";
  };
})(window);
