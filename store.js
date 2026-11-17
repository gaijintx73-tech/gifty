/* Gifty storage. Every read and write in the extension goes through here.
   That is deliberate: a future hosted/synced version can swap the backend
   inside this file (same item shape, stable UUIDs, createdAt/updatedAt)
   without touching the popup or dashboard.

   Backend: chrome.storage.local. When chrome.storage is unavailable
   (opening dashboard.html directly in a browser for a preview), it falls
   back to localStorage so the dashboard is still viewable. */
(function () {
  "use strict";

  var SCHEMA_VERSION = 1;
  var ITEMS_KEY = "gifty_items_v1";
  var LISTS_KEY = "gifty_lists_v1";
  var SETTINGS_KEY = "gifty_settings_v1";
  var DEFAULT_LIST_ID = "default";
  var DEV_KEY = "gifty_dev_store_v1";

  function hasChromeStorage() {
    try {
      return typeof chrome !== "undefined" && !!(chrome.storage && chrome.storage.local);
    } catch (e) { return false; }
  }

  function devRead() {
    try {
      return JSON.parse(localStorage.getItem(DEV_KEY) || "{}");
    } catch (e) { return {}; }
  }
  function devWrite(obj) {
    try { localStorage.setItem(DEV_KEY, JSON.stringify(obj)); } catch (e) { /* private mode */ }
  }

  function rawGet(keys) {
    if (hasChromeStorage()) return chrome.storage.local.get(keys);
    return Promise.resolve(devRead());
  }
  function rawSet(obj) {
    if (hasChromeStorage()) return chrome.storage.local.set(obj);
    var cur = devRead();
    Object.keys(obj).forEach(function (k) { cur[k] = obj[k]; });
    devWrite(cur);
    return Promise.resolve();
  }
  function rawBytesInUse() {
    if (hasChromeStorage() && chrome.storage.local.getBytesInUse) {
      return chrome.storage.local.getBytesInUse(null);
    }
    try { return Promise.resolve((localStorage.getItem(DEV_KEY) || "").length); }
    catch (e) { return Promise.resolve(0); }
  }

  function defaultLists() {
    return [{ id: DEFAULT_LIST_ID, name: "Wishlist", createdAt: new Date().toISOString() }];
  }

  function sanitizeLists(lists) {
    if (!Array.isArray(lists) || !lists.length) return defaultLists();
    var seen = {};
    var out = [];
    lists.forEach(function (l) {
      if (!l || !l.name) return;
      var id = String(l.id || GiftyUtils.uid());
      if (seen[id]) return;
      seen[id] = true;
      out.push({ id: id, name: String(l.name).slice(0, 60), createdAt: l.createdAt || new Date().toISOString() });
    });
    return out.length ? out : defaultLists();
  }

  function sanitizeItem(raw) {
    var now = new Date().toISOString();
    var price = raw.price;
    if (price !== null && price !== undefined) {
      price = Number(price);
      if (!isFinite(price)) price = null;
    } else {
      price = null;
    }
    var url = String(raw.url || "").trim();
    return {
      id: String(raw.id || GiftyUtils.uid()),
      title: GiftyUtils.cleanTitle(raw.title || url || "Untitled", 300),
      url: url,
      normalizedUrl: GiftyUtils.normalizeUrl(url),
      site: String(raw.site || GiftyUtils.hostnameFromUrl(url)).slice(0, 120),
      image: raw.image ? String(raw.image).slice(0, 2000) : null,
      images: Array.isArray(raw.images) ? raw.images.slice(0, 8).map(String) : [],
      price: price,
      priceText: raw.priceText ? String(raw.priceText).slice(0, 60) : null,
      currency: raw.currency ? String(raw.currency).toUpperCase().slice(0, 3) : null,
      description: String(raw.description || "").slice(0, 1000),
      listId: String(raw.listId || DEFAULT_LIST_ID),
      tags: GiftyUtils.parseTags(raw.tags || []),
      note: String(raw.note || "").slice(0, 2000),
      priority: ["low", "medium", "high"].indexOf(raw.priority) !== -1 ? raw.priority : "medium",
      status: raw.status === "bought" ? "bought" : "want",
      source: raw.source || "popup",
      createdAt: raw.createdAt || now,
      updatedAt: now
    };
  }

  function getState() {
    return rawGet([ITEMS_KEY, LISTS_KEY, SETTINGS_KEY]).then(function (data) {
      var lists = sanitizeLists(data[LISTS_KEY]);
      var listIds = {};
      lists.forEach(function (l) { listIds[l.id] = true; });
      var items = Array.isArray(data[ITEMS_KEY]) ? data[ITEMS_KEY] : [];
      items = items.filter(function (it) { return it && it.url; }).map(function (it) {
        var clean = sanitizeItem(it);
        // Keep the original createdAt; sanitizeItem only stamps updatedAt.
        clean.createdAt = it.createdAt || clean.createdAt;
        clean.updatedAt = it.updatedAt || clean.updatedAt;
        if (!listIds[clean.listId]) clean.listId = lists[0].id;
        return clean;
      });
      var settings = data[SETTINGS_KEY] || {};
      return {
        schemaVersion: SCHEMA_VERSION,
        items: items,
        lists: lists,
        settings: {
          defaultListId: listIds[settings.defaultListId] ? settings.defaultListId : lists[0].id,
          lastListId: listIds[settings.lastListId] ? settings.lastListId : lists[0].id
        }
      };
    });
  }

  function saveState(state) {
    var obj = {};
    obj[ITEMS_KEY] = state.items;
    obj[LISTS_KEY] = state.lists;
    obj[SETTINGS_KEY] = state.settings;
    return rawSet(obj);
  }

  function seedIfEmpty() {
    return getState().then(function (state) { return saveState(state).then(function () { return state; }); });
  }

  // Upsert: same normalized URL updates the existing item instead of
  // creating a duplicate. Returns { item, created, state }.
  function saveItem(data) {
    return getState().then(function (state) {
      var incoming = sanitizeItem(data);
      var existingIndex = -1;
      if (data.id) {
        existingIndex = state.items.findIndex(function (it) { return it.id === data.id; });
      }
      if (existingIndex === -1 && incoming.normalizedUrl) {
        existingIndex = state.items.findIndex(function (it) {
          return it.normalizedUrl && it.normalizedUrl === incoming.normalizedUrl;
        });
      }
      var created = existingIndex === -1;
      if (!created) {
        incoming.id = state.items[existingIndex].id;
        incoming.createdAt = state.items[existingIndex].createdAt;
        state.items[existingIndex] = incoming;
      } else {
        state.items.unshift(incoming);
      }
      state.settings.lastListId = incoming.listId;
      return saveState(state).then(function () {
        return { item: incoming, created: created, state: state };
      });
    });
  }

  function findByUrl(url) {
    var norm = GiftyUtils.normalizeUrl(url);
    if (!norm) return Promise.resolve(null);
    return getState().then(function (state) {
      return state.items.find(function (it) { return it.normalizedUrl === norm; }) || null;
    });
  }

  function updateItem(id, patch) {
    return getState().then(function (state) {
      var idx = state.items.findIndex(function (it) { return it.id === id; });
      if (idx === -1) return null;
      var merged = sanitizeItem(Object.assign({}, state.items[idx], patch, { id: id }));
      merged.createdAt = state.items[idx].createdAt;
      state.items[idx] = merged;
      return saveState(state).then(function () { return merged; });
    });
  }

  function deleteItem(id) {
    return getState().then(function (state) {
      state.items = state.items.filter(function (it) { return it.id !== id; });
      return saveState(state).then(function () { return state; });
    });
  }

  function createList(name) {
    var clean = String(name || "").trim().slice(0, 60);
    if (!clean) return Promise.reject(new Error("List name is required."));
    return getState().then(function (state) {
      var dup = state.lists.find(function (l) { return l.name.toLowerCase() === clean.toLowerCase(); });
      if (dup) return dup;
      var list = { id: GiftyUtils.uid(), name: clean, createdAt: new Date().toISOString() };
      state.lists.push(list);
      return saveState(state).then(function () { return list; });
    });
  }

  function renameList(id, name) {
    var clean = String(name || "").trim().slice(0, 60);
    if (!clean) return Promise.reject(new Error("List name is required."));
    return getState().then(function (state) {
      var list = state.lists.find(function (l) { return l.id === id; });
      if (!list) return null;
      list.name = clean;
      return saveState(state).then(function () { return list; });
    });
  }

  // Deleting a list never deletes its items: they move to the first
  // remaining list. The last list cannot be deleted.
  function deleteList(id) {
    return getState().then(function (state) {
      if (state.lists.length <= 1) return Promise.reject(new Error("You need at least one list."));
      var remaining = state.lists.filter(function (l) { return l.id !== id; });
      if (remaining.length === state.lists.length) return state;
      state.items.forEach(function (it) {
        if (it.listId === id) it.listId = remaining[0].id;
      });
      state.lists = remaining;
      if (state.settings.defaultListId === id) state.settings.defaultListId = remaining[0].id;
      if (state.settings.lastListId === id) state.settings.lastListId = remaining[0].id;
      return saveState(state).then(function () { return state; });
    });
  }

  function exportData() {
    return getState().then(function (state) {
      return {
        app: "gifty",
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        lists: state.lists,
        items: state.items
      };
    });
  }

  // Accepts the export format above, or a bare array of items.
  // Merges by id first, then by normalized URL. Returns counts.
  function importData(data) {
    var incomingLists = [];
    var incomingItems = [];
    if (Array.isArray(data)) incomingItems = data;
    else if (data && typeof data === "object") {
      incomingLists = Array.isArray(data.lists) ? data.lists : [];
      incomingItems = Array.isArray(data.items) ? data.items : [];
    } else {
      return Promise.reject(new Error("That file does not look like a Gifty export."));
    }
    return getState().then(function (state) {
      var listsAdded = 0;
      incomingLists.forEach(function (l) {
        if (!l || !l.name) return;
        var exists = state.lists.some(function (x) {
          return x.id === l.id || x.name.toLowerCase() === String(l.name).toLowerCase();
        });
        if (!exists) {
          state.lists.push({ id: String(l.id || GiftyUtils.uid()), name: String(l.name).slice(0, 60), createdAt: l.createdAt || new Date().toISOString() });
          listsAdded++;
        }
      });
      var listIds = {};
      state.lists.forEach(function (l) { listIds[l.id] = true; });
      var added = 0, updated = 0, skipped = 0;
      incomingItems.forEach(function (raw) {
        if (!raw || !raw.url) { skipped++; return; }
        var clean = sanitizeItem(raw);
        if (!listIds[clean.listId]) clean.listId = state.lists[0].id;
        var idx = state.items.findIndex(function (it) {
          return it.id === clean.id || (it.normalizedUrl && it.normalizedUrl === clean.normalizedUrl);
        });
        if (idx !== -1) {
          clean.id = state.items[idx].id;
          clean.createdAt = state.items[idx].createdAt;
          state.items[idx] = clean;
          updated++;
        } else {
          state.items.push(clean);
          added++;
        }
      });
      state.items.sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
      return saveState(state).then(function () {
        return { added: added, updated: updated, skipped: skipped, listsAdded: listsAdded };
      });
    });
  }

  var api = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULT_LIST_ID: DEFAULT_LIST_ID,
    getState: getState,
    seedIfEmpty: seedIfEmpty,
    saveItem: saveItem,
    findByUrl: findByUrl,
    updateItem: updateItem,
    deleteItem: deleteItem,
    createList: createList,
    renameList: renameList,
    deleteList: deleteList,
    exportData: exportData,
    importData: importData,
    getBytesInUse: rawBytesInUse
  };

  globalThis.GiftyStore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
