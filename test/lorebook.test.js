/**
 * test/lorebook.test.js - Tests for lib/lorebook.js
 *
 * Run with: node lib/lorebook.js && node test/lorebook.test.js
 * Or: node -e "require('./lib/lorebook.js'); require('./test/lorebook.test.js')"
 */

const Lorebook = require("../lib/lorebook.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log("  PASS: " + message);
    passed++;
  } else {
    console.log("  FAIL: " + message);
    failed++;
  }
}

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${message} (got: ${a}, expected: ${e})`);
}

console.log("\n=== Lorebook Tests ===\n");

// --- parseSTFormat tests ---

console.log("parseSTFormat:");

// Test 1: SillyTavern object format
const stFormat = {
  entries: {
    "0": { uid: 1, key: ["elf"], content: "Elves are tall.", comment: "Elves" },
    "1": { uid: 2, key: ["dwarf"], content: "Dwarves are short.", comment: "Dwarves" },
  },
};
const parsed1 = Lorebook.parseSTFormat(stFormat);
assert(parsed1.length === 2, "ST object format: parses 2 entries");
assert(parsed1[0].key[0] === "elf", "ST object format: first entry key is 'elf'");
assert(parsed1[1].content === "Dwarves are short.", "ST object format: second entry content correct");

// Test 2: Array format
const arrFormat = [
  { key: ["sword"], content: "Swords are sharp." },
  { key: ["shield"], content: "Shields are sturdy." },
];
const parsed2 = Lorebook.parseSTFormat(arrFormat);
assert(parsed2.length === 2, "Array format: parses 2 entries");

// Test 3: String JSON input
const parsed3 = Lorebook.parseSTFormat(JSON.stringify(stFormat));
assert(parsed3.length === 2, "String JSON input: parses 2 entries");

// Test 4: Empty/invalid input
assertDeepEqual(Lorebook.parseSTFormat({}), [], "Empty object: returns empty array");
assertDeepEqual(Lorebook.parseSTFormat({ entries: {} }), [], "Empty entries object: returns empty array");
assertDeepEqual(Lorebook.parseSTFormat([]), [], "Empty array: returns empty array");

// Test 5: Normalization fills defaults
const minimalEntry = [{ content: "test content" }];
const parsed5 = Lorebook.parseSTFormat(minimalEntry);
assert(parsed5.length === 1, "Minimal entry: parsed");
assert(parsed5[0].constant === false, "Minimal entry: constant defaults to false");
assert(parsed5[0].selective === false, "Minimal entry: selective defaults to false (no selective field)");
assert(parsed5[0].order === 100, "Minimal entry: order defaults to 100");
assert(parsed5[0].disable === false, "Minimal entry: disable defaults to false");
assert(Array.isArray(parsed5[0].key), "Minimal entry: key defaults to array");
assert(parsed5[0].key.length === 0, "Minimal entry: key is empty array");

// --- Input validation tests (Fix #4) ---

console.log("\nInput validation (fix #4):");

// Test 6: Entries with empty content are filtered out
const withEmpty = [
  { key: ["a"], content: "valid" },
  { key: ["b"], content: "" },
  { key: ["c"] }, // no content field
  { key: ["d"], content: "also valid" },
];
const parsed6 = Lorebook.parseSTFormat(withEmpty);
assert(parsed6.length === 2, "Entries with empty/missing content are filtered out");

// Test 7: Entries with non-array key get normalized to empty array (still valid)
// parseSTFormat normalizes key to [] if it's not an array, so these entries survive
const withBadKey = [
  { key: "string-key", content: "valid" }, // key normalized to [] -> valid
  { key: ["array"], content: "valid" },     // correct
  { content: "no key field" },              // no key -> defaults to [] -> valid
];
const parsed7 = Lorebook.parseSTFormat(withBadKey);
assert(parsed7.length === 3, "Entries with non-array key are normalized and kept");
assert(Array.isArray(parsed7[0].key) && parsed7[0].key.length === 0, "String key normalized to empty array");

// Test 8: Entry count cap
const manyEntries = [];
for (let i = 0; i < 1200; i++) {
  manyEntries.push({ key: [], content: "entry " + i });
}
const parsed8 = Lorebook.parseSTFormat(manyEntries);
assert(parsed8.length === 1000, "Entry count capped at 1000");

// Test 9: Content length cap
const hugeContent = "x".repeat(60 * 1024); // 60KB, over the 50KB limit
const withHugeContent = [{ key: [], content: hugeContent }];
const parsed9 = Lorebook.parseSTFormat(withHugeContent);
assert(parsed9.length === 0, "Entry with content over 50KB is filtered out");

// Test 10: M5 fix - uid is always numeric
const withStringUid = [{ uid: "42", key: [], content: "test" }];
const parsed10 = Lorebook.parseSTFormat(withStringUid);
assert(parsed10.length === 1, "Entry with string uid is kept");
assert(typeof parsed10[0].uid === "number", "uid is converted to number");
assert(parsed10[0].uid === 42, "string uid '42' becomes number 42");

const withBadUid = [{ uid: "not-a-number", key: [], content: "test" }];
const parsed11 = Lorebook.parseSTFormat(withBadUid);
assert(parsed11.length === 1, "Entry with non-numeric string uid is kept");
assert(typeof parsed11[0].uid === "number", "bad uid becomes fallback number");
assert(parsed11[0].uid === 1, "bad uid falls back to index+1");

// --- matchEntries tests ---

console.log("\nmatchEntries:");

// Test 12: Constant entries always match
const entries12 = [
  { uid: 1, key: [], content: "Always", constant: true, disable: false, selective: false, order: 100 },
];
const matched12 = Lorebook.matchEntries(entries12, "anything");
assert(matched12.length === 1, "Constant entry matches any text");

// Test 13: Selective entries match on keyword
const entries13 = [
  { uid: 1, key: ["dragon"], content: "Dragons!", constant: false, disable: false, selective: true, order: 100 },
];
assert(Lorebook.matchEntries(entries13, "I saw a dragon").length === 1, "Selective entry matches keyword");
assert(Lorebook.matchEntries(entries13, "I saw a cat").length === 0, "Selective entry doesn't match without keyword");

// Test 14: Disabled entries don't match
const entries14 = [
  { uid: 1, key: ["dragon"], content: "Dragons!", constant: true, disable: true, selective: false, order: 100 },
];
assert(Lorebook.matchEntries(entries14, "dragon").length === 0, "Disabled entry doesn't match");

// Test 15: Keyword trimming (W5 fix)
const entries15 = [
  { uid: 1, key: [" dragon "], content: "Trimmed!", constant: false, disable: false, selective: true, order: 100 },
];
assert(Lorebook.matchEntries(entries15, "I saw a dragon").length === 1, "Keywords are trimmed before matching");

// Test 16: Case insensitive matching
const entries16 = [
  { uid: 1, key: ["DRAGON"], content: "Dragons!", constant: false, disable: false, selective: true, order: 100 },
];
assert(Lorebook.matchEntries(entries16, "I saw a Dragon").length === 1, "Case insensitive keyword matching");

// Test 17: Order sorting
const entries17 = [
  { uid: 1, key: [], content: "B", constant: true, disable: false, selective: false, order: 200 },
  { uid: 2, key: [], content: "A", constant: true, disable: false, selective: false, order: 100 },
  { uid: 3, key: [], content: "C", constant: true, disable: false, selective: false, order: 50 },
];
const matched17 = Lorebook.matchEntries(entries17, "test");
assert(matched17[0].content === "C", "Entries sorted by order: lowest first (50)");

// Test 18: Invalid input to matchEntries
assertDeepEqual(Lorebook.matchEntries(null, "test"), [], "null entries returns empty");
assertDeepEqual(Lorebook.matchEntries("not an array", "test"), [], "Non-array entries returns empty");
assertDeepEqual(Lorebook.matchEntries([], null), [], "null conversation text returns empty");

// --- buildInjectionText tests ---

console.log("\nbuildInjectionText:");

// Test 19: Basic formatting
const matched19 = [
  { comment: "Elves", content: "Elves are tall." },
  { comment: "Dwarves", content: "Dwarves are short." },
];
const text19 = Lorebook.buildInjectionText(matched19);
assert(text19.includes("[Elves]"), "Injection text includes entry label");
assert(text19.includes("Elves are tall."), "Injection text includes entry content");
assert(text19.includes("[Dwarves]"), "Injection text includes second entry label");

// Test 20: Empty entries
assert(Lorebook.buildInjectionText([]) === "", "Empty matched entries produces empty string");
assert(Lorebook.buildInjectionText(null) === "", "Null matched entries produces empty string");

// Test 21: Entry with no comment uses "Untitled"
const matched21 = [{ comment: "", content: "Some lore" }];
const text21 = Lorebook.buildInjectionText(matched21);
assert(text21.includes("[Untitled]"), "Entry without comment uses 'Untitled' label");

// --- buildInjectionBlock tests ---

console.log("\nbuildInjectionBlock:");

// Test 22: Wraps in lorebook tags
const block22 = Lorebook.buildInjectionBlock(matched19);
assert(block22.includes("<lorebook>"), "Block includes opening <lorebook> tag");
assert(block22.includes("</lorebook>"), "Block includes closing </lorebook> tag");

// Test 23: Empty block
assert(Lorebook.buildInjectionBlock([]) === "", "Empty entries produce empty block");

// --- isValidEntry tests ---

console.log("\nisValidEntry:");

// Test 24: Valid entry
assert(Lorebook.isValidEntry({ content: "test", key: ["a"] }) === true, "Valid entry passes");

// Test 25: Invalid entries
assert(Lorebook.isValidEntry({ content: "", key: [] }) === false, "Empty content fails");
assert(Lorebook.isValidEntry({ content: "test", key: "notarray" }) === false, "Non-array key fails");
assert(Lorebook.isValidEntry(null) === false, "null fails");
assert(Lorebook.isValidEntry("string") === false, "String fails");
assert(Lorebook.isValidEntry({ key: [] }) === false, "Missing content fails");

// --- exportSTFormat tests ---

console.log("\nexportSTFormat:");

// Test 26: Export round-trip
const original26 = [
  { uid: 1, key: ["a"], content: "A", comment: "Entry A", constant: false, selective: true },
  { uid: 2, key: ["b"], content: "B", comment: "Entry B", constant: true, selective: false },
];
const exported26 = Lorebook.exportSTFormat(original26);
assert(exported26.entries !== undefined, "Export has entries object");
assert(Object.keys(exported26.entries).length === 2, "Export has 2 entries");
const reimported26 = Lorebook.parseSTFormat(exported26);
assert(reimported26.length === 2, "Re-imported export has 2 entries");
assert(reimported26[0].content === "A", "Round-trip preserves content");

// --- createEntry tests ---

console.log("\ncreateEntry:");

// Test 27: New entry has correct defaults
const newEntry27 = Lorebook.createEntry();
assert(typeof newEntry27.uid === "number", "New entry uid is a number");
assert(Array.isArray(newEntry27.key), "New entry key is an array");
assert(newEntry27.key.length === 0, "New entry key is empty");
assert(newEntry27.content === "", "New entry content is empty string");
assert(newEntry27.constant === false, "New entry constant is false");
assert(newEntry27.selective === true, "New entry selective is true");
assert(newEntry27.order === 100, "New entry order is 100");

// --- Results ---

console.log("\n=== Results ===");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(failed === 0 ? "\nAll tests passed!" : `\n${failed} test(s) failed.`);

if (failed > 0) {
  process.exit(1);
}
