"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

console.log("=== RUNNING EXAMPILOT PHASE 5 STAGE 6: XP LEVELS & PROGRESSION VALIDATION ===\n");

const dashboardHtmlPath = path.join(__dirname, "dashboard.html");
assert.ok(fs.existsSync(dashboardHtmlPath), "dashboard.html must exist");
const dashboardHtml = fs.readFileSync(dashboardHtmlPath, "utf8");

// Helper to extract function / code block
function extractFunctionBody(code, functionName) {
  const marker = "function " + functionName;
  const startIdx = code.indexOf(marker);
  if (startIdx === -1) throw new Error("Could not find function: " + functionName);
  const openBrace = code.indexOf("{", startIdx);
  let depth = 1;
  let i = openBrace + 1;
  while (depth > 0 && i < code.length) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") depth--;
    i++;
  }
  return code.slice(openBrace + 1, i - 1);
}

// 1. Level Configuration Verification
console.log("Test 1: Level configuration in dashboard.html...");
assert.match(
  dashboardHtml,
  /const\s+LEVEL_CONFIG\s*=\s*\[/i,
  "dashboard.html must define LEVEL_CONFIG array"
);

// Extract LEVEL_CONFIG
const configStartIndex = dashboardHtml.indexOf("const LEVEL_CONFIG");
assert.ok(configStartIndex > -1, "LEVEL_CONFIG must exist in dashboard.html");
const configEndIndex = dashboardHtml.indexOf("];", configStartIndex) + 2;
const configCode = dashboardHtml.slice(configStartIndex, configEndIndex);
const levelConfig = new Function(configCode + "\nreturn LEVEL_CONFIG;")();

const EXPECTED_LEVELS = [
  { level: 1, name: "Novice", threshold: 0 },
  { level: 2, name: "Apprentice", threshold: 50 },
  { level: 3, name: "Scholar", threshold: 120 },
  { level: 4, name: "Achiever", threshold: 220 },
  { level: 5, name: "Master", threshold: 360 },
  { level: 6, name: "Champion", threshold: 550 },
  { level: 7, name: "Elite", threshold: 800 },
  { level: 8, name: "JAMB Legend", threshold: 1200 }
];

assert.equal(levelConfig.length, 8, "Must define exactly 8 levels");
EXPECTED_LEVELS.forEach((exp, idx) => {
  const actual = levelConfig[idx];
  assert.equal(actual.level, exp.level, `Level index ${idx} must have level ${exp.level}`);
  assert.equal(actual.name, exp.name, `Level index ${idx} must have name ${exp.name}`);
  assert.equal(actual.threshold, exp.threshold, `Level index ${idx} must have threshold ${exp.threshold}`);
});
console.log("  ✓ All 8 levels and thresholds correctly configured (Novice 0 XP to JAMB Legend 1,200 XP)");

// 2. Pure Level-Calculation Helper Verification
console.log("\nTest 2: Pure level-calculation helper execution & return contract...");
const calcBody = extractFunctionBody(dashboardHtml, "calculateLevelProgression");
const calculateLevelProgression = new Function(
  configCode + "\nreturn function calculateLevelProgression(xp) {\n" + calcBody + "\n};"
)();

// Verify helper return fields on a sample calculation
const sample = calculateLevelProgression(75);
assert.equal(typeof sample.currentLevel, "number", "Must return currentLevel as number");
assert.equal(typeof sample.currentLevelName, "string", "Must return currentLevelName as string");
assert.equal(typeof sample.xpAtStart, "number", "Must return xpAtStart as number");
assert.equal(typeof sample.xpRequiredForNextLevel, "number", "Must return xpRequiredForNextLevel as number");
assert.equal(typeof sample.xpEarnedWithinLevel, "number", "Must return xpEarnedWithinLevel as number");
assert.equal(typeof sample.progressPercentage, "number", "Must return progressPercentage as number");
assert.equal(typeof sample.isMaxLevel, "boolean", "Must return isMaxLevel as boolean");
console.log("  ✓ Helper returns all 7 required progression properties");

// 3. Minimum Boundary XP Test Cases
console.log("\nTest 3: Minimum XP boundary assertions...");
const boundaryTests = [
  { xp: 0, expectedLevel: 1, expectedName: "Novice", expectedStart: 0, expectedReq: 50, expectedEarned: 0, expectedPct: 0, isMax: false },
  { xp: 49, expectedLevel: 1, expectedName: "Novice", expectedStart: 0, expectedReq: 50, expectedEarned: 49, expectedPct: 98, isMax: false },
  { xp: 50, expectedLevel: 2, expectedName: "Apprentice", expectedStart: 50, expectedReq: 70, expectedEarned: 0, expectedPct: 0, isMax: false },
  { xp: 75, expectedLevel: 2, expectedName: "Apprentice", expectedStart: 50, expectedReq: 70, expectedEarned: 25, expectedPct: 35, isMax: false },
  { xp: 119, expectedLevel: 2, expectedName: "Apprentice", expectedStart: 50, expectedReq: 70, expectedEarned: 69, expectedPct: 98, isMax: false },
  { xp: 120, expectedLevel: 3, expectedName: "Scholar", expectedStart: 120, expectedReq: 100, expectedEarned: 0, expectedPct: 0, isMax: false },
  { xp: 200, expectedLevel: 3, expectedName: "Scholar", expectedStart: 120, expectedReq: 100, expectedEarned: 80, expectedPct: 80, isMax: false },
  { xp: 219, expectedLevel: 3, expectedName: "Scholar", expectedStart: 120, expectedReq: 100, expectedEarned: 99, expectedPct: 99, isMax: false },
  { xp: 220, expectedLevel: 4, expectedName: "Achiever", expectedStart: 220, expectedReq: 140, expectedEarned: 0, expectedPct: 0, isMax: false },
  { xp: 359, expectedLevel: 4, expectedName: "Achiever", expectedStart: 220, expectedReq: 140, expectedEarned: 139, expectedPct: 99, isMax: false },
  { xp: 360, expectedLevel: 5, expectedName: "Master", expectedStart: 360, expectedReq: 190, expectedEarned: 0, expectedPct: 0, isMax: false },
  { xp: 549, expectedLevel: 5, expectedName: "Master", expectedStart: 360, expectedReq: 190, expectedEarned: 189, expectedPct: 99, isMax: false },
  { xp: 550, expectedLevel: 6, expectedName: "Champion", expectedStart: 550, expectedReq: 250, expectedEarned: 0, expectedPct: 0, isMax: false },
  { xp: 799, expectedLevel: 6, expectedName: "Champion", expectedStart: 550, expectedReq: 250, expectedEarned: 249, expectedPct: 99, isMax: false },
  { xp: 800, expectedLevel: 7, expectedName: "Elite", expectedStart: 800, expectedReq: 400, expectedEarned: 0, expectedPct: 0, isMax: false },
  { xp: 1199, expectedLevel: 7, expectedName: "Elite", expectedStart: 800, expectedReq: 400, expectedEarned: 399, expectedPct: 99, isMax: false },
  { xp: 1200, expectedLevel: 8, expectedName: "JAMB Legend", expectedStart: 1200, expectedReq: 0, expectedEarned: 0, expectedPct: 100, isMax: true },
  { xp: 1201, expectedLevel: 8, expectedName: "JAMB Legend", expectedStart: 1200, expectedReq: 0, expectedEarned: 1, expectedPct: 100, isMax: true },
  { xp: 1500, expectedLevel: 8, expectedName: "JAMB Legend", expectedStart: 1200, expectedReq: 0, expectedEarned: 300, expectedPct: 100, isMax: true },
  { xp: 9999, expectedLevel: 8, expectedName: "JAMB Legend", expectedStart: 1200, expectedReq: 0, expectedEarned: 8799, expectedPct: 100, isMax: true }
];

boundaryTests.forEach((t) => {
  const res = calculateLevelProgression(t.xp);
  assert.equal(res.currentLevel, t.expectedLevel, `XP ${t.xp} expected Level ${t.expectedLevel}, got ${res.currentLevel}`);
  assert.equal(res.currentLevelName, t.expectedName, `XP ${t.xp} expected Name ${t.expectedName}, got ${res.currentLevelName}`);
  assert.equal(res.xpAtStart, t.expectedStart, `XP ${t.xp} expected Start XP ${t.expectedStart}, got ${res.xpAtStart}`);
  assert.equal(res.xpRequiredForNextLevel, t.expectedReq, `XP ${t.xp} expected Req XP ${t.expectedReq}, got ${res.xpRequiredForNextLevel}`);
  assert.equal(res.xpEarnedWithinLevel, t.expectedEarned, `XP ${t.xp} expected Earned XP ${t.expectedEarned}, got ${res.xpEarnedWithinLevel}`);
  assert.equal(res.progressPercentage, t.expectedPct, `XP ${t.xp} expected Progress ${t.expectedPct}%, got ${res.progressPercentage}%`);
  assert.equal(res.isMaxLevel, t.isMax, `XP ${t.xp} expected isMaxLevel ${t.isMax}, got ${res.isMaxLevel}`);
  console.log(`  ✓ ${t.xp} XP → Level ${res.currentLevel} (${res.currentLevelName}), Progress: ${res.progressPercentage}%, isMaxLevel: ${res.isMaxLevel}`);
});

// 4. Progress Percentage Range Invariance
console.log("\nTest 4: Progress percentage bounds invariance [0, 100]...");
const variousXpInputs = [-1000, -5, 0, 1, 10, 49, 50, 75, 119, 120, 200, 220, 359, 360, 550, 799, 800, 1199, 1200, 1250, 5000, 100000];
variousXpInputs.forEach((xp) => {
  const res = calculateLevelProgression(xp);
  assert.ok(res.progressPercentage >= 0, `Progress for XP ${xp} must be >= 0, got ${res.progressPercentage}`);
  assert.ok(res.progressPercentage <= 100, `Progress for XP ${xp} must be <= 100, got ${res.progressPercentage}`);
});
console.log("  ✓ Progress percentage never goes below 0 or above 100 across all input ranges");

// 5. Dashboard UI DOM Verification
console.log("\nTest 5: Dashboard UI progression DOM structure & layout preservation...");
const requiredDomIds = [
  "challengeProgression",
  "challengeProgressionLevel",
  "challengeProgressionStats",
  "challengeProgressionFill"
];

requiredDomIds.forEach((id) => {
  assert.match(dashboardHtml, new RegExp(`id=["']${id}["']`, "i"), `DOM element #${id} must exist in dashboard.html`);
  console.log(`  ✓ #${id} exists in dashboard.html`);
});

// Verify progression section is inside #challengeWidget
const widgetStart = dashboardHtml.indexOf('id="challengeWidget"');
const widgetEnd = dashboardHtml.indexOf('</aside>', widgetStart);
const progressionIndex = dashboardHtml.indexOf('id="challengeProgression"');

assert.ok(progressionIndex > widgetStart && progressionIndex < widgetEnd, "#challengeProgression must be inside #challengeWidget");
console.log("  ✓ #challengeProgression is placed inside #challengeWidget");

// Verify existing badges and widgets are preserved
const preservedElements = [
  "challengeQuestionCount",
  "challengePlanLabel",
  "challengeStreak",
  "challengeXpBadge",
  "challengeStatusText",
  "challengeActionBtn"
];
preservedElements.forEach((id) => {
  assert.match(dashboardHtml, new RegExp(`id=["']${id}["']`, "i"), `Preserved element #${id} must exist`);
  console.log(`  ✓ Existing #${id} preserved`);
});

// 6. Error Handling & Initial State
console.log("\nTest 6: Error handling & initial state...");
assert.match(
  dashboardHtml,
  /id=["']challengeProgression["'][^>]*style=["'][^"']*display:\s*none/i,
  "#challengeProgression must be initially hidden (display:none) so no fake level is shown if XP fails to load"
);
console.log("  ✓ #challengeProgression defaults to display:none");

// 7. Maximum Level State Handling
console.log("\nTest 7: Maximum level UI state handling in renderChallengeProgression...");
assert.match(
  dashboardHtml,
  /Maximum level reached/i,
  "renderChallengeProgression must show 'Maximum level reached' at max level"
);
assert.match(
  dashboardHtml,
  /fillEl\.style\.width\s*=\s*['"]100%['"]/i,
  "renderChallengeProgression must set fill to 100% at max level"
);
console.log("  ✓ Maximum level state verified (100% progress and 'Maximum level reached')");

// 8. Security & Read-Only Invariants
console.log("\nTest 8: Security & Server-authoritative invariance...");
assert.match(
  dashboardHtml,
  /supabaseClient\.rpc\(['"]get_my_xp['"]\)/i,
  "dashboard.html must read XP total from get_my_xp RPC"
);
assert.doesNotMatch(
  dashboardHtml,
  /\.from\(['"]user_xp_ledger['"]\)\s*\.(insert|update|upsert|delete)/i,
  "dashboard.html must never mutate user_xp_ledger"
);
assert.doesNotMatch(
  dashboardHtml,
  /\.from\(['"]challenge_attempts['"]\)\s*\.(insert|update|upsert|delete)/i,
  "dashboard.html must never mutate challenge_attempts"
);
assert.doesNotMatch(
  dashboardHtml,
  /submit_daily_challenge/i,
  "dashboard.html must never call submit_daily_challenge"
);
console.log("  ✓ XP and Level progression strictly consume authoritative get_my_xp() without mutations");

console.log("\n=== ALL PHASE 5 STAGE 6 TESTS PASSED SUCCESSFULLY! ===");
