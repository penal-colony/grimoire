/*
 * Grimoire - Plugin UI for side panel
 * Copyright (C) 2026 Ash <ash@ashisgreat.xyz>
 *
 * License: GPL v3
 */

/**
 * plugin-ui.js - Plugin management in the side panel
 *
 * Manages:
 * - Plugin CRUD (create, read, update, delete)
 * - Per-plugin enable/disable toggle
 * - Plugin code editor (string storage, no eval in this context)
 * - Import/export plugins as .json files
 *
 * Storage key: jlb_plugins (array of { id, name, code, enabled, createdAt, updatedAt })
 */

(function () {
  "use strict";

  const STORAGE_PLUGINS = "jlb_plugins";

  // State
  let plugins = [];
  let editingPluginId = null;

  // Tab switching (shared with sidepanel.js)
  const tabLorebooks = document.getElementById("tabLorebooks");
  const tabPlugins = document.getElementById("tabPlugins");

  // Views
  const viewLorebooks = document.getElementById("view-lorebooks");
  const viewDetail = document.getElementById("view-detail");
  const viewPlugins = document.getElementById("view-plugins");

  // Plugin list elements
  const pluginList = document.getElementById("pluginList");
  const pluginEmptyState = document.getElementById("pluginEmptyState");
  const btnAddPlugin = document.getElementById("btnAddPlugin");
  const btnImportPlugin = document.getElementById("btnImportPlugin");
  const fileImportPlugin = document.createElement("input");
  fileImportPlugin.type = "file";
  fileImportPlugin.accept = ".json,.js";
  fileImportPlugin.style.display = "none";

  // Plugin modal elements
  const pluginModal = document.getElementById("pluginModal");
  const pluginModalTitle = document.getElementById("pluginModalTitle");
  const btnClosePluginModal = document.getElementById("btnClosePluginModal");
  const btnSavePlugin = document.getElementById("btnSavePlugin");
  const btnDeletePlugin = document.getElementById("btnDeletePlugin");
  const editPluginName = document.getElementById("editPluginName");
  const editPluginCode = document.getElementById("editPluginCode");

  // === Tab switching ===

  function showTabLorebooks() {
    tabLorebooks.classList.add("active");
    tabPlugins.classList.remove("active");
    viewPlugins.style.display = "none";
    // Lorebook views are controlled by sidepanel.js
    // We need to restore them. The sidepanel.js showLorebookList/showLorebookDetail
    // functions set viewLorebooks and viewDetail display.
    // Just reset to lorebook list view.
    viewLorebooks.style.display = "flex";
    viewDetail.style.display = "none";
  }

  function showTabPlugins() {
    tabLorebooks.classList.remove("active");
    tabPlugins.classList.add("active");
    viewLorebooks.style.display = "none";
    viewDetail.style.display = "none";
    viewPlugins.style.display = "flex";
    renderPlugins();
  }

  // Expose to global scope so sidepanel.js can remove its own tab listeners
  window.showTabLorebooks = showTabLorebooks;
  window.showTabPlugins = showTabPlugins;

  // === Storage helpers ===

  function savePlugins() {
    chrome.storage.local.set({ [STORAGE_PLUGINS]: plugins });
  }

  // === Plugin list rendering ===

  function renderPlugins() {
    if (plugins.length === 0) {
      pluginList.style.display = "none";
      pluginEmptyState.style.display = "block";
      return;
    }

    pluginList.style.display = "block";
    pluginEmptyState.style.display = "none";

    while (pluginList.firstChild) {
      pluginList.removeChild(pluginList.firstChild);
    }

    const sorted = plugins.slice().sort((a, b) => b.updatedAt - a.updatedAt);

    sorted.forEach((plugin) => {
      const isDisabled = !plugin.enabled;

      const card = document.createElement("div");
      card.className = "plugin-card" + (isDisabled ? " disabled" : "");

      const info = document.createElement("div");
      info.className = "plugin-card-info";

      const nameEl = document.createElement("div");
      nameEl.className = "plugin-card-name";
      nameEl.textContent = plugin.name || "Untitled Plugin";
      info.appendChild(nameEl);

      const previewEl = document.createElement("div");
      previewEl.className = "plugin-card-preview";
      // Show first 80 chars of code as preview
      const codePreview = (plugin.code || "").replace(/\n/g, " ").substring(0, 80);
      previewEl.textContent = codePreview || "No code";
      info.appendChild(previewEl);

      card.appendChild(info);

      // Actions
      const actions = document.createElement("div");
      actions.className = "entry-actions";

      // Enable/disable toggle
      const label = document.createElement("label");
      label.className = "switch";
      label.setAttribute("title", "Enable/Disable plugin");

      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = !!plugin.enabled;
      toggle.addEventListener("change", () => {
        plugin.enabled = toggle.checked;
        savePlugins();
        renderPlugins();
      });

      const slider = document.createElement("span");
      slider.className = "slider";

      label.appendChild(toggle);
      label.appendChild(slider);
      actions.appendChild(label);

      // Edit button
      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-secondary entry-edit";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => openPluginModal(plugin.id));
      actions.appendChild(editBtn);

      card.appendChild(actions);
      pluginList.appendChild(card);
    });
  }

  // === Plugin CRUD ===

  function addPlugin(name, code) {
    const id = "plg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const plugin = {
      id,
      name: name || "Untitled Plugin",
      code: code || "",
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    plugins.push(plugin);
    savePlugins();
    renderPlugins();
    return plugin;
  }

  function updatePlugin(id, updates) {
    const idx = plugins.findIndex((p) => p.id === id);
    if (idx !== -1) {
      plugins[idx] = { ...plugins[idx], ...updates, updatedAt: Date.now() };
      savePlugins();
      renderPlugins();
    }
  }

  function deletePlugin(id) {
    plugins = plugins.filter((p) => p.id !== id);
    savePlugins();
    renderPlugins();
  }

  // === Plugin modal ===

  function openPluginModal(pluginId) {
    editingPluginId = pluginId;

    if (pluginId !== null) {
      const plugin = plugins.find((p) => p.id === pluginId);
      if (!plugin) return;

      pluginModalTitle.textContent = "Edit Plugin";
      editPluginName.value = plugin.name || "";
      editPluginCode.value = plugin.code || "";
      btnDeletePlugin.style.display = "inline-block";
    } else {
      pluginModalTitle.textContent = "New Plugin";
      editPluginName.value = "";
      editPluginCode.value = "";
      btnDeletePlugin.style.display = "none";
    }

    pluginModal.style.display = "flex";
  }

  function closePluginModal() {
    pluginModal.style.display = "none";
    editingPluginId = null;
  }

  function savePluginFromModal() {
    const name = editPluginName.value.trim();
    const code = editPluginCode.value;

    if (!name) {
      alert("Please enter a plugin name.");
      return;
    }

    if (editingPluginId !== null) {
      updatePlugin(editingPluginId, { name, code });
    } else {
      addPlugin(name, code);
    }

    closePluginModal();
  }

  // === Import / Export ===

  function handleImportPlugin() {
    fileImportPlugin.click();
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
        alert("Failed to parse JSON file.\n\nError: " + err.message);
        return;
      }

      // Support importing a single plugin or an array
      const pluginData = Array.isArray(json) ? json : [json];

      pluginData.forEach((p) => {
        if (p.name && p.code !== undefined) {
          addPlugin(p.name, p.code);
        }
      });

      if (pluginData.length === 0) {
        alert("No valid plugins found in file.\n\nExpected format: { \"name\": \"...\", \"code\": \"...\" }");
      }
    };

    reader.onerror = () => {
      alert("Failed to read the file. Please try again.");
    };

    reader.readAsText(file);
    fileImportPlugin.value = "";
  }

  function exportPlugin(plugin) {
    const filename = plugin.name.replace(/[^a-z0-9]/gi, "_").toLowerCase() + "-plugin.json";
    const blob = new Blob([JSON.stringify(plugin, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Export button per-plugin (add to renderPlugins if desired)
  window.exportPlugin = exportPlugin;

  // === Init ===

  function init() {
    document.body.appendChild(fileImportPlugin);

    // Load plugins
    chrome.storage.local.get([STORAGE_PLUGINS], (result) => {
      plugins = Array.isArray(result[STORAGE_PLUGINS]) ? result[STORAGE_PLUGINS] : [];
      // Don't render yet, only when plugins tab is selected
    });

    // Listen for storage changes
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[STORAGE_PLUGINS]) {
        plugins = changes[STORAGE_PLUGINS].newValue || [];
        renderPlugins();
      }
    });

    // Tab buttons
    tabPlugins.addEventListener("click", () => {
      if (!tabPlugins.classList.contains("active")) {
        showTabPlugins();
        // Override the lorebook view to hidden (sidepanel.js might have set it)
        if (viewLorebooks.style.display !== "none") {
          viewLorebooks.style.display = "none";
        }
        if (viewDetail.style.display !== "none") {
          viewDetail.style.display = "none";
        }
      }
    });

    tabLorebooks.addEventListener("click", () => {
      if (!tabLorebooks.classList.contains("active")) {
        showTabLorebooks();
      }
    });

    // Plugin list buttons
    btnAddPlugin.addEventListener("click", () => openPluginModal(null));
    btnImportPlugin.addEventListener("click", handleImportPlugin);
    fileImportPlugin.addEventListener("change", handleFileImport);

    // Plugin modal buttons
    btnClosePluginModal.addEventListener("click", closePluginModal);
    btnSavePlugin.addEventListener("click", savePluginFromModal);
    btnDeletePlugin.addEventListener("click", () => {
      if (editingPluginId !== null) {
        if (confirm("Delete this plugin?")) {
          deletePlugin(editingPluginId);
          closePluginModal();
        }
      }
    });
    pluginModal.addEventListener("click", (e) => {
      if (e.target === pluginModal) closePluginModal();
    });
  }

  // Start when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
