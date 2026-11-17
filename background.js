/* Gifty service worker: context menus, keyboard shortcut, badge count,
   and opening the dashboard. Quick-saves go through GiftyStore, same as
   the popup, so duplicates still upsert instead of doubling up. */
"use strict";

try { importScripts("utils.js", "store.js"); } catch (e) { /* utils/store failed to load; handlers below guard */ }

var DASHBOARD_URL = chrome.runtime.getURL("dashboard.html");

function isSaveableUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function updateBadge() {
  if (typeof GiftyStore === "undefined") return;
  GiftyStore.getState().then(function (state) {
    var count = state.items.filter(function (it) { return it.status === "want"; }).length;
    chrome.action.setBadgeText({ text: count > 0 ? String(Math.min(count, 99)) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#1d4ed8" });
  }).catch(function () { /* storage unavailable */ });
}

function flashBadge() {
  chrome.action.setBadgeText({ text: "✓" });
  setTimeout(updateBadge, 1600);
}

function openDashboard() {
  chrome.tabs.query({ url: DASHBOARD_URL }, function (tabs) {
    if (tabs && tabs.length) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: DASHBOARD_URL });
    }
  });
}

function requestPageData(tabId) {
  return new Promise(function (resolve) {
    try {
      chrome.tabs.sendMessage(tabId, { type: "GIFTY_GET_PAGE_DATA" }, function (resp) {
        if (chrome.runtime.lastError || !resp || !resp.ok) resolve(null);
        else resolve(resp.data);
      });
    } catch (e) { resolve(null); }
  });
}

function quickSaveTab(tab, source) {
  if (!tab || !isSaveableUrl(tab.url)) return Promise.resolve(null);
  return requestPageData(tab.id).then(function (data) {
    return GiftyStore.getState().then(function (state) {
      var base = data || {};
      var item = {
        title: base.title || tab.title || tab.url,
        description: base.description || "",
        url: base.url || tab.url,
        site: base.site || GiftyUtils.hostnameFromUrl(tab.url),
        image: base.image || null,
        images: base.images || [],
        price: base.price !== undefined ? base.price : null,
        currency: base.currency || null,
        priceText: base.priceText || null,
        listId: state.settings.lastListId || state.settings.defaultListId,
        tags: [],
        note: "",
        priority: "medium",
        status: "want",
        source: source || "quick-save"
      };
      return GiftyStore.saveItem(item);
    });
  }).then(function (result) {
    if (result) { updateBadge(); flashBadge(); }
    return result;
  }).catch(function () { return null; });
}

function quickSaveLink(info) {
  if (!isSaveableUrl(info.linkUrl)) return Promise.resolve(null);
  return GiftyStore.getState().then(function (state) {
    var linkText = String(info.linkText || "").replace(/\s+/g, " ").trim().slice(0, 300);
    return GiftyStore.saveItem({
      title: linkText || info.linkUrl,
      description: "",
      url: info.linkUrl,
      site: GiftyUtils.hostnameFromUrl(info.linkUrl),
      image: null,
      images: [],
      price: null,
      currency: null,
      priceText: null,
      listId: state.settings.lastListId || state.settings.defaultListId,
      tags: [],
      note: "",
      priority: "medium",
      status: "want",
      source: "context-menu-link"
    });
  }).then(function (result) {
    if (result) { updateBadge(); flashBadge(); }
    return result;
  }).catch(function () { return null; });
}

chrome.runtime.onInstalled.addListener(function () {
  if (typeof GiftyStore !== "undefined") GiftyStore.seedIfEmpty().then(updateBadge).catch(function () {});
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({ id: "gifty-save-page", title: "Save page to Gifty", contexts: ["page"] });
    chrome.contextMenus.create({ id: "gifty-save-link", title: "Save link to Gifty", contexts: ["link"] });
  });
});

chrome.runtime.onStartup.addListener(updateBadge);

if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener(function (changes) {
    if (changes.gifty_items_v1) updateBadge();
  });
}

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId === "gifty-save-page") quickSaveTab(tab, "context-menu");
  if (info.menuItemId === "gifty-save-link") quickSaveLink(info);
});

chrome.commands.onCommand.addListener(function (command) {
  if (command !== "save-page") return;
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs && tabs[0]) quickSaveTab(tabs[0], "keyboard");
  });
});

chrome.runtime.onMessage.addListener(function (message) {
  if (message && message.type === "GIFTY_OPEN_DASHBOARD") openDashboard();
});
