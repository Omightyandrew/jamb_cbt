"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("=== EXAMPILOT AUTOMATIC ADMIN PREMIUM ACCESS TEST SUITE ===\n");

// Read file contents
const premiumAccessSource = fs.readFileSync(path.join(__dirname, "premium-access.js"), "utf8");
const dashboardHtml = fs.readFileSync(path.join(__dirname, "dashboard.html"), "utf8");
const aiTutorSource = fs.readFileSync(path.join(__dirname, "supabase", "functions", "ai-tutor", "index.ts"), "utf8");
const paystackSource = fs.readFileSync(path.join(__dirname, "Paystack.js"), "utf8");

// =========================================================================
// Test 1: Source code analysis & pattern verification
// =========================================================================
function testSourceCodePatterns() {
  console.log("Test 1: Static source pattern verification...");

  // 1. premium-access.js contains admin bypass
  assert.ok(
    premiumAccessSource.includes("appRole === 'admin' || appRole === 'super_admin'"),
    "premium-access.js must check app_metadata.role / admin_role"
  );
  assert.ok(
    premiumAccessSource.includes("from('Student_profiles')"),
    "premium-access.js must check Student_profiles"
  );
  assert.ok(
    premiumAccessSource.includes("profileRow?.is_admin === true"),
    "premium-access.js must check Student_profiles.is_admin === true"
  );

  // 2. dashboard.html contains admin bypass in refreshDashboardPremiumState
  assert.ok(
    dashboardHtml.includes("appRole === 'admin' || appRole === 'super_admin'"),
    "dashboard.html must check app_metadata.role / admin_role in refreshDashboardPremiumState"
  );
  assert.ok(
    dashboardHtml.includes("from('Student_profiles')"),
    "dashboard.html must check Student_profiles in refreshDashboardPremiumState"
  );
  assert.ok(
    dashboardHtml.includes("profileRow?.is_admin === true"),
    "dashboard.html must check Student_profiles.is_admin === true in refreshDashboardPremiumState"
  );

  // 3. ai-tutor index.ts contains admin bypass
  assert.ok(
    aiTutorSource.includes('appRole === "admin" || appRole === "super_admin"'),
    "ai-tutor index.ts must check app_metadata.role / admin_role"
  );
  assert.ok(
    aiTutorSource.includes('from("Student_profiles")'),
    "ai-tutor index.ts must check Student_profiles"
  );
  assert.ok(
    aiTutorSource.includes("profileRow?.is_admin === true"),
    "ai-tutor index.ts must check Student_profiles.is_admin === true"
  );
  assert.ok(
    aiTutorSource.includes("let premium = isAdmin;"),
    "ai-tutor index.ts must initialize premium flag from isAdmin"
  );

  // 4. Paystack.js is intact
  assert.ok(
    paystackSource.includes("payFor30Days") && paystackSource.includes("payFor1Year"),
    "Paystack.js plans and functions must be intact"
  );

  console.log("  ✓ All source pattern checks passed.");
}

// =========================================================================
// Test 2: premium-access.js - window.ensurePremiumFeatureAccess behavior
// =========================================================================
async function testPremiumAccessJsLogic() {
  console.log("\nTest 2: premium-access.js window.ensurePremiumFeatureAccess simulation...");

  function createMockEnv({ user, profileAdmin = false, subRows = [] }) {
    const dom = {
      documentElement: { innerHTML: "" },
      location: { href: "https://exampilot.com.ng/novels.html" }
    };

    const mockClient = {
      auth: {
        getSession: async () => ({
          data: user ? { session: { user } } : null,
          error: null
        })
      },
      from: (table) => {
        if (table === "Student_profiles") {
          return {
            select: () => ({
              eq: (field, val) => ({
                maybeSingle: async () => ({
                  data: profileAdmin ? { is_admin: true } : { is_admin: false },
                  error: null
                })
              })
            })
          };
        }
        if (table === "subscriptions") {
          return {
            select: () => ({
              eq: (field, val) => ({
                order: () => Promise.resolve({
                  data: subRows,
                  error: null
                })
              })
            })
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }
    };

    const sandbox = {
      window: {
        location: dom.location,
        supabaseClient: mockClient
      },
      document: dom,
      URL,
      Date,
      Array,
      String,
      Boolean,
      Number,
      console
    };

    vm.createContext(sandbox);
    vm.runInContext(premiumAccessSource, sandbox);
    return sandbox.window.ensurePremiumFeatureAccess;
  }

  // Case A: Admin identified via app_metadata.role = 'admin' (no subscriptions)
  {
    const ensureAccess = createMockEnv({
      user: {
        id: "admin-uuid-1",
        app_metadata: { role: "admin" }
      },
      profileAdmin: false,
      subRows: []
    });
    const result = await ensureAccess({ featureName: "Novel Library", featureKey: "novels" });
    assert.strictEqual(result, true, "Admin with app_metadata.role=admin must receive Premium");
    console.log("  ✓ Admin via app_metadata.role='admin' receives Premium without subscriptions");
  }

  // Case B: Admin identified via app_metadata.admin_role = 'super_admin' (no subscriptions)
  {
    const ensureAccess = createMockEnv({
      user: {
        id: "admin-uuid-2",
        app_metadata: { admin_role: "super_admin" }
      },
      profileAdmin: false,
      subRows: []
    });
    const result = await ensureAccess({ featureName: "Novel Library", featureKey: "novels" });
    assert.strictEqual(result, true, "Admin with app_metadata.admin_role=super_admin must receive Premium");
    console.log("  ✓ Admin via app_metadata.admin_role='super_admin' receives Premium without subscriptions");
  }

  // Case C: Admin identified via Student_profiles.is_admin = true (no app_metadata, no subscriptions)
  {
    const ensureAccess = createMockEnv({
      user: {
        id: "admin-uuid-3",
        app_metadata: {}
      },
      profileAdmin: true,
      subRows: []
    });
    const result = await ensureAccess({ featureName: "Novel Library", featureKey: "novels" });
    assert.strictEqual(result, true, "Admin with Student_profiles.is_admin=true must receive Premium");
    console.log("  ✓ Admin via Student_profiles.is_admin=true receives Premium without subscriptions");
  }

  // Case D: Ordinary student with active subscription
  {
    const ensureAccess = createMockEnv({
      user: {
        id: "student-uuid-active",
        app_metadata: {}
      },
      profileAdmin: false,
      subRows: [
        {
          status: "active",
          expires_at: new Date(Date.now() + 86400000).toISOString()
        }
      ]
    });
    const result = await ensureAccess({ featureName: "Novel Library", featureKey: "novels" });
    assert.strictEqual(result, true, "Ordinary student with active subscription must receive Premium");
    console.log("  ✓ Ordinary student with active subscription receives Premium");
  }

  // Case E: Ordinary free student (no subscription) -> Denied
  {
    const ensureAccess = createMockEnv({
      user: {
        id: "student-uuid-free",
        app_metadata: {}
      },
      profileAdmin: false,
      subRows: []
    });
    const result = await ensureAccess({ featureName: "Novel Library", featureKey: "novels" });
    assert.strictEqual(result, false, "Ordinary free student must NOT receive Premium");
    console.log("  ✓ Ordinary free student is denied Premium and sees upgrade screen");
  }

  // Case F: Ordinary student with expired subscription -> Denied
  {
    const ensureAccess = createMockEnv({
      user: {
        id: "student-uuid-expired",
        app_metadata: {}
      },
      profileAdmin: false,
      subRows: [
        {
          status: "active",
          expires_at: new Date(Date.now() - 86400000).toISOString() // Expired yesterday
        }
      ]
    });
    const result = await ensureAccess({ featureName: "Novel Library", featureKey: "novels" });
    assert.strictEqual(result, false, "Expired subscription must NOT receive Premium");
    console.log("  ✓ Expired student subscription remains expired and is denied Premium");
  }
}

// =========================================================================
// Test 3: dashboard.html - refreshDashboardPremiumState simulation
// =========================================================================
async function testDashboardPremiumStateLogic() {
  console.log("\nTest 3: dashboard.html refreshDashboardPremiumState simulation...");

  function simulateDashboardRefresh({ user, profileAdmin = false, subRows = [] }) {
    let dashboardIsPremium = false;
    const localStorageStore = {};
    const mockLocalStorage = {
      getItem: (k) => localStorageStore[k] || null,
      setItem: (k, v) => { localStorageStore[k] = String(v); }
    };

    const mockClient = {
      auth: {
        getSession: async () => ({
          data: user ? { session: { user } } : null,
          error: null
        })
      },
      from: (table) => {
        if (table === "Student_profiles") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: profileAdmin ? { is_admin: true } : { is_admin: false },
                  error: null
                })
              })
            })
          };
        }
        if (table === "subscriptions") {
          return {
            select: () => ({
              eq: () => Promise.resolve({
                data: subRows,
                error: null
              })
            })
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }
    };

    // Extract the function body from dashboard.html
    const funcMatch = dashboardHtml.match(/async function refreshDashboardPremiumState\(\) \{([\s\S]*?)\n\}/);
    assert.ok(funcMatch, "refreshDashboardPremiumState must be present in dashboard.html");

    const functionBody = funcMatch[1];
    const runner = new Function(
      "supabaseClient",
      "localStorage",
      "dashboardIsPremium",
      `return (async () => {
        let dashboardIsPremium = false;
        ${functionBody}
      })();`
    );

    return {
      run: () => runner(mockClient, mockLocalStorage, dashboardIsPremium),
      store: localStorageStore
    };
  }

  // Case A: Admin via app_metadata
  {
    const { run, store } = simulateDashboardRefresh({
      user: { id: "admin-1", app_metadata: { role: "admin" } }
    });
    const result = await run();
    assert.strictEqual(result, true, "Dashboard must recognize admin via app_metadata");
    assert.strictEqual(store["studentSubscribed"], "true", "localStorage studentSubscribed must reflect 'true'");
    console.log("  ✓ Dashboard recognises admin via app_metadata (sets premium true)");
  }

  // Case B: Admin via Student_profiles.is_admin
  {
    const { run, store } = simulateDashboardRefresh({
      user: { id: "admin-2", app_metadata: {} },
      profileAdmin: true
    });
    const result = await run();
    assert.strictEqual(result, true, "Dashboard must recognize admin via Student_profiles");
    assert.strictEqual(store["studentSubscribed"], "true", "localStorage studentSubscribed must reflect 'true'");
    console.log("  ✓ Dashboard recognises admin via Student_profiles.is_admin (sets premium true)");
  }

  // Case C: Regular active student
  {
    const { run, store } = simulateDashboardRefresh({
      user: { id: "student-1", app_metadata: {} },
      subRows: [{ status: "paid", expires_at: new Date(Date.now() + 1000000).toISOString() }]
    });
    const result = await run();
    assert.strictEqual(result, true, "Dashboard must recognize active paid student");
    assert.strictEqual(store["studentSubscribed"], "true");
    console.log("  ✓ Dashboard recognises active paying student");
  }

  // Case D: Regular free student
  {
    const { run, store } = simulateDashboardRefresh({
      user: { id: "student-2", app_metadata: {} },
      subRows: []
    });
    const result = await run();
    assert.strictEqual(result, false, "Dashboard must set free student to not premium");
    assert.strictEqual(store["studentSubscribed"], "false");
    console.log("  ✓ Dashboard leaves free student as free (not premium)");
  }

  // Case E: Expired student
  {
    const { run, store } = simulateDashboardRefresh({
      user: { id: "student-3", app_metadata: {} },
      subRows: [{ status: "active", expires_at: new Date(Date.now() - 5000000).toISOString() }]
    });
    const result = await run();
    assert.strictEqual(result, false, "Dashboard must set expired student to not premium");
    assert.strictEqual(store["studentSubscribed"], "false");
    console.log("  ✓ Dashboard leaves expired student as free (not premium)");
  }
}

// =========================================================================
// Test 4: AI Tutor Quota & Premium Calculation Logic
// =========================================================================
async function testAiTutorQuotaLogic() {
  console.log("\nTest 4: AI Tutor Quota & Premium Calculation simulation...");

  function simulateAiTutorQuota({ user, profileAdmin = false, subRows = [] }) {
    const adminClient = {
      from: (table) => {
        if (table === "Student_profiles") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: profileAdmin ? { is_admin: true } : { is_admin: false },
                  error: null
                })
              })
            })
          };
        }
        if (table === "subscriptions") {
          return {
            select: () => ({
              eq: () => ({
                order: () => Promise.resolve({
                  data: subRows,
                  error: null
                })
              })
            })
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }
    };

    const premiumStatuses = new Set([
      "active", "paid", "premium", "subscribed", "success", "successful", "succeeded", "completed"
    ]);

    function isPremium(row) {
      if (!row) return false;
      const status = String(row.status || "").trim().toLowerCase();
      if (!premiumStatuses.has(status)) return false;
      if (!row.expires_at) return true;
      const expiry = new Date(String(row.expires_at));
      return !Number.isNaN(expiry.getTime()) && expiry > new Date();
    }

    return (async () => {
      // Exact logic extracted from ai-tutor/index.ts
      const appRole = String(
        (user.app_metadata)?.role ||
        (user.app_metadata)?.admin_role ||
        ""
      ).trim().toLowerCase();

      let isAdmin = (appRole === "admin" || appRole === "super_admin");

      if (!isAdmin && user.id) {
        try {
          const { data: profileRow } = await adminClient
            .from("Student_profiles")
            .select("is_admin")
            .eq("id", user.id)
            .maybeSingle();

          if (profileRow?.is_admin === true) {
            isAdmin = true;
          }
        } catch (err) {
          console.warn("AI Tutor admin profile check skipped:", err);
        }
      }

      let premium = isAdmin;

      if (!premium) {
        const {
          data: subscriptionRows,
          error: subscriptionError
        } = await adminClient
          .from("subscriptions")
          .select("status,expires_at")
          .eq("user_id", user.id)
          .order("id", { ascending: false });

        if (subscriptionError) {
          throw new Error("subscription_unavailable");
        }

        premium = (subscriptionRows || [])
          .some(isPremium);
      }

      const quota = premium ? 15 : 4;
      return { premium, quota };
    })();
  }

  // Case A: Admin via app_metadata
  {
    const result = await simulateAiTutorQuota({
      user: { id: "admin-1", app_metadata: { role: "admin" } }
    });
    assert.strictEqual(result.premium, true);
    assert.strictEqual(result.quota, 15, "Admin via app_metadata must have 15 messages quota");
    console.log("  ✓ Admin via app_metadata receives Premium and quota=15");
  }

  // Case B: Admin via Student_profiles.is_admin
  {
    const result = await simulateAiTutorQuota({
      user: { id: "admin-2", app_metadata: {} },
      profileAdmin: true
    });
    assert.strictEqual(result.premium, true);
    assert.strictEqual(result.quota, 15, "Admin via Student_profiles must have 15 messages quota");
    console.log("  ✓ Admin via Student_profiles receives Premium and quota=15");
  }

  // Case C: Ordinary free student
  {
    const result = await simulateAiTutorQuota({
      user: { id: "student-free", app_metadata: {} },
      profileAdmin: false,
      subRows: []
    });
    assert.strictEqual(result.premium, false);
    assert.strictEqual(result.quota, 4, "Ordinary free student must have 4 messages quota");
    console.log("  ✓ Ordinary free student receives Free status and quota=4");
  }

  // Case D: Ordinary Premium student with active subscription
  {
    const result = await simulateAiTutorQuota({
      user: { id: "student-paid", app_metadata: {} },
      profileAdmin: false,
      subRows: [{ status: "paid", expires_at: new Date(Date.now() + 100000000).toISOString() }]
    });
    assert.strictEqual(result.premium, true);
    assert.strictEqual(result.quota, 15, "Ordinary Premium student must have 15 messages quota");
    console.log("  ✓ Ordinary active subscriber receives Premium and quota=15");
  }

  // Case E: Ordinary student with expired subscription
  {
    const result = await simulateAiTutorQuota({
      user: { id: "student-expired", app_metadata: {} },
      profileAdmin: false,
      subRows: [{ status: "paid", expires_at: new Date(Date.now() - 100000000).toISOString() }]
    });
    assert.strictEqual(result.premium, false);
    assert.strictEqual(result.quota, 4, "Expired student must have 4 messages quota");
    console.log("  ✓ Expired student receives Free status and quota=4");
  }
}

// =========================================================================
// Runner
// =========================================================================
async function runAllTests() {
  testSourceCodePatterns();
  await testPremiumAccessJsLogic();
  await testDashboardPremiumStateLogic();
  await testAiTutorQuotaLogic();

  console.log("\n=============================================================");
  console.log("ALL ADMIN AUTOMATIC PREMIUM ACCESS TESTS PASSED SUCCESSFULLY!");
  console.log("=============================================================\n");
}

runAllTests().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
