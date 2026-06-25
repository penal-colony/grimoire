/*
 * Grimoire - Plugin engine bridge (ISOLATED world)
 * Copyright (C) 2026 Ash <ash@ashisgreat.xyz>
 *
 * License: GPL v3
 */

/**
 * plugin-bridge.js - ISOLATED world content script
 *
 * Bridges plugin storage and execution between chrome.storage and the MAIN world.
 *
 * Responsibilities:
 * - Read plugin configs + db state from chrome.storage.local
 * - Send plugin data to MAIN world on PLUGIN_REQUEST
 * - Persist plugin db state on PLUGIN_DB_SYNC
 * - Sync on storage changes (debounced)
 */

(function () {
  "use strict";

  const PAGE_ORIGIN = "https://janitorai.com";

  let storageDebounceTimer = null;

  /**
   * Send plugin configs and database state to the MAIN world.
   */
  function sendPluginData() {
    chrome.storage.local.get(
      ["jlb_plugins", "jlb_plugin_db", "jlb_plugin_variables"],
      (result) => {
        const plugins = Array.isArray(result.jlb_plugins) ? result.jlb_plugins : [];
        const pluginDb = result.jlb_plugin_db || {};
        const variables = result.jlb_plugin_variables || {};

        window.postMessage(
          {
            type: "PLUGIN_DATA",
            plugins,
            pluginDb,
            variables,
          },
          PAGE_ORIGIN
        );
      }
    );
  }

  /**
   * Persist plugin database state back to storage.
   */
  function syncPluginDb(pluginDbState, variables) {
    const updates = {};
    if (pluginDbState && typeof pluginDbState === "object") {
      updates.jlb_plugin_db = pluginDbState;
    }
    if (variables && typeof variables === "object") {
      updates.jlb_plugin_variables = variables;
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  }

  // Listen for requests from MAIN world
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== PAGE_ORIGIN && event.origin !== location.origin) return;

    if (event.data.type === "PLUGIN_REQUEST") {
      sendPluginData();
    }

    if (event.data.type === "PLUGIN_DB_SYNC") {
      syncPluginDb(event.data.pluginDbState, event.data.variables);
    }
  });

  // Listen for storage changes (e.g. user edits plugin in side panel)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    const relevant = ["jlb_plugins", "jlb_plugin_db", "jlb_plugin_variables"].some(
      (k) => k in changes
    );
    if (!relevant) return;

    // Debounce: rapid side-panel saves
    if (storageDebounceTimer) {
      clearTimeout(storageDebounceTimer);
    }
    storageDebounceTimer = setTimeout(() => {
      storageDebounceTimer = null;
      sendPluginData();
    }, 200);
  });

  console.log("[Grimoire] Plugin bridge ready (ISOLATED).");
})();
