"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

console.log("=== RUNNING EXAMPILOT PHASE 7 NOTIFICATIONS FOUNDATION VALIDATION ===\n");

const MIGRATION_PATH = path.join(
  __dirname,
  "supabase",
  "migrations",
  "20261003230000_phase7_notifications_foundation.sql"
);

// 1. Verify Migration File Exists
console.log("Test 1: Migration file existence and naming convention...");
assert.ok(fs.existsSync(MIGRATION_PATH), `Migration file must exist at ${MIGRATION_PATH}`);
const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");
assert.ok(migrationSql.length > 0, "Migration file must not be empty");
console.log("  ✓ Migration file found and readable");

// 2. Schema Extensions on public.notifications
console.log("\nTest 2: Schema columns on public.notifications...");
assert.match(
  migrationSql,
  /category\s+text\s+NOT\s+NULL\s+DEFAULT\s+'personal'/i,
  "Migration must add 'category' as text NOT NULL DEFAULT 'personal'"
);
assert.match(
  migrationSql,
  /CHECK\s*\(\s*category\s+IN\s*\(\s*'personal'\s*,\s*'community'\s*,\s*'announcement'\s*\)\s*\)/i,
  "Migration must constrain category to ('personal', 'community', 'announcement')"
);
assert.match(
  migrationSql,
  /event_type\s+text/i,
  "Migration must add nullable 'event_type' text column"
);
assert.match(
  migrationSql,
  /event_key\s+text/i,
  "Migration must add nullable 'event_key' text column"
);
assert.match(
  migrationSql,
  /expires_at\s+timestamptz/i,
  "Migration must add 'expires_at' timestamptz column"
);
console.log("  ✓ All required columns (category, event_type, event_key, expires_at) verified");

// 3. Backfill and 7-day Expiry Logic
console.log("\nTest 3: Backfill and 7-day retention rules...");
assert.match(
  migrationSql,
  /UPDATE\s+public\.notifications\s+SET\s+expires_at\s*=\s*created_at\s*\+\s*interval\s+'7 days'/i,
  "Existing rows must be backfilled based on their own created_at + interval '7 days'"
);
assert.match(
  migrationSql,
  /ALTER\s+COLUMN\s+expires_at\s+SET\s+DEFAULT\s*\(now\(\)\s*\+\s*interval\s+'7 days'\)/i,
  "New rows must default to now() + interval '7 days'"
);
assert.match(
  migrationSql,
  /ALTER\s+COLUMN\s+expires_at\s+SET\s+NOT\s+NULL/i,
  "expires_at must be enforced as NOT NULL"
);
console.log("  ✓ Backfill based on created_at and 7-day default retention verified");

// 4. Idempotency & Unique Partial Index on event_key
console.log("\nTest 4: Unique event_key protection...");
assert.match(
  migrationSql,
  /CREATE\s+UNIQUE\s+INDEX[\s\S]+?ON\s+public\.notifications\s*\(\s*event_key\s*\)\s*WHERE\s+event_key\s+IS\s+NOT\s+NULL/i,
  "Unique partial index must exist on event_key WHERE event_key IS NOT NULL"
);
console.log("  ✓ Unique partial index on event_key verified");

// 5. Server-Side Read State (public.notification_reads)
console.log("\nTest 5: public.notification_reads structure and constraints...");
assert.match(
  migrationSql,
  /CREATE\s+TABLE[^\n]+public\.notification_reads/i,
  "public.notification_reads table must be created"
);
assert.match(
  migrationSql,
  /notification_id\s+bigint\s+NOT\s+NULL\s+REFERENCES\s+public\.notifications\(id\)\s+ON\s+DELETE\s+CASCADE/i,
  "notification_id must reference public.notifications(id) ON DELETE CASCADE"
);
assert.match(
  migrationSql,
  /user_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+auth\.users\(id\)\s+ON\s+DELETE\s+CASCADE/i,
  "user_id must reference auth.users(id) ON DELETE CASCADE"
);
assert.match(
  migrationSql,
  /PRIMARY\s+KEY\s*\(\s*notification_id\s*,\s*user_id\s*\)/i,
  "public.notification_reads must have a composite PRIMARY KEY (notification_id, user_id)"
);
console.log("  ✓ Table structure, foreign keys with CASCADE, and composite primary key verified");

// 6. RLS on public.notification_reads
console.log("\nTest 6: Row Level Security on public.notification_reads...");
assert.match(
  migrationSql,
  /ALTER\s+TABLE\s+public\.notification_reads\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
  "RLS must be enabled on public.notification_reads"
);
assert.match(
  migrationSql,
  /CREATE\s+POLICY\s+"notification_reads_select_own"[\s\S]+?FOR\s+SELECT[\s\S]+?USING\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/i,
  "Students can SELECT only their own read receipts"
);
assert.match(
  migrationSql,
  /CREATE\s+POLICY\s+"notification_reads_insert_own"[\s\S]+?FOR\s+INSERT[\s\S]+?WITH\s+CHECK\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/i,
  "Students can INSERT only their own read receipts"
);
assert.match(
  migrationSql,
  /CREATE\s+POLICY\s+"notification_reads_update_own"[\s\S]+?FOR\s+UPDATE[\s\S]+?USING\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)[\s\S]+?WITH\s+CHECK\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/i,
  "Students can UPDATE only their own read receipts"
);
assert.match(
  migrationSql,
  /CREATE\s+POLICY\s+"notification_reads_delete_own"[\s\S]+?FOR\s+DELETE[\s\S]+?USING\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/i,
  "Students can DELETE only their own read receipts"
);
// Confirm no policies grant students INSERT/UPDATE/DELETE on notifications itself
assert.ok(
  !migrationSql.includes('CREATE POLICY "notifications_student_insert"'),
  "Students must NOT be granted insert policies on notifications table"
);
assert.ok(
  !migrationSql.includes('CREATE POLICY "notifications_student_update"'),
  "Students must NOT be granted update policies on notifications table"
);
console.log("  ✓ Student-scoped RLS verified (CRUD on reads only; no student write access on notifications)");

// 7. Expiry Cleanup Function
console.log("\nTest 7: Expiry cleanup function public.cleanup_expired_notifications()...");
assert.match(
  migrationSql,
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.cleanup_expired_notifications\(\)/i,
  "Function public.cleanup_expired_notifications() must be defined"
);
assert.match(
  migrationSql,
  /DELETE\s+FROM\s+public\.notifications\s+WHERE\s+expires_at\s*<=\s*now\(\)/i,
  "Function must delete notifications WHERE expires_at <= now()"
);
assert.match(
  migrationSql,
  /SECURITY\s+DEFINER/i,
  "Function must be declared SECURITY DEFINER"
);
assert.match(
  migrationSql,
  /SET\s+search_path\s*=\s*public\s*,\s*pg_catalog/i,
  "Function must secure search_path"
);
console.log("  ✓ cleanup_expired_notifications() verified with SECURITY DEFINER and safe search_path");

// 8. Integrity check: Protected Files remain untouched by notifications changes
console.log("\nTest 8: Protected files remain untouched...");
const gitStatus = execSync("git status --porcelain", { encoding: "utf8" });
const changedFiles = gitStatus
  .split("\n")
  .filter(Boolean)
  .map((line) => line.slice(3).trim().replace(/^"|"$/g, ""));

const protectedFiles = [
  "Paystack.js",
  "challenge.html",
  "cbt.html",
  "exam.js",
  "questions.js",
  "questions_clean_baseline_4900.js",
  "novels.html",
  "novels.js",
  "supabase/functions/send-push-notification/index.ts"
];

// Notification-specific patterns that must NEVER be injected into protected files
const unauthorizedNotificationPatterns = [
  /notifications/i,
  /notification_reads/i,
  /push-notifications/i,
  /send-push-notification/i,
  /loadStudentNotifications/i,
  /openNotifications/i
];

// Core protected files that must have zero diff whatsoever
const strictlyUntouchedFiles = [
  "Paystack.js",
  "exam.js",
  "questions.js",
  "questions_clean_baseline_4900.js",
  "novels.js",
  "supabase/functions/send-push-notification/index.ts"
];

protectedFiles.forEach((file) => {
  const isChanged = changedFiles.includes(file);
  if (strictlyUntouchedFiles.includes(file)) {
    assert.ok(!isChanged, `Protected file was touched: ${file}`);
    console.log(`  ✓ ${file} is untouched`);
  } else if (isChanged) {
    // For protected student pages that received legitimate updates in other approved phases
    // (such as SEO meta tags or image dimensions), verify no unauthorized notifications logic was added.
    const fileDiff = execSync(`git diff ${file}`, { encoding: "utf8" });
    const addedLines = fileDiff
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .join("\n");

    unauthorizedNotificationPatterns.forEach((pattern) => {
      assert.ok(
        !pattern.test(addedLines),
        `Protected file ${file} contains unauthorized notifications code matching ${pattern}`
      );
    });
    console.log(`  ✓ ${file} is verified (no unauthorized notifications modifications; legitimate phase changes preserved)`);
  } else {
    console.log(`  ✓ ${file} is untouched`);
  }
});

// 9. Edge Function (send-push-notification) Phase 7 Stage 1 Checks
console.log("\nTest 9: send-push-notification Stage 1 infrastructure...");
const edgeFuncPath = path.join(
  __dirname,
  "supabase",
  "functions",
  "send-push-notification",
  "index.ts"
);
assert.ok(fs.existsSync(edgeFuncPath), `send-push-notification must exist at ${edgeFuncPath}`);
const edgeFuncCode = fs.readFileSync(edgeFuncPath, "utf8");

// Category support & announcement default
assert.match(
  edgeFuncCode,
  /const\s+category\s*=\s*rawCategory\s*\|\|\s*"announcement"/i,
  "Default category for admin notifications must be 'announcement'"
);
// Invalid category rejection
assert.match(
  edgeFuncCode,
  /!\["personal",\s*"community",\s*"announcement"\]\.includes\(category\)/i,
  "Must validate category against ['personal', 'community', 'announcement'] and reject invalid values"
);
// event_type and event_key support
assert.match(
  edgeFuncCode,
  /const\s+eventType\s*=/i,
  "event_type support must exist"
);
assert.match(
  edgeFuncCode,
  /const\s+eventKey\s*=/i,
  "event_key support must exist"
);
assert.match(
  edgeFuncCode,
  /const\s+expiresAt\s*=/i,
  "expires_at support must exist"
);
// Duplicate / idempotency handling on event_key
assert.match(
  edgeFuncCode,
  /notificationError\.code\s*===\s*"23505"\s*&&\s*eventKey/i,
  "Must catch unique violation 23505 on event_key"
);
assert.match(
  edgeFuncCode,
  /already_exists:\s*true/i,
  "Must return graceful already_exists: true when duplicate event_key is detected"
);
// Existing admin authorization and target audience semantics preserved
assert.match(
  edgeFuncCode,
  /isAdmin\(user\)/i,
  "Existing admin authentication must remain intact"
);
assert.match(
  edgeFuncCode,
  /targetType\s*===\s*"specific"/i,
  "Target audience semantics must remain intact"
);
assert.match(
  edgeFuncCode,
  /webpush\.sendNotification/i,
  "Web Push sending logic must be preserved"
);
console.log("  ✓ Category validation and announcement default verified");
console.log("  ✓ event_type, event_key, and expires_at payload mapping verified");
console.log("  ✓ Idempotent duplicate event_key handling (23505) verified");
console.log("  ✓ Existing admin authorization and Web Push flow verified");

// 10. Dashboard Stage 2 Read State Synchronization Checks
console.log("\nTest 10: dashboard.html Stage 2 read synchronization with notification_reads...");
const dashboardPath = path.join(__dirname, "dashboard.html");
assert.ok(fs.existsSync(dashboardPath), `dashboard.html must exist at ${dashboardPath}`);
const dashboardCode = fs.readFileSync(dashboardPath, "utf8");

// Dashboard queries notification_reads
assert.match(
  dashboardCode,
  /\.from\(['"]notification_reads['"]\)/,
  "dashboard.html must query public.notification_reads"
);
// Keyed by authenticated student
assert.match(
  dashboardCode,
  /\.eq\(['"]user_id['"],\s*dashboardCurrentUser\.id\)/,
  "Read state queries must be keyed strictly by dashboardCurrentUser.id"
);
// Notification open/read writes a receipt via idempotent upsert
assert.match(
  dashboardCode,
  /\.from\(['"]notification_reads['"]\)[\s\S]+?\.upsert\(/,
  "Opening a notification must write to notification_reads via upsert"
);
assert.match(
  dashboardCode,
  /onConflict:\s*['"]notification_id,user_id['"]/i,
  "Read receipt upsert must specify onConflict: 'notification_id,user_id' for idempotency"
);
// Database read state takes priority over localStorage
assert.match(
  dashboardCode,
  /dashboardReadStateLoaded\s*=\s*true/i,
  "Database read state must set dashboardReadStateLoaded flag"
);
assert.match(
  dashboardCode,
  /if\s*\(\s*dashboardReadStateLoaded/i,
  "getReadNotificationIds must prioritize database read state when loaded"
);
// LocalStorage remains only a fallback/cache
assert.match(
  dashboardCode,
  /getLocalStorageReadNotificationIds\(\)/,
  "getLocalStorageReadNotificationIds fallback must be preserved"
);
assert.match(
  dashboardCode,
  /saveLocalStorageReadNotificationIds\(/,
  "saveLocalStorageReadNotificationIds cache must be preserved"
);
// Failure of read-state operations does not break notification loading/opening
assert.match(
  dashboardCode,
  /catch\s*\(\s*readErr\s*\)[\s\S]+?getLocalStorageReadNotificationIds\(\)/i,
  "Read state query error must fall back gracefully to localStorage without crashing loading"
);
assert.match(
  dashboardCode,
  /catch\s*\(\s*err\s*\)[\s\S]+?notification_reads/i,
  "Read receipt upsert error must be caught gracefully without preventing notification display"
);
console.log("  ✓ Queries public.notification_reads for authenticated student verified");
console.log("  ✓ Idempotent upsert (notification_id, user_id) on notification open verified");
console.log("  ✓ Database priority with graceful localStorage fallback verified");
console.log("  ✓ Non-crashing error handling on read-state failure verified");

// 11. Paystack Stage 3 Subscription Notifications Hook Checks
console.log("\nTest 11: Paystack_payment/index.ts Stage 3 subscription notification hook...");
const paystackPath = path.join(
  __dirname,
  "supabase",
  "functions",
  "Paystack_payment",
  "index.ts"
);
assert.ok(fs.existsSync(paystackPath), `Paystack_payment index.ts must exist at ${paystackPath}`);
const paystackCode = fs.readFileSync(paystackPath, "utf8");

// Hook location: inside fulfillPayment, after savedSub assignment and before return
assert.match(
  paystackCode,
  /savedSub\s*=\s*(?:newSub|updatedSub);[\s\S]+?Phase 7[\s\S]+?return\s*\{[\s\S]+?success:\s*true/i,
  "Subscription notification hook must be positioned after savedSub is set and before successful return"
);

// Entire hook wrapped in non-blocking try/catch
assert.match(
  paystackCode,
  /try\s*\{[\s\S]+?catch\s*\(\s*notifErr\s*\)\s*\{[\s\S]+?console\.error\(/i,
  "Subscription notification hook must be wrapped in its own outer try/catch with console.error"
);

// Profile lookup for display name privacy
assert.match(
  paystackCode,
  /\.from\(['"]Student_profiles['"]\)[\s\S]+?\.select\(['"]Full_name,\s*Username['"]\)/,
  "Must query Student_profiles for Full_name and Username"
);
assert.match(
  paystackCode,
  /displayName\s*=\s*`@\$\{rawUsername\.replace\(/,
  "Must prefix non-empty username with @ for display name"
);
assert.match(
  paystackCode,
  /const\s+firstName\s*=\s*rawFullName\.split\(/,
  "Must extract first name from Full_name when username is missing"
);
assert.match(
  paystackCode,
  /let\s+displayName\s*=\s*["']A fellow student["']/,
  "Must default to 'A fellow student' fallback"
);

// Privacy assertion: customerEmail, userId, reference are NOT used as displayName
assert.doesNotMatch(
  paystackCode,
  /displayName\s*=\s*(?:customerEmail|userId|reference)/,
  "Must NEVER use customerEmail, userId, or payment reference as public displayName"
);

// Private notification fields
assert.match(
  paystackCode,
  /title:\s*["']🎉 Welcome to ExamPilot Premium!["']/,
  "Private notification must have welcome title"
);
assert.match(
  paystackCode,
  /target_type:\s*["']specific["'][\s\S]+?target_user_id:\s*userId[\s\S]+?category:\s*["']personal["'][\s\S]+?event_type:\s*["']subscription_activated["'][\s\S]+?event_key:\s*`sub_private:\$\{reference\}`/i,
  "Private notification must have correct target_type, target_user_id, category, event_type, and event_key"
);

// Community notification fields
assert.match(
  paystackCode,
  /title:\s*["']🎉 New Premium Member!["']/,
  "Community notification must have new member title"
);
assert.match(
  paystackCode,
  /target_type:\s*["']all["'][\s\S]+?category:\s*["']community["'][\s\S]+?event_type:\s*["']community_subscription["'][\s\S]+?event_key:\s*`sub_community:\$\{reference\}`/i,
  "Community notification must have target_type 'all', category 'community', event_type 'community_subscription', and event_key 'sub_community:${reference}'"
);

// PostgreSQL duplicate key (23505) handling
assert.match(
  paystackCode,
  /privateNotifErr\.code\s*===\s*["']23505["']/,
  "Must catch and ignore duplicate 23505 error for private notification"
);
assert.match(
  paystackCode,
  /commNotifErr\.code\s*===\s*["']23505["']/,
  "Must catch and ignore duplicate 23505 error for community notification"
);

// Independence of notification insertions
assert.match(
  paystackCode,
  /catch\s*\(\s*privErr\s*\)[\s\S]+?try\s*\{[\s\S]+?sub_community/i,
  "Private notification must be in its own sub-block so failures do not prevent community notification"
);

// Web Push function is NOT called
assert.doesNotMatch(
  paystackCode,
  /send-push-notification/i,
  "Paystack fulfillment must not invoke send-push-notification edge function"
);

console.log("  ✓ Hook location after savedSub and before return verified");
console.log("  ✓ Outer and inner non-blocking try/catch isolation verified");
console.log("  ✓ Student profile lookup and privacy display name hierarchy verified");
console.log("  ✓ Private notification payload (personal / subscription_activated) verified");
console.log("  ✓ Community notification payload (community / community_subscription) verified");
console.log("  ✓ PostgreSQL 23505 duplicate event_key handling verified");
console.log("  ✓ Independent notification creation verified");
console.log("  ✓ No Web Push invocation verified");

// 12. Daily Challenge Reminder Migration Checks (Stage 4)
console.log("\nTest 12: Daily Challenge Reminder Migration Checks (Stage 4)...");
const STAGE4_MIGRATION_PATH = path.join(
  __dirname,
  "supabase",
  "migrations",
  "20261004000000_phase7_daily_challenge_reminder.sql"
);

// 1. Migration exists with exact approved filename
assert.ok(
  fs.existsSync(STAGE4_MIGRATION_PATH),
  `Stage 4 migration must exist at ${STAGE4_MIGRATION_PATH}`
);
const stage4Sql = fs.readFileSync(STAGE4_MIGRATION_PATH, "utf8");
assert.ok(stage4Sql.length > 0, "Stage 4 migration must not be empty");
console.log("  ✓ Migration exists with exact approved filename");

// 2. Africa/Lagos date logic is used
assert.match(
  stage4Sql,
  /now\(\)\s+AT\s+TIME\s+ZONE\s+'Africa\/Lagos'/i,
  "Server-side Africa/Lagos timezone must be used for date calculation"
);
console.log("  ✓ Africa/Lagos server-side date logic verified");

// 3. public.challenge_attempts is the authoritative completion source
assert.match(
  stage4Sql,
  /FROM\s+public\.challenge_attempts\s+ca/i,
  "public.challenge_attempts must be queried as authoritative completion source"
);
console.log("  ✓ public.challenge_attempts authoritative completion source verified");

// 4 & 5. Completed students excluded, uncompleted eligible
assert.match(
  stage4Sql,
  /NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.challenge_attempts\s+ca\s+WHERE\s+ca\.user_id\s*=\s*sp\.id\s+AND\s+ca\.challenge_date\s*=\s*p_challenge_date\s*\)/i,
  "Students who have completed today's challenge must be excluded, leaving uncompleted students eligible"
);
console.log("  ✓ Completed students excluded and uncompleted students eligible verified");

// 6. Admin users are excluded
assert.match(
  stage4Sql,
  /COALESCE\s*\(\s*sp\.is_admin\s*,\s*false\s*\)\s*=\s*false/i,
  "Admin users must be excluded via COALESCE(is_admin, false) = false"
);
console.log("  ✓ Admin exclusion verified");

// 7. event_type = challenge_reminder
assert.match(
  stage4Sql,
  /'challenge_reminder'\s+AS\s+event_type/i,
  "event_type must be challenge_reminder"
);
console.log("  ✓ event_type = challenge_reminder verified");

// 8. category = personal
assert.match(
  stage4Sql,
  /'personal'\s+AS\s+category/i,
  "category must be personal"
);
console.log("  ✓ category = personal verified");

// 9 & 10. event_key format: challenge_reminder:<user_id>:<YYYY-MM-DD> and deterministic
assert.match(
  stage4Sql,
  /'challenge_reminder:'\s*\|\|\s*es\.user_id(?:::text)?\s*\|\|\s*':'\s*\|\|\s*v_today_str\s+AS\s+event_key/i,
  "event_key must follow deterministic format: challenge_reminder:<user_id>:<YYYY-MM-DD>"
);
console.log("  ✓ Deterministic event_key format challenge_reminder:<user_id>:<YYYY-MM-DD> verified");

// 11. ON CONFLICT DO NOTHING / idempotency is present
assert.match(
  stage4Sql,
  /ON\s+CONFLICT[\s\S]+?DO\s+NOTHING/i,
  "ON CONFLICT DO NOTHING must be present for idempotency"
);
console.log("  ✓ ON CONFLICT DO NOTHING idempotency verified");

// 12. destination is ./challenge.html
assert.match(
  stage4Sql,
  /'\.\/challenge\.html'\s+AS\s+destination_url/i,
  "destination_url must be ./challenge.html"
);
console.log("  ✓ destination_url = ./challenge.html verified");

// 13. 7-day expiry is present
assert.match(
  stage4Sql,
  /now\(\)\s*\+\s*interval\s+'7 days'\s+AS\s+expires_at/i,
  "expires_at must be 7 days from creation"
);
console.log("  ✓ 7-day expiry verified");

// 14. pg_cron is not attempted or installed (unavailable in project)
assert.doesNotMatch(
  stage4Sql,
  /cron\.schedule/i,
  "Migration must not register pg_cron schedule when pg_cron is unavailable"
);
assert.doesNotMatch(
  stage4Sql,
  /CREATE\s+EXTENSION[\s\S]+?pg_cron/i,
  "Migration must not attempt to install pg_cron"
);
console.log("  ✓ No pg_cron schedule registration or forced extension installation verified");

// 15. Security: SECURITY DEFINER and safe search_path
assert.match(
  stage4Sql,
  /SECURITY\s+DEFINER/i,
  "Function must be SECURITY DEFINER"
);
assert.match(
  stage4Sql,
  /SET\s+search_path\s*=\s*public\s*,\s*pg_catalog/i,
  "Function must explicitly set safe search_path"
);
assert.match(
  stage4Sql,
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.generate_daily_challenge_reminders/i,
  "Must revoke execution from PUBLIC"
);
assert.match(
  stage4Sql,
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.generate_daily_challenge_reminders/i,
  "Must grant execution to service_role"
);
console.log("  ✓ SECURITY DEFINER, search_path, and service_role permissions verified");

console.log("\n=== ALL PHASE 7 NOTIFICATIONS STAGE 4 CHECKS PASSED SUCCESSFULLY! ===");


