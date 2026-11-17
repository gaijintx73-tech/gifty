/* Gifty shared helpers. Pure functions only, no DOM or chrome APIs here
   except crypto.randomUUID, so this file runs in the popup, dashboard,
   content script, service worker, and plain Node tests. */
(function () {
  "use strict";

  var TRACKING_PARAMS = [
    "fbclid", "gclid", "gbraid", "wbraid", "msclkid", "igshid",
    "mc_cid", "mc_eid", "_ga", "_gac", "ref", "ref_", "tag",
    "yclid", "vero_id", "vero_conv", "mkt_tok"
  ];

  function isTrackingParam(name) {
    var n = String(name).toLowerCase();
    if (n.indexOf("utm_") === 0) return true;
    return TRACKING_PARAMS.indexOf(n) !== -1;
  }

  // Canonical URL used for duplicate detection. Strips tracking params,
  // fragments, and a leading www., and sorts the remaining query params
  // so the same product reached two ways still matches.
  function normalizeUrl(raw) {
    if (!raw) return "";
    var input = String(raw).trim();
    try {
      var u = new URL(input);
      u.hash = "";
      u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
      var kept = [];
      u.searchParams.forEach(function (value, key) {
        if (!isTrackingParam(key)) kept.push([key, value]);
      });
      kept.sort(function (a, b) {
        return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
      });
      var qs = kept
        .map(function (pair) {
          return encodeURIComponent(pair[0]) + "=" + encodeURIComponent(pair[1]);
        })
        .join("&");
      var path = u.pathname;
      if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
      return u.protocol + "//" + u.hostname + (u.port ? ":" + u.port : "") + path + (qs ? "?" + qs : "");
    } catch (e) {
      return input;
    }
  }

  function hostnameFromUrl(raw) {
    try {
      return new URL(String(raw)).hostname.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  }

  function cleanTitle(raw, maxLen) {
    var t = String(raw || "").replace(/\s+/g, " ").trim();
    var limit = maxLen || 300;
    if (t.length > limit) t = t.slice(0, limit).trim();
    return t;
  }

  function uid() {
    try {
      if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) { /* fall through */ }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  var CURRENCY_SYMBOLS = { "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR" };

  // Parse "$1,299.99", "€75", "USD 49.99", "49.99 USD". Ranges take the
  // first amount; the original text is always kept as priceText.
  function parsePriceText(raw) {
    if (raw === null || raw === undefined) return { amount: null, currency: null };
    if (typeof raw === "number" && isFinite(raw)) return { amount: raw, currency: null };
    var text = String(raw).trim();
    if (!text) return { amount: null, currency: null };
    var currency = null;
    var code = text.match(/\b(USD|EUR|GBP|JPY|AUD|CAD|CHF|NZD|INR)\b/i);
    if (code) {
      currency = code[1].toUpperCase();
    } else if (/A\$/.test(text)) currency = "AUD";
    else if (/C\$/.test(text)) currency = "CAD";
    else {
      for (var sym in CURRENCY_SYMBOLS) {
        if (text.indexOf(sym) !== -1) { currency = CURRENCY_SYMBOLS[sym]; break; }
      }
    }
    var m = text.match(/[\d]{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/);
    if (!m) return { amount: null, currency: currency };
    var amount = parseFloat(m[0].replace(/[,\s]/g, ""));
    if (!isFinite(amount)) return { amount: null, currency: currency };
    return { amount: amount, currency: currency };
  }

  function formatPrice(item) {
    if (item.priceText && (item.price === null || item.price === undefined)) return item.priceText;
    if (item.price === null || item.price === undefined || !isFinite(item.price)) return "";
    var currency = item.currency || "USD";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency", currency: currency
      }).format(item.price);
    } catch (e) {
      return currency + " " + item.price.toFixed(2);
    }
  }

  // "gift ideas, Kitchen ,#books" -> ["gift ideas", "Kitchen", "books"]
  function cleanTag(t) {
    // Trim first: "#kitchen" after a comma arrives as " #kitchen",
    // and stripping "#" before trimming would miss it.
    return String(t).trim().replace(/^#+/, "").trim();
  }

  function parseTags(raw) {
    if (Array.isArray(raw)) {
      return dedupeTags(raw.map(cleanTag));
    }
    if (!raw) return [];
    return dedupeTags(String(raw).split(",").map(cleanTag));
  }

  function dedupeTags(tags) {
    var seen = {};
    var out = [];
    tags.forEach(function (t) {
      if (!t || t.length > 40) return;
      var key = t.toLowerCase();
      if (!seen[key]) { seen[key] = true; out.push(t); }
    });
    return out.slice(0, 20);
  }

  function escapeHtml(raw) {
    return String(raw == null ? "" : raw)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  var api = {
    normalizeUrl: normalizeUrl,
    hostnameFromUrl: hostnameFromUrl,
    cleanTitle: cleanTitle,
    uid: uid,
    parsePriceText: parsePriceText,
    formatPrice: formatPrice,
    parseTags: parseTags,
    escapeHtml: escapeHtml
  };

  globalThis.GiftyUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
