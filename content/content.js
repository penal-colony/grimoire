/**
 * content.js - ISOLATED world content script
 *
 * Bridges communication between chrome.storage and the MAIN world inject.js.
 * - Listens for LOREBOOK_REQUEST from the page
 * - Reads entries from chrome.storage.local
 * - Sends entries back via postMessage with strict origin targeting
 * - Pushes updates on storage changes (debounced)
 *
 * Security: postMessage targets https://janitorai.com only (no wildcard).
 * A shared secret prevents forged messages from page scripts.
 */

(function () {
  "use strict";

  // Shared secret matching inject.js
  const LOREBOOK_SECRET = "janitor-lorebook-v1";

  // Only post messages to this origin (no wildcard "*")
  const PAGE_ORIGIN = "https://janitorai.com";

  // Debounce timer for storage change events (M8 fix)
  let storageDebounceTimer = null;

  /**
   * Read all lorebook data from storage and send to the page.
   * Validates data shape before sending (W2 fix).
   */
  function sendLorebookData() {
    chrome.storage.local.get(["jlb_entries", "jlb_enabled"], (result) => {
      // Validate entries shape before sending
      let entries = result.jlb_entries;
      if (!Array.isArray(entries)) {
        entries = [];
      }

      // Sanitize entries: ensure required fields exist
      entries = entries.filter((entry) => {
        if (!entry || typeof entry !== "object") return false;
        if (typeof entry.content !== "string") return false;
        if (!Array.isArray(entry.key)) return false;
        return true;
      });

      const enabled = result.jlb_enabled !== false; // default true

      window.postMessage(
        {
          type: "LOREBOOK_DATA",
          secret: LOREBOOK_SECRET,
          entries: entries,
          enabled: enabled,
        },
        PAGE_ORIGIN
      );
    });
  }

  // Listen for requests from the MAIN world inject script
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    // Validate origin: same-origin only
    if (event.origin !== PAGE_ORIGIN && event.origin !== location.origin) return;

    if (
      event.data.type === "LOREBOOK_REQUEST" &&
      event.data.secret === LOREBOOK_SECRET
    ) {
      sendLorebookData();
    }
  });

  // Listen for storage changes and push updates to the page (debounced - M8 fix)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes.jlb_entries || changes.jlb_enabled) {
      // Debounce rapid storage changes by 100ms
      if (storageDebounceTimer) {
        clearTimeout(storageDebounceTimer);
      }
      storageDebounceTimer = setTimeout(() => {
        storageDebounceTimer = null;
        sendLorebookData();
      }, 100);
    }
  });

  // Fix #7: Migrate old non-namespaced storage keys to jlb_ prefix
  chrome.storage.local.get(["lorebookEntries", "lorebookEnabled"], (old) => {
    if (old.lorebookEntries !== undefined || old.lorebookEnabled !== undefined) {
      const migration = {};
      if (old.lorebookEntries !== undefined) migration.jlb_entries = old.lorebookEntries;
      if (old.lorebookEnabled !== undefined) migration.jlb_enabled = old.lorebookEnabled;
      chrome.storage.local.set(migration, () => {
        chrome.storage.local.remove(["lorebookEntries", "lorebookEnabled"]);
        console.log("[Janitor Lorebook] Migrated storage keys to jlb_ prefix.");
      });
    }
  });

  // M7 fix: Delay initial data send slightly to let inject.js set up its listener
  setTimeout(sendLorebookData, 0);

  console.log("[Janitor Lorebook] Content script bridge ready.");
})();
