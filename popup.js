/* Gifty popup: prefill from the page, let the user fix anything, save. */
(function () {
  "use strict";

  var els = {};
  var tab = null;
  var pageData = null;
  var images = [];
  var imageIndex = 0;
  var existingItem = null;
  var lists = [];
  var saving = false;

  function $(id) { return document.getElementById(id); }

  function isSaveableUrl(url) {
    return typeof url === "string" && /^https?:\/\//i.test(url);
  }

  function requestPageData(tabId) {
    return new Promise(function (resolve) {
      chrome.tabs.sendMessage(tabId, { type: "GIFTY_GET_PAGE_DATA" }, function (resp) {
        if (chrome.runtime.lastError || !resp || !resp.ok) resolve(null);
        else resolve(resp.data);
      });
    });
  }

  // The content script is registered for all URLs, but tabs opened before
  // install (or after an extension reload) may not have it yet. Injecting
  // the same files on demand covers that case.
  function requestPageDataWithInject(tabId) {
    return requestPageData(tabId).then(function (data) {
      if (data) return data;
      return new Promise(function (resolve) {
        try {
          chrome.scripting.executeScript(
            { target: { tabId: tabId }, files: ["utils.js", "content.js"] },
            function () {
              if (chrome.runtime.lastError) { resolve(null); return; }
              requestPageData(tabId).then(resolve);
            }
          );
        } catch (e) { resolve(null); }
      });
    });
  }

  function renderImage() {
    var img = els.previewImg;
    var src = images[imageIndex] || "";
    if (src) {
      img.src = src;
      img.classList.remove("hidden");
      els.noImage.classList.add("hidden");
    } else {
      img.removeAttribute("src");
      img.classList.add("hidden");
      els.noImage.classList.remove("hidden");
    }
    els.imageUrl.value = src;
    if (images.length > 1) {
      els.imageNav.classList.remove("hidden");
      els.imageCount.textContent = (imageIndex + 1) + " of " + images.length;
    } else {
      els.imageNav.classList.add("hidden");
    }
  }

  function setImages(list, preferred) {
    images = (list || []).filter(Boolean).slice(0, 8);
    imageIndex = 0;
    if (preferred) {
      var idx = images.indexOf(preferred);
      if (idx !== -1) imageIndex = idx;
      else if (preferred) { images.unshift(preferred); }
    }
    renderImage();
  }

  function fillListSelect(selectedId) {
    els.listSelect.innerHTML = "";
    lists.forEach(function (list) {
      var opt = document.createElement("option");
      opt.value = list.id;
      opt.textContent = list.name;
      els.listSelect.appendChild(opt);
    });
    var optNew = document.createElement("option");
    optNew.value = "__new__";
    optNew.textContent = "+ New list…";
    els.listSelect.appendChild(optNew);
    els.listSelect.value = selectedId || (lists[0] && lists[0].id) || "";
    toggleNewListInput();
  }

  function toggleNewListInput() {
    var isNew = els.listSelect.value === "__new__";
    els.newListName.classList.toggle("hidden", !isNew);
    if (isNew) els.newListName.focus();
  }

  function showError(msg) {
    els.errorText.textContent = msg;
    els.errorText.classList.remove("hidden");
  }

  function prefill(data, fallbackTab) {
    var url = (data && data.url) || (fallbackTab && fallbackTab.url) || "";
    var title = (data && data.title) || (fallbackTab && fallbackTab.title) || "";
    els.title.value = title;
    els.pageUrl.textContent = GiftyUtils.hostnameFromUrl(url) + " · " + url;
    if (data && data.description) {
      els.description.textContent = data.description;
      els.description.classList.remove("hidden");
    }
    if (data && data.price !== null && data.price !== undefined) {
      els.price.value = String(data.price);
    } else if (data && data.priceText) {
      els.price.value = data.priceText;
    }
    if (data && data.currency) els.currency.value = data.currency;
    if (data && data.selection) els.note.value = data.selection;
    setImages(data ? data.images : [], data ? data.image : null);

    // Duplicate check runs on the canonical URL the scraper found.
    GiftyStore.findByUrl(url).then(function (found) {
      existingItem = found;
      if (found) {
        var listName = (lists.find(function (l) { return l.id === found.listId; }) || {}).name || "a list";
        els.duplicateBanner.textContent = "Already saved in “" + listName + "”. Saving will update it instead of adding a duplicate.";
        els.duplicateBanner.classList.remove("hidden");
        els.saveBtn.textContent = "Update saved item";
        // Prefill the user's own fields from the saved copy.
        els.title.value = found.title;
        els.price.value = found.price !== null && found.price !== undefined ? String(found.price) : (found.priceText || "");
        if (found.currency) els.currency.value = found.currency;
        els.listSelect.value = found.listId;
        els.tags.value = found.tags.join(", ");
        els.priority.value = found.priority;
        els.note.value = found.note || els.note.value;
        setImages(found.images && found.images.length ? found.images : (data ? data.images : []), found.image);
        if (found.description) {
          els.description.textContent = found.description;
          els.description.classList.remove("hidden");
        }
      }
    }).catch(function () { /* duplicate check is best-effort */ });
  }

  function openDashboard() {
    chrome.runtime.sendMessage({ type: "GIFTY_OPEN_DASHBOARD" });
  }

  function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    els.errorText.classList.add("hidden");
    var title = els.title.value.trim();
    var url = (pageData && pageData.url) || (tab && tab.url) || "";
    if (!title) { showError("Add a title first."); els.title.focus(); return; }
    if (!url) { showError("No page URL was found. Try reloading the page."); return; }

    var listPromise;
    if (els.listSelect.value === "__new__") {
      var name = els.newListName.value.trim();
      if (!name) { showError("Name the new list, or pick an existing one."); els.newListName.focus(); return; }
      listPromise = GiftyStore.createList(name).then(function (list) { return list.id; });
    } else {
      listPromise = Promise.resolve(els.listSelect.value);
    }

    saving = true;
    els.saveBtn.disabled = true;
    els.saveBtn.textContent = "Saving…";

    listPromise.then(function (listId) {
      var rawPrice = els.price.value.trim();
      var parsed = GiftyUtils.parsePriceText(rawPrice);
      var imageUrl = els.imageUrl.value.trim();
      var item = {
        title: title,
        description: (pageData && pageData.description) || (existingItem && existingItem.description) || "",
        url: url,
        site: GiftyUtils.hostnameFromUrl(url),
        image: imageUrl || null,
        images: images.slice(),
        price: parsed.amount,
        currency: els.currency.value || parsed.currency || null,
        priceText: rawPrice || null,
        listId: listId,
        tags: GiftyUtils.parseTags(els.tags.value),
        note: els.note.value.trim(),
        priority: els.priority.value,
        status: existingItem ? existingItem.status : "want",
        source: "popup"
      };
      if (imageUrl && images.indexOf(imageUrl) === -1) item.images.unshift(imageUrl);
      if (existingItem) item.id = existingItem.id;
      return GiftyStore.saveItem(item);
    }).then(function (result) {
      var listName = (lists.find(function (l) { return l.id === result.item.listId; }) || {}).name;
      if (!listName) {
        return GiftyStore.getState().then(function (state) {
          var l = state.lists.find(function (x) { return x.id === result.item.listId; });
          return { result: result, listName: l ? l.name : "your list" };
        });
      }
      return { result: result, listName: listName };
    }).then(function (done) {
      els.saveForm.classList.add("hidden");
      els.savedText.textContent = (done.result.created ? "Saved to “" : "Updated in “") + done.listName + "”.";
      els.savedView.classList.remove("hidden");
    }).catch(function (err) {
      saving = false;
      els.saveBtn.disabled = false;
      els.saveBtn.textContent = existingItem ? "Update saved item" : "Save to Gifty";
      showError((err && err.message) || "Could not save. Please try again.");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    ["loading", "unsupported", "saveForm", "savedView", "duplicateBanner",
     "previewImg", "noImage", "imageNav", "imageCount", "prevImg", "nextImg",
     "imageUrl", "title", "pageUrl", "description", "price", "currency",
     "listSelect", "newListName", "tags", "priority", "note",
     "errorText", "saveBtn", "savedText", "viewAllBtn",
     "openDashboardUnsupported", "viewSavedBtn", "closeBtn"].forEach(function (id) {
      els[id] = $(id);
    });

    els.viewAllBtn.addEventListener("click", openDashboard);
    els.openDashboardUnsupported.addEventListener("click", openDashboard);
    els.viewSavedBtn.addEventListener("click", openDashboard);
    els.closeBtn.addEventListener("click", function () { window.close(); });
    els.listSelect.addEventListener("change", toggleNewListInput);
    els.prevImg.addEventListener("click", function () {
      if (!images.length) return;
      imageIndex = (imageIndex - 1 + images.length) % images.length;
      renderImage();
    });
    els.nextImg.addEventListener("click", function () {
      if (!images.length) return;
      imageIndex = (imageIndex + 1) % images.length;
      renderImage();
    });
    els.imageUrl.addEventListener("change", function () {
      var v = els.imageUrl.value.trim();
      if (v && images.indexOf(v) === -1) { images.unshift(v); imageIndex = 0; }
      else if (v) { imageIndex = images.indexOf(v); }
      renderImage();
    });
    els.saveForm.addEventListener("submit", onSubmit);
    els.saveForm.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); els.saveForm.requestSubmit(); }
    });

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      tab = (tabs && tabs[0]) || null;
      if (!tab || !isSaveableUrl(tab.url)) {
        els.loading.classList.add("hidden");
        els.unsupported.classList.remove("hidden");
        return;
      }
      GiftyStore.getState().then(function (state) {
        lists = state.lists;
        fillListSelect(state.settings.lastListId || state.settings.defaultListId);
        return requestPageDataWithInject(tab.id);
      }).then(function (data) {
        pageData = data;
        els.loading.classList.add("hidden");
        els.saveForm.classList.remove("hidden");
        prefill(data, tab);
        els.title.focus();
        els.title.select();
      }).catch(function () {
        els.loading.classList.add("hidden");
        els.saveForm.classList.remove("hidden");
        prefill(null, tab);
      });
    });
  });
})();
