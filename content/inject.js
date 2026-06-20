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
 * inject.js - MAIN world script
 *
 * Runs in the page context. Wraps window.fetch to intercept
 * outgoing chat/completions requests and inject lorebook
 * content into the system message.
 *
 * Depends on: lib/lorebook.js (loaded in MAIN world before this script)
 *
 * Security: Uses a shared secret for postMessage validation to
 * prevent malicious page scripts from forging lorebook data.
 */

(function () {
  "use strict";

  // W5 fix: Use the shared Lorebook library from lib/lorebook.js (loaded in MAIN world)
  // This eliminates the duplicate matcher logic that had subtle bugs (no keyword trimming).
  if (typeof window.Lorebook === "undefined") {
    console.warn("[Grimoire] Lorebook library not loaded! Injection disabled.");
    return;
  }

  const Lorebook = window.Lorebook;

  // Shared secret for postMessage validation (raises the bar for forgery)
  const LOREBOOK_SECRET = "grimoire-v1";

  // Only accept messages from janitorai.com origin
  const PAGE_ORIGIN = "https://janitorai.com";

  // Cached lorebook entries and master toggle
  let cachedEntries = [];
  let lorebookEnabled = true;
  let scanDepth = 3; // Default: scan last 3 messages for keyword triggers

  // --- Communication with content script (ISOLATED world) ---

  // Request entries on load
  window.postMessage({ type: "LOREBOOK_REQUEST", secret: LOREBOOK_SECRET }, PAGE_ORIGIN);

  // Listen for lorebook data and updates from content script
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    // Validate origin: same-origin only (both scripts run on janitorai.com)
    if (event.origin !== PAGE_ORIGIN && event.origin !== location.origin) return;

    if (event.data.type === "LOREBOOK_DATA" && event.data.secret === LOREBOOK_SECRET) {
      // Validate entries shape (W2 fix)
      if (!Array.isArray(event.data.entries)) {
        console.warn("[Grimoire] Invalid entries data received, ignoring.");
        return;
      }
      cachedEntries = event.data.entries;
      lorebookEnabled = event.data.enabled !== false;
      if (typeof event.data.scanDepth === "number" && event.data.scanDepth > 0) {
        scanDepth = event.data.scanDepth;
      }
    }
  });

  // --- Fetch interception ---

  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    let [resource, init] = args;

    // Normalize: fetch can be called with (url, init) or (Request) or (Request, init)
    let url = "";
    let isRequestObject = false;

    if (typeof resource === "string") {
      url = resource;
    } else if (resource instanceof Request) {
      isRequestObject = true;
      url = resource.url;
      // C2 fix: If no separate init was provided, reconstruct from the Request object
      // so we can modify the body and pass it explicitly to originalFetch.
      if (!init) {
        init = {
          method: resource.method,
          headers: resource.headers,
          mode: resource.mode,
          credentials: resource.credentials,
          cache: resource.cache,
          redirect: resource.redirect,
          referrer: resource.referrer,
          referrerPolicy: resource.referrerPolicy,
          // Note: body is intentionally omitted here; we'll read it below
          // from the Request if needed, or set our own modified body.
        };
      }
    }

    // M6 fix: Early exit if lorebook is disabled or no entries.
    // Avoids wasteful body parsing on every chat message.
    if (!lorebookEnabled || cachedEntries.length === 0) {
      // C2 fix: if we reconstructed init from a Request, pass it explicitly
      if (isRequestObject && init) {
        return originalFetch(url, init);
      }
      return originalFetch.apply(this, args);
    }

    // C1 fix: Match /chat/completions at path boundary (not /v1/chat/completions)
    // This catches all OpenAI-compatible endpoints regardless of base URL the user configured:
    //   /api/chat/completions, /v1/chat/completions, /api/v1/chat/completions, etc.
    // Regex avoids false positives like /docs/chat/completions-guide
    const isChatCompletions = /\/chat\/completions(\?.*)?(#.*)?$/.test(url);
    const isPost = init && init.method && init.method.toUpperCase() === "POST";

    if (isChatCompletions && isPost) {
      try {
        // Read the body string from whatever source we have
        let bodyStr = "";

        if (init.body !== undefined && init.body !== null) {
          // Body from init (string, Blob, or ArrayBuffer)
          if (typeof init.body === "string") {
            bodyStr = init.body;
          } else if (init.body instanceof Blob) {
            bodyStr = await init.body.text();
          } else if (init.body instanceof ArrayBuffer) {
            bodyStr = new TextDecoder().decode(init.body);
          }
        } else if (isRequestObject && resource.body) {
          // C2 fix: Body from the Request object (not yet consumed)
          // Clone the request so we can read its body without consuming the original.
          // Note: ReadableStream bodies are not handled (unlikely for POST request bodies).
          const reqClone = resource.clone();
          bodyStr = await reqClone.text();
        }

        if (bodyStr) {
          const body = JSON.parse(bodyStr);

          if (body.messages && Array.isArray(body.messages) && body.messages.length > 0) {
            // Extract conversation text from last N messages for keyword scanning
            // scanDepth is set from storage (default: 3)
            const recentMessages = body.messages.slice(-scanDepth);
            const conversationText = recentMessages
              .map((m) => {
                if (typeof m.content === "string") return m.content;
                if (Array.isArray(m.content)) {
                  return m.content
                    .filter((p) => p.type === "text")
                    .map((p) => p.text)
                    .join(" ");
                }
                return "";
              })
              .join(" ");

            // W5 fix: Use shared Lorebook.matchEntries (from lib/lorebook.js)
            // instead of duplicated inline matcher.
            const matched = Lorebook.matchEntries(cachedEntries, conversationText);

            if (matched.length > 0) {
              const injectionText = Lorebook.buildInjectionText(matched);

              // E3 fix: Find the system message by role, not just messages[0]
              const sysMsg = body.messages.find((m) => m.role === "system");
              if (sysMsg && typeof sysMsg.content === "string") {
                const existing = sysMsg.content || "";
                // Only inject once (avoid duplicates)
                if (!existing.includes("<lorebook>")) {
                  sysMsg.content = existing + "\n<lorebook>\n" + injectionText + "\n</lorebook>";
                }
              }

              // Re-serialize and set the modified body
              init.body = JSON.stringify(body);
            }
          }
        }
      } catch (err) {
        // If anything goes wrong, just pass the request through unmodified.
        // Streaming responses are never touched (only request body is modified).
        console.warn("[Grimoire] Injection error (passing through):", err);
      }
    }

    // C2 fix: Always pass the modified init explicitly to avoid losing the body
    // when we reconstructed init from a Request object.
    if (isRequestObject) {
      // We always have an init now (either provided or reconstructed).
      // Pass url + init to ensure the modified body is sent.
      return originalFetch(url, init);
    }
    // Standard case: args already contains the modified init (objects are passed by reference)
    return originalFetch.apply(this, args);
  };

  console.log("[Grimoire] Fetch interceptor installed.");
})();
