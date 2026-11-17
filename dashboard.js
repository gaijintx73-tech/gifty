/* Gifty dashboard: browse, search, filter, edit, export/import.
   All data comes from GiftyStore. User content is inserted with
   textContent (never innerHTML) so a saved title cannot inject markup. */
(function () {
  "use strict";

  var state = { items: [], lists: [], settings: {} };
  var view = { listId: "all", query: "", sort: "newest", status: "all", tag: null };
  var toastTimer = null;
  var els = {};

  function $(id) { return document.getElementById(id); }
  function isDevMode() {
    try { return !(typeof chrome !== "undefined" && chrome.storage && chrome.storage.local); }
    catch (e) { return true; }
  }
  function safeHttpUrl(url) {
    if (typeof url !== "string") return null;
    var t = url.trim();
    return /^https?:\/\//i.test(t) ? t : null;
  }
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.add("hidden"); }, 3200);
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch (e) { return ""; }
  }

  function filteredItems() {
    var q = view.query.trim().toLowerCase();
    var items = state.items.filter(function (it) {
      if (view.listId !== "all" && it.listId !== view.listId) return false;
      if (view.status !== "all" && it.status !== view.status) return false;
      if (view.tag && it.tags.map(function (t) { return t.toLowerCase(); }).indexOf(view.tag.toLowerCase()) === -1) return false;
      if (q) {
        var hay = [it.title, it.site, it.note, it.description, it.tags.join(" ")].join(" ").toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    items.sort(function (a, b) {
      if (view.sort === "oldest") return a.createdAt.localeCompare(b.createdAt);
      if (view.sort === "titleAsc") return a.title.localeCompare(b.title);
      if (view.sort === "priceAsc") return (a.price === null ? Infinity : a.price) - (b.price === null ? Infinity : b.price);
      if (view.sort === "priceDesc") return (b.price === null ? -Infinity : b.price) - (a.price === null ? -Infinity : a.price);
      return b.createdAt.localeCompare(a.createdAt);
    });
    return items;
  }

  function renderSidebar() {
    var nav = els.listNav;
    nav.innerHTML = "";
    function addRow(id, name, count, isList) {
      var li = el("li");
      if (view.listId === id) li.className = "active";
      var btn = el("button", "nav-link", name);
      btn.type = "button";
      btn.addEventListener("click", function () { view.listId = id; renderAll(); });
      li.appendChild(btn);
      li.appendChild(el("span", "count", String(count)));
      if (isList) {
        var rename = el("button", "icon-btn", "✎");
        rename.type = "button";
        rename.title = "Rename list";
        rename.setAttribute("aria-label", "Rename " + name);
        rename.addEventListener("click", function (e) { e.stopPropagation(); renameList(id, name); });
        var del = el("button", "icon-btn", "×");
        del.type = "button";
        del.title = "Delete list (items move to another list)";
        del.setAttribute("aria-label", "Delete " + name);
        del.addEventListener("click", function (e) { e.stopPropagation(); deleteList(id, name); });
        li.appendChild(rename);
        li.appendChild(del);
      }
      nav.appendChild(li);
    }
    addRow("all", "All items", state.items.length, false);
    state.lists.forEach(function (list) {
      var count = state.items.filter(function (it) { return it.listId === list.id; }).length;
      addRow(list.id, list.name, count, true);
    });
    GiftyStore.getBytesInUse().then(function (bytes) {
      var kb = bytes ? (bytes / 1024).toFixed(1) : "0";
      els.storageInfo.textContent = state.items.length + " item" + (state.items.length === 1 ? "" : "s") + " · " + kb + " KB stored locally";
    }).catch(function () { els.storageInfo.textContent = ""; });
  }

  function renderChips() {
    var counts = {};
    state.items.forEach(function (it) {
      if (view.listId !== "all" && it.listId !== view.listId) return;
      it.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    var tags = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 20);
    els.tagChips.innerHTML = "";
    tags.forEach(function (tag) {
      var chip = el("button", "chip" + (view.tag === tag ? " active" : ""), tag + " (" + counts[tag] + ")");
      chip.type = "button";
      chip.addEventListener("click", function () {
        view.tag = view.tag === tag ? null : tag;
        renderAll();
      });
      els.tagChips.appendChild(chip);
    });
  }

  function renderGrid() {
    var items = filteredItems();
    var listName = "All items";
    if (view.listId !== "all") {
      var found = state.lists.find(function (l) { return l.id === view.listId; });
      if (found) listName = found.name;
    }
    els.viewTitle.textContent = listName;
    els.viewCount.textContent = items.length + " of " + state.items.length + " item" + (state.items.length === 1 ? "" : "s");

    els.grid.innerHTML = "";
    if (!state.items.length) {
      els.emptyState.textContent = "Nothing saved yet. Click the Gifty button in your toolbar on any product page, or use “Add manually” above.";
      els.emptyState.classList.remove("hidden");
      return;
    }
    if (!items.length) {
      els.emptyState.textContent = "No items match this view. Try clearing the search or picking a different list.";
      els.emptyState.classList.remove("hidden");
      return;
    }
    els.emptyState.classList.add("hidden");

    items.forEach(function (item) {
      var card = el("article", "card" + (item.status === "bought" ? " bought" : ""));
      var safeUrl = safeHttpUrl(item.url);
      var safeImg = safeHttpUrl(item.image);

      var imgLink = el("a", "card-image");
      if (safeUrl) { imgLink.href = safeUrl; imgLink.target = "_blank"; imgLink.rel = "noopener noreferrer"; }
      if (safeImg) {
        var img = document.createElement("img");
        img.src = safeImg;
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.addEventListener("error", function () { img.remove(); imgLink.appendChild(el("div", "placeholder", "🎁")); });
        imgLink.appendChild(img);
      } else {
        imgLink.appendChild(el("div", "placeholder", "🎁"));
      }
      card.appendChild(imgLink);

      var body = el("div", "card-body");
      var titleLink = el("a", "card-title", item.title);
      if (safeUrl) { titleLink.href = safeUrl; titleLink.target = "_blank"; titleLink.rel = "noopener noreferrer"; }
      body.appendChild(titleLink);
      body.appendChild(el("p", "card-meta", (item.site || "") + (item.site ? " · " : "") + formatDate(item.createdAt)));

      var priceText = GiftyUtils.formatPrice(item);
      if (priceText || item.priority) {
        var row = el("div", "card-price-row");
        if (priceText) row.appendChild(el("span", "card-price", priceText));
        row.appendChild(el("span", "badge " + item.priority, item.priority));
        if (item.status === "bought") row.appendChild(el("span", "badge bought", "Bought"));
        body.appendChild(row);
      }
      if (item.note) body.appendChild(el("p", "card-note", item.note));
      if (item.tags.length) {
        var tagWrap = el("div", "card-tags");
        item.tags.forEach(function (t) { tagWrap.appendChild(el("span", "tag", t)); });
        body.appendChild(tagWrap);
      }

      var actions = el("div", "card-actions");
      var toggle = el("button", "btn small", item.status === "bought" ? "Back to wanted" : "Mark bought");
      toggle.type = "button";
      toggle.addEventListener("click", function () {
        GiftyStore.updateItem(item.id, { status: item.status === "bought" ? "want" : "bought" })
          .then(reload).catch(function () { toast("Could not update that item."); });
      });
      var edit = el("button", "btn small", "Edit");
      edit.type = "button";
      edit.addEventListener("click", function () { openModal(item); });
      var del = el("button", "btn small danger", "Delete");
      del.type = "button";
      del.addEventListener("click", function () {
        if (!window.confirm("Remove “" + item.title + "” from Gifty?")) return;
        GiftyStore.deleteItem(item.id).then(function () { reload(); toast("Removed."); }).catch(function () { toast("Could not remove that item."); });
      });
      actions.appendChild(toggle);
      actions.appendChild(edit);
      actions.appendChild(del);
      body.appendChild(actions);
      card.appendChild(body);
      els.grid.appendChild(card);
    });
  }

  function renderAll() {
    renderSidebar();
    renderChips();
    renderGrid();
  }

  function reload() {
    return GiftyStore.getState().then(function (s) {
      state = s;
      if (view.listId !== "all" && !state.lists.some(function (l) { return l.id === view.listId; })) view.listId = "all";
      renderAll();
    });
  }

  function renameList(id, currentName) {
    var name = window.prompt("Rename list:", currentName);
    if (name === null) return;
    name = name.trim();
    if (!name || name === currentName) return;
    GiftyStore.renameList(id, name).then(reload).catch(function (e) { toast(e.message || "Could not rename that list."); });
  }

  function deleteList(id, name) {
    var count = state.items.filter(function (it) { return it.listId === id; }).length;
    var msg = count
      ? "Delete the list “" + name + "”? Its " + count + " item(s) will move to another list, not be deleted."
      : "Delete the empty list “" + name + "”?";
    if (!window.confirm(msg)) return;
    GiftyStore.deleteList(id).then(function () { view.listId = "all"; reload(); toast("List deleted; items moved."); })
      .catch(function (e) { toast(e.message || "Could not delete that list."); });
  }

  function fillEditLists(selectedId) {
    els.editList.innerHTML = "";
    state.lists.forEach(function (list) {
      var opt = document.createElement("option");
      opt.value = list.id;
      opt.textContent = list.name;
      els.editList.appendChild(opt);
    });
    if (selectedId) els.editList.value = selectedId;
  }

  function openModal(item) {
    var isNew = !item;
    els.modalTitle.textContent = isNew ? "Add an item" : "Edit item";
    els.editError.classList.add("hidden");
    els.deleteFromModal.classList.toggle("hidden", isNew);
    fillEditLists(isNew ? (view.listId !== "all" ? view.listId : state.settings.lastListId) : item.listId);
    els.editId.value = isNew ? "" : item.id;
    els.editTitle.value = isNew ? "" : item.title;
    els.editUrl.value = isNew ? "" : item.url;
    els.editImage.value = isNew ? "" : (item.image || "");
    els.editPrice.value = isNew ? "" : (item.price !== null && item.price !== undefined ? String(item.price) : (item.priceText || ""));
    els.editCurrency.value = isNew ? "" : (item.currency || "");
    els.editDescription.value = isNew ? "" : (item.description || "");
    els.editPriority.value = isNew ? "medium" : item.priority;
    els.editStatus.value = isNew ? "want" : item.status;
    els.editTags.value = isNew ? "" : item.tags.join(", ");
    els.editNote.value = isNew ? "" : (item.note || "");
    els.modalOverlay.classList.remove("hidden");
    els.editTitle.focus();
  }

  function closeModal() {
    els.modalOverlay.classList.add("hidden");
  }

  function onEditSubmit(event) {
    event.preventDefault();
    els.editError.classList.add("hidden");
    var id = els.editId.value || null;
    var title = els.editTitle.value.trim();
    var url = els.editUrl.value.trim();
    if (!title) { els.editError.textContent = "Add a title first."; els.editError.classList.remove("hidden"); return; }
    if (!safeHttpUrl(url)) { els.editError.textContent = "Enter a full http(s) link, starting with https://"; els.editError.classList.remove("hidden"); return; }

    var norm = GiftyUtils.normalizeUrl(url);
    var clash = state.items.find(function (it) { return it.id !== id && it.normalizedUrl === norm; });
    if (clash && !window.confirm("Another saved item already has this link (“" + clash.title + "”). Save anyway?")) return;

    var rawPrice = els.editPrice.value.trim();
    var parsed = GiftyUtils.parsePriceText(rawPrice);
    var imageUrl = els.editImage.value.trim();
    var data = {
      title: title,
      url: url,
      site: GiftyUtils.hostnameFromUrl(url),
      image: imageUrl || null,
      images: imageUrl ? [imageUrl] : [],
      price: parsed.amount,
      currency: els.editCurrency.value || parsed.currency || null,
      priceText: rawPrice || null,
      description: els.editDescription.value.trim(),
      listId: els.editList.value,
      tags: GiftyUtils.parseTags(els.editTags.value),
      note: els.editNote.value.trim(),
      priority: els.editPriority.value,
      status: els.editStatus.value,
      source: id ? undefined : "manual"
    };
    if (id) {
      var prev = state.items.find(function (it) { return it.id === id; });
      data.id = id;
      data.source = prev ? prev.source : "manual";
      if (prev && prev.images && prev.images.length && imageUrl && prev.images.indexOf(imageUrl) === -1) {
        data.images = [imageUrl].concat(prev.images).slice(0, 8);
      } else if (prev) {
        data.images = prev.images || data.images;
      }
    }
    GiftyStore.saveItem(data).then(function () {
      closeModal();
      reload();
      toast(id ? "Updated." : "Added.");
    }).catch(function (e) { els.editError.textContent = e.message || "Could not save."; els.editError.classList.remove("hidden"); });
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function csvCell(v) {
    var s = String(v === null || v === undefined ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportJson() {
    GiftyStore.exportData().then(function (data) {
      download("gifty-export-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify(data, null, 2), "application/json");
      toast("Exported " + data.items.length + " item(s).");
    }).catch(function () { toast("Export failed."); });
  }

  function exportCsv() {
    GiftyStore.getState().then(function (s) {
      var names = {};
      s.lists.forEach(function (l) { names[l.id] = l.name; });
      var rows = [["Title", "URL", "Site", "Price", "Currency", "List", "Tags", "Priority", "Status", "Note", "Date saved"]];
      s.items.forEach(function (it) {
        rows.push([it.title, it.url, it.site, it.price === null ? "" : it.price, it.currency || "", names[it.listId] || "", it.tags.join("; "), it.priority, it.status, it.note, it.createdAt.slice(0, 10)]);
      });
      download("gifty-export-" + new Date().toISOString().slice(0, 10) + ".csv", rows.map(function (r) { return r.map(csvCell).join(","); }).join("\n"), "text/csv");
      toast("Exported " + s.items.length + " item(s).");
    }).catch(function () { toast("Export failed."); });
  }

  function onImportFile(event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(String(reader.result)); }
      catch (e) { toast("That file is not valid JSON."); return; }
      GiftyStore.importData(parsed).then(function (counts) {
        reload();
        toast("Imported: " + counts.added + " added, " + counts.updated + " updated, " + counts.skipped + " skipped.");
      }).catch(function (e) { toast(e.message || "Import failed."); });
    };
    reader.onerror = function () { toast("Could not read that file."); };
    reader.readAsText(file);
  }

  // Preview samples, only when the dashboard is opened directly in a
  // browser (no chrome.storage). They live in localStorage, are clearly
  // labelled, and delete like any other item. Extension installs never
  // see them.
  function seedPreviewSamplesIfNeeded() {
    if (!isDevMode()) return Promise.resolve();
    els.devBanner.classList.remove("hidden");
    return GiftyStore.getState().then(function (s) {
      if (s.items.length) return;
      var samples = [
        { title: "Sample: Ceramic pour-over set", url: "https://example.com/pour-over-set", site: "example.com", image: null, images: [], price: 42, currency: "USD", priceText: "42", description: "Preview sample. Delete me.", listId: s.lists[0].id, tags: ["kitchen"], note: "This is a preview item so you can see the layout.", priority: "medium", status: "want", source: "preview" },
        { title: "Sample: Field notebook, dot grid (3-pack)", url: "https://example.com/field-notebook", site: "example.com", image: null, images: [], price: 18.5, currency: "USD", priceText: "18.5", description: "Preview sample. Delete me.", listId: s.lists[0].id, tags: ["desk", "gift for Kim"], note: "", priority: "high", status: "want", source: "preview" },
        { title: "Sample: Trail running shoes", url: "https://example.com/trail-shoes", site: "example.com", image: null, images: [], price: 129.95, currency: "USD", priceText: "129.95", description: "Preview sample. Delete me.", listId: s.lists[0].id, tags: ["outdoors"], note: "Already bought, shown for the Bought filter.", priority: "low", status: "bought", source: "preview" }
      ];
      var chain = Promise.resolve();
      samples.forEach(function (item) { chain = chain.then(function () { return GiftyStore.saveItem(item); }); });
      return chain;
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    ["searchInput", "statusFilter", "sortSelect", "addBtn", "exportJsonBtn",
     "exportCsvBtn", "importBtn", "importFile", "devBanner", "listNav",
     "newListForm", "newListInput", "storageInfo", "viewTitle", "viewCount",
     "tagChips", "emptyState", "grid", "modalOverlay", "modalTitle",
     "editForm", "editId", "editTitle", "editUrl", "editImage", "editPrice",
     "editCurrency", "editDescription", "editList", "editPriority",
     "editStatus", "editTags", "editNote", "editError", "deleteFromModal",
     "cancelEdit", "toast"].forEach(function (id) { els[id] = $(id); });

    els.searchInput.addEventListener("input", function () { view.query = els.searchInput.value; renderGrid(); renderChips(); });
    els.statusFilter.addEventListener("change", function () { view.status = els.statusFilter.value; renderGrid(); });
    els.sortSelect.addEventListener("change", function () { view.sort = els.sortSelect.value; renderGrid(); });
    els.addBtn.addEventListener("click", function () { openModal(null); });
    els.exportJsonBtn.addEventListener("click", exportJson);
    els.exportCsvBtn.addEventListener("click", exportCsv);
    els.importBtn.addEventListener("click", function () { els.importFile.click(); });
    els.importFile.addEventListener("change", onImportFile);
    els.newListForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = els.newListInput.value.trim();
      if (!name) return;
      GiftyStore.createList(name).then(function (list) {
        els.newListInput.value = "";
        view.listId = list.id;
        reload();
        toast("List “" + list.name + "” created.");
      }).catch(function (err) { toast(err.message || "Could not create that list."); });
    });
    els.editForm.addEventListener("submit", onEditSubmit);
    els.cancelEdit.addEventListener("click", closeModal);
    els.modalOverlay.addEventListener("click", function (e) { if (e.target === els.modalOverlay) closeModal(); });
    els.deleteFromModal.addEventListener("click", function () {
      var id = els.editId.value;
      if (!id) return;
      if (!window.confirm("Remove this item from Gifty?")) return;
      GiftyStore.deleteItem(id).then(function () { closeModal(); reload(); toast("Removed."); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !els.modalOverlay.classList.contains("hidden")) closeModal();
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        e.preventDefault();
        els.searchInput.focus();
      }
    });

    // Refresh when the popup or a quick-save changes storage elsewhere.
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(function (changes) {
          if (changes.gifty_items_v1 || changes.gifty_lists_v1) reload();
        });
      }
    } catch (e) { /* dev mode */ }

    seedPreviewSamplesIfNeeded().then(reload).catch(reload);
  });
})();
