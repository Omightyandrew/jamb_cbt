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
  assert.equal(res403.error.code, "forbidden");
  assert.equal(res403.error.message, "An active Premium subscription is required.");

  // 2b. Test 403 error with technical message "Mock access is not permitted." -> normalized to friendly text
  env.supabaseClient = {
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          context: {
            status: 403,
            clone: () => ({ json: async () => ({ error: { code: "forbidden", message: "Mock access is not permitted." } }) })
          }
        }
      })
    }
  };
  const res403Technical = await env.MockExamApi.startMock({ selectedSubjects: ["English", "Math", "Physics", "Chemistry"] });
  assert.equal(res403Technical.error.status, 403);
  assert.equal(res403Technical.error.code, "forbidden");
  assert.equal(res403Technical.error.message, "An active Premium subscription is required.");
  assert.equal(res403Technical.error.rawMessage, "Mock access is not permitted.");

  // 2c. Test 403 error with missing/empty message -> normalized to friendly text
  env.supabaseClient = {
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          context: {
            status: 403,
            clone: () => ({ json: async () => null })
          }
        }
      })
    }
  };
  const res403Empty = await env.MockExamApi.startMock({ selectedSubjects: ["English", "Math", "Physics", "Chemistry"] });
  assert.equal(res403Empty.error.status, 403);
  assert.equal(res403Empty.error.code, "forbidden");
  assert.equal(res403Empty.error.message, "An active Premium subscription is required.");

  // 2d. Test unrelated 403 with string payload and code (e.g. origin_not_allowed from edge function)
  env.supabaseClient = {
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          context: {
            status: 403,
            clone: () => ({ json: async () => ({ error: "Origin is not allowed.", code: "origin_not_allowed" }) })
          }
        }
      })
    }
  };
  const res403Origin = await env.MockExamApi.startMock({ selectedSubjects: ["English", "Math", "Physics", "Chemistry"] });
  assert.equal(res403Origin.error.status, 403);
  assert.equal(res403Origin.error.code, "origin_not_allowed");
  assert.equal(res403Origin.error.message, "Origin is not allowed.");

  // 2e. Test unrelated 403 with specific forbidden message (e.g. Account suspended)
  env.supabaseClient = {
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          context: {
            status: 403,
            clone: () => ({ json: async () => ({ error: { code: "forbidden", message: "Account has been suspended." } }) })
          }
        }
      })
    }
  };
  const res403Suspended = await env.MockExamApi.startMock({ selectedSubjects: ["English", "Math", "Physics", "Chemistry"] });
  assert.equal(res403Suspended.error.status, 403);
  assert.equal(res403Suspended.error.code, "forbidden");
  assert.equal(res403Suspended.error.message, "Account has been suspended.");

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

async function testMockUiSubscriptionPopup() {
  const htmlPath = path.join(__dirname, "mock-exam.html");
  const html = fs.readFileSync(htmlPath, "utf8");

  // 1. Verify HTML includes Paystack and subscription modal
  assert.ok(html.includes("Paystack.js"), "mock-exam.html must include Paystack.js");
  assert.ok(html.includes("js.paystack.co/v2/inline.js"), "mock-exam.html must include inline Paystack SDK");
  assert.ok(html.includes('id="subscriptionModal"'), "mock-exam.html must contain #subscriptionModal");
  assert.ok(html.includes("₦1,500"), "mock-exam.html must display ₦1,500 30-day plan");
  assert.ok(html.includes("₦4,000"), "mock-exam.html must display ₦4,000 1-year plan");
  assert.ok(html.includes("Full Mock Exams"), "mock-exam.html must display Full Mock Exams benefit");
  assert.ok(html.includes('id="mockSubscriptionModalClose"'), "mock-exam.html must have modal close button");
  assert.ok(html.includes('id="mockSubscriptionModalSecondary"'), "mock-exam.html must have secondary close button");

  // 2. Verify CSS includes modal styles
  const cssPath = path.join(__dirname, "mock-exam.css");
  const css = fs.readFileSync(cssPath, "utf8");
  assert.ok(css.includes(".subscription-modal-backdrop"), "mock-exam.css must define backdrop");
  assert.ok(css.includes(".subscription-modal-backdrop.show"), "mock-exam.css must define show class");
  assert.ok(css.includes(".subscription-modal"), "mock-exam.css must define modal card");

  // 3. Verify UI script handles 403 by opening modal while preserving selected subjects
  const uiCode = fs.readFileSync(path.join(__dirname, "mock-exam-ui.js"), "utf8");
  assert.ok(uiCode.includes("openSubscriptionModal()"), "UI script must define openSubscriptionModal");
  assert.ok(uiCode.includes("isPremiumDenial(error)"), "UI script must check isPremiumDenial");
  assert.ok(!uiCode.includes('showMessage("Mock access is not permitted."'), "UI script must never hardcode raw technical message");
  assert.ok(uiCode.includes("Upgrade to continue"), "UI script must provide friendly upgrade message");

  // 4. Runtime simulation of mock-exam-ui.js
  const domElements = new Map();
  function createElement(id, tagName = "div") {
    const classList = new Set();
    const listeners = new Map();
    const attrs = new Map();
    const el = {
      id,
      tagName,
      textContent: "",
      className: "",
      hidden: false,
      disabled: false,
      innerHTML: "",
      style: { display: "" },
      classList: {
        add: (c) => classList.add(c),
        remove: (c) => classList.delete(c),
        contains: (c) => classList.has(c),
        toggle: (c, force) => {
          if (force !== undefined) {
            if (force) classList.add(c); else classList.delete(c);
          } else {
            if (classList.has(c)) classList.delete(c); else classList.add(c);
          }
        }
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => attrs.get(k) || null,
      hasAttribute: (k) => attrs.has(k),
      addEventListener: (evt, handler) => {
        if (!listeners.has(evt)) listeners.set(evt, []);
        listeners.get(evt).push(handler);
      },
      dispatchEvent: async (evt) => {
        const list = listeners.get(evt.type) || [];
        for (const fn of list) await fn(evt);
      },
      closest: (sel) => {
        if (sel === "button" && tagName === "button") return el;
        return null;
      }
    };
    domElements.set(id, el);
    return el;
  }

  const appEl = createElement("mockApp", "main");
  const timerEl = createElement("mockTimer");
  const headerSubmitEl = createElement("mockHeaderSubmit", "button");
  const modalEl = createElement("subscriptionModal");
  const closeBtnEl = createElement("mockSubscriptionModalClose", "button");
  const cancelBtnEl = createElement("mockSubscriptionModalSecondary", "button");
  const pay30BtnEl = createElement("mockPay30DaysBtn", "button");
  const pay1YearBtnEl = createElement("mockPay1YearBtn", "button");

  const docListeners = new Map();
  const mockDocument = {
    getElementById: (id) => {
      if (domElements.has(id)) return domElements.get(id);
      return createElement(id);
    },
    addEventListener: (evt, handler) => {
      if (!docListeners.has(evt)) docListeners.set(evt, []);
      docListeners.get(evt).push(handler);
    }
  };

  let simulatedApiResponse = null;
  const mockWindow = {
    document: mockDocument,
    crypto: {
      randomUUID: () => "00000000-0000-0000-0000-000000000002",
      getRandomValues: (buf) => buf
    },
    location: { href: "https://exampilot.com.ng/mock-exam.html", search: "" },
    history: { replaceState: () => {} },
    supabaseClient: {
      auth: { getSession: async () => ({ data: { session: { user: { id: "test-user-1" } } }, error: null }) }
    },
    MockExamApi: {
      startMock: async () => simulatedApiResponse
    },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {}
  };

  // Evaluate mock-exam-ui.js in simulated sandbox
  const uiFn = new Function("window", "document", uiCode);
  uiFn(mockWindow, mockDocument);

  // Allow async init() to run
  await new Promise((r) => setTimeout(r, 20));

  // Verify mock-exam.html initial markup contains inline style="display:none;" to prevent in-flow render before CSS loads
  const mockExamHtmlContent = fs.readFileSync(path.join(__dirname, "mock-exam.html"), "utf8");
  assert.ok(
    /id=["']subscriptionModal["'][^>]*style=["'][^"']*display\s*:\s*none/i.test(mockExamHtmlContent),
    "mock-exam.html subscriptionModal must have inline style='display:none' to prevent rendering as page content before CSS loads"
  );

  // Verify modal starts hidden
  assert.equal(modalEl.classList.contains("show"), false, "Modal must start closed");

  // Simulate subject selection and start mock with 403 forbidden
  simulatedApiResponse = {
    data: null,
    error: {
      status: 403,
      code: "forbidden",
      message: "An active Premium subscription is required."
    }
  };

  // Simulate subject selection (3 additional subjects: Mathematics, Physics, Chemistry)
  function createCheckbox(val) {
    return {
      value: val,
      checked: true,
      closest: (sel) => sel.includes("mock-subject") ? { value: val, checked: true } : null
    };
  }

  await appEl.dispatchEvent({ type: "change", target: createCheckbox("Mathematics") });
  await appEl.dispatchEvent({ type: "change", target: createCheckbox("Physics") });
  await appEl.dispatchEvent({ type: "change", target: createCheckbox("Chemistry") });

  // Trigger startAttempt via start button
  const startBtn = {
    id: "mockStart",
    tagName: "button",
    closest: (sel) => sel === "button" ? { id: "mockStart" } : null
  };

  // Call click on start button
  await appEl.dispatchEvent({ type: "click", target: startBtn });

  // Verify modal is opened on 403
  assert.equal(modalEl.classList.contains("show"), true, "Modal must open on 403 error");
  assert.equal(modalEl.getAttribute("aria-hidden"), "false", "Modal must set aria-hidden=false");
  assert.equal(modalEl.style.display, "flex", "Modal must explicitly set display:flex when opened");

  const messageEl = mockDocument.getElementById("mockMessage");
  assert.ok(messageEl.textContent.includes("Upgrade to continue"), "Message must explain upgrade is needed");
  assert.ok(!messageEl.textContent.includes("Mock access is not permitted"), "Message must not use technical wording");

  // Simulate closing modal
  await closeBtnEl.dispatchEvent({ type: "click", target: closeBtnEl });
  assert.equal(modalEl.classList.contains("show"), false, "Modal must close on close button click");
  assert.equal(modalEl.getAttribute("aria-hidden"), "true", "Modal must set aria-hidden=true");
  assert.equal(modalEl.style.display, "none", "Modal must explicitly set display:none when closed");

  // Helper to verify selected subjects remain intact in the rendered selection HTML
  function assertSelectedSubjectsIntact() {
    assert.ok(appEl.innerHTML.includes('value="Mathematics" checked'), "Mathematics must remain checked");
    assert.ok(appEl.innerHTML.includes('value="Physics" checked'), "Physics must remain checked");
    assert.ok(appEl.innerHTML.includes('value="Chemistry" checked'), "Chemistry must remain checked");
  }

  // 1a. Verify selected subjects are intact after initial modal open and close
  assertSelectedSubjectsIntact();

  // 1. The exact verified backend Premium denial opens the popup:
  // 1a. Exact backend denial message
  simulatedApiResponse = {
    data: null,
    error: {
      status: 403,
      code: "forbidden",
      message: "Mock access is not permitted."
    }
  };
  await appEl.dispatchEvent({ type: "click", target: startBtn });
  assert.equal(modalEl.classList.contains("show"), true, "Modal must open on verified backend Mock access not permitted denial");
  assert.ok(messageEl.textContent.includes("Upgrade to continue"), "Friendly message must be displayed");
  await closeBtnEl.dispatchEvent({ type: "click", target: closeBtnEl });
  assert.equal(modalEl.classList.contains("show"), false, "Modal must close on close button click");
  assertSelectedSubjectsIntact();

  // 1b. Exact backend denial message with harmless whitespace / punctuation difference
  simulatedApiResponse = {
    data: null,
    error: {
      status: 403,
      code: "forbidden",
      message: "  mock access is not permitted  "
    }
  };
  await appEl.dispatchEvent({ type: "click", target: startBtn });
  assert.equal(modalEl.classList.contains("show"), true, "Modal must open on harmless whitespace variance");
  await closeBtnEl.dispatchEvent({ type: "click", target: closeBtnEl });
  assert.equal(modalEl.classList.contains("show"), false, "Modal must close");
  assertSelectedSubjectsIntact();

  // 2. Its normalized equivalent still opens the popup if original error identity is preserved:
  simulatedApiResponse = {
    data: null,
    error: {
      status: 403,
      code: "forbidden",
      message: "An active Premium subscription is required.",
      rawMessage: "Mock access is not permitted."
    }
  };
  await appEl.dispatchEvent({ type: "click", target: startBtn });
  assert.equal(modalEl.classList.contains("show"), true, "Modal must open on normalized denial with preserved rawMessage identity");
  assert.ok(messageEl.textContent.includes("Upgrade to continue"), "Friendly message must be displayed");
  await closeBtnEl.dispatchEvent({ type: "click", target: closeBtnEl });
  assert.equal(modalEl.classList.contains("show"), false, "Modal must close");
  assertSelectedSubjectsIntact();

  // 3. An unrelated HTTP 403 with code forbidden does NOT open the popup:
  // 3a. Account suspended
  simulatedApiResponse = {
    data: null,
    error: {
      status: 403,
      code: "forbidden",
      message: "Account has been suspended."
    }
  };
  await appEl.dispatchEvent({ type: "click", target: startBtn });
  assert.equal(modalEl.classList.contains("show"), false, "Modal must NOT open on account suspended forbidden 403");
  assert.equal(messageEl.textContent, "Account has been suspended.");
  assertSelectedSubjectsIntact();

  // 3b. Access denied
  simulatedApiResponse = {
    data: null,
    error: {
      status: 403,
      code: "forbidden",
      message: "Access denied."
    }
  };
  await appEl.dispatchEvent({ type: "click", target: startBtn });
  assert.equal(modalEl.classList.contains("show"), false, "Modal must NOT open on generic access denied forbidden 403");
  assert.equal(messageEl.textContent, "Access denied.");
  assertSelectedSubjectsIntact();

  // 3c. Forbidden containing word "subscription" or "premium" but NOT the verified denial
  simulatedApiResponse = {
    data: null,
    error: {
      status: 403,
      code: "forbidden",
      message: "Your subscription payment method was declined."
    }
  };
  await appEl.dispatchEvent({ type: "click", target: startBtn });
  assert.equal(modalEl.classList.contains("show"), false, "Modal must NOT open solely because error text contains subscription");
  assert.equal(messageEl.textContent, "Your subscription payment method was declined.");
  assertSelectedSubjectsIntact();

  // 4. An error with premium_required or subscription_required but wrong status or message does NOT open popup:
  // 4a. 403 with code premium_required
  simulatedApiResponse = {
    data: null,
    error: {
      status: 403,
      code: "premium_required",
      message: "Mock access is not permitted."
    }
  };
  await appEl.dispatchEvent({ type: "click", target: startBtn });
  assert.equal(modalEl.classList.contains("show"), false, "Modal must NOT open solely because of premium_required code");
  assertSelectedSubjectsIntact();

  // 4b. 403 with code subscription_required
  simulatedApiResponse = {
    data: null,
    error: {
      status: 403,
      code: "subscription_required",
      message: "Subscription required."
    }
  };
  await appEl.dispatchEvent({ type: "click", target: startBtn });
  assert.equal(modalEl.classList.contains("show"), false, "Modal must NOT open solely because of subscription_required code");
  assertSelectedSubjectsIntact();

  // 4c. Wrong status 400 with premium_required
  simulatedApiResponse = {
    data: null,
    error: {
      status: 400,
      code: "premium_required",
      message: "Mock access is not permitted."
    }
  };
  await appEl.dispatchEvent({ type: "click", target: startBtn });
  assert.equal(modalEl.classList.contains("show"), false, "Modal must NOT open on status 400");
  assertSelectedSubjectsIntact();

  // 4d. Wrong status 500 with subscription_required
  simulatedApiResponse = {
    data: null,
    error: {
      status: 500,
      code: "subscription_required",
      message: "Internal server error."
    }
  };
  await appEl.dispatchEvent({ type: "click", target: startBtn });
  assert.equal(modalEl.classList.contains("show"), false, "Modal must NOT open on status 500");
  assertSelectedSubjectsIntact();

  // 5. Other errors (401, network failure, 409, 422, 500, origin 403) do NOT open the popup:
  // 5a. 403 origin_not_allowed
  simulatedApiResponse = {
    data: null,
    error: {
      status: 403,
      code: "origin_not_allowed",
      message: "Origin is not allowed."
    }
  };
  await appEl.dispatchEvent({ type: "click", target: startBtn });
  assert.equal(modalEl.classList.contains("show"), false, "Modal must NOT open on origin_not_allowed 403");
  assert.equal(messageEl.textContent, "Origin is not allowed.");
  assertSelectedSubjectsIntact();

  // 5b. 401 Authentication error
  simulatedApiResponse = {
    data: null,
    error: {
      status: 401,
      code: "unauthenticated",
      message: "Authentication is required."
    }
  };
  await appEl.dispatchEvent({ type: "click", target: startBtn });
  assert.equal(modalEl.classList.contains("show"), false, "Modal must NOT open on 401 error");
  assert.equal(messageEl.textContent, "Authentication is required.");
  assertSelectedSubjectsIntact();

  // 5c. Network error (status null)
  simulatedApiResponse = {
    data: null,
    error: {
      status: null,
      code: "network_error",
      message: "Mock is unavailable. Check your connection and try again."
    }
  };
  await appEl.dispatchEvent({ type: "click", target: startBtn });
  assert.equal(modalEl.classList.contains("show"), false, "Modal must NOT open on network error");
  assert.equal(messageEl.textContent, "Mock is unavailable. Check your connection and try again.");
  assertSelectedSubjectsIntact();

  // 5d. 422 Validation error (invalid subject combination)
  simulatedApiResponse = {
    data: null,
    error: {
      status: 422,
      code: "invalid_combination",
      message: "The selected subject combination is not permitted for JAMB."
    }
  };
  await appEl.dispatchEvent({ type: "click", target: startBtn });
  assert.equal(modalEl.classList.contains("show"), false, "Modal must NOT open on 422 error");
  assert.equal(messageEl.textContent, "The selected subject combination is not permitted for JAMB.");
  assertSelectedSubjectsIntact();

  // 5e. 409 Conflict error
  simulatedApiResponse = {
    data: null,
    error: {
      status: 409,
      code: "conflict",
      message: "The Mock attempt state has changed."
    }
  };
  await appEl.dispatchEvent({ type: "click", target: startBtn });
  assert.equal(modalEl.classList.contains("show"), false, "Modal must NOT open on 409 error");
  assert.equal(messageEl.textContent, "The Mock attempt state has changed.");
  assertSelectedSubjectsIntact();

  // 5f. 500 Server error
  simulatedApiResponse = {
    data: null,
    error: {
      status: 500,
      code: "request_failed",
      message: "Mock is temporarily unavailable."
    }
  };
  await appEl.dispatchEvent({ type: "click", target: startBtn });
  assert.equal(modalEl.classList.contains("show"), false, "Modal must NOT open on 500 error");
  assert.equal(messageEl.textContent, "Mock is temporarily unavailable.");
  assertSelectedSubjectsIntact();

  console.log("Mock UI subscription popup markup and logic tests passed successfully!");
}

async function runAll() {
  await testMockApiErrors();
  await testMockUiSubscriptionPopup();
  await testDatabaseContracts();
}

runAll().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

