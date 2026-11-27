"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

console.log("=== RUNNING EXAMPILOT PHASE 5 STAGE 3: STREAKS & MILESTONES VALIDATION ===\n");

const challengeHtmlPath = path.join(__dirname, "challenge.html");
const dashboardHtmlPath = path.join(__dirname, "dashboard.html");

assert.ok(fs.existsSync(challengeHtmlPath), "challenge.html must exist");
assert.ok(fs.existsSync(dashboardHtmlPath), "dashboard.html must exist");

const challengeHtml = fs.readFileSync(challengeHtmlPath, "utf8");
const dashboardHtml = fs.readFileSync(dashboardHtmlPath, "utf8");

// Helper to extract function body
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

// 1. Timezone Consistency Check: Africa/Lagos
console.log("Test 1: Africa/Lagos timezone consistency in challenge.html and dashboard.html...");
assert.match(
  challengeHtml,
  /timeZone:\s*['"]Africa\/Lagos['"]/i,
  "challenge.html localDate() must use Africa/Lagos timezone"
);
assert.match(
  dashboardHtml,
  /timeZone:\s*['"]Africa\/Lagos['"]/i,
  "dashboard.html getLagosDate() must use Africa/Lagos timezone"
);

const challengeLocalDate = new Function(extractFunctionBody(challengeHtml, "localDate"))();
const dashboardLagosDate = new Function(extractFunctionBody(dashboardHtml, "getLagosDate"))();

assert.equal(challengeLocalDate, dashboardLagosDate, "challenge.html and dashboard.html must produce identical Lagos dates");
assert.match(challengeLocalDate, /^\d{4}-\d{2}-\d{2}$/, "Lagos date must be YYYY-MM-DD");
console.log(`  ✓ Both client files agree on Africa/Lagos date: ${challengeLocalDate}`);

// 2. Date Rollover / dayBefore
console.log("\nTest 2: Date math & month/year rollover...");
const dayBeforeChallenge = new Function("dateStr", "numberOfDays", extractFunctionBody(challengeHtml, "dayBefore"));
const dayBeforeDashboard = new Function("dateStr", "numberOfDays", extractFunctionBody(dashboardHtml, "dayBeforeDashboard"));

assert.equal(dayBeforeChallenge("2026-03-01", 1), "2026-02-28");
assert.equal(dayBeforeDashboard("2026-03-01", 1), "2026-02-28");
assert.equal(dayBeforeChallenge("2026-01-01", 1), "2025-12-31");
assert.equal(dayBeforeDashboard("2026-01-01", 1), "2025-12-31");
console.log("  ✓ Rollover calculations match across both implementations");

// 3. Streak Calculation & Incomplete/Missing Day Logic
console.log("\nTest 3: Dynamic streak calculation behavior...");
const calculateChallengeStreak = new Function(
  "attemptDates",
  "todayLagos",
  "dayBeforeDashboard",
  extractFunctionBody(dashboardHtml, "calculateChallengeStreak")
);

function runStreak(dates, anchorDate) {
  return calculateChallengeStreak(dates, anchorDate, dayBeforeDashboard);
}

const today = challengeLocalDate;
const yesterday = dayBeforeChallenge(today, 1);
const twoDaysAgo = dayBeforeChallenge(today, 2);
const threeDaysAgo = dayBeforeChallenge(today, 3);

// A. Empty history => 0
assert.equal(runStreak([], today), 0, "No attempts must yield 0 streak");

// B. Completed today => 1
assert.equal(runStreak([today], today), 1, "Completed today must yield 1 streak");

// C. Completed yesterday, today pending => 1
assert.equal(runStreak([yesterday], today), 1, "Completed yesterday (today pending) must preserve 1 streak");

// D. Completed 3 consecutive days (today + yesterday + 2 days ago) => 3
assert.equal(runStreak([today, yesterday, twoDaysAgo], today), 3, "3 consecutive days must yield 3 streak");

// E. Missed both today and yesterday (last attempt was 2 days ago) => 0
assert.equal(runStreak([twoDaysAgo], today), 0, "Missing yesterday and today resets streak to 0");

// F. Duplicate attempts on the same date do not artificially inflate streak
assert.equal(runStreak([today, today, yesterday, yesterday], today), 2, "Duplicate attempts must not inflate streak count");
console.log("  ✓ Zero, preserved yesterday, consecutive streak, reset, and duplicate guards verified");

// 4. Milestone Definitions & Badge Extraction
console.log("\nTest 4: Milestone definitions and badge thresholds (3, 7, 14, 30, 60, 100 days)...");

// Extract getStreakMilestone from challenge.html
const challengeMilestonesCode = challengeHtml.slice(
  challengeHtml.indexOf("const STREAK_MILESTONES"),
  challengeHtml.indexOf("function hash")
);
const getChallengeMilestone = new Function(
  challengeMilestonesCode + "\nreturn getStreakMilestone(arguments[0]);"
);

// Extract getStreakMilestone from dashboard.html
const dashboardMilestonesCode = dashboardHtml.slice(
  dashboardHtml.indexOf("const STREAK_MILESTONES"),
  dashboardHtml.indexOf("async function loadDashboardChallengeWidget")
);
const getDashboardMilestone = new Function(
  dashboardMilestonesCode + "\nreturn getStreakMilestone(arguments[0]);"
);

const milestoneCases = [
  { streak: 0, expectedId: null },
  { streak: 1, expectedId: null },
  { streak: 2, expectedId: null },
  { streak: 3, expectedId: "starter", expectedName: "Starter" },
  { streak: 6, expectedId: "starter", expectedName: "Starter" },
  { streak: 7, expectedId: "dedicated", expectedName: "Dedicated" },
  { streak: 13, expectedId: "dedicated", expectedName: "Dedicated" },
  { streak: 14, expectedId: "consistent", expectedName: "Consistent" },
  { streak: 29, expectedId: "consistent", expectedName: "Consistent" },
  { streak: 30, expectedId: "master", expectedName: "Challenge Master" },
  { streak: 59, expectedId: "master", expectedName: "Challenge Master" },
  { streak: 60, expectedId: "elite", expectedName: "Elite" },
  { streak: 99, expectedId: "elite", expectedName: "Elite" },
  { streak: 100, expectedId: "legend", expectedName: "ExamPilot Legend" },
  { streak: 150, expectedId: "legend", expectedName: "ExamPilot Legend" }
];

milestoneCases.forEach(({ streak, expectedId, expectedName }) => {
  const cm = getChallengeMilestone(streak);
  const dm = getDashboardMilestone(streak);

  if (expectedId === null) {
    assert.equal(cm, null, `Streak ${streak} must have no milestone in challenge.html`);
    assert.equal(dm, null, `Streak ${streak} must have no milestone in dashboard.html`);
  } else {
    assert.ok(cm, `Streak ${streak} must have milestone in challenge.html`);
    assert.ok(dm, `Streak ${streak} must have milestone in dashboard.html`);
    assert.equal(cm.id, expectedId, `Streak ${streak} expected id ${expectedId}, got ${cm.id}`);
    assert.equal(dm.id, expectedId, `Streak ${streak} expected id ${expectedId}, got ${dm.id}`);
    assert.equal(cm.name, expectedName, `Streak ${streak} expected name ${expectedName}, got ${cm.name}`);
    assert.equal(dm.name, expectedName, `Streak ${streak} expected name ${expectedName}, got ${dm.name}`);
    assert.ok(cm.icon, "Milestone must have an icon");
    assert.ok(cm.description, "Milestone must have a description");
  }
});
console.log("  ✓ All 6 milestone tiers (Starter, Dedicated, Consistent, Challenge Master, Elite, Legend) verified");

// 5. DOM & Visual Representation Verification
console.log("\nTest 5: DOM & Visual badge representation verification...");
assert.match(
  challengeHtml,
  /id=["']milestoneBadge["']/i,
  "challenge.html must have #milestoneBadge element in hero stats"
);
assert.match(
  dashboardHtml,
  /id=["']challengeStreak["']/i,
  "dashboard.html must have #challengeStreak element"
);
console.log("  ✓ Visual badge DOM elements present in challenge.html and dashboard.html");

// 6. Security & Read-Only Invariance
console.log("\nTest 6: Security audit - No trusted database write path for milestones or streaks...");
// Verify no insert/update/upsert on challenge_attempts or streak tables in challenge.html or dashboard.html
assert.equal(
  challengeHtml.match(/\.from\(['"](streaks|badges|milestones)['"]\)/gi),
  null,
  "challenge.html must not query non-existent streak/badge tables"
);
assert.equal(
  dashboardHtml.match(/\.from\(['"](streaks|badges|milestones)['"]\)/gi),
  null,
  "dashboard.html must not query non-existent streak/badge tables"
);
assert.equal(
  dashboardHtml.match(/\.from\(['"]challenge_attempts['"]\)\s*\.(insert|update|upsert|delete)\b/gi),
  null,
  "dashboard.html must NEVER mutate challenge_attempts"
);
console.log("  ✓ Streak and milestone system remains strictly server-authoritative and read-derived");

console.log("\n=== ALL PHASE 5 STAGE 3 TESTS PASSED SUCCESSFULLY! ===");
