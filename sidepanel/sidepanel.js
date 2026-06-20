/*
 * Grimoire - Lorebook injection for JanitorAI
 * Copyright (C) 2026 Ash <ash@ashisgreat.xyz>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */


/**
 * sidepanel.js - Side panel UI logic (multi-lorebook v2)
 *
 * Manages:
 * - Multiple lorebooks (CRUD, enable/disable per lorebook)
 * - Entries within a lorebook (CRUD, per-entry toggle)
 * - Import/export (per lorebook, ST-compatible)
 * - View switching between lorebook list and detail view
 * - Master toggle (global on/off)
 * - Migration from v1 flat storage
 *
 * Storage keys:
 * - jlb_lorebooks: array of {id, name, description, enabled, createdAt, updatedAt}
 * - jlb_entries_<id>: array of ST-compatible entries for that lorebook
 * - jlb_enabled: master toggle boolean
 */

(function () {
  "use strict";

  // Storage keys
  const STORAGE_LOREBOOKS = "jlb_lorebooks";
  const STORAGE_ENABLED = "jlb_enabled";
  const STORAGE_SCAN_DEPTH = "jlb_scan_depth";

  // === State ===
  let lorebooks = [];
  let currentLorebookId = null; // null = lorebook list view
  let entriesByLorebook = {}; // cache: lorebookId -> entries array
  let editingUid = null; // null = creating new entry, number = editing
  let editingLorebookId = null; // for lorebook modal (null = creating new lorebook)

  // === DOM refs ===
  const masterToggle = document.getElementById("masterToggle");
  const scanDepthInput = document.getElementById("scanDepthInput");

  // Views
  const viewLorebooks = document.getElementById("view-lorebooks");
  const viewDetail = document.getElementById("view-detail");

  // Lorebook list elements
  const lorebookList = document.getElementById("lorebookList");
  const lorebookEmptyState = document.getElementById("lorebookEmptyState");
  const btnAddLorebook = document.getElementById("btnAddLorebook");
  const btnImportLorebook = document.getElementById("btnImportLorebook");
  const fileImportLorebook = document.createElement("input");
  fileImportLorebook.type = "file";
  fileImportLorebook.accept = ".json";
  fileImportLorebook.style.display = "none";

  // Detail view elements
  const detailName = document.getElementById("detailName");
  const detailCount = document.getElementById("detailCount");
  const btnBack = document.getElementById("btnBack");
  const btnEditLorebook = document.getElementById("btnEditLorebook");
  const entryList = document.getElementById("entryList");
  const entryEmptyState = document.getElementById("entryEmptyState");
  const btnAddEntry = document.getElementById("btnAddEntry");
  const btnExportEntries = document.getElementById("btnExportEntries");

  // Entry edit modal
  const editModal = document.getElementById("editModal");
  const modalTitle = document.getElementById("modalTitle");
  const btnCloseModal = document.getElementById("btnCloseModal");
  const btnSave = document.getElementById("btnSave");
  const btnDelete = document.getElementById("btnDelete");
  const editComment = document.getElementById("editComment");
  const editKeys = document.getElementById("editKeys");
  const editContent = document.getElementById("editContent");
  const editConstant = document.getElementById("editConstant");
  const editSelective = document.getElementById("editSelective");
  const editOrder = document.getElementById("editOrder");

  // Lorebook edit modal
  const lorebookModal = document.getElementById("lorebookModal");
  const lorebookModalTitle = document.getElementById("lorebookModalTitle");
  const btnCloseLorebookModal = document.getElementById("btnCloseLorebookModal");
  const btnSaveLorebook = document.getElementById("btnSaveLorebook");
  const btnDeleteLorebook = document.getElementById("btnDeleteLorebook");
  const editLbName = document.getElementById("editLbName");
  const editLbDescription = document.getElementById("editLbDescription");

  // === Storage helpers ===

  function saveLorebooks() {
    chrome.storage.local.set({ [STORAGE_LOREBOOKS]: lorebooks });
  }

  function saveEntries(lorebookId, entries) {
    const key = "jlb_entries_" + lorebookId;
    chrome.storage.local.set({ [key]: entries });
  }

  function saveMasterToggle(enabled) {
    chrome.storage.local.set({ [STORAGE_ENABLED]: enabled });
  }

  function loadEntries(lorebookId) {
    return new Promise((resolve) => {
      const key = "jlb_entries_" + lorebookId;
      chrome.storage.local.get([key], (result) => {
        const entries = Array.isArray(result[key]) ? result[key] : [];
        entriesByLorebook[lorebookId] = entries;
        resolve(entries);
      });
    });
  }

  // === View switching ===

  function showLorebookList() {
    currentLorebookId = null;
    viewLorebooks.style.display = "flex";
    viewDetail.style.display = "none";
    renderLorebooks();
  }

  function showLorebookDetail(lorebookId) {
    currentLorebookId = lorebookId;
    viewLorebooks.style.display = "none";
    viewDetail.style.display = "flex";

    const lb = lorebooks.find((l) => l.id === lorebookId);
    if (lb) {
      detailName.textContent = lb.name;
    }

    loadEntries(lorebookId).then(() => {
      renderEntries();
    });
  }

  // === Lorebook list rendering ===

  function renderLorebooks() {
    if (lorebooks.length === 0) {
      lorebookList.style.display = "none";
      lorebookEmptyState.style.display = "block";
      return;
    }

    lorebookList.style.display = "block";
    lorebookEmptyState.style.display = "none";

    lorebookList.innerHTML = lorebooks
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((lb) => {
        const entryCount = entriesByLorebook[lb.id]
          ? entriesByLorebook[lb.id].length
          : 0;
        const isDisabled = !lb.enabled;
        const safeId = escapeHtml(lb.id);
        const name = escapeHtml(lb.name || "Untitled");
        const desc = escapeHtml(lb.description || "");

        return `
          <div class="lorebook-card ${isDisabled ? "disabled" : ""}" data-lb-id="${safeId}">
            <div class="lorebook-card-info">
              <div class="lorebook-card-name">${name}</div>
              ${desc ? `<div class="lorebook-card-desc">${desc}</div>` : ""}
              <div class="lorebook-card-meta">${entryCount} ${entryCount === 1 ? "entry" : "entries"}</div>
            </div>
            <div class="entry-actions">
              <label class="switch" title="Enable/Disable lorebook" onclick="event.stopPropagation()">
                <input type="checkbox" class="lb-toggle" data-lb-id="${safeId}" ${lb.enabled ? "checked" : ""}>
                <span class="slider"></span>
              </label>
            </div>
          </div>
        `;
      })
      .join("");

    // Attach listeners
    lorebookList.querySelectorAll(".lorebook-card").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.lbId;
        showLorebookDetail(id);
      });
    });

    lorebookList.querySelectorAll(".lb-toggle").forEach((el) => {
      el.addEventListener("change", (e) => {
        e.stopPropagation();
        const id = e.target.dataset.lbId;
        toggleLorebook(id, e.target.checked);
      });
    });
  }

  // === Entry list rendering ===

  function renderEntries() {
    const entries = entriesByLorebook[currentLorebookId] || [];

    // Update count
    detailCount.textContent = entries.length + (entries.length === 1 ? " entry" : " entries");

    if (entries.length === 0) {
      entryList.style.display = "none";
      entryEmptyState.style.display = "block";
      return;
    }

    entryList.style.display = "block";
    entryEmptyState.style.display = "none";

    entryList.innerHTML = entries
      .slice()
      .sort((a, b) => (a.order || 100) - (b.order || 100))
      .map((entry) => {
        const isDisabled = entry.disable;
        const keywordBadges = (entry.key || [])
          .map((k) => `<span class="badge">${escapeHtml(k)}</span>`)
          .join("");
        const constantTag = entry.constant
          ? '<span class="entry-constant-tag">CONST</span>'
          : "";
        const label = escapeHtml(entry.comment || "Untitled");
        const safeUid = Number(entry.uid) || 0;

        return `
          <div class="entry-card ${isDisabled ? "disabled" : ""}" data-uid="${safeUid}">
            <div class="entry-info">
              <div class="entry-label">${label}${constantTag}</div>
              <div class="entry-keywords">${keywordBadges || '<span style="color:var(--text-muted)">No keywords</span>'}</div>
            </div>
            <div class="entry-actions">
              <label class="switch" title="Enable/Disable entry">
                <input type="checkbox" class="entry-toggle" data-uid="${safeUid}" ${isDisabled ? "" : "checked"}>
                <span class="slider"></span>
              </label>
              <button class="btn btn-secondary entry-edit" data-uid="${safeUid}">Edit</button>
            </div>
          </div>
        `;
      })
      .join("");

    // Attach event listeners
    entryList.querySelectorAll(".entry-toggle").forEach((el) => {
      el.addEventListener("change", (e) => {
        const uid = Number(e.target.dataset.uid);
        toggleEntry(uid, !e.target.checked);
      });
    });

    entryList.querySelectorAll(".entry-edit").forEach((el) => {
      el.addEventListener("click", (e) => {
        const uid = Number(e.target.dataset.uid);
        openEditModal(uid);
      });
    });
  }

  // === Lorebook CRUD ===

  function addLorebook(name, description) {
    const lb = Lorebook.createLorebook(name, description);
    lorebooks.push(lb);
    entriesByLorebook[lb.id] = [];
    saveLorebooks();
    saveEntries(lb.id, []);
    renderLorebooks();
    return lb;
  }

  function updateLorebook(id, updates) {
    const idx = lorebooks.findIndex((l) => l.id === id);
    if (idx !== -1) {
      lorebooks[idx] = { ...lorebooks[idx], ...updates, updatedAt: Date.now() };
      saveLorebooks();
      renderLorebooks();
    }
  }

  function deleteLorebook(id) {
    lorebooks = lorebooks.filter((l) => l.id !== id);
    delete entriesByLorebook[id];
    // Save lorebooks list and remove entries
    chrome.storage.local.set({ [STORAGE_LOREBOOKS]: lorebooks }, () => {
      chrome.storage.local.remove("jlb_entries_" + id);
    });
    renderLorebooks();
  }

  function toggleLorebook(id, enabled) {
    updateLorebook(id, { enabled });
  }

  // === Entry CRUD ===

  function getEntries() {
    return entriesByLorebook[currentLorebookId] || [];
  }

  function setEntries(entries) {
    entriesByLorebook[currentLorebookId] = entries;
    saveEntries(currentLorebookId, entries);
    renderEntries();
  }

  function addEntry(entry) {
    const entries = getEntries();
    entries.push(entry);
    setEntries(entries);
  }

  function updateEntry(uid, updated) {
    const entries = getEntries();
    const idx = entries.findIndex((e) => e.uid === uid);
    if (idx !== -1) {
      entries[idx] = { ...entries[idx], ...updated };
      setEntries(entries);
    }
  }

  function deleteEntry(uid) {
    const entries = getEntries();
    setEntries(entries.filter((e) => e.uid !== uid));
  }

  function toggleEntry(uid, disable) {
    updateEntry(uid, { disable });
  }

  // === Entry modal ===

  function openEditModal(uid) {
    editingUid = uid;

    if (uid !== null) {
      const entry = getEntries().find((e) => e.uid === uid);
      if (!entry) return;

      modalTitle.textContent = "Edit Entry";
      editComment.value = entry.comment || "";
      editKeys.value = (entry.key || []).join(", ");
      editContent.value = entry.content || "";
      editConstant.checked = entry.constant || false;
      editSelective.checked = entry.selective !== false;
      editOrder.value = entry.order ?? 100;
      btnDelete.style.display = "inline-block";
    } else {
      modalTitle.textContent = "New Entry";
      editComment.value = "";
      editKeys.value = "";
      editContent.value = "";
      editConstant.checked = false;
      editSelective.checked = true;
      editOrder.value = 100;
      btnDelete.style.display = "none";
    }

    editModal.style.display = "flex";
  }

  function closeEditModal() {
    editModal.style.display = "none";
    editingUid = null;
  }

  function saveFromModal() {
    const comment = editComment.value.trim();
    const keys = editKeys.value
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    const content = editContent.value;
    const constant = editConstant.checked;
    const selective = editSelective.checked;
    const order = parseInt(editOrder.value, 10) || 100;

    if (!comment && !content) {
      alert("Please add at least a label or content.");
      return;
    }

    if (editingUid !== null) {
      updateEntry(editingUid, {
        comment,
        key: keys,
        content,
        constant,
        selective,
        order,
      });
    } else {
      const newEntry = Lorebook.createEntry();
      newEntry.comment = comment;
      newEntry.key = keys;
      newEntry.content = content;
      newEntry.constant = constant;
      newEntry.selective = selective;
      newEntry.order = order;
      addEntry(newEntry);
    }

    closeEditModal();
  }

  // === Lorebook modal ===

  function openLorebookModal(lbId) {
    editingLorebookId = lbId;

    if (lbId !== null) {
      const lb = lorebooks.find((l) => l.id === lbId);
      if (!lb) return;

      lorebookModalTitle.textContent = "Edit Lorebook";
      editLbName.value = lb.name || "";
      editLbDescription.value = lb.description || "";
      btnDeleteLorebook.style.display = "inline-block";
    } else {
      lorebookModalTitle.textContent = "New Lorebook";
      editLbName.value = "";
      editLbDescription.value = "";
      btnDeleteLorebook.style.display = "none";
    }

    lorebookModal.style.display = "flex";
  }

  function closeLorebookModal() {
    lorebookModal.style.display = "none";
    editingLorebookId = null;
  }

  function saveLorebookFromModal() {
    const name = editLbName.value.trim();
    const description = editLbDescription.value.trim();

    if (!name) {
      alert("Please enter a lorebook name.");
      return;
    }

    if (editingLorebookId !== null) {
      updateLorebook(editingLorebookId, { name, description });
      // Update detail view header if we're viewing this lorebook
      if (currentLorebookId === editingLorebookId) {
        detailName.textContent = name;
      }
    } else {
      const lb = addLorebook(name, description);
    }

    closeLorebookModal();
  }

  // === Import / Export ===

  function handleImportLorebook() {
    fileImportLorebook.click();
  }

  function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      let json;
      try {
        json = JSON.parse(event.target.result);
      } catch (err) {
        alert(
          "Failed to parse JSON file.\n\n" +
          "Make sure you selected a valid JSON lorebook export " +
          "(from SillyTavern or this extension).\n\n" +
          "Error: " + err.message
        );
        return;
      }

      // Check format
      const looksLikeST = json && json.entries && typeof json.entries === "object";
      const looksLikeArray = Array.isArray(json);
      const looksLikeSingleEntry = json && (json.uid !== undefined || json.key !== undefined);

      if (!looksLikeST && !looksLikeArray && !looksLikeSingleEntry) {
        alert(
          "This file does not appear to be a recognized lorebook format.\n\n" +
          "Expected formats:\n" +
          '- SillyTavern lorebook: { "entries": { ... } }\n' +
          "- Array of entries: [ { ... }, { ... } ]\n" +
          '- Single entry: { "uid": 1, "key": [...], "content": "..." }'
        );
        return;
      }

      let imported;
      try {
        imported = Lorebook.parseSTFormat(json);
      } catch (err) {
        alert(
          "Failed to process lorebook data.\n\n" +
          "The JSON is valid but the entry structure is unexpected.\n" +
          "Error: " + err.message
        );
        return;
      }

      if (imported.length === 0) {
        alert(
          "No valid entries found in file.\n\n" +
          "Entries must have at least a non-empty 'content' string " +
          "and a 'key' array (can be empty for constant entries)."
        );
        return;
      }

      // Derive lorebook name from filename
      const displayName = file.name.replace(/\.json$/i, "") || "Imported Lorebook";

      // Create new lorebook with the imported entries
      const lb = Lorebook.createLorebook(displayName, "Imported from " + file.name);
      // Assign fresh UIDs
      imported.forEach((entry) => {
        entry.uid = Date.now() + Math.floor(Math.random() * 10000);
      });

      lorebooks.push(lb);
      entriesByLorebook[lb.id] = imported;
      saveLorebooks();
      saveEntries(lb.id, imported);
      renderLorebooks();

      console.log(`[Grimoire] Imported lorebook "${displayName}" with ${imported.length} entries.`);
    };

    reader.onerror = () => {
      alert("Failed to read the file. Please try again.");
    };

    reader.readAsText(file);
    fileImportLorebook.value = "";
  }

  function handleExportEntries() {
    const entries = getEntries();
    if (entries.length === 0) {
      alert("No entries to export.");
      return;
    }

    const lb = lorebooks.find((l) => l.id === currentLorebookId);
    const filename = (lb ? lb.name : "lorebook").replace(/[^a-z0-9]/gi, "_").toLowerCase() + "-export.json";

    const exportData = Lorebook.exportSTFormat(entries);
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // === Utility ===

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // === Load all lorebook entry counts for the list view ===

  function refreshEntryCounts() {
    const promises = lorebooks.map((lb) => loadEntries(lb.id));
    Promise.all(promises).then(() => {
      renderLorebooks();
    });
  }

  // === Init ===

  function init() {
    // Add hidden file input to DOM
    document.body.appendChild(fileImportLorebook);

    // Load lorebooks and master toggle
    chrome.storage.local.get([STORAGE_LOREBOOKS, STORAGE_ENABLED, STORAGE_SCAN_DEPTH, "jlb_entries"], (result) => {
      // Handle migration from v1 (jlb_entries -> Default lorebook)
      if (!Array.isArray(result[STORAGE_LOREBOOKS])) {
        if (Array.isArray(result.jlb_entries) && result.jlb_entries.length > 0) {
          // Migrate v1 entries
          const defaultLb = {
            id: "lb_default",
            name: "Default",
            description: "Migrated from previous version",
            enabled: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          lorebooks = [defaultLb];
          entriesByLorebook[defaultLb.id] = result.jlb_entries;

          // Save migrated data and remove old key
          chrome.storage.local.set({
            [STORAGE_LOREBOOKS]: lorebooks,
            ["jlb_entries_" + defaultLb.id]: result.jlb_entries,
          }, () => {
            chrome.storage.local.remove("jlb_entries");
            console.log("[Grimoire] Migrated v1 entries to multi-lorebook format.");
          });
        } else {
          // Fresh install
          lorebooks = [];
          chrome.storage.local.set({ [STORAGE_LOREBOOKS]: [] });
        }
      } else {
        lorebooks = result[STORAGE_LOREBOOKS];
      }

      const enabled = result[STORAGE_ENABLED] !== false;
      masterToggle.checked = enabled;

      const scanDepth = typeof result[STORAGE_SCAN_DEPTH] === "number" && result[STORAGE_SCAN_DEPTH] > 0
        ? result[STORAGE_SCAN_DEPTH]
        : 3;
      scanDepthInput.value = scanDepth;

      // Load entry counts for all lorebooks
      refreshEntryCounts();
    });

    // Listen for storage changes
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;

      if (changes[STORAGE_LOREBOOKS]) {
        lorebooks = changes[STORAGE_LOREBOOKS].newValue || [];
        if (!currentLorebookId) {
          refreshEntryCounts();
        }
      }

      if (changes[STORAGE_ENABLED]) {
        masterToggle.checked = changes[STORAGE_ENABLED].newValue !== false;
      }

      if (changes[STORAGE_SCAN_DEPTH]) {
        const newDepth = changes[STORAGE_SCAN_DEPTH].newValue;
        scanDepthInput.value = (typeof newDepth === "number" && newDepth > 0) ? newDepth : 3;
      }

      // If entries changed for current lorebook (e.g. from another context)
      if (currentLorebookId && changes["jlb_entries_" + currentLorebookId]) {
        entriesByLorebook[currentLorebookId] = changes["jlb_entries_" + currentLorebookId].newValue || [];
        renderEntries();
      }
    });

    // === Event listeners ===

    // Master toggle
    masterToggle.addEventListener("change", () => {
      saveMasterToggle(masterToggle.checked);
    });

    // Scan depth
    scanDepthInput.addEventListener("change", () => {
      let depth = parseInt(scanDepthInput.value, 10);
      if (isNaN(depth) || depth < 1) depth = 3;
      if (depth > 50) depth = 50;
      scanDepthInput.value = depth;
      chrome.storage.local.set({ [STORAGE_SCAN_DEPTH]: depth });
    });

    // Lorebook list view buttons
    btnAddLorebook.addEventListener("click", () => openLorebookModal(null));
    btnImportLorebook.addEventListener("click", handleImportLorebook);
    fileImportLorebook.addEventListener("change", handleFileImport);

    // Detail view buttons
    btnBack.addEventListener("click", showLorebookList);
    btnEditLorebook.addEventListener("click", () => openLorebookModal(currentLorebookId));
    btnAddEntry.addEventListener("click", () => openEditModal(null));
    btnExportEntries.addEventListener("click", handleExportEntries);

    // Entry modal buttons
    btnCloseModal.addEventListener("click", closeEditModal);
    btnSave.addEventListener("click", saveFromModal);
    btnDelete.addEventListener("click", () => {
      if (editingUid !== null) {
        if (confirm("Delete this entry?")) {
          deleteEntry(editingUid);
          closeEditModal();
        }
      }
    });
    editModal.addEventListener("click", (e) => {
      if (e.target === editModal) closeEditModal();
    });

    // Lorebook modal buttons
    btnCloseLorebookModal.addEventListener("click", closeLorebookModal);
    btnSaveLorebook.addEventListener("click", saveLorebookFromModal);
    btnDeleteLorebook.addEventListener("click", () => {
      if (editingLorebookId !== null) {
        if (confirm("Delete this lorebook and all its entries?")) {
          const wasViewingDetail = currentLorebookId === editingLorebookId;
          deleteLorebook(editingLorebookId);
          closeLorebookModal();
          if (wasViewingDetail) {
            showLorebookList();
          }
        }
      }
    });
    lorebookModal.addEventListener("click", (e) => {
      if (e.target === lorebookModal) closeLorebookModal();
    });
  }

  // Start when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
