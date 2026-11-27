"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

console.log("=== RUNNING EXAMPILOT PHASE 5 STAGE 5: XP COMPLETION FEEDBACK VALIDATION ===\n");

// 1. Verify Daily Challenge Completion Feedback in challenge.html
console.log("Test 1: Daily Challenge completion XP feedback in challenge.html...");
const challengeHtmlPath = path.join(__dirname, "challenge.html");
assert.ok(fs.existsSync(challengeHtmlPath), "challenge.html must exist");
const challengeHtml = fs.readFileSync(challengeHtmlPath, "utf8");

// Verify xp_awarded is read from server response
assert.match(
  challengeHtml,
  /xp_awarded:\s*Number\(data\?\.xp_awarded\)\s*\|\|\s*0/i,
  "saveChallengeResult must extract xp_awarded from server response"
);

// Verify already_completed returns xp_awarded: 0
assert.match(
  challengeHtml,
  /already_completed:\s*true[\s\S]*?xp_awarded:\s*0/i,
  "already_completed must set xp_awarded: 0"
);

// Verify +10 XP indicator renders only when xp_awarded === 10
assert.match(
  challengeHtml,
  /saved\s*&&\s*saved\.xp_awarded\s*===\s*10/i,
  "Must check saved.xp_awarded === 10 before rendering XP feedback"
);
assert.match(
  challengeHtml,
  /✨ \+10 XP Earned!/i,
  "Must render '✨ +10 XP Earned!' text"
);

// Verify no client-side XP mutations in challenge.html
assert.doesNotMatch(
  challengeHtml,
  /\.from\(['"]user_xp_ledger['"]\)\s*\.(insert|update|upsert|delete)/i,
  "challenge.html must NEVER mutate user_xp_ledger"
);
console.log("  ✓ Daily Challenge renders +10 XP feedback only on server xp_awarded === 10 and does zero client mutation");

// 2. Verify Mock Exam Completion Feedback in mock-exam-ui.js
console.log("\nTest 2: Mock Exam completion XP feedback in mock-exam-ui.js...");
const mockExamUiPath = path.join(__dirname, "mock-exam-ui.js");
assert.ok(fs.existsSync(mockExamUiPath), "mock-exam-ui.js must exist");
const mockExamUi = fs.readFileSync(mockExamUiPath, "utf8");

// Verify +25 XP is rendered only when result.status === 'submitted'
assert.match(
  mockExamUi,
  /result\.status\s*===\s*["']submitted["']/i,
  "Must verify result.status === 'submitted' before showing Mock XP feedback"
);
assert.match(
  mockExamUi,
  /✨ \+25 XP Earned!/i,
  "Must render '✨ +25 XP Earned!' text"
);

// Verify no client-side XP mutations in mock-exam-ui.js
assert.doesNotMatch(
  mockExamUi,
  /\.from\(['"]user_xp_ledger['"]\)\s*\.(insert|update|upsert|delete)/i,
  "mock-exam-ui.js must NEVER mutate user_xp_ledger"
);
console.log("  ✓ Mock Exam renders +25 XP feedback on server status === 'submitted' and does zero client mutation");

// 3. Verify Dashboard XP badge remains intact in dashboard.html
console.log("\nTest 3: Dashboard XP badge preservation in dashboard.html...");
const dashboardHtmlPath = path.join(__dirname, "dashboard.html");
const dashboardHtml = fs.readFileSync(dashboardHtmlPath, "utf8");

assert.match(
  dashboardHtml,
  /id=["']challengeXpBadge["']/i,
  "dashboard.html must preserve #challengeXpBadge"
);
assert.match(
  dashboardHtml,
  /typeof\s+xpTotal\s*===\s*['"]number['"]\s*&&\s*xpTotal\s*>=\s*0/i,
  "dashboard.html must preserve >= 0 condition for #challengeXpBadge"
);
assert.doesNotMatch(
  dashboardHtml,
  /\.from\(['"]user_xp_ledger['"]\)\s*\.(insert|update|upsert|delete)/i,
  "dashboard.html must NEVER mutate user_xp_ledger"
);
console.log("  ✓ Dashboard XP badge and security contracts preserved");

// 4. Scope Protection Checks across client files
console.log("\nTest 4: Scope protection verification...");
const outOfScopePatterns = [
  /xp_level/i,
  /level_xp/i,
  /spend_xp/i,
  /xp_spending/i,
  /xp_reward_store/i,
  /xp_leaderboard/i
];

for (const pattern of outOfScopePatterns) {
  assert.doesNotMatch(challengeHtml, pattern, `challenge.html must not contain out-of-scope pattern: ${pattern}`);
  assert.doesNotMatch(mockExamUi, pattern, `mock-exam-ui.js must not contain out-of-scope pattern: ${pattern}`);
  assert.doesNotMatch(dashboardHtml, pattern, `dashboard.html must not contain out-of-scope pattern: ${pattern}`);
}
console.log("  ✓ No out-of-scope XP mechanics found across client files");

console.log("\n=== ALL PHASE 5 STAGE 5 XP FEEDBACK TESTS PASSED SUCCESSFULLY! ===");
