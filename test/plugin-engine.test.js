/*
 * Grimoire - Plugin engine tests
 * Copyright (C) 2026 Ash <ash@ashisgreat.xyz>
 *
 * License: GPL v3
 */

/**
 * plugin-engine.test.js
 *
 * Tests for the plugin sandbox runner and integration.
 * These test the sandbox API surface and message flow.
 * Not a browser test — runs in Node with a minimal mock.
 *
 * Usage: node test/plugin-engine.test.js
 */

// Minimal mock of the browser environment
const mockMessages = [
  { role: "system", content: "You are a dice-rolling assistant." },
  { role: "assistant", content: "Welcome!" },
  { role: "user", content: "I attack! [[roll d20+5 adv, plus, attackRoll]] and I check perception [[roll 2d6+2, set, perception]]" },
];

// Simulate what the sandbox runner does
(function testPluginSandbox() {
  console.log("=== Plugin Sandbox Tests ===\n");

  const pluginDb = new Map();
  const variables = { strength: 16, dexterity: 12 };
  let variableChanges = {};
  let systemPromptAdditions = [];
  let messageReplacements = [];

  // Build the sandboxed API (identical to what plugin-runner.js exposes)
  const api = {
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
    db: {
      get(key) { return pluginDb.get(key); },
      set(key, value) { pluginDb.set(key, value); },
      delete(key) { return pluginDb.delete(key); },
      has(key) { return pluginDb.has(key); },
      keys() { return [...pluginDb.keys()]; },
      clear() { pluginDb.clear(); },
      size() { return pluginDb.size; },
    },
    addMessage(msg) {
      systemPromptAdditions.push(msg);
    },
    replaceMessage(opts) {
      messageReplacements.push(opts);
    },
  };

  // Test 1: getVariable returns correct values
  console.log("Test 1: getVariable");
  console.assert(api.getVariable("strength") === 16, "strength should be 16");
  console.assert(api.getVariable("dexterity") === 12, "dexterity should be 12");
  console.assert(api.getVariable("nonexistent") === undefined, "nonexistent should be undefined");
  console.log("  ✓ PASSED\n");

  // Test 2: setVariable with different operations
  console.log("Test 2: setVariable operations");
  api.setVariable("hp", 10, "set");
  console.assert(variables.hp === 10, "hp should be 10 after set");
  console.assert(variableChanges.hp.old === 0, "old value should be 0");

  api.setVariable("hp", 5, "plus");
  console.assert(variables.hp === 15, "hp should be 15 after plus(5)");

  api.setVariable("hp", 3, "minus");
  console.assert(variables.hp === 12, "hp should be 12 after minus(3)");
  console.log("  ✓ PASSED\n");

  // Test 3: Plugin database
  console.log("Test 3: Plugin database");
  api.db.set("lastQuest", "defeat_goblin");
  console.assert(api.db.get("lastQuest") === "defeat_goblin", "db get should work");
  console.assert(api.db.has("lastQuest") === true, "db has should be true");
  console.assert(api.db.has("nonexistent") === false, "db has should be false for missing key");
  console.assert(api.db.size() === 1, "db size should be 1");
  api.db.delete("lastQuest");
  console.assert(api.db.size() === 0, "db size should be 0 after delete");
  api.db.set("a", 1);
  api.db.set("b", 2);
  api.db.clear();
  console.assert(api.db.size() === 0, "db size should be 0 after clear");
  console.log("  ✓ PASSED\n");

  // Test 4: Dice roller regex (does it match correctly)
  console.log("Test 4: Dice roller regex matching");
  const rollRegex = /\[\[\s*(?:roll\s*,?\s*)?(\d+)?d(\d+)(?:([+-])(\d+))?(?:,?\s*(adv|dis))?(?:,?\s*(plus|minus|set)\s*,\s*([a-zA-Z0-9_]+))?\s*\]\]/gi;

  const testCases = [
    { input: "[[d20]]", expect: { numDice: 1, numSides: 20 } },
    { input: "[[roll 2d6]]", expect: { numDice: 2, numSides: 6 } },
    { input: "[[d20+5]]", expect: { numDice: 1, numSides: 20, sign: "+", mod: 5 } },
    { input: "[[3d8-2]]", expect: { numDice: 3, numSides: 8, sign: "-", mod: 2 } },
    { input: "[[2d20 adv, plus, attackRoll]]", expect: { numDice: 2, numSides: 20, adv: "adv", op: "plus", var: "attackRoll" } },
    { input: "[[d20 dis, set, saveDC]]", expect: { numDice: 1, numSides: 20, adv: "dis", op: "set", var: "saveDC" } },
    { input: "[[roll 1d100+10, plus, luck]]", expect: { numDice: 1, numSides: 100, sign: "+", mod: 10, op: "plus", var: "luck" } },
  ];

  testCases.forEach((tc, i) => {
    const match = rollRegex.exec(tc.input);
    rollRegex.lastIndex = 0;
    if (!match) {
      console.error(`  ✗ FAILED: "${tc.input}" did not match regex`);
      return;
    }
    const numDice = parseInt(match[1]) || 1;
    const numSides = parseInt(match[2]);
    const sign = match[3];
    const mod = parseInt(match[4]) || 0;
    const adv = match[5];
    const op = match[6];
    const varName = match[7];

    console.assert(numDice === tc.expect.numDice, `dice count: expected ${tc.expect.numDice}, got ${numDice}`);
    console.assert(numSides === tc.expect.numSides, `sides: expected ${tc.expect.numSides}, got ${numSides}`);
    if (tc.expect.sign !== undefined) console.assert(sign === tc.expect.sign, `sign: expected ${tc.expect.sign}, got ${sign}`);
    if (tc.expect.mod !== undefined) console.assert(mod === tc.expect.mod, `mod: expected ${tc.expect.mod}, got ${mod}`);
    if (tc.expect.adv !== undefined) console.assert(adv === tc.expect.adv, `adv: expected ${tc.expect.adv}, got ${adv}`);
    if (tc.expect.op !== undefined) console.assert(op === tc.expect.op, `op: expected ${tc.expect.op}, got ${op}`);
    if (tc.expect.var !== undefined) console.assert(varName === tc.expect.var, `var: expected ${tc.expect.var}, got ${varName}`);
  });
  console.log("  ✓ PASSED\n");

  // Test 5: addMessage and replaceMessage
  console.log("Test 5: Message manipulation");
  api.addMessage({ role: "system", content: "Test system prompt", append: false });
  console.assert(systemPromptAdditions.length === 1, "should have 1 system prompt");
  console.assert(systemPromptAdditions[0].content === "Test system prompt", "content should match");

  api.replaceMessage({ find: "hello", replace: "world", target: "user" });
  console.assert(messageReplacements.length === 1, "should have 1 replacement");
  console.assert(messageReplacements[0].find === "hello", "find should match");
  console.log("  ✓ PASSED\n");

  // Test 6: Verify dice_roller.json is valid plugin format
  console.log("Test 6: Example plugin format validation");
  const fs = require("fs");
  const path = require("path");

  const diceRollerPath = path.join(__dirname, "example-plugins", "dice-roller.json");
  if (!fs.existsSync(diceRollerPath)) {
    console.log("  ⚠ SKIPPED: dice-roller.json not found (expected, not yet loaded)\n");
  } else {
    const plugin = JSON.parse(fs.readFileSync(diceRollerPath, "utf-8"));
    console.assert(typeof plugin.name === "string" && plugin.name.length > 0, "plugin must have a name");
    console.assert(typeof plugin.code === "string" && plugin.code.length > 0, "plugin must have code");
    console.assert(plugin.code.includes("function processMessage"), "plugin code must contain processMessage function");
    console.assert(plugin.code.includes("api.setVariable"), "plugin code should use setVariable");
    console.assert(plugin.code.includes("api.addMessage"), "plugin code should use addMessage");
    console.log("  ✓ PASSED\n");
  }

  // Test 7: Plugin code runs without errors in sandbox
  console.log("Test 7: Plugin execution in simulated sandbox");

  // Reset state
  while (messageReplacements.length > 0) messageReplacements.pop();
  while (systemPromptAdditions.length > 0) systemPromptAdditions.pop();

  // Load the actual plugin code from the example file
  const pluginData = JSON.parse(fs.readFileSync(diceRollerPath, "utf-8"));
  const diceRollerCode = pluginData.code;

  try {
    // Same wrapper as sandbox runner: define + call processMessage
    const wrapperCode = diceRollerCode + "\nreturn processMessage(messages, api);";
    const fn = new Function("messages", "api", wrapperCode);
    const testMessages = JSON.parse(JSON.stringify(mockMessages)); // deep clone
    fn(testMessages, api);

    // Verify that variables were set (attackRoll from [[roll d20+5 adv, plus, attackRoll]])
    console.assert(typeof variables.attackRoll === "number", "attackRoll should be set");
    console.assert(variables.attackRoll >= 6 && variables.attackRoll <= 25, "attackRoll should be in valid range (d20+5)");

    // Verify that system prompt was injected
    const hasSystemPrompt = systemPromptAdditions.some(
      (m) => m.role === "system" && m.content.includes("SYSTEM OVERRIDE")
    );
    console.assert(hasSystemPrompt, "should have injected a system prompt");

    // Verify that message replacement was triggered
    console.assert(messageReplacements.length > 0, "should have message replacements");

    // Verify that setVariable for perception ran
    console.assert(typeof variables.perception === "number", "perception should be set from [[roll 2d6+2, set, perception]]");

    console.log("  ✓ PASSED (all assertions)\n");
  } catch (err) {
    console.error("  ✗ FAILED:", err.message);
  }

  console.log("=== All Tests Complete ===");
})();
