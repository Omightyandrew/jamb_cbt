"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

console.log("=== RUNNING EXAMPILOT REFERRAL V1 CLIENT & UI VALIDATION ===\n");

const TRACKER_PATH = path.join(__dirname, "referral-tracker.js");
const STUDENT_PATH = path.join(__dirname, "student.html");
const DASHBOARD_PATH = path.join(__dirname, "dashboard.html");
const SETTINGS_PATH = path.join(__dirname, "settings.html");

// 1. referral-tracker.js file existence and syntax
console.log("Test 1: referral-tracker.js existence and code structure...");
assert.ok(fs.existsSync(TRACKER_PATH), `referral-tracker.js must exist at ${TRACKER_PATH}`);
const trackerCode = fs.readFileSync(TRACKER_PATH, "utf8");
assert.doesNotThrow(() => {
  new Function(trackerCode);
}, "referral-tracker.js must be syntactically valid JavaScript");
console.log("  ✓ referral-tracker.js found and valid syntax");

// 2. Functional tests on referral-tracker logic
console.log("\nTest 2: Referral code sanitization and URL parsing logic...");

// Simulate tracker in mock window
const mockStorage = {};
const mockWindow = {
  location: { search: "?ref=ep_champion99", origin: "https://exampilot.com.ng" },
  localStorage: {
    getItem: (k) => mockStorage[k] || null,
    setItem: (k, v) => { mockStorage[k] = String(v); },
    removeItem: (k) => { delete mockStorage[k]; }
  },
  sessionStorage: {
    getItem: (k) => mockStorage[k] || null,
    setItem: (k, v) => { mockStorage[k] = String(v); },
    removeItem: (k) => { delete mockStorage[k]; }
  },
  open: () => {}
};

const trackerFunc = new Function("window", trackerCode);
trackerFunc(mockWindow);

assert.ok(mockWindow.ExamPilotReferral, "ExamPilotReferral must be exposed on window");
const { sanitizeCode, getPendingReferralCode, buildReferralUrl, shareOnWhatsApp, clearPendingReferralCode } = mockWindow.ExamPilotReferral;

// Sanitization checks
assert.equal(sanitizeCode(" ep_test123 "), "EP_TEST123", "Must trim and uppercase valid referral code");
assert.equal(sanitizeCode("a"), "", "Must reject codes shorter than 3 characters");
assert.equal(sanitizeCode("bad code with spaces!"), "", "Must reject codes with invalid characters");
assert.equal(sanitizeCode(null), "", "Must handle null gracefully");

// Capture check from simulated URL ?ref=ep_champion99
assert.equal(getPendingReferralCode(), "EP_CHAMPION99", "Must capture and persist sanitized code from URL");

// Build referral URL
const builtUrl = buildReferralUrl("EP_CHAMPION99");
assert.equal(builtUrl, "https://exampilot.com.ng/student.html?ref=EP_CHAMPION99", "Referral URL must target student.html with ?ref=CODE");

// WhatsApp share URL
const waUrl = shareOnWhatsApp("EP_CHAMPION99");
assert.match(waUrl, /https:\/\/wa\.me\/\?text=/, "WhatsApp share must target wa.me");
assert.match(waUrl, /EP_CHAMPION99/, "WhatsApp share must include the referral code");

// Clear storage
clearPendingReferralCode();
assert.equal(getPendingReferralCode(), "", "clearPendingReferralCode must remove code from storage");
console.log("  ✓ Sanitization, URL parsing, and share helpers verified");

// 3. student.html registration & attribution binding
console.log("\nTest 3: student.html registration and attribution binding...");
assert.ok(fs.existsSync(STUDENT_PATH), "student.html must exist");
const studentCode = fs.readFileSync(STUDENT_PATH, "utf8");

assert.match(
  studentCode,
  /<script\s+src=["']referral-tracker\.js["']>/,
  "student.html must load referral-tracker.js"
);
assert.match(
  studentCode,
  /signupMeta\.referral_code\s*=\s*pendingReferralCode/,
  "student.html must pass referral_code into signUp metadata"
);
assert.match(
  studentCode,
  /supabaseClient\.rpc\(["']bind_referral_attribution["'],\s*\{\s*p_referral_code:\s*pendingReferralCode\s*\}\)/,
  "student.html must invoke bind_referral_attribution RPC on immediate session"
);
assert.match(
  studentCode,
  /supabaseClient\.rpc\(["']bind_referral_attribution["'],\s*\{\s*p_referral_code:\s*boundCode\s*\}\)/,
  "student.html loadStudentProfile must invoke bind_referral_attribution for email-confirmation resilience"
);
console.log("  ✓ student.html metadata transport and resilient attribution binding verified");

// 4. dashboard.html profile menu entry
console.log("\nTest 4: dashboard.html profile menu entry...");
assert.ok(fs.existsSync(DASHBOARD_PATH), "dashboard.html must exist");
const dashboardCode = fs.readFileSync(DASHBOARD_PATH, "utf8");

assert.match(
  dashboardCode,
  /<a\s+class=["']profile-menu-item["']\s+href=["']settings\.html\?view=referrals["'][\s\S]+?Refer\s+&\s+Earn/i,
  "dashboard.html profile menu must contain 'Refer & Earn' link to settings.html?view=referrals"
);
console.log("  ✓ dashboard.html profile menu link verified");

// 5. settings.html view routing and UI sections
console.log("\nTest 5: settings.html referrals view routing and controls...");
assert.ok(fs.existsSync(SETTINGS_PATH), "settings.html must exist");
const settingsCode = fs.readFileSync(SETTINGS_PATH, "utf8");

// View routing
assert.match(
  settingsCode,
  /target\s*=\s*rawView\s*===\s*['"]support['"]\s*\?\s*['"]support['"]\s*:\s*\(\s*rawView\s*===\s*['"]referrals['"]\s*\?\s*['"]referrals['"]\s*:\s*['"]settings['"]\s*\)/,
  "settings.html applySettingsView must route view=referrals to referrals section"
);
assert.match(
  settingsCode,
  /target\s*===\s*['"]referrals['"]\s*\?\s*['"]Refer & Earn['"]/,
  "settings.html must display 'Refer & Earn' title for referrals view"
);

// UI elements
assert.match(
  settingsCode,
  /data-page-section=["']referrals["'][\s\S]+?id=["']referralOverviewSection["']/,
  "settings.html must have referralOverviewSection"
);
assert.match(
  settingsCode,
  /id=["']myReferralCode["'][\s\S]+?id=["']myReferralLink["']/,
  "settings.html must have referral code and link inputs"
);
assert.match(
  settingsCode,
  /id=["']statReferredCount["'][\s\S]+?id=["']statPremiumCount["'][\s\S]+?id=["']statTotalCommission["'][\s\S]+?id=["']statAvailableBalance["'][\s\S]+?id=["']statPaidAmount["']/,
  "settings.html must display all 5 core referral stats (Referred, Premium, Total, Available, Paid)"
);
assert.match(
  settingsCode,
  /id=["']bankName["'][\s\S]+?id=["']accountNumber["'][\s\S]+?id=["']accountName["']/,
  "settings.html must have bank payout form fields"
);

assert.match(
  settingsCode,
  /minThresholdKobo\s*=\s*120000/,
  "settings.html must enforce ₦1,200 (120,000 kobo) threshold"
);
assert.match(
  settingsCode,
  /payoutBtn\.disabled\s*=\s*true/,
  "settings.html must disable payout button when available balance < ₦1,200"
);

// Server-authoritative code generation & atomic payout RPC calls
assert.match(
  settingsCode,
  /supabaseClient\s*\.rpc\(\s*['"]get_or_create_student_referral_code['"]\s*\)/,
  "settings.html must call get_or_create_student_referral_code RPC"
);
assert.match(
  settingsCode,
  /supabaseClient\s*\.rpc\(\s*['"]request_referral_payout['"]\s*\)/,
  "settings.html must call request_referral_payout RPC"
);
assert.doesNotMatch(
  settingsCode,
  /supabaseClient\s*\.from\(\s*['"]referral_payouts['"]\s*\)\s*\.insert/,
  "settings.html must NOT make direct client insert into referral_payouts"
);

// Unified ledger balance calculation in UI
assert.match(
  settingsCode,
  /availCommKobo\s*=\s*Math\.max\(\s*0\s*,\s*totalCommKobo\s*-\s*totalDebitedKobo\s*\)/,
  "settings.html must compute available balance strictly from totalCommKobo - totalDebitedKobo"
);
console.log("  ✓ settings.html view router, statistics, bank form, RPC wiring, and unified ledger verified");

// 6. Withdrawal fee & net amount display in settings.html
console.log("\nTest 6: Withdrawal fee and net payout display in settings.html...");
assert.match(
  settingsCode,
  /select\(\s*['"]amount,\s*fee_amount,\s*net_amount,\s*status/i,
  "settings.html must query fee_amount and net_amount in referral_payouts"
);
assert.match(
  settingsCode,
  /Fee:\s*₦120\s*\|\s*You\\?'ll receive:\s*₦/i,
  "settings.html must display fixed ₦120 fee and net amount in threshold hint"
);
assert.match(
  settingsCode,
  /•\s*Available Balance:\s*₦[\s\S]+?•\s*Withdrawal Amount:\s*₦[\s\S]+?•\s*Withdrawal Fee:\s*₦[\s\S]+?•\s*Amount you will receive:\s*₦/i,
  "settings.html confirmation dialog must clearly show available balance, withdrawal amount, ₦120 fee, and net amount"
);
assert.match(
  settingsCode,
  /supabaseClient\.rpc\(\s*['"]request_referral_payout['"]\s*\)/,
  "request_referral_payout RPC must be called with no parameters (server-authoritative)"
);
console.log("  ✓ settings.html withdrawal fee and net payout display verified");

console.log("\n=== ALL REFERRAL CLIENT & UI TESTS PASSED! ===");


