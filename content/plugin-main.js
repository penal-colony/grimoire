/*
 * Grimoire - Plugin engine (MAIN world)
 * Copyright (C) 2026 Ash <ash@ashisgreat.xyz>
 *
 * License: GPL v3
 */

/**
 * plugin-main.js - MAIN world script
 *
 * Runs in the page context. Manages the sandboxed plugin iframe
 * and hooks into the fetch interceptor to run plugins before
 * messages are sent to the API.
 *
 * Architecture:
 *   side panel  ──>  chrome.storage.local  ──>  plugin-bridge.js (ISOLATED)
 *                                                       │
 *                                                   postMessage
 *                                                       │
 *   plugin-main.js (MAIN)  <───────────────────────────┘
 *        │
 *        │  postMessage(pluginCode + messages + state)
 *        ▼
 *   sandbox iframe (plugin-runner.js)
 *        │
 *        │  postMessage(result + state changes)
 *        ▼
 *   plugin-main.js  ──>  apply changes to fetch body  ──>  API
 */

(function () {
  "use strict";

  const PAGE_ORIGIN = "https://janitorai.com";

  // Plugin state
  let plugins = [];
  let pluginDb = {};
  let variables = {};
  let sandboxIframe = null;
  let iframeReady = false;
  let pendingRequests = new Map(); // requestId -> { resolve, reject }
  let nextRequestId = 0;

  // --- Sandbox iframe management ---

  function getSandboxIframe() {
    if (sandboxIframe && iframeReady) return sandboxIframe;

    if (!sandboxIframe) {
      sandboxIframe = document.createElement("iframe");
      sandboxIframe.src = chrome.runtime.getURL("sandbox/plugin-runner.html");
      sandboxIframe.style.display = "none";
      sandboxIframe.setAttribute("sandbox", "allow-scripts");

      // Wait for iframe to load
      sandboxIframe.addEventListener("load", () => {
        iframeReady = true;
      });

      document.body.appendChild(sandboxIframe);
    }

    return sandboxIframe;
  }

  // Listen for results from the sandbox iframe
  window.addEventListener("message", (event) => {
    if (event.origin !== PAGE_ORIGIN && event.origin !== location.origin) return;
    if (!event.data || event.data.type !== "PLUGIN_RESULT") return;

    const { requestId, result, variables: newVars, variableChanges,
            systemPromptAdditions, messageReplacements, pluginDbState, error } = event.data;

    const pending = pendingRequests.get(requestId);
    if (!pending) return;

    pendingRequests.delete(requestId);

    if (error) {
      console.warn("[Grimoire] Plugin error:", error);
      pending.reject(new Error(error));
    } else {
      pending.resolve({
        result,
        variables: newVars || variables,
        variableChanges: variableChanges || {},
        systemPromptAdditions: systemPromptAdditions || [],
        messageReplacements: messageReplacements || [],
        pluginDbState: pluginDbState || {},
      });
    }
  });

  /**
   * Run a single plugin in the sandbox.
   * Returns a promise that resolves with the plugin's result.
   */
  function runPlugin(pluginCode, messages) {
    return new Promise((resolve, reject) => {
      const iframe = getSandboxIframe();
      const requestId = ++nextRequestId;

      pendingRequests.set(requestId, { resolve, reject });

      // Timeout safety: 10 seconds max per plugin
      setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId);
          reject(new Error("Plugin execution timed out (10s)"));
        }
      }, 10000);

      iframe.contentWindow.postMessage(
        {
          type: "PLUGIN_RUN",
          pluginCode,
          messages,
          variables: { ...variables },
          pluginDbData: { ...pluginDb },
          requestId,
        },
        PAGE_ORIGIN
      );
    });
  }

  /**
   * Sync plugin database state back to ISOLATED world for persistence.
   */
  function syncState() {
    window.postMessage(
      {
        type: "PLUGIN_DB_SYNC",
        pluginDbState: pluginDb,
        variables,
      },
      PAGE_ORIGIN
    );
  }

  // --- Communication with ISOLATED world bridge ---

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== PAGE_ORIGIN && event.origin !== location.origin) return;

    if (event.data.type === "PLUGIN_DATA") {
      plugins = Array.isArray(event.data.plugins) ? event.data.plugins : [];
      pluginDb = event.data.pluginDb || {};
      variables = event.data.variables || {};
    }
  });

  // Request plugin data on load
  setTimeout(() => {
    window.postMessage({ type: "PLUGIN_REQUEST" }, PAGE_ORIGIN);
  }, 100);

  // --- Fetch interceptor integration ---

  // Store reference to the original fetch after Grimoire's inject.js wraps it
  // (plugin-main.js loads AFTER inject.js in manifest, so window.fetch is already wrapped)
  // We need to wrap it AGAIN for plugin processing.
  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    let [resource, init] = args;

    // Normalize to get URL
    let url = "";
    let isRequestObject = false;

    if (typeof resource === "string") {
      url = resource;
    } else if (resource instanceof Request) {
      isRequestObject = true;
      url = resource.url;
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
        };
      }
    }

    // Only process chat/completions POST requests
    const isChatCompletions = /\/chat\/completions(\?.*)?(#.*)?$/.test(url);
    const isPost = init && init.method && init.method.toUpperCase() === "POST";

    // Check if plugins exist and are enabled
    const enabledPlugins = plugins.filter((p) => p.enabled && p.code);
    const shouldRunPlugins = isChatCompletions && isPost && enabledPlugins.length > 0;

    if (shouldRunPlugins) {
      try {
        // Read the body
        let bodyStr = "";

        if (init.body !== undefined && init.body !== null) {
          if (typeof init.body === "string") {
            bodyStr = init.body;
          } else if (init.body instanceof Blob) {
            bodyStr = await init.body.text();
          } else if (init.body instanceof ArrayBuffer) {
            bodyStr = new TextDecoder().decode(init.body);
          }
        } else if (isRequestObject && resource.body) {
          const reqClone = resource.clone();
          bodyStr = await reqClone.text();
        }

        if (bodyStr) {
          const body = JSON.parse(bodyStr);

          if (body.messages && Array.isArray(body.messages) && body.messages.length > 0) {
            // Find the last user message (the one being sent right now)
            let lastUserMsg = null;
            for (let i = body.messages.length - 1; i >= 0; i--) {
              if (body.messages[i].role === "user") {
                lastUserMsg = body.messages[i];
                break;
              }
            }

            const userMessage = lastUserMsg
              ? (typeof lastUserMsg.content === "string"
                  ? lastUserMsg.content
                  : "")
              : "";

            // Run each enabled plugin sequentially
            for (const plugin of enabledPlugins) {
              try {
                const pluginResult = await runPlugin(plugin.code, body.messages);

                // Apply variable changes
                if (pluginResult.variables) {
                  variables = { ...variables, ...pluginResult.variables };
                }

                // Apply message replacements
                for (const replacement of (pluginResult.messageReplacements || [])) {
                  const { find, replace, target } = replacement;
                  for (const msg of body.messages) {
                    if (msg.role === (target || "user") && typeof msg.content === "string") {
                      if (msg.content.includes(find)) {
                        msg.content = msg.content.replace(find, replace);
                      }
                    }
                  }
                }

                // Apply system prompt additions
                for (const addMsg of (pluginResult.systemPromptAdditions || [])) {
                  if (addMsg.role === "system" && addMsg.content) {
                    if (addMsg.append) {
                      // Append to existing system message
                      const sysMsg = body.messages.find((m) => m.role === "system");
                      if (sysMsg && typeof sysMsg.content === "string") {
                        sysMsg.content += "\n" + addMsg.content;
                      } else {
                        body.messages.unshift({ role: "system", content: addMsg.content });
                      }
                    } else {
                      // Insert before the last user message
                      const lastUserIdx = body.messages.findLastIndex(
                        (m) => m.role === "user"
                      );
                      if (lastUserIdx >= 0) {
                        body.messages.splice(lastUserIdx, 0, {
                          role: "system",
                          content: addMsg.content,
                        });
                      } else {
                        body.messages.unshift({ role: "system", content: addMsg.content });
                      }
                    }
                  }
                }

                // Update plugin db
                if (pluginResult.pluginDbState) {
                  pluginDb = { ...pluginDb, ...pluginResult.pluginDbState };
                }
              } catch (err) {
                console.warn(
                  `[Grimoire] Plugin "${plugin.name}" failed:`,
                  err.message
                );
                // Continue with next plugin on error
              }
            }

            // Sync state back to storage
            syncState();

            // Re-serialize the modified body
            init.body = JSON.stringify(body);
          }
        }
      } catch (err) {
        console.warn("[Grimoire] Plugin processing error (passing through):", err);
      }
    }

    // Pass through to original fetch (which may be inject.js's wrapper, which does lorebook injection)
    if (isRequestObject) {
      return originalFetch(url, init);
    }
    return originalFetch.apply(this, args);
  };

  console.log("[Grimoire] Plugin engine ready (MAIN).");
})();
