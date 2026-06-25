/*
 * Grimoire - Plugin sandbox runner
 * Copyright (C) 2026 Ash <ash@ashisgreat.xyz>
 *
 * License: GPL v3
 */

/**
 * plugin-runner.js - Runs inside a sandboxed iframe
 *
 * This script has zero access to:
 * - chrome.* extension APIs
 * - window.fetch / XMLHttpRequest
 * - DOM (the page is empty)
 * - localStorage / sessionStorage
 * - The parent page's context
 *
 * Communication is strictly postMessage: code in, result out.
 * User plugins run via new Function() with a limited API.
 */

(function () {
  "use strict";

  const PLUGIN_ORIGIN = "https://janitorai.com";

  // Per-plugin-session database (Map, not persisted here — parent handles persistence)
  const pluginDb = new Map();

  // Track system prompt additions and message replacements as return metadata
  let systemPromptAdditions = [];
  let messageReplacements = [];
  let variableChanges = {};

  window.addEventListener("message", (event) => {
    // Validate origin
    if (event.origin !== PLUGIN_ORIGIN && event.origin !== location.origin) return;
    if (!event.data || event.data.type !== "PLUGIN_RUN") return;

    const {
      pluginCode,
      messages,
      variables,
      pluginDbData,
      requestId,
    } = event.data;

    // Reset accumulators for this run
    systemPromptAdditions = [];
    messageReplacements = [];
    variableChanges = {};

    // Restore persisted plugin database from parent
    if (pluginDbData && typeof pluginDbData === "object") {
      pluginDb.clear();
      for (const [k, v] of Object.entries(pluginDbData)) {
        pluginDb.set(k, v);
      }
    }

    // Build the sandboxed API object exposed to user plugins
    const api = {
      // Variable management (read/write plugin-scoped variables)
      getVariable(name) {
        return variables[name];
      },
      setVariable(name, value, operation) {
        const oldVal = variables[name] || 0;
        let newVal;
        switch (operation) {
          case "plus":  newVal = oldVal + value; break;
          case "minus": newVal = oldVal - value; break;
          case "set":   newVal = value; break;
          default:      newVal = value; break;
        }
        variables[name] = newVal;
        variableChanges[name] = { old: oldVal, new: newVal, operation };
      },

      // Plugin database (persisted between runs by parent)
      db: {
        get(key) { return pluginDb.get(key); },
        set(key, value) { pluginDb.set(key, value); },
        delete(key) { return pluginDb.delete(key); },
        has(key) { return pluginDb.has(key); },
        keys() { return [...pluginDb.keys()]; },
        values() { return [...pluginDb.values()]; },
        entries() { return [...pluginDb.entries()]; },
        clear() { pluginDb.clear(); },
        size() { return pluginDb.size; },
      },

      // Message manipulation
      addMessage(msg) {
        // msg: { role: "system"|"assistant"|"user", content: string, append?: boolean }
        systemPromptAdditions.push(msg);
      },

      replaceMessage(opts) {
        // opts: { find: string, replace: string, target: "user"|"assistant"|"system" }
        messageReplacements.push(opts);
      },
    };

    try {
      // Execute user's plugin code.
      // The plugin code is a function declaration: function processMessage(messages, api) { ... }
      // We wrap it to define the function and then call it, returning its result.
      const wrapperCode = pluginCode + "\nreturn processMessage(messages, api);";
      const fn = new Function("messages", "api", wrapperCode);
      const result = fn(messages, api);

      // Send result back to parent
      event.source.postMessage(
        {
          type: "PLUGIN_RESULT",
          requestId,
          result,                     // whatever the plugin returns (usually messages)
          variables,                  // updated variables
          variableChanges,            // delta for logging
          systemPromptAdditions,      // system messages to inject
          messageReplacements,        // text replacements to apply
          pluginDbState: Object.fromEntries(pluginDb),  // serialized for persistence
          error: null,
        },
        event.origin
      );
    } catch (err) {
      // Plugin threw an error — report back
      event.source.postMessage(
        {
          type: "PLUGIN_RESULT",
          requestId,
          result: null,
          variables,
          variableChanges: {},
          systemPromptAdditions: [],
          messageReplacements: [],
          pluginDbState: Object.fromEntries(pluginDb),
          error: err.message || String(err),
        },
        event.origin
      );
    }
  });

  console.log("[Grimoire] Plugin sandbox runner ready.");
})();
