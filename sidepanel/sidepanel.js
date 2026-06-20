/**
 * sidepanel.js - Side panel UI logic
 *
 * Manages CRUD operations for lorebook entries, import/export,
 * and the master toggle. All data persisted in chrome.storage.local.
 *
 * Storage keys are namespaced with jlb_ prefix (fix #7).
 */

(function () {
  "use strict";

  // Namespaced storage keys (fix #7)
  const STORAGE_ENTRIES = "jlb_entries";
  const STORAGE_ENABLED = "jlb_enabled";

  // === State ===
  let entries = [];
  let editingUid = null; // null = creating new, number = editing existing

  // === DOM refs ===
  const masterToggle = document.getElementById("masterToggle");
  const entryList = document.getElementById("entryList");
  const emptyState = document.getElementById("emptyState");
  const btnAdd = document.getElementById("btnAdd");
  const btnImport = document.getElementById("btnImport");
  const btnExport = document.getElementById("btnExport");
  const fileImport = document.getElementById("fileImport");
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

  // === Storage ===

  function saveEntries() {
    chrome.storage.local.set({ [STORAGE_ENTRIES]: entries });
  }

  function saveMasterToggle(enabled) {
    chrome.storage.local.set({ [STORAGE_ENABLED]: enabled });
  }

  // === Rendering ===

  function render() {
    // Show/hide empty state
    if (entries.length === 0) {
      entryList.style.display = "none";
      emptyState.style.display = "block";
      return;
    }

    entryList.style.display = "block";
    emptyState.style.display = "none";

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
        // M5 fix: uid is guaranteed numeric by parseSTFormat, but escape anyway
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

    // Attach event listeners to rendered elements
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

  // === CRUD ===

  function addEntry(entry) {
    entries.push(entry);
    saveEntries();
    render();
  }

  function updateEntry(uid, updated) {
    const idx = entries.findIndex((e) => e.uid === uid);
    if (idx !== -1) {
      entries[idx] = { ...entries[idx], ...updated };
      saveEntries();
      render();
    }
  }

  function deleteEntry(uid) {
    entries = entries.filter((e) => e.uid !== uid);
    saveEntries();
    render();
  }

  function toggleEntry(uid, disable) {
    updateEntry(uid, { disable });
  }

  // === Modal ===

  function openEditModal(uid) {
    editingUid = uid;

    if (uid !== null) {
      // Editing existing
      const entry = entries.find((e) => e.uid === uid);
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
      // Creating new
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

  // === Import / Export ===

  function handleImport() {
    fileImport.click();
  }

  function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      // Fix #5: User-friendly error handling for invalid JSON / unrecognized formats
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

      // Check if the JSON has the expected structure
      const looksLikeST = json && json.entries && typeof json.entries === "object";
      const looksLikeArray = Array.isArray(json);
      const looksLikeSingleEntry = json && (json.uid !== undefined || json.key !== undefined);

      if (!looksLikeST && !looksLikeArray && !looksLikeSingleEntry) {
        alert(
          "This file does not appear to be a recognized lorebook format.\n\n" +
          "Expected formats:\n" +
          "- SillyTavern lorebook: { \"entries\": { ... } }\n" +
          "- Array of entries: [ { ... }, { ... } ]\n" +
          "- Single entry: { \"uid\": 1, \"key\": [...], \"content\": \"...\" }"
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

      // Merge: append imported entries, assign new UIDs to avoid conflicts
      const maxUid = entries.reduce((max, e) => Math.max(max, e.uid || 0), 0);
      imported.forEach((entry, idx) => {
        entry.uid = maxUid + idx + 1;
      });

      entries = entries.concat(imported);
      saveEntries();
      render();

      console.log(`[Janitor Lorebook] Imported ${imported.length} entries.`);
    };

    reader.onerror = () => {
      alert("Failed to read the file. Please try again.");
    };

    reader.readAsText(file);
    // Reset input so same file can be re-imported
    fileImport.value = "";
  }

  function handleExport() {
    if (entries.length === 0) {
      alert("No entries to export.");
      return;
    }

    const exportData = Lorebook.exportSTFormat(entries);
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lorebook-export.json";
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

  // === Init ===

  function init() {
    // Load entries and master toggle (namespaced keys)
    chrome.storage.local.get([STORAGE_ENTRIES, STORAGE_ENABLED], (result) => {
      entries = result[STORAGE_ENTRIES] || [];
      const enabled = result[STORAGE_ENABLED] !== false;
      masterToggle.checked = enabled;
      render();
    });

    // Listen for storage changes (in case entries change from another context)
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[STORAGE_ENTRIES]) {
        entries = changes[STORAGE_ENTRIES].newValue || [];
        render();
      }
      if (changes[STORAGE_ENABLED]) {
        masterToggle.checked = changes[STORAGE_ENABLED].newValue !== false;
      }
    });

    // Event listeners
    masterToggle.addEventListener("change", () => {
      saveMasterToggle(masterToggle.checked);
    });

    btnAdd.addEventListener("click", () => openEditModal(null));
    btnImport.addEventListener("click", handleImport);
    btnExport.addEventListener("click", handleExport);
    fileImport.addEventListener("change", handleFileImport);

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

    // Close modal on overlay click
    editModal.addEventListener("click", (e) => {
      if (e.target === editModal) closeEditModal();
    });
  }

  // Start when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
