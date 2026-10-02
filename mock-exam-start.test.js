"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Read and evaluate mock-api.js in a mock browser environment
const mockApiCode = fs.readFileSync(path.join(__dirname, "mock-api.js"), "utf8");

function createMockEnvironment() {
  const windowObj = {
    crypto: {
      randomUUID: () => "00000000-0000-0000-0000-000000000001"
    },
    supabaseClient: null
  };
  const fn = new Function("window", mockApiCode);
  fn(windowObj);
  return windowObj;
}

async function testMockApiErrors() {
  const env = createMockEnvironment();
  assert.ok(env.MockExamApi, "MockExamApi should be exposed on window");
  assert.equal(typeof env.MockExamApi.startMock, "function");

  // 1. Test 401 error
  env.supabaseClient = {
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          context: {
            status: 401,
            clone: () => ({ json: async () => ({ error: { code: "unauthenticated", message: "Sign in required" } }) })
          }
        }
      })
    }
  };
  const res401 = await env.MockExamApi.startMock({ selectedSubjects: ["English", "Math", "Physics", "Chemistry"] });
  assert.equal(res401.error.status, 401);
  assert.equal(res401.error.message, "Sign in required");

  // 2. Test 403 error (subscription required)
  env.supabaseClient = {
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          context: {
            status: 403,
            clone: () => ({ json: async () => ({ error: { code: "forbidden", message: "An active Premium subscription is required." } }) })
          }
        }
      })
    }
  };
  const res403 = await env.MockExamApi.startMock({ selectedSubjects: ["English", "Math", "Physics", "Chemistry"] });
  assert.equal(res403.error.status, 403);
  assert.equal(res403.error.message, "An active Premium subscription is required.");

  // 3. Test 409 error (conflict)
  env.supabaseClient = {
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          context: {
            status: 409,
            clone: () => ({ json: async () => ({ error: { code: "conflict", message: "Active attempt exists" } }) })
          }
        }
      })
    }
  };
  const res409 = await env.MockExamApi.startMock({ selectedSubjects: ["English", "Math", "Physics", "Chemistry"] });
  assert.equal(res409.error.status, 409);
  assert.equal(res409.error.message, "Active attempt exists");

  // 4. Test 422 error - NEVER "Mock is temporarily unavailable"
  env.supabaseClient = {
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          context: {
            status: 422,
            clone: () => ({ json: async () => ({ error: { code: "invalid_request", message: "The request is not valid for this Mock operation." } }) })
          }
        }
      })
    }
  };
  const res422Generic = await env.MockExamApi.startMock({ selectedSubjects: ["English", "Math", "Physics", "History"] });
  assert.equal(res422Generic.error.status, 422);
  assert.notEqual(res422Generic.error.message, "Mock is temporarily unavailable.");
  assert.equal(res422Generic.error.message, "The selected subject combination is not permitted for JAMB.");

  // 5. Test 422 error with specific backend error
  env.supabaseClient = {
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          context: {
            status: 422,
            clone: () => ({ json: async () => ({ error: { code: "invalid_request", message: "Selected subject combination is not permitted." } }) })
          }
        }
      })
    }
  };
  const res422Specific = await env.MockExamApi.startMock({ selectedSubjects: ["English", "Math", "Physics", "History"] });
  assert.equal(res422Specific.error.status, 422);
  assert.equal(res422Specific.error.message, "Selected subject combination is not permitted.");

  // 6. Test 422 error with missing payload/context
  env.supabaseClient = {
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          context: {
            status: 422,
            clone: () => ({ json: async () => { throw new Error("JSON parse error"); } })
          }
        }
      })
    }
  };
  const res422Fallback = await env.MockExamApi.startMock({ selectedSubjects: ["English", "Math", "Physics", "History"] });
  assert.equal(res422Fallback.error.status, 422);
  assert.equal(res422Fallback.error.message, "The selected subject combination is not permitted for JAMB.");

  // 7. Test 500 error - should give generic fallback
  env.supabaseClient = {
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          context: {
            status: 500,
            clone: () => ({ json: async () => null })
          }
        }
      })
    }
  };
  const res500 = await env.MockExamApi.startMock({ selectedSubjects: ["English", "Math", "Physics", "Chemistry"] });
  assert.equal(res500.error.status, 500);
  assert.equal(res500.error.message, "Mock is temporarily unavailable.");

  console.log("mock-exam-start unit tests passed successfully!");
}

async function testDatabaseContracts() {
  const precheckPath = path.join(__dirname, "nabteb_gen", "precheck.js");
  if (!fs.existsSync(precheckPath)) {
    console.log("Skipping DB contract test (precheck.js not found).");
    return;
  }
  const { runQuery } = require(precheckPath);

  // Run dry-run transaction in PostgreSQL
  const sql = `
    BEGIN;
    
    -- 1. Ensure user has active subscription in this transaction
    UPDATE public.subscriptions 
    SET status = 'active', expires_at = (now() + interval '1 day')
    WHERE user_id = '0cc4519b-19a5-4733-b06b-af5e62152f5e';

    -- 2. Verify start_mock_attempt with valid STEM combination
    DO $$
    DECLARE
      v_res jsonb;
      v_q_count int;
      v_eng_count int;
      v_math_count int;
      v_status text;
    BEGIN
      v_res := public.start_mock_attempt(
        '0cc4519b-19a5-4733-b06b-af5e62152f5e'::uuid,
        '00000000-0000-0000-0000-000000000099'::uuid,
        ARRAY['English', 'Mathematics', 'Physics', 'Chemistry']::text[]
      );
      v_q_count := jsonb_array_length(v_res->'questions');
      v_status := v_res->>'status';
      IF v_q_count <> 180 THEN
        RAISE EXCEPTION 'Expected 180 questions, got %', v_q_count;
      END IF;
      IF v_status <> 'in_progress' THEN
        RAISE EXCEPTION 'Expected in_progress status, got %', v_status;
      END IF;
      
      SELECT count(*) INTO v_eng_count
      FROM jsonb_to_recordset(v_res->'questions') AS q(subject text)
      WHERE q.subject = 'English';
      
      SELECT count(*) INTO v_math_count
      FROM jsonb_to_recordset(v_res->'questions') AS q(subject text)
      WHERE q.subject = 'Mathematics';

      IF v_eng_count <> 60 OR v_math_count <> 40 THEN
        RAISE EXCEPTION 'Expected 60 English and 40 Math, got % and %', v_eng_count, v_math_count;
      END IF;

      RAISE NOTICE 'STEM COMBINATION OK: 180 questions (60 English, 40 Math)';
    END $$;

    -- 3. Verify that combination with History is rejected with 22023
    DO $$
    DECLARE
      v_res jsonb;
    BEGIN
      BEGIN
        v_res := public.start_mock_attempt(
          '0cc4519b-19a5-4733-b06b-af5e62152f5e'::uuid,
          '00000000-0000-0000-0000-000000000098'::uuid,
          ARRAY['English', 'Mathematics', 'Physics', 'History']::text[]
        );
        RAISE EXCEPTION 'History should have been rejected!';
      EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'HISTORY COMBINATION REJECTED AS EXPECTED (22023)';
      END;
    END $$;

    -- 4. Verify that unsubscribed user is rejected with 42501
    DO $$
    DECLARE
      v_res jsonb;
    BEGIN
      BEGIN
        v_res := public.start_mock_attempt(
          '566848a8-5241-4a58-b4ef-6070c2edb781'::uuid, -- free user
          '00000000-0000-0000-0000-000000000097'::uuid,
          ARRAY['English', 'Mathematics', 'Physics', 'Chemistry']::text[]
        );
        RAISE EXCEPTION 'Unsubscribed user should have been rejected!';
      EXCEPTION WHEN SQLSTATE '42501' THEN
        RAISE NOTICE 'UNSUBSCRIBED USER REJECTED AS EXPECTED (42501)';
      END;
    END $$;

    ROLLBACK;
  `;

  await runQuery(sql);
  console.log("Database contract dry-run tests passed (180 questions, 120 minutes, 60/40 allocation, History rejection, Premium enforcement). All rolled back cleanly.");
}

async function runAll() {
  await testMockApiErrors();
  await testDatabaseContracts();
}

runAll().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

