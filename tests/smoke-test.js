/* Gifty smoke tests. No dependencies. Run from the repo root:
   node tests/smoke-test.js
   Covers the pure helpers and the storage layer (CRUD, dedupe by
   canonical URL, list delete/move, export/import merge) with an
   in-memory chrome.storage.local stub. The popup, dashboard, and
   content script are DOM/browser code and are checked by loading the
   unpacked extension (see README). */
"use strict";

// In-memory chrome.storage.local stub, installed before store.js loads.
var backing = {};
global.chrome = {
  storage: {
    local: {
      get: function (keys) {
        var out = {};
        (Array.isArray(keys) ? keys : [keys]).forEach(function (k) {
          if (k in backing) out[k] = backing[k];
        });
        return Promise.resolve(out);
      },
      set: function (obj) {
        Object.assign(backing, JSON.parse(JSON.stringify(obj)));
        return Promise.resolve();
      },
      getBytesInUse: function () {
        return Promise.resolve(JSON.stringify(backing).length);
      }
    }
  }
};

var utils = require("../utils.js");
var store = require("../store.js");

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS " + name);
  else { failures++; console.log("FAIL " + name + (extra !== undefined ? " :: " + JSON.stringify(extra) : "")); }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual: actual, expected: expected });
}

async function main() {
  // --- utils ---
  eq("normalizeUrl strips tracking + fragment, sorts params",
    utils.normalizeUrl("https://WWW.Example.com/thing/?b=2&utm_source=x&a=1&fbclid=zzz#part"),
    "https://example.com/thing?a=1&b=2");
  eq("normalizeUrl keeps real params",
    utils.normalizeUrl("https://shop.example.com/p?id=42&color=red"),
    "https://shop.example.com/p?color=red&id=42");
  eq("normalizeUrl trailing slash", utils.normalizeUrl("https://example.com/thing/"), "https://example.com/thing");
  eq("hostname strips www", utils.hostnameFromUrl("https://www.example.com/x"), "example.com");
  eq("parsePrice $1,299.99", utils.parsePriceText("$1,299.99"), { amount: 1299.99, currency: "USD" });
  eq("parsePrice euro", utils.parsePriceText("€75"), { amount: 75, currency: "EUR" });
  eq("parsePrice code suffix", utils.parsePriceText("49.99 USD"), { amount: 49.99, currency: "USD" });
  eq("parsePrice no number", utils.parsePriceText("varies"), { amount: null, currency: null });
  eq("parsePrice number input", utils.parsePriceText(12.5), { amount: 12.5, currency: null });
  eq("parseTags dedupe + strip #", utils.parseTags("kitchen, Gift Ideas, #kitchen,  books "), ["kitchen", "Gift Ideas", "books"]);
  eq("cleanTitle collapses whitespace", utils.cleanTitle("  A   nice   thing  "), "A nice thing");
  check("uid unique", utils.uid() !== utils.uid());
  check("formatPrice USD", utils.formatPrice({ price: 49.99, currency: "USD", priceText: null }).indexOf("49.99") !== -1);
  eq("formatPrice falls back to priceText", utils.formatPrice({ price: null, priceText: "varies" }), "varies");

  // --- store: seed + save + dedupe ---
  var seeded = await store.seedIfEmpty();
  eq("seed creates one default list", seeded.lists.length, 1);
  eq("default list name", seeded.lists[0].name, "Wishlist");

  var first = await store.saveItem({
    title: "Pour-over set", url: "https://example.com/pour-over?utm_source=news", site: "example.com",
    price: 42, currency: "USD", listId: seeded.lists[0].id, tags: ["kitchen"], source: "popup"
  });
  check("first save creates", first.created === true);
  var second = await store.saveItem({
    title: "Pour-over set (edited)", url: "https://example.com/pour-over?fbclid=abc", site: "example.com",
    price: 39, currency: "USD", listId: seeded.lists[0].id, tags: ["kitchen"], source: "popup"
  });
  check("same product via tracking link updates, not duplicates", second.created === false);
  check("update keeps one id", second.item.id === first.item.id);
  var afterDupe = await store.getState();
  eq("still one item after dedupe save", afterDupe.items.length, 1);
  eq("updated title wins", afterDupe.items[0].title, "Pour-over set (edited)");
  eq("updated price wins", afterDupe.items[0].price, 39);

  var found = await store.findByUrl("https://example.com/pour-over/?utm_medium=email");
  check("findByUrl matches canonical form", !!(found && found.id === first.item.id));

  // --- lists: create/rename/delete moves items ---
  var gifts = await store.createList("Gift Ideas");
  check("createList returns new list", gifts.name === "Gift Ideas" && gifts.id !== seeded.lists[0].id);
  var dupList = await store.createList("gift ideas");
  check("createList dedupes by name (case-insensitive)", dupList.id === gifts.id);
  await store.updateItem(first.item.id, { listId: gifts.id });
  var renamed = await store.renameList(gifts.id, "Gifts");
  eq("renameList", renamed.name, "Gifts");
  var afterDelete = await store.deleteList(gifts.id);
  eq("deleteList leaves one list", afterDelete.lists.length, 1);
  eq("deleted list's items move to remaining list", afterDelete.items[0].listId, afterDelete.lists[0].id);
  var deleteLastFailed = false;
  try { await store.deleteList(afterDelete.lists[0].id); } catch (e) { deleteLastFailed = true; }
  check("cannot delete the last list", deleteLastFailed);

  // --- status + delete ---
  await store.updateItem(first.item.id, { status: "bought" });
  var bought = await store.getState();
  eq("status update", bought.items[0].status, "bought");

  // --- export/import round trip ---
  var exported = await store.exportData();
  eq("export shape", exported.app, "gifty");
  eq("export item count", exported.items.length, 1);
  var reimport = await store.importData(JSON.parse(JSON.stringify(exported)));
  eq("re-import adds nothing", reimport.added, 0);
  eq("re-import updates existing", reimport.updated, 1);
  var bare = await store.importData([{ title: "Notebook", url: "https://example.com/notebook", price: 18.5, currency: "USD" }]);
  eq("bare-array import adds", bare.added, 1);
  var badImportFailed = false;
  try { await store.importData("not an object"); } catch (e) { badImportFailed = true; }
  check("import rejects non-object input", badImportFailed);

  var bytes = await store.getBytesInUse();
  check("bytes in use reported", bytes > 0, bytes);

  await store.deleteItem(first.item.id);
  var afterItemDelete = await store.getState();
  eq("deleteItem removes only that item", afterItemDelete.items.length, 1);

  console.log(failures === 0 ? "\nAll smoke tests passed." : "\n" + failures + " test(s) failed.");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(function (err) { console.error(err); process.exit(1); });
