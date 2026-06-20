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
 * content.js - ISOLATED world content script
 *
 * Bridges communication between chrome.storage and the MAIN world inject.js.
 * - Listens for LOREBOOK_REQUEST from the page
 * - Reads entries from chrome.storage.local (multi-lorebook aware)
 * - Sends combined entries from all enabled lorebooks to the page
 * - Pushes updates on storage changes (debounced)
 * - Migrates old flat storage to multi-lorebook format on first load
 *
 * Security: postMessage targets https://janitorai.com only (no wildcard).
 * A shared secret prevents forged messages from page scripts.
 */

(function () {
  "use strict";

  // Shared secret matching inject.js
  const LOREBOOK_SECRET = "grimoire-v1";

  // Only post messages to this origin (no wildcard "*")
  const PAGE_ORIGIN = "https://janitorai.com";

  // Debounce timer for storage change events (M8 fix)
  let storageDebounceTimer = null;

  // Track which storage keys we care about for change detection
  let watchedKeys = new Set(["jlb_lorebooks", "jlb_enabled"]);

  /**
   * Read all lorebook data from storage and send to the page.
   * Collects entries from all enabled lorebooks and combines them.
   */
  function sendLorebookData() {
    // First get the lorebooks list and master toggle
    chrome.storage.local.get(["jlb_lorebooks", "jlb_enabled", "jlb_scan_depth"], (result) => {
      const lorebooks = Array.isArray(result.jlb_lorebooks) ? result.jlb_lorebooks : [];
      const enabled = result.jlb_enabled !== false; // default true
      const scanDepth = typeof result.jlb_scan_depth === "number" && result.jlb_scan_depth > 0
        ? result.jlb_scan_depth
        : 3;

      // Build list of entry keys for all lorebooks
      const entryKeys = lorebooks.map((lb) => "jlb_entries_" + lb.id);

      // Update watched keys
      lorebooks.forEach((lb) => watchedKeys.add("jlb_entries_" + lb.id));

      if (entryKeys.length === 0) {
        // No lorebooks: send empty
        window.postMessage(
          {
            type: "LOREBOOK_DATA",
            secret: LOREBOOK_SECRET,
            entries: [],
            enabled: enabled,
            scanDepth: scanDepth,
          },
          PAGE_ORIGIN
        );
        return;
      }

      chrome.storage.local.get(entryKeys, (entriesResult) => {
        // Build entries-by-lorebook map
        const entriesByLorebook = {};
        for (const lb of lorebooks) {
          const key = "jlb_entries_" + lb.id;
          const entries = entriesResult[key];
          if (Array.isArray(entries)) {
            entriesByLorebook[lb.id] = entries;
          } else {
            entriesByLorebook[lb.id] = [];
          }
        }

        // Use Lorebook helper if available, otherwise manual flatten
        let combined = [];
        if (typeof window.Lorebook !== "undefined" && window.Lorebook.getAllEnabledEntries) {
          combined = window.Lorebook.getAllEnabledEntries(lorebooks, entriesByLorebook);
        } else {
          // Manual fallback (content.js runs in ISOLATED world where Lorebook isn't loaded)
          for (const lb of lorebooks) {
            if (!lb || !lb.enabled) continue;
            const entries = entriesByLorebook[lb.id];
            if (!Array.isArray(entries)) continue;
            for (const entry of entries) {
              if (entry && typeof entry === "object" && typeof entry.content === "string" && Array.isArray(entry.key)) {
                combined.push(entry);
              }
            }
          }
        }

        window.postMessage(
          {
            type: "LOREBOOK_DATA",
            secret: LOREBOOK_SECRET,
            entries: combined,
            enabled: enabled,
            scanDepth: scanDepth,
          },
          PAGE_ORIGIN
        );
      });
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

    // Check if any relevant key changed
    let relevant = false;
    for (const key of Object.keys(changes)) {
      if (key === "jlb_lorebooks" || key === "jlb_enabled" || key === "jlb_scan_depth" || key.startsWith("jlb_entries_")) {
        relevant = true;
        break;
      }
    }

    if (!relevant) return;

    // Debounce rapid storage changes by 100ms
    if (storageDebounceTimer) {
      clearTimeout(storageDebounceTimer);
    }
    storageDebounceTimer = setTimeout(() => {
      storageDebounceTimer = null;
      sendLorebookData();
    }, 100);
  });

  // === Migration ===

  /**
   * Migrate from v1 flat storage (jlb_entries) to v2 multi-lorebook format.
   * Creates a "Default" lorebook and moves old entries into it.
   * Also handles pre-v1 migration (lorebookEntries -> jlb_entries).
   */
  function migrateIfNeeded() {
    chrome.storage.local.get(
      ["jlb_lorebooks", "jlb_entries", "lorebookEntries", "lorebookEnabled"],
      (result) => {
        // Pre-v1 migration: lorebookEntries -> jlb_entries
        if (result.lorebookEntries !== undefined || result.lorebookEnabled !== undefined) {
          const migration = {};
          if (result.lorebookEntries !== undefined) migration.jlb_entries = result.lorebookEntries;
          if (result.lorebookEnabled !== undefined) migration.jlb_enabled = result.lorebookEnabled;
          chrome.storage.local.set(migration, () => {
            chrome.storage.local.remove(["lorebookEntries", "lorebookEnabled"]);
            console.log("[Grimoire] Migrated pre-v1 storage keys to jlb_ prefix.");
            // Now check if v1->v2 migration is also needed
            migrateV1ToV2();
          });
        } else {
          // Check v1 -> v2 migration
          migrateV1ToV2();
        }
      }
    );
  }

  function migrateV1ToV2() {
    chrome.storage.local.get(["jlb_lorebooks", "jlb_entries"], (result) => {
      // Already migrated to v2
      if (Array.isArray(result.jlb_lorebooks)) {
        return;
      }

      // No old entries to migrate
      if (!Array.isArray(result.jlb_entries) || result.jlb_entries.length === 0) {
        // Just initialize empty lorebooks array
        chrome.storage.local.set({ jlb_lorebooks: [] });
        return;
      }

      // Create a "Default" lorebook and move entries into it
      const defaultLb = {
        id: "lb_default",
        name: "Default",
        description: "Migrated from previous version",
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const updates = {
        jlb_lorebooks: [defaultLb],
        ["jlb_entries_" + defaultLb.id]: result.jlb_entries,
      };

      chrome.storage.local.set(updates, () => {
        // Remove old flat entries key
        chrome.storage.local.remove("jlb_entries");
        console.log("[Grimoire] Migrated v1 entries to multi-lorebook format (Default lorebook).");
      });
    });
  }

  // Run migration on load
  migrateIfNeeded();

  // M7 fix: Delay initial data send slightly to let inject.js set up its listener
  setTimeout(sendLorebookData, 0);

  console.log("[Grimoire] Content script bridge ready (multi-lorebook).");
})();
