/* Gifty page scraper. Runs in the page's isolated world and only reads
   the page when the popup or background asks for it. It never sends
   anything anywhere: the extracted title/image/price goes back to the
   extension, which stores it locally. */
(function () {
  "use strict";
  if (window.__giftyContentLoaded) return;
  window.__giftyContentLoaded = true;

  function metaContent(attr, value) {
    var el = document.querySelector('meta[' + attr + '="' + value + '"]');
    return el ? (el.getAttribute("content") || "").trim() : "";
  }

  function toAbsolute(src) {
    if (!src) return "";
    try {
      var u = new URL(String(src).trim(), document.baseURI);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      return u.href;
    } catch (e) { return ""; }
  }

  function firstString(v) {
    if (typeof v === "string") return v.trim();
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) {
        var s = firstString(v[i]);
        if (s) return s;
      }
    }
    if (v && typeof v === "object") {
      if (typeof v.url === "string") return v.url.trim();
      if (typeof v.contentUrl === "string") return v.contentUrl.trim();
    }
    return "";
  }

  function walkJsonLd(node, found) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(function (n) { walkJsonLd(n, found); }); return; }
    var type = node["@type"];
    var types = Array.isArray(type) ? type : [type];
    if (types.indexOf("Product") !== -1) found.push(node);
    if (Array.isArray(node["@graph"])) walkJsonLd(node["@graph"], found);
    if (node.mainEntity) walkJsonLd(node.mainEntity, found);
  }

  function jsonLdProduct() {
    var products = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(function (el) {
      try { walkJsonLd(JSON.parse(el.textContent || "{}"), products); } catch (e) { /* malformed JSON-LD */ }
    });
    return products[0] || null;
  }

  function offerFromProduct(product) {
    if (!product || !product.offers) return null;
    var offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    if (!offers) return null;
    if (offers.offers) offers = Array.isArray(offers.offers) ? offers.offers[0] : offers.offers;
    return offers || null;
  }

  function collectImages(ogImage, twitterImage, ldImage) {
    var seen = {};
    var out = [];
    function push(src) {
      var abs = toAbsolute(src);
      if (!abs || seen[abs]) return;
      seen[abs] = true;
      out.push(abs);
    }
    push(ogImage);
    push(twitterImage);
    push(ldImage);
    var linkImg = document.querySelector('link[rel="image_src"]');
    if (linkImg) push(linkImg.getAttribute("href"));

    // Fallback: largest visible images on the page, skipping logos/icons.
    var scored = [];
    Array.prototype.forEach.call(document.images || [], function (img) {
      var src = img.currentSrc || img.src || "";
      var abs = toAbsolute(src);
      if (!abs || seen[abs]) return;
      var w = img.naturalWidth || img.clientWidth || 0;
      var h = img.naturalHeight || img.clientHeight || 0;
      if (w < 120 || h < 120) return;
      var lower = abs.toLowerCase();
      var junk = /logo|icon|avatar|sprite|badge|favicon/.test(lower);
      scored.push({ url: abs, area: w * h, junk: junk });
    });
    scored.sort(function (a, b) {
      if (a.junk !== b.junk) return a.junk ? 1 : -1;
      return b.area - a.area;
    });
    scored.slice(0, 6).forEach(function (s) { push(s.url); });
    return out.slice(0, 8);
  }

  function extractPrice(product) {
    // 1. JSON-LD offers. 2. Product meta tags. 3. Microdata / data attrs.
    // Deliberately no free-text price hunting: guessing from visible text
    // grabs the wrong number too often. The popup lets you type it.
    var offer = offerFromProduct(product);
    if (offer && offer.price !== undefined && offer.price !== null && offer.price !== "") {
      var parsed = GiftyUtils.parsePriceText(String(offer.price));
      return {
        price: parsed.amount,
        currency: offer.priceCurrency ? String(offer.priceCurrency).toUpperCase() : parsed.currency,
        priceText: offer.priceCurrency ? offer.priceCurrency + " " + offer.price : String(offer.price)
      };
    }
    var metaPrice = metaContent("property", "product:price:amount") || metaContent("property", "og:price:amount");
    if (metaPrice) {
      var mp = GiftyUtils.parsePriceText(metaPrice);
      var mc = metaContent("property", "product:price:currency") || metaContent("property", "og:price:currency");
      return { price: mp.amount, currency: (mc || mp.currency || null), priceText: metaPrice };
    }
    var prop = document.querySelector("[itemprop='price']");
    if (prop) {
      var content = prop.getAttribute("content") || prop.textContent || "";
      var pp = GiftyUtils.parsePriceText(content);
      if (pp.amount !== null) {
        var curEl = document.querySelector("[itemprop='priceCurrency']");
        var cur = curEl ? (curEl.getAttribute("content") || curEl.textContent || "").trim() : "";
        return { price: pp.amount, currency: cur || pp.currency, priceText: content.trim().slice(0, 60) };
      }
    }
    var dataEl = document.querySelector("[data-price]");
    if (dataEl) {
      var dp = GiftyUtils.parsePriceText(dataEl.getAttribute("data-price"));
      if (dp.amount !== null) return { price: dp.amount, currency: dp.currency, priceText: dataEl.getAttribute("data-price") };
    }
    return { price: null, currency: null, priceText: null };
  }

  function extract() {
    var product = jsonLdProduct();
    var ogTitle = metaContent("property", "og:title");
    var twitterTitle = metaContent("name", "twitter:title");
    var title = ogTitle || twitterTitle || (product && firstString(product.name)) || document.title || "";
    var description = metaContent("property", "og:description")
      || metaContent("name", "twitter:description")
      || metaContent("name", "description")
      || (product && firstString(product.description))
      || "";
    var images = collectImages(
      metaContent("property", "og:image"),
      metaContent("name", "twitter:image"),
      product ? firstString(product.image) : ""
    );
    var priceInfo = extractPrice(product);
    var canonical = document.querySelector('link[rel="canonical"]');
    var url = (canonical && canonical.getAttribute("href")) ? toAbsolute(canonical.getAttribute("href")) : location.href;
    var selection = "";
    try { selection = String(window.getSelection ? window.getSelection().toString() : "").trim().slice(0, 500); } catch (e) { /* ignore */ }

    return {
      title: GiftyUtils.cleanTitle(title),
      description: String(description).replace(/\s+/g, " ").trim().slice(0, 1000),
      url: url || location.href,
      site: location.hostname.replace(/^www\./, ""),
      images: images,
      image: images[0] || null,
      price: priceInfo.price,
      currency: priceInfo.currency,
      priceText: priceInfo.priceText,
      selection: selection
    };
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.type !== "GIFTY_GET_PAGE_DATA") return;
    try {
      sendResponse({ ok: true, data: extract() });
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  });
})();
