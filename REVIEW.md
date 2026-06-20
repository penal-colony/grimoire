# Janitor Lorebook — Code Review

## Executive Summary

The extension is cleanly structured and well-organized. However, there are **two critical issues** that would prevent it from working in production, plus several security concerns around the `postMessage` bridge and a handful of MV3/edge-case problems. Overall assessment: **promising but needs fixes before deployment.**

---

## Issues Found

### 🔴 CRITICAL (blockers)

#### C1. Fetch interceptor uses wrong URL pattern — will miss real JanitorAI requests

**File:** `content/inject.js`, line ~75
**Current code:**
```js
if (url && url.includes("/v1/chat/completions") && init …)
```

**Problem:** JanitorAI's browser client sends requests to the path `/chat/completions` (without `/v1/`), appended to whatever base URL the user configured. For example:
- User configures `https://openrouter.ai/api` → request goes to `https://openrouter.ai/api/chat/completions`
- User configures `https://openrouter.ai/api/v1` → request goes to `https://openrouter.ai/api/v1/chat/completions`
- User configures `https://api.openai.com/v1` → request goes to `https://api.openai.com/v1/chat/completions`

The current pattern `url.includes("/v1/chat/completions")` would match only the third case and some coincidental matches of the second case. It would **miss** anyone whose proxy URL doesn't already contain `/v1/`.

**Fix:** Match `/chat/completions` (the common suffix) instead:
```js
if (url && url.includes("/chat/completions") && init && init.method …)
```
Better yet, use a regex that matches at a URL path boundary:
```js
if (url && /\/chat\/completions(\?.*)?(#.*)?$/.test(url) && init …)
```
This avoids false positives on URLs like `https://docs.example.com/chat/completions-guide`.

---

#### C2. `Request` body reconstruction is broken — sends `undefined` body

**File:** `content/inject.js`, lines ~82–96
**Current code:**
```js
if (resource instanceof Request) {
    url = resource.url;
    if (!init) {
        init = {
            method: resource.method,
            headers: resource.headers,
            body: resource.body,
            …
        };
    }
}
```

Later:
```js
if (typeof init.body === "string") {
    bodyStr = init.body;
} else if (init.body instanceof Blob) {
    bodyStr = await init.body.text();
} …
```

Then after modification:
```js
init.body = JSON.stringify(body);
```

And the call:
```js
return originalFetch.apply(this, args);
```

**Problem 1:** When `resource` is a `Request`, the args are `[resource, init]`. The modifier changes `init.body` but calls `originalFetch.apply(this, args)` where `args` is still the original array. However, `args[1]` is a reference to the same `init` object, so `init.body` would update in `args` — this part is actually fine because objects are references.

**Problem 2 (the real bug):** If the incoming `init` is omitted completely (i.e., `fetch(resource)` where `resource` is a `Request`), then `args` is `[resource]` (length 1). When the code creates `init` from the Request and sets `init.body`, it does so on a new local `init` variable. But `args` still has only one element: `[resource]`. The `originalFetch.apply(this, args)` call passes one argument, which means the modified body is **lost** — the `Request` object's body isn't being passed through as a second argument.

Wait — actually, when `fetch()` receives a `Request` object and no init, the body is read from the Request itself. So `init.body` in the reconstructed object IS the original body. The issue is subtler: after parsing and modifying, the code writes `init.body = JSON.stringify(body)`, but then calls `originalFetch.apply(this, args)`. If args was `[resource]` (no init), the reconstructed init object **is not passed** to the original fetch.

The absolute fix:
```js
// At the end, before calling originalFetch:
if (resource instanceof Request && args.length === 1) {
    // We constructed init ourselves; pass it explicitly
    return originalFetch(resource.url, init);
}
return originalFetch.apply(this, args);
```

**Problem 3:** After reading the body from `init.body` (which consumed the ReadableStream if present), if the Request had a ReadableStream body, this code would fail entirely because it doesn't handle `ReadableStream` bodies — only string, Blob, and ArrayBuffer. JanitorAI likely sends a string body, but this is still fragile.

---

### 🟠 WARNING (should fix)

#### W1. postMessage origin is wildcard `"*"` — both directions

**Files:** `content/content.js` and `content/inject.js`
**Current code in content.js:**
```js
window.postMessage({ type: "LOREBOOK_DATA", … }, "*");
```
**Current code in inject.js:**
```js
window.postMessage({ type: "LOREBOOK_REQUEST" }, "*");
```

**Problem:** Any page or iframe on the same origin can send forged messages. The inject.js listener already checks `event.source !== window`, which is good, but a malicious script on the page could still forge a message with the same `source` reference by scripting within the same window. Since the extension injects into `janitorai.com`, and JanitorAI runs user-submitted character code, a malicious character could:

1. Send `{ type: "LOREBOOK_DATA", entries: [{…malicious content…}], enabled: true }` to poison the lorebook cache with malicious lorebook entries (which the extension would then inject into the system prompt, potentially modifying model behavior).
2. Send `{ type: "LOREBOOK_DATA", entries: [], enabled: false }` to disable lorebook injection.

**Fix:** Use a secret nonce or origin verification. Since both scripts run in the same page, the simplest approach is a shared secret:
```js
// In both inject.js and content.js:
const LOREBOOK_SECRET = "janitor-lorebook-v1";

// Sender:
window.postMessage({ type: "LOREBOOK_DATA", secret: LOREBOOK_SECRET, … }, "*");

// Receiver:
if (event.data.type === "LOREBOOK_DATA" && event.data.secret === LOREBOOK_SECRET) { … }
```

This isn't cryptographically secure (a page script can read the extension's injected code), but it raises the bar significantly. For true security, use `chrome.runtime.sendMessage` from inject.js to background, then back down.

**Alternative:** Use `CustomEvent` instead of `postMessage` — only scripts in the same world can listen. But that breaks the ISOLATED↔MAIN world bridge.

**Severity note:** The practical risk is moderate. A malicious character card has full control of the page JS, so it could do worse things than mess with lorebook entries. But this is still a supply-chain-style attack vector worth addressing.

#### W2. No validation of entry data from storage

**File:** `content/content.js`, `content/inject.js`

**Problem:** When `content.js` reads from `chrome.storage.local`, it trusts the data completely. If somehow corrupted data (e.g., `entries` is not an array) gets into storage, `inject.js` will try to call `.filter()` on non-array data and crash the fetch interceptor. Because the crash is caught by try/catch, the request passes through unmodified — but the interceptor is now a permanent no-op for the rest of the page session.

**Fix:** Add validation in `content.js` before sending:
```js
const entries = Array.isArray(result.lorebookEntries) ? result.lorebookEntries : [];
```

And in inject.js, validate on receipt:
```js
if (!Array.isArray(event.data.entries)) {
    console.warn("[Janitor Lorebook] Invalid entries data received");
    return;
}
```

#### W3. `position` field is normalized in `parseSTFormat` but never used in matching

**File:** `lib/lorebook.js` (normalized) vs `content/inject.js` (inline matcher)

**Problem:** The SillyTavern `position` field defines *where* in the context the entry gets injected (before character, after character, at depth, etc.). The extension ignores this and always prepends/appends to the system message. This means imported entries with `position: 1` (after character definition) won't work as expected.

**Severity:** Low-medium. Users coming from ST may be confused when their carefully-positioned lorebooks behave differently.

**Fix:** At minimum, document this limitation. If you want to support it, you'd need to insert entries at different points in the `messages` array (after system, before last user, etc.).

#### W4. `keysecondary` is completely ignored

**File:** `lib/lorebook.js` (normalized but unused), `content/inject.js` (inline matcher)

**Problem:** SillyTavern supports `keysecondary` as a secondary keyword list with AND/NOT logic via `selectiveLogic`. The extension's matcher only checks `entry.key`. Entries that rely on secondary keys for triggering will never match.

**Severity:** Medium for users importing ST lorebooks that use secondary keys.

#### W5. Duplicate matcher logic — DRY violation

**File:** `content/inject.js` (inline `matchEntries` and `buildInjectionText` functions) and `lib/lorebook.js` (Lorebook.matchEntries and Lorebook.buildInjectionText)

**Problem:** The inject script duplicates the matching logic instead of using the shared `lib/lorebook.js`. This means:
- Bug fixes to the matcher must be applied in two places
- The lorebook.js library exists but isn't loaded in the MAIN world
- The inject.js version has a subtle behavioral difference: it does `entry.key.some(k => k && textLower.includes(k.toLowerCase()))` while lorebook.js does `entry.key.some(k => k && k.trim() && textLower.includes(k.trim().toLowerCase()))`. The inject.js version doesn't trim keywords! A keyword of `" "` (space) would be treated as truthy in inject.js but filtered out in lorebook.js.

**Fix:** Since `lib/lorebook.js` is already set up with dual CJS/window export, load it in inject.js as well:
```json
// In manifest.json, change inject.js content_script to:
{
    "matches": ["https://janitorai.com/*"],
    "js": ["lib/lorebook.js", "content/inject.js"],
    "run_at": "document_start",
    "world": "MAIN"
}
```
Then remove the duplicate functions from inject.js.

---

### 🟡 MINOR (should fix)

#### M1. SVG icon — Chrome may reject it

**Files:** `manifest.json`, `icons/icon.svg`

**Problem:** Chrome requires PNG icons for the toolbar/action. SVG support for extension icons is inconsistent across Chrome versions and often results in a blank icon or fallback letter. The manifest lists SVG for all icon sizes.

**Fix:** Provide actual PNG icons at 16, 48, and 128px. Keep the SVG for source/reference. At minimum, add a fallback:
```json
"action": {
    "default_icon": {
        "16": "icons/icon-16.png",
        "48": "icons/icon-48.png",
        "128": "icons/icon-128.png"
    }
}
```

#### M2. `host_permissions` pattern too narrow

**File:** `manifest.json`
```json
"host_permissions": ["https://janitorai.com/*"]
```

**Problem:** JanitorAI users may access the site at `www.janitorai.com`, `janitorai.com`, `beta.janitorai.com`, or a custom deployment. The current pattern matches `janitorai.com/*` but not `www.janitorai.com/*`.

**Fix:** Include the www subdomain:
```json
"host_permissions": [
    "https://janitorai.com/*",
    "https://www.janitorai.com/*"
]
```

#### M3. `activeTab` + `scripting` permissions unused

**File:** `manifest.json`

**Problem:** The manifest requests `activeTab` and `scripting` permissions but they are never used. Chrome Web Store review may reject the extension for requesting unnecessary permissions.

**Fix:** Remove them.

#### M4. `content_security_policy` not defined — unsafe if sidepanel loads external resources

**File:** `manifest.json`

**Problem:** The side panel loads `sidepanel.js` and `lib/lorebook.js` from the extension bundle. Currently safe. But without an explicit CSP, future changes could introduce an XSS vector. Also, extensions that use `innerHTML` (as this one does in `render()`) should declare a CSP to reassure reviewers.

**Fix:** Add:
```json
"content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
}
```

#### M5. `innerHTML` usage in sidepanel render — potential XSS (currently mitigated)

**File:** `sidepanel/sidepanel.js`, `render()` function

**Problem:** The code builds HTML strings and assigns to `innerHTML`. It does escape keyword text and labels with `escapeHtml()`, which is good. However, the `entry.uid` is interpolated into `data-uid="${entry.uid}"` without escaping. While `uid` should always be a number (assigned by `Date.now()` or `parseSTFormat`), imported entries could have string UIDs that contain `"` or other HTML-breaking characters. Also, `data-uid` in the event handler is cast with `Number(e.target.dataset.uid)` which would return `NaN` for non-numeric UIDs — breaking the edit/delete flow silently.

**Fix:** In `parseSTFormat`, force `uid` to be a number:
```js
uid: typeof entry.uid === 'number' ? entry.uid : (parseInt(entry.uid, 10) || (idx + 1))
```

#### M6. Empty lorebook entries produce silent no-op, but metadata still injected

**File:** `content/inject.js`

**Problem:** When `cachedEntries` is empty, the fetch interceptor still runs the body parsing, JSON.parse, and message extraction — it just skips the injection. This is wasteful on every chat message.

**Fix:** Move the empty-entries check earlier:
```js
if (!lorebookEnabled || cachedEntries.length === 0) {
    return originalFetch.apply(this, args);
}
```

#### M7. Race condition: initial `sendLorebookData()` may fire before fetch interceptor is installed

**File:** `content/content.js`, `content/inject.js`

**Problem:** `content.js` calls `sendLorebookData()` on load (which calls `chrome.storage.local.get` and then `postMessage`). `inject.js` also requests entries immediately with `postMessage`. Both scripts have `run_at: "document_start"`, so they load near-simultaneously. If `content.js` sends data before `inject.js`'s event listener is registered, the first message is lost. The inject.js fallback is `postMessage` for `LOREBOOK_REQUEST`, but that creates a second round-trip (page → isolated → storage → isolated → page).

**Current flow:**
1. content.js loads → calls `sendLorebookData()` → maybe sends before inject.js is ready
2. inject.js loads → sends `LOREBOOK_REQUEST` → content.js responds → data arrives
3. Page's first `fetch()` might fire before step 2 completes

**Impact:** The very first chat message sent after page load might not get lorebook injection because entries haven't arrived yet.

**Fix:** In inject.js, wait for entries before letting the first fetch through. Or use a `requestAnimationFrame`/microtask to ensure the listener is registered before content.js sends. The simplest fix: have content.js send on a `setTimeout(…, 0)` to give inject.js time to set up.

#### M8. No debounce/throttle on storage change push

**File:** `content/content.js`

**Problem:** When the user rapidly edits entries in the sidepanel, each save triggers `chrome.storage.onChanged`, which calls `sendLorebookData()` → `chrome.storage.local.get()` → `postMessage`. Rapid edits cause a burst of storage reads and message posts, potentially causing jank.

**Fix:** Debounce the handler by ~100ms.

#### M9. `masterToggle` defaults to true, but first-time users have no entries

**File:** `sidepanel/sidepanel.js`, `content/content.js`

**Problem:** `lorebookEnabled` defaults to `true`. A new user installs the extension with zero entries, and the fetch interceptor runs on every chat message (parsing body, scanning messages) for nothing. See M6 — same fix applies.

#### M10. `btnExport` creates a temporary anchor element — clean but fragile

**File:** `sidepanel/sidepanel.js`, `handleExport()`

**Problem:** The export function creates an `<a>` element, appends it to `document.body`, clicks it, then removes it. In a sidepanel context this works, but it's marginally cleaner to use `chrome.downloads.download()` with a data URL for better UX (native save dialog) and reliability. Not a bug, just a note.

---

### 🔵 EDGE CASES (things to consider)

#### E1. Streaming responses — handled correctly

**File:** `content/inject.js`

The interceptor only modifies the request body. Streaming responses are raw `Response` objects from the original fetch, passed through untouched. No issues here. ✅

#### E2. JSON parse failure in interceptor — handled correctly

**File:** `content/inject.js`

The try/catch around the entire injection logic silently passes the request through on any error. This is the correct behavior for a non-critical injection. ✅

#### E3. What if the system message is not at `messages[0]`?

**File:** `content/inject.js`, line: `const sysMsg = body.messages[0];`

**Problem:** OpenAI API spec requires the system message to be at index 0, but JanitorAI might restructure messages. The code checks `sysMsg.role === "system"`, so it won't inject into a user message. But it could miss the system message if it's at a different position.

**Fix:** Find the system message by role:
```js
const sysMsg = body.messages.find(m => m.role === "system");
if (sysMsg) { … }
```

#### E4. What if `body.messages` contains content arrays (multimodal)?

**Problem:** The conversation text extraction assumes `m.content` is always a string: `typeof m.content === "string" ? m.content : ""`. With multimodal models (images), content can be an array of `{type, text|image_url}` objects. The extraction would yield empty strings for image-only messages.

**Fix:** Handle content arrays:
```js
const conversationText = recentMessages
    .map(m => {
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content)) return m.content
            .filter(p => p.type === "text")
            .map(p => p.text)
            .join(" ");
        return "";
    })
    .join(" ");
```

#### E5. What if the request body is a `ReadableStream`?

**Problem:** The code handles string, Blob, and ArrayBuffer bodies but not `ReadableStream`. If JanitorAI ever streams the request body (unlikely for a POST body, but possible with `fetch()` duplex mode), the code would silently skip injection.

**Severity:** Very low. POST bodies are typically strings. But add a comment noting the limitation.

---

## SillyTavern Format Compatibility Analysis

### What matches well ✅
- Entry format uses all correct field names (`uid`, `key`, `keysecondary`, `comment`, `content`, `constant`, `selective`, `selectiveLogic`, `order`, `position`, `disable`, `probability`, `useProbability`)
- Import parses both `{entries: {}}` object format and raw arrays
- Export produces the exact `{entries: {}}` format with string-number keys
- Default values are sensible

### What's missing / different ❌
1. **`keysecondary` not used** in matching (W4 above)
2. **`position` field ignored** (W3 above) — ST places entries at different depths
3. **Missing ST fields in normalization:** The gist shows these additional fields that ST lorebooks may contain and that the extension doesn't handle:
   - `addMemo` (boolean)
   - `excludeRecursion` (boolean)
   - `preventRecursion` (boolean)
   - `depth` (number — scan depth override)
   - `group` (string — grouping)
   - `scanDepth` (number)
   - `caseSensitive` (boolean)
   - `matchWholeWords` (boolean)
   - `displayIndex` (number)
   These are silently lost on import/re-export.
4. **`selectiveLogic` not implemented** — SillyTavern supports AND/NOT logic for keyword combinations. The extension always uses OR logic (any keyword matches).
5. **`useProbability` not implemented** — ST supports randomization: "50% chance this entry fires." The extension ignores probability.
6. **No recursion support** — ST entries can trigger other entries via keywords found in injected content. The extension only does one-pass matching against conversation text.

**Verdict on ST compatibility:** The extension handles the core format correctly for simple lorebooks (keyword-triggered or constant entries). It will successfully import and export lorebooks, but imported entries will lose advanced features (probability, positioning, secondary keys, recursion) on a round-trip through the extension. This is a reasonable tradeoff for an MVP but should be documented.

---

## Summary Table

| # | Severity | File | Issue |
|---|----------|------|-------|
| C1 | Critical | inject.js:75 | URL pattern `/v1/chat/completions` won't match JanitorAI's actual requests |
| C2 | Critical | inject.js:82-96 | Reconstructed `init` not passed to original fetch when no init arg |
| W1 | Warning | content.js, inject.js | postMessage with `"*"` target, no origin/secret validation |
| W2 | Warning | content.js, inject.js | No validation of entry data shape from storage |
| W3 | Warning | lorebook.js, inject.js | `position` field normalized but never used |
| W4 | Warning | lorebook.js, inject.js | `keysecondary` completely ignored in matching |
| W5 | Warning | inject.js vs lorebook.js | Duplicate matcher with subtle keyword-trimming difference |
| M1 | Minor | manifest.json, icons/ | SVG as action icon may not render in Chrome |
| M2 | Minor | manifest.json | host_permissions missing `www.janitorai.com` |
| M3 | Minor | manifest.json | Unused `activeTab` and `scripting` permissions |
| M4 | Minor | manifest.json | Missing content_security_policy |
| M5 | Minor | sidepanel.js, lorebook.js | String UIDs from import can break rendering |
| M6 | Minor | inject.js | Empty entries still trigger full body parsing |
| M7 | Minor | content.js, inject.js | Race condition on initial data delivery |
| M8 | Minor | content.js | No debounce on storage change handler |
| M9 | Minor | sidepanel.js | Master toggle defaults true with no entries |
| M10 | Minor | sidepanel.js | Export uses temporary DOM element |

---

## Recommended Fix Priority

1. **Fix C1 and C2 immediately** — the extension doesn't work without these.
2. **Fix W1** — the postMessage security issue is the most impactful non-blocking fix.
3. **Fix W2 and M7** — data validation and race condition could cause silent failures.
4. **Fix W5, M6** — performance and maintainability improvements.
5. **Address M1-M5, M8-M10** — polish for Chrome Web Store readiness.
6. **Document ST limitations** (W3, W4) as known scope reductions.

---

## Overall Assessment

The code is well-structured: separate concerns between worlds, clean shared library, and a functional side panel UI. The fetch interception pattern is correct for MV3. However, the **URL matching bug (C1)** means the extension simply won't work against real JanitorAI traffic, and the **Request body reconstruction bug (C2)** causes data loss in edge cases. Once these are fixed, the extension should function correctly for its intended use case with simple lorebooks.

**Grade: B-** (architecture) / **D** (production readiness, due to blockers)
