/**
 * lorebook.js - Shared lorebook logic
 *
 * Provides matching, injection formatting, and SillyTavern import parsing.
 * Used by the side panel UI and embeddable in other contexts.
 *
 * Entry format (SillyTavern-compatible subset):
 * {
 *   "uid": 1,
 *   "key": ["keyword1", "keyword2"],
 *   "keysecondary": [],
 *   "comment": "entry description/label",
 *   "content": "lorebook content to inject",
 *   "constant": false,
 *   "selective": true,
 *   "selectiveLogic": 0,
 *   "order": 100,
 *   "position": 0,
 *   "disable": false,
 *   "probability": 100,
 *   "useProbability": true
 * }
 *
 * Safety limits:
 * - Max 1000 entries per lorebook
 * - Max 50KB per entry content
 */

// --- Validation constants ---

const MAX_ENTRIES = 1000;
const MAX_CONTENT_LENGTH = 50 * 1024; // 50KB per entry content

const Lorebook = {
  /**
   * Validate a single entry object.
   * Ensures required fields exist with correct types.
   * @param {object} entry - Entry to validate
   * @returns {boolean} True if entry has valid shape
   */
  isValidEntry(entry) {
    if (!entry || typeof entry !== "object") return false;
    // content must be a non-empty string
    if (typeof entry.content !== "string" || entry.content.length === 0) return false;
    // key must be an array
    if (!Array.isArray(entry.key)) return false;
    // Enforce content length cap
    if (entry.content.length > MAX_CONTENT_LENGTH) return false;
    return true;
  },

  /**
   * Sanitize and validate an array of entries.
   * Removes malformed entries and enforces caps.
   * @param {Array} entries - Raw entry array
   * @returns {Array} Clean, validated entries
   */
  validateEntries(entries) {
    if (!Array.isArray(entries)) return [];

    return entries
      .filter((entry) => this.isValidEntry(entry))
      .slice(0, MAX_ENTRIES); // Cap total entries
  },

  /**
   * Match entries against conversation text.
   * Returns entries that should be injected, sorted by order (ascending).
   *
   * @param {Array} entries - Lorebook entry objects
   * @param {string} conversationText - Recent conversation text for keyword scanning
   * @returns {Array} Matched entries in injection order
   */
  matchEntries(entries, conversationText) {
    if (!entries || !Array.isArray(entries)) return [];

    const textLower = (conversationText || "").toLowerCase();

    return entries
      .filter((entry) => !entry.disable)
      .filter((entry) => {
        // Constant entries always inject
        if (entry.constant) return true;

        // Selective entries: check if any primary keyword matches
        if (entry.selective && Array.isArray(entry.key) && entry.key.length > 0) {
          return entry.key.some(
            (k) => k && k.trim() && textLower.includes(k.trim().toLowerCase())
          );
        }

        // Non-constant, non-selective => treat as constant (ST default behavior)
        return !entry.selective;
      })
      .sort((a, b) => (a.order || 100) - (b.order || 100));
  },

  /**
   * Build formatted injection text from matched entries.
   * Each entry is wrapped with its label as a bracket header.
   *
   * @param {Array} matchedEntries - Entries to format
   * @returns {string} Formatted text for injection
   */
  buildInjectionText(matchedEntries) {
    if (!matchedEntries || matchedEntries.length === 0) return "";

    return matchedEntries
      .map((entry) => {
        const label = entry.comment || "Untitled";
        return `[${label}]\n${entry.content || ""}`;
      })
      .join("\n\n");
  },

  /**
   * Build the full lorebook block including XML-style tags.
   *
   * @param {Array} matchedEntries - Entries to inject
   * @returns {string} Full injection block or empty string if no entries
   */
  buildInjectionBlock(matchedEntries) {
    const text = this.buildInjectionText(matchedEntries);
    if (!text) return "";
    return `\n<lorebook>\n${text}\n</lorebook>`;
  },

  /**
   * Parse a SillyTavern lorebook JSON (or array of entries).
   * Handles both {entries: {...}} object format and plain arrays.
   * Normalizes entries to ensure all expected fields exist.
   * Validates and caps entries for safety (W2 fix).
   *
   * @param {string|object} json - ST lorebook JSON string or parsed object
   * @returns {Array} Normalized, validated entry array
   */
  parseSTFormat(json) {
    let data = json;
    if (typeof json === "string") {
      data = JSON.parse(json);
    }

    let entries = [];

    // SillyTavern format: { entries: { "0": {...}, "1": {...} } }
    if (data && data.entries && typeof data.entries === "object" && !Array.isArray(data.entries)) {
      entries = Object.values(data.entries);
    }
    // Array format
    else if (Array.isArray(data)) {
      entries = data;
    }
    // Single entry object
    else if (data && (data.uid !== undefined || data.key !== undefined)) {
      entries = [data];
    } else {
      entries = [];
    }

    // Normalize each entry with defaults
    let normalized = entries.map((entry, idx) => ({
      // M5 fix: Force uid to be a number to prevent HTML injection / NaN issues
      uid: typeof entry.uid === "number"
        ? entry.uid
        : (parseInt(entry.uid, 10) || (idx + 1)),
      key: Array.isArray(entry.key) ? entry.key : [],
      keysecondary: Array.isArray(entry.keysecondary) ? entry.keysecondary : [],
      comment: typeof entry.comment === "string" ? entry.comment : "",
      content: typeof entry.content === "string" ? entry.content : "",
      constant: Boolean(entry.constant),
      selective: Boolean(entry.selective),
      selectiveLogic: entry.selectiveLogic ?? 0,
      order: typeof entry.order === "number" ? entry.order : 100,
      position: entry.position ?? 0,
      disable: Boolean(entry.disable),
      probability: entry.probability ?? 100,
      useProbability: entry.useProbability !== false,
    }));

    // Validate: filter out entries with empty content or invalid shape
    normalized = this.validateEntries(normalized);

    return normalized;
  },

  /**
   * Create a new blank entry with sensible defaults.
   *
   * @param {number} uid - Optional UID (auto-assigned if omitted)
   * @returns {object} New entry
   */
  createEntry(uid) {
    return {
      uid: uid || Date.now(),
      key: [],
      keysecondary: [],
      comment: "",
      content: "",
      constant: false,
      selective: true,
      selectiveLogic: 0,
      order: 100,
      position: 0,
      disable: false,
      probability: 100,
      useProbability: true,
    };
  },

  /**
   * Export entries to SillyTavern-compatible format.
   *
   * @param {Array} entries - Entry array
   * @returns {object} ST-format lorebook object
   */
  exportSTFormat(entries) {
    const entriesObj = {};
    entries.forEach((entry, idx) => {
      entriesObj[String(idx)] = { ...entry };
    });

    return {
      entries: entriesObj,
    };
  },
};

// Export for different module systems
if (typeof module !== "undefined" && module.exports) {
  module.exports = Lorebook;
}
if (typeof window !== "undefined") {
  window.Lorebook = Lorebook;
}
