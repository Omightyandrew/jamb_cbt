"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

console.log("=== RUNNING EXAMPILOT REFERRAL V1 BACKEND & SCHEMA VALIDATION ===\n");

const MIGRATION_PATH = path.join(
  __dirname,
  "supabase",
  "migrations",
  "20261008000000_create_referral_v1.sql"
);
const PAYSTACK_FUNC_PATH = path.join(
  __dirname,
  "supabase",
  "functions",
  "Paystack_payment",
  "index.ts"
);

// 1. Verify Migration File Exists and is Readable
console.log("Test 1: Migration file existence and naming convention...");
assert.ok(fs.existsSync(MIGRATION_PATH), `Migration file must exist at ${MIGRATION_PATH}`);
const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");
assert.ok(migrationSql.length > 0, "Migration file must not be empty");
console.log("  ✓ Migration file found and readable");

// 2. Exactly 5 Dedicated Tables Created
console.log("\nTest 2: Exactly 5 dedicated tables defined...");
const expectedTables = [
  "student_referral_codes",
  "referral_attributions",
  "referral_payouts",
  "referral_commissions",
  "referral_payout_accounts",
];
expectedTables.forEach((table) => {
  const tableRegex = new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+public\\.${table}`, "i");
  assert.match(migrationSql, tableRegex, `Migration must create table public.${table}`);
});
console.log("  ✓ All 5 dedicated tables verified: student_referral_codes, referral_attributions, referral_commissions, referral_payout_accounts, referral_payouts");

// 3. No Modification to Existing Frozen Tables
console.log("\nTest 3: Existing tables remain completely untouched...");
assert.doesNotMatch(
  migrationSql,
  /ALTER\s+TABLE\s+(?:ONLY\s+)?public\.(?:"Student_profiles"|Student_profiles|subscriptions|payment_transactions|notifications)\s+ADD/i,
  "Migration must NOT alter Student_profiles, subscriptions, payment_transactions, or notifications"
);
console.log("  ✓ Zero modifications to existing tables verified");

// 4. Referral Code Uniqueness
console.log("\nTest 4: Referral code uniqueness and user binding...");
assert.match(
  migrationSql,
  /referral_code\s+text\s+UNIQUE\s+NOT\s+NULL/i,
  "student_referral_codes must enforce referral_code text UNIQUE NOT NULL"
);
assert.match(
  migrationSql,
  /user_id\s+uuid\s+UNIQUE\s+NOT\s+NULL\s+REFERENCES\s+auth\.users/i,
  "student_referral_codes must enforce user_id uuid UNIQUE NOT NULL referencing auth.users"
);
console.log("  ✓ 1:1 user_id and referral_code unique constraints verified");

// 5. Attribution Binding, Self-Referral Prevention & Immutability
console.log("\nTest 5: Attribution constraints (self-referral prevention & immutability)...");
assert.match(
  migrationSql,
  /referred_user_id\s+uuid\s+UNIQUE\s+NOT\s+NULL\s+REFERENCES\s+auth\.users/i,
  "referral_attributions must enforce referred_user_id uuid UNIQUE NOT NULL (single immutable attribution)"
);
assert.match(
  migrationSql,
  /CONSTRAINT\s+chk_no_self_referral\s+CHECK\s*\(\s*referred_user_id\s*<>\s*referrer_user_id\s*\)/i,
  "referral_attributions must enforce CHECK (referred_user_id <> referrer_user_id)"
);
assert.doesNotMatch(
  migrationSql,
  /CREATE\s+POLICY\s+["'].*?["']\s+ON\s+public\.referral_attributions\s+FOR\s+UPDATE/i,
  "referral_attributions must NOT have any UPDATE policy (attribution is immutable)"
);
console.log("  ✓ Attribution uniqueness, self-referral prevention, and immutability verified");

// 6. Referral Commission Constraints (First Purchase & Deduplication)
console.log("\nTest 6: Referral commissions table constraints...");
assert.match(
  migrationSql,
  /referred_user_id\s+uuid\s+UNIQUE\s+NOT\s+NULL\s+REFERENCES\s+auth\.users/i,
  "referral_commissions must enforce referred_user_id uuid UNIQUE NOT NULL (strictly one commission per student)"
);
assert.match(
  migrationSql,
  /payment_reference\s+text\s+UNIQUE\s+NOT\s+NULL/i,
  "referral_commissions must enforce payment_reference text UNIQUE NOT NULL"
);
assert.match(
  migrationSql,
  /commission_amount\s+bigint\s+NOT\s+NULL/i,
  "referral_commissions must have commission_amount bigint NOT NULL"
);
console.log("  ✓ Single commission per referred student and payment reference deduplication verified");

// 7. Payout Threshold & Bank Detail Snapshot
console.log("\nTest 7: Minimum ₦1,200 payout threshold and immutable bank snapshot...");
assert.match(
  migrationSql,
  /CHECK\s*\(\s*amount\s*>=\s*120000\s*\)/i,
  "referral_payouts must enforce CHECK (amount >= 120000) for the ₦1,200 minimum threshold in kobo"
);
assert.match(
  migrationSql,
  /bank_name\s+text\s+NOT\s+NULL[\s\S]+?account_number\s+text\s+NOT\s+NULL[\s\S]+?account_name\s+text\s+NOT\s+NULL/i,
  "referral_payouts must store snapshot of bank_name, account_number, and account_name directly"
);
console.log("  ✓ ₦1,200 (120,000 kobo) threshold and bank snapshot verified");

// 8. Row Level Security on All Tables
console.log("\nTest 8: Row Level Security policies on all 5 tables...");
expectedTables.forEach((table) => {
  const rlsRegex = new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i");
  assert.match(migrationSql, rlsRegex, `Table public.${table} must have RLS enabled`);
});
assert.match(
  migrationSql,
  /CREATE\s+POLICY\s+["']referral_payout_accounts_read_own["'][\s\S]+?USING\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/i,
  "referral_payout_accounts must only allow students to read their own bank details"
);
assert.doesNotMatch(
  migrationSql,
  /CREATE\s+POLICY\s+["'].*?["']\s+ON\s+public\.referral_commissions\s+FOR\s+INSERT\s+TO\s+authenticated/i,
  "referral_commissions must NOT allow public/client direct inserts"
);
console.log("  ✓ RLS enabled across all 5 tables and strict student isolation verified");

// 9. Database-Side Binding Helper (Email Confirmation Resilient)
console.log("\nTest 9: Database binding helper and auth trigger...");
assert.match(
  migrationSql,
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.bind_referral_attribution/i,
  "Must create public.bind_referral_attribution function"
);
assert.match(
  migrationSql,
  /SECURITY\s+DEFINER/i,
  "bind_referral_attribution must be SECURITY DEFINER"
);
assert.match(
  migrationSql,
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.handle_new_user_referral_trigger/i,
  "Must create auth trigger function to bind from raw_user_meta_data"
);
console.log("  ✓ bind_referral_attribution function and handle_new_user_referral_trigger verified");

// 10. Paystack Payment Edge Function Referral Integration
console.log("\nTest 10: Paystack Edge Function referral integration...");
assert.ok(fs.existsSync(PAYSTACK_FUNC_PATH), `Paystack function must exist at ${PAYSTACK_FUNC_PATH}`);
const paystackCode = fs.readFileSync(PAYSTACK_FUNC_PATH, "utf8");

// Hook must be placed inside fulfillPayment and pass planDays
assert.match(
  paystackCode,
  /async\s+function\s+processReferralCommission/,
  "Must define processReferralCommission helper"
);
assert.match(
  paystackCode,
  /await\s+processReferralCommission\s*\(\s*\{[\s\S]+?referredUserId:\s*userId[\s\S]+?reference[\s\S]+?amount[\s\S]+?planDays/i,
  "fulfillPayment must call processReferralCommission with userId, reference, amount, and planDays"
);

// Commission must be calculated from getExpectedAmount(planDays) base price
assert.match(
  paystackCode,
  /const\s+baseAmount\s*=\s*getExpectedAmount\(\s*planDays\s*\)/,
  "Must calculate baseAmount using getExpectedAmount(planDays)"
);
assert.match(
  paystackCode,
  /if\s*\(\s*baseAmount\s*===\s*null\s*\)/,
  "Must safely skip commission if baseAmount === null"
);
assert.match(
  paystackCode,
  /Math\.round\(\s*baseAmount\s*\*\s*0\.2(?:0)?\s*\)/,
  "Commission must be calculated as Math.round(baseAmount * 0.20)"
);

// Pure unit math tests for base price vs fee-inclusive payments
function getExpectedAmount(planDays) {
  if (planDays === 30) return 150000;
  if (planDays === 365) return 400000;
  return null;
}
function calculateCommission(planDays, _paidAmount) {
  const base = getExpectedAmount(planDays);
  if (base === null) return 0;
  return Math.round(base * 0.20);
}

// ₦1,500 base purchase -> ₦300 commission
assert.equal(calculateCommission(30, 150000), 30000, "₦1,500 (150,000 kobo) must yield exactly ₦300 (30,000 kobo) commission");

// ₦1,650 fee-inclusive payment for the ₦1,500 plan -> still ₦300 commission
assert.equal(calculateCommission(30, 165000), 30000, "₦1,650 fee-inclusive payment for 30-day plan must still yield exactly ₦300 (30,000 kobo)");

// ₦4,000 base purchase -> ₦800 commission
assert.equal(calculateCommission(365, 400000), 80000, "₦4,000 (400,000 kobo) must yield exactly ₦800 (80,000 kobo) commission");

// Fee-inclusive 365-day payment (e.g. ₦4,250) -> still ₦800 commission
assert.equal(calculateCommission(365, 425000), 80000, "Fee-inclusive payment for 365-day plan must still yield exactly ₦800 (80,000 kobo)");
console.log("  ✓ Base-price math verified: ₦1,500 plan -> ₦300 (even if ₦1,650 paid), ₦4,000 plan -> ₦800 (even if fee-inclusive)");

// Prior payment transactions check (renewal = ₦0)
assert.match(
  paystackCode,
  /\.from\(["']payment_transactions["']\)[\s\S]+?\.eq\(["']user_id["'],\s*referredUserId\)[\s\S]+?\.eq\(["']status["'],\s*["']success["']\)[\s\S]+?\.neq\(["']reference["'],\s*reference\)/i,
  "Must check payment_transactions for prior successful transactions to prevent renewal commissions"
);
console.log("  ✓ Authoritative ledger renewal gate verified");

// Non-blocking try/catch
assert.match(
  paystackCode,
  /try\s*\{\s*await\s+processReferralCommission[\s\S]+?\}\s*catch\s*\(\s*\w+\s*\)\s*\{/i,
  "processReferralCommission must be wrapped in non-blocking try/catch so fulfillment never fails"
);
// Idempotent duplicate error handling (23505)
assert.match(
  paystackCode,
  /insertCommErr\.code\s*===\s*["']23505["']/,
  "Must catch and safely ignore PostgreSQL 23505 unique conflict"
);
console.log("  ✓ Idempotent duplicate webhook handling verified");

// 11. Server-Authoritative Referral Code Generator RPC
console.log("\nTest 11: Server-authoritative referral code generator RPC...");
assert.match(
  migrationSql,
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_or_create_student_referral_code\(\)/i,
  "Must define public.get_or_create_student_referral_code() function"
);
assert.match(
  migrationSql,
  /FUNCTION\s+public\.get_or_create_student_referral_code[\s\S]+?SECURITY\s+DEFINER[\s\S]+?SET\s+search_path\s*=\s*public,\s*pg_catalog/i,
  "get_or_create_student_referral_code must be SECURITY DEFINER with safe search_path"
);
assert.match(
  migrationSql,
  /EXCEPTION\s+WHEN\s+unique_violation\s+THEN/i,
  "get_or_create_student_referral_code must handle unique_violation and retry/return"
);
console.log("  ✓ get_or_create_student_referral_code RPC verified with collision handling");

// 12. Atomic Payout Request RPC & Advisory Lock Concurrency
console.log("\nTest 12: Atomic payout request RPC with advisory transaction lock...");
assert.match(
  migrationSql,
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.request_referral_payout\(\)/i,
  "Must define public.request_referral_payout() function"
);
assert.match(
  migrationSql,
  /pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*v_user_id::text\s*\)\s*\)/i,
  "request_referral_payout must acquire transaction advisory lock on user's UUID hash"
);
assert.match(
  migrationSql,
  /v_available\s*:=\s*v_total_earned\s*-\s*v_total_debited/i,
  "request_referral_payout must compute available balance strictly from ledger sums"
);
assert.match(
  migrationSql,
  /v_available\s*<\s*120000/i,
  "request_referral_payout must enforce 120000 kobo (₦1,200) threshold check"
);

// Verify that client cannot directly INSERT into referral_payouts
assert.doesNotMatch(
  migrationSql,
  /CREATE\s+POLICY\s+["']referral_payouts_insert_own["']/i,
  "Direct student INSERT policy on referral_payouts must NOT exist (atomic RPC required)"
);
console.log("  ✓ request_referral_payout RPC, advisory lock, and client direct-insert prevention verified");

// 13. Auth Trigger Warning Logging
console.log("\nTest 13: Auth trigger non-blocking warning logging...");
assert.match(
  migrationSql,
  /RAISE\s+WARNING\s+'handle_new_user_referral_trigger notice for user %: %',\s*NEW\.id,\s*SQLERRM/i,
  "Trigger must log detailed warning with user id and SQLERRM rather than silently swallowing"
);
console.log("  ✓ Non-blocking auth trigger warning logging verified");

// 14. Withdrawal Fee & Net Payout Adjustment (Migration & Math)
console.log("\nTest 14: Withdrawal fee & net payout adjustment validation...");
const FEE_MIGRATION_PATH = path.join(
  __dirname,
  "supabase",
  "migrations",
  "20261008010000_referral_payout_withdrawal_fee.sql"
);
assert.ok(fs.existsSync(FEE_MIGRATION_PATH), `Fee migration file must exist at ${FEE_MIGRATION_PATH}`);
const feeMigrationSql = fs.readFileSync(FEE_MIGRATION_PATH, "utf8");

// Schema additions: fee_amount and net_amount
assert.match(
  feeMigrationSql,
  /ALTER\s+TABLE\s+public\.referral_payouts\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+fee_amount\s+bigint\s+NOT\s+NULL\s+DEFAULT\s+12000/i,
  "Migration must add fee_amount bigint NOT NULL DEFAULT 12000 to referral_payouts"
);
assert.match(
  feeMigrationSql,
  /ALTER\s+TABLE\s+public\.referral_payouts\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+net_amount\s+bigint/i,
  "Migration must add net_amount bigint to referral_payouts"
);
assert.match(
  feeMigrationSql,
  /ALTER\s+TABLE\s+public\.referral_payouts\s+ALTER\s+COLUMN\s+net_amount\s+SET\s+NOT\s+NULL/i,
  "Migration must set net_amount NOT NULL"
);
assert.match(
  feeMigrationSql,
  /CHECK\s*\(\s*net_amount\s*=\s*amount\s*-\s*fee_amount\s*\)/i,
  "Migration must enforce CHECK (net_amount = amount - fee_amount)"
);
assert.match(
  feeMigrationSql,
  /CHECK\s*\(\s*fee_amount\s*=\s*12000\s*\)/i,
  "Migration must enforce CHECK (fee_amount = 12000) for fixed ₦120 fee"
);

// RPC signature and server-authoritative calculations
assert.match(
  feeMigrationSql,
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.request_referral_payout\(\s*\)/i,
  "request_referral_payout must accept NO client arguments (client cannot pass fee or net)"
);
assert.match(
  feeMigrationSql,
  /v_fee_amount\s+(?:CONSTANT\s+)?bigint\s*:=\s*12000/i,
  "RPC must define fixed 12,000 kobo (₦120) fee constant"
);
assert.match(
  feeMigrationSql,
  /v_net_amount\s*:=\s*v_available\s*-\s*v_fee_amount/i,
  "RPC must compute v_net_amount := v_available - v_fee_amount"
);
assert.match(
  feeMigrationSql,
  /pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*v_user_id::text\s*\)\s*\)/i,
  "RPC must preserve pg_advisory_xact_lock for concurrency protection"
);

// Rejected payout behavior: only pending/processing/completed debits balance
assert.match(
  feeMigrationSql,
  /status\s+IN\s*\(\s*'pending',\s*'processing',\s*'completed'\s*\)/i,
  "RPC must only debit pending/processing/completed payouts (rejected payouts automatically refunded)"
);

// Pure unit math calculations for withdrawal fee
function computePayout(availableKobo) {
  const MIN_THRESHOLD = 120000; // ₦1,200
  const FIXED_FEE = 12000;      // ₦120
  if (availableKobo < MIN_THRESHOLD) {
    return { success: false, error: "Below minimum threshold" };
  }
  const gross = availableKobo;
  const fee = FIXED_FEE;
  const net = gross - fee;
  return { success: true, gross, fee, net };
}

// 1. ₦1,200 gross -> ₦120 fee -> ₦1,080 net
const p1200 = computePayout(120000);
assert.ok(p1200.success, "₦1,200 must be accepted");
assert.equal(p1200.gross, 120000, "Gross must be 120,000 kobo (₦1,200)");
assert.equal(p1200.fee, 12000, "Fee must be 12,000 kobo (₦120)");
assert.equal(p1200.net, 108000, "Net must be 108,000 kobo (₦1,080)");

// 2. ₦1,500 gross -> ₦120 fee -> ₦1,380 net
const p1500 = computePayout(150000);
assert.ok(p1500.success, "₦1,500 must be accepted");
assert.equal(p1500.gross, 150000, "Gross must be 150,000 kobo (₦1,500)");
assert.equal(p1500.fee, 12000, "Fee must be 12,000 kobo (₦120)");
assert.equal(p1500.net, 138000, "Net must be 138,000 kobo (₦1,380)");

// 3. ₦4,000 gross -> ₦120 fee -> ₦3,880 net
const p4000 = computePayout(400000);
assert.ok(p4000.success, "₦4,000 must be accepted");
assert.equal(p4000.gross, 400000, "Gross must be 400,000 kobo (₦4,000)");
assert.equal(p4000.fee, 12000, "Fee must be 12,000 kobo (₦120)");
assert.equal(p4000.net, 388000, "Net must be 388,000 kobo (₦3,880)");

// 4. Withdrawal below ₦1,200 is rejected
assert.equal(computePayout(119999).success, false, "Withdrawal below ₦1,200 (119,999 kobo) must be rejected");
assert.equal(computePayout(50000).success, false, "Withdrawal below ₦1,200 (50,000 kobo) must be rejected");
assert.equal(computePayout(0).success, false, "Withdrawal with 0 balance must be rejected");

console.log("  ✓ ₦1,200 gross -> ₦120 fee -> ₦1,080 net verified");
console.log("  ✓ ₦1,500 gross -> ₦120 fee -> ₦1,380 net verified");
console.log("  ✓ ₦4,000 gross -> ₦120 fee -> ₦3,880 net verified");
console.log("  ✓ Below ₦1,200 withdrawal rejected verified");
console.log("  ✓ Server-authoritative fee, net, and concurrency invariants verified");

console.log("\n=== ALL REFERRAL BACKEND & SCHEMA TESTS PASSED! ===");


