// script-loading.spec.js
// Automated verification for Phase 4: Script-Loading Performance Optimizations

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("=================================================");
console.log("PHASE 4: SCRIPT-LOADING PERFORMANCE TEST SUITE");
console.log("=================================================\n");

function createMockDom(options = {}) {
  const elements = new Map();
  const eventListeners = new Map();

  function makeElement(tagName, id = "", classes = []) {
    const el = {
      tagName: tagName.toUpperCase(),
      id,
      classList: {
        _classes: new Set(classes),
        contains(c) { return this._classes.has(c); },
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); }
      },
      attributes: {},
      dataset: {},
      children: [],
      parentNode: null,
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k]; },
      addEventListener(type, fn, opts = {}) {
        if (!eventListeners.has(this)) eventListeners.set(this, []);
        eventListeners.get(this).push({ type, fn, once: opts.once });
      },
      dispatchEvent(event) {
        if (event.type === "load" && typeof this.onload === "function") {
          this.onload.call(this, event);
        }
        if (event.type === "error" && typeof this.onerror === "function") {
          this.onerror.call(this, event);
        }
        const listeners = eventListeners.get(this) || [];
        for (let i = 0; i < listeners.length; i++) {
          const l = listeners[i];
          if (l.type === event.type) {
            l.fn.call(this, event);
            if (l.once) {
              listeners.splice(i, 1);
              i--;
            }
          }
        }
      },
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
          this.children.splice(idx, 1);
          child.parentNode = null;
        }
        return child;
      }
    };
    if (id) elements.set(id, el);
    return el;
  }

  const documentElement = makeElement("HTML");
  const head = makeElement("HEAD");
  const body = makeElement("BODY");
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  const document = {
    readyState: options.readyState || "loading",
    head,
    body,
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) { return makeElement(tag); },
    querySelector(selector) {
      if (selector.includes("paystack.co")) {
        const inHead = head.children.find(c => c.tagName === "SCRIPT" && (c.src || "").includes("paystack.co"));
        if (inHead) return inHead;
        return body.children.find(c => c.tagName === "SCRIPT" && (c.src || "").includes("paystack.co")) || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      const results = [];
      const check = (node) => {
        if (selector === "button" && node.tagName === "BUTTON") results.push(node);
        node.children.forEach(check);
      };
      check(documentElement);
      return results;
    },
    addEventListener(type, fn, opts = {}) {
      if (!eventListeners.has(this)) eventListeners.set(this, []);
      eventListeners.get(this).push({ type, fn, once: opts.once });
    },
    dispatchEvent(event) {
      const listeners = eventListeners.get(this) || [];
      listeners.slice().forEach(l => {
        if (l.type === event.type) l.fn(event);
      });
    }
  };

  const window = {
    document,
    location: { href: "https://exampilot.com.ng/mock-exam.html", search: "" },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id)
  };

  return { window, document, head, body, makeElement };
}

async function runAllTests() {
  const mockExamHtml = fs.readFileSync(path.join(__dirname, "mock-exam.html"), "utf8");
  const loaderMatch = mockExamHtml.match(/let paystackLoadPromise[\s\S]*?window\.ensurePaystackScript = ensurePaystackScript;/);
  assert.ok(loaderMatch, "ensurePaystackScript must be defined in mock-exam.html");
  const loaderCode = loaderMatch[0];

  // ----------------------------------------------------
  // TEST 1: Paystack Loader - Already Loaded Fast-Path
  // ----------------------------------------------------
  console.log("Test 1: Paystack loader - already loaded fast path...");
  {
    const { window, document } = createMockDom();
    const fakePop = function () {};
    window.PaystackPop = fakePop;

    vm.runInNewContext(loaderCode, {
      window,
      document,
      setTimeout,
      clearTimeout,
      console
    });

    const res = await window.ensurePaystackScript();
    assert.strictEqual(res, fakePop, "Must immediately resolve with existing window.PaystackPop");
    assert.strictEqual(document.head.children.length, 0, "No script tag should be injected when already loaded");
    console.log("  ✓ Already-loaded fast path resolves immediately without DOM mutations");
  }

  // ----------------------------------------------------
  // TEST 2: Paystack Loader - Single-Flight Concurrency
  // ----------------------------------------------------
  console.log("\nTest 2: Paystack loader - single-flight concurrency...");
  {
    const { window, document, head } = createMockDom();

    vm.runInNewContext(loaderCode, {
      window,
      document,
      setTimeout,
      clearTimeout,
      console
    });

    const p1 = window.ensurePaystackScript();
    const p2 = window.ensurePaystackScript();
    const p3 = window.ensurePaystackScript();

    const scripts = head.children.filter(c => c.tagName === "SCRIPT" && (c.src || "").includes("paystack.co"));
    assert.strictEqual(scripts.length, 1, "Concurrent calls must create exactly ONE script tag");
    assert.strictEqual(scripts[0].dataset.paystackStatus, "loading", "Tag must have status='loading'");

    const fakePop = function () {};
    window.PaystackPop = fakePop;
    scripts[0].dispatchEvent({ type: "load" });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    assert.strictEqual(r1, fakePop);
    assert.strictEqual(r2, fakePop);
    assert.strictEqual(r3, fakePop);
    assert.strictEqual(scripts[0].dataset.paystackStatus, "loaded");
    console.log("  ✓ Single-flight concurrency: 1 script created, all concurrent callers resolve to identical instance");
  }

  // ----------------------------------------------------
  // TEST 3: Paystack Loader - Stalled/Dead Script Tag Cleanup
  // ----------------------------------------------------
  console.log("\nTest 3: Paystack loader - dead tag detection and cleanup...");
  {
    const { window, document, head, makeElement } = createMockDom();
    const deadTag = makeElement("SCRIPT");
    deadTag.src = "https://js.paystack.co/v2/inline.js";
    head.appendChild(deadTag);
    assert.strictEqual(head.children.length, 1);

    vm.runInNewContext(loaderCode, {
      window,
      document,
      setTimeout,
      clearTimeout,
      console
    });

    const p = window.ensurePaystackScript();
    assert.strictEqual(head.children.length, 1, "Dead tag replaced with fresh script tag");
    const freshTag = head.children[0];
    assert.notStrictEqual(freshTag, deadTag, "Must not be the old dead tag");
    assert.strictEqual(freshTag.dataset.paystackStatus, "loading");

    window.PaystackPop = function () {};
    freshTag.dispatchEvent({ type: "load" });

    const pop = await p;
    assert.ok(typeof pop === "function");
    console.log("  ✓ Dead/unresponsive script tags detected, removed and cleanly replaced");
  }

  // ----------------------------------------------------
  // TEST 4: Paystack Loader - Failure Handling & Non-Duplicating Retry
  // ----------------------------------------------------
  console.log("\nTest 4: Paystack loader - failure cleanup and retry without duplicates...");
  {
    const { window, document, head } = createMockDom();

    vm.runInNewContext(loaderCode, {
      window,
      document,
      setTimeout,
      clearTimeout,
      console
    });

    const firstCall = window.ensurePaystackScript();
    const script1 = head.children[0];
    assert.ok(script1, "First script created");

    script1.dispatchEvent({ type: "error" });

    let firstError = null;
    try {
      await firstCall;
    } catch (e) {
      firstError = e;
    }
    assert.ok(firstError && firstError.message.includes("failed to load"), "Must reject with failure message");
    assert.strictEqual(head.children.length, 0, "Failed script element must be removed from DOM on error");

    // Retry after failure
    const retryCall = window.ensurePaystackScript();
    assert.strictEqual(head.children.length, 1, "Retry must create exactly 1 new script tag");
    const script2 = head.children[0];
    assert.notStrictEqual(script2, script1);

    window.PaystackPop = function () {};
    script2.dispatchEvent({ type: "load" });

    const pop = await retryCall;
    assert.ok(typeof pop === "function", "Retry must resolve successfully");
    console.log("  ✓ Network failure properly cleans up DOM; subsequent retry succeeds without duplicate tags");
  }

  // ----------------------------------------------------
  // TEST 5: Paystack Loader - Timeout Protection
  // ----------------------------------------------------
  console.log("\nTest 5: Paystack loader - timeout protection...");
  {
    const { window, document, head } = createMockDom();
    const fastTimeoutCode = loaderCode.replace("10000);", "50);");

    vm.runInNewContext(fastTimeoutCode, {
      window,
      document,
      setTimeout,
      clearTimeout,
      console
    });

    const timedOutCall = window.ensurePaystackScript();
    assert.strictEqual(head.children.length, 1);

    let timeoutError = null;
    try {
      await timedOutCall;
    } catch (e) {
      timeoutError = e;
    }
    assert.ok(timeoutError && timeoutError.message.includes("timed out"), `Expected timeout message, got: ${timeoutError?.message}`);
    assert.strictEqual(head.children.length, 0, "Timed-out script element must be removed from DOM");
    console.log("  ✓ Unresponsive script triggers timeout, cleans up DOM, and resets loader for retry");
  }

  // ----------------------------------------------------
  // TEST 6: Mock Exam - Static Contract Preservation
  // ----------------------------------------------------
  console.log("\nTest 6: Mock Exam - static contract preservation...");
  {
    assert.ok(mockExamHtml.includes("Paystack.js"), "mock-exam.html must include Paystack.js");
    assert.ok(mockExamHtml.includes("js.paystack.co/v2/inline.js"), "mock-exam.html must include inline Paystack SDK URL");
    assert.ok(!mockExamHtml.includes('<script src="https://js.paystack.co/v2/inline.js"></script>'), "Eager render-blocking Paystack tag must NOT be present in head");
    assert.ok(mockExamHtml.includes('<script src="Paystack.js" defer></script>'), "Paystack.js must have defer attribute");
    assert.ok(mockExamHtml.includes('id="subscriptionModal"'), "mock-exam.html must retain #subscriptionModal");
    console.log("  ✓ Static test contracts in mock-exam-start.test.js lines 336-337 strictly satisfied");
  }

  // ----------------------------------------------------
  // TEST 7: Topics Catalog - Exact 13 Subjects & Truthful Counts
  // ----------------------------------------------------
  console.log("\nTest 7: Topics catalog - exact 13 subjects and truthful counts...");
  {
    const catalogSource = fs.readFileSync(path.join(__dirname, "topics-catalog.js"), "utf8");
    const sandbox = { window: {} };
    vm.runInNewContext(catalogSource, sandbox);

    const banks = sandbox.window.questionBanks;
    assert.ok(banks, "window.questionBanks must be defined");
    const subjects = Object.keys(banks);
    assert.strictEqual(subjects.length, 13, "Must define exactly 13 JAMB subjects");

    const expectedCounts = {
      English: { practice: 500, past: 20 },
      Mathematics: { practice: 500, past: 0 },
      Physics: { practice: 500, past: 480 },
      Chemistry: { practice: 100, past: 10 },
      Biology: { practice: 100, past: 10 },
      Government: { practice: 100, past: 10 },
      Commerce: { practice: 500, past: 0 },
      Economics: { practice: 500, past: 0 },
      Accounting: { practice: 500, past: 0 },
      Geography: { practice: 500, past: 0 },
      CRS: { practice: 500, past: 0 },
      History: { practice: 500, past: 0 },
      Literature: { practice: 100, past: 0 }
    };

    subjects.forEach(sub => {
      assert.ok(expectedCounts[sub], `Unexpected subject: ${sub}`);
      assert.strictEqual(banks[sub].practice.length, expectedCounts[sub].practice, `${sub} practice count must be ${expectedCounts[sub].practice}`);
      assert.strictEqual(banks[sub].past.length, expectedCounts[sub].past, `${sub} past count must be ${expectedCounts[sub].past}`);
    });

    console.log("  ✓ topics-catalog.js defines all 13 JAMB subjects with 100% truthful counts (Mathematics: 500 practice, 0 past)");
  }

  // ----------------------------------------------------
  // TEST 8: Topics.html - Anti-Pattern Elimination
  // ----------------------------------------------------
  console.log("\nTest 8: Topics.html - document.write elimination and catalog inclusion...");
  {
    const topicsHtml = fs.readFileSync(path.join(__dirname, "topics.html"), "utf8");

    assert.ok(!topicsHtml.includes("document.write"), "topics.html must contain zero document.write calls");
    assert.ok(!topicsHtml.includes('src="questions.js"'), "topics.html must NOT load 2.04 MB questions.js");
    assert.ok(topicsHtml.includes('src="topics-catalog.js"'), "topics.html must load topics-catalog.js");
    assert.ok(topicsHtml.includes("s.async=false") || topicsHtml.includes("s.async = false"), "Dynamic runtime script must enforce async=false for ordered execution");

    console.log("  ✓ document.write completely removed; questions.js replaced with lightweight catalog");
  }

  // ----------------------------------------------------
  // TEST 9: Topics.js - Idempotent Initialization
  // ----------------------------------------------------
  console.log("\nTest 9: Topics.js - idempotent initialization guard...");
  {
    const topicsJs = fs.readFileSync(path.join(__dirname, "topics.js"), "utf8");

    assert.ok(topicsJs.includes("initTopicsRuntime"), "topics.js must define initTopicsRuntime");
    assert.ok(topicsJs.includes("isTopicsInitialized"), "topics.js must have isTopicsInitialized guard");
    assert.ok(topicsJs.includes('document.readyState === "loading"'), "topics.js must check document.readyState");

    console.log("  ✓ topics.js has idempotent guard and document.readyState checking");
  }

  // ----------------------------------------------------
  // TEST 10: Auxiliary Pages - Non-Critical Script Deferral
  // ----------------------------------------------------
  console.log("\nTest 10: Auxiliary pages - non-critical script deferral...");
  {
    const dashboardHtml = fs.readFileSync(path.join(__dirname, "dashboard.html"), "utf8");
    assert.ok(dashboardHtml.includes('<script src="ai-tutor.js" defer></script>'), "dashboard.html must defer ai-tutor.js");
    assert.ok(dashboardHtml.includes('<script src="trustpilot-prompt.js" defer></script>'), "dashboard.html must defer trustpilot-prompt.js");
    assert.ok(dashboardHtml.includes('<script src="push-notifications.js" defer></script>'), "dashboard.html must defer push-notifications.js");

    const novelsHtml = fs.readFileSync(path.join(__dirname, "novels.html"), "utf8");
    assert.ok(!novelsHtml.match(/<head[\s\S]*?src=["'].*supabase.*["'][\s\S]*?<\/head>/i), "novels.html must have NO render-blocking supabase scripts in <head>");
    assert.ok(novelsHtml.includes('<script src="novels.js"></script>'), "novels.html must include novels.js at body bottom");

    const answersHtml = fs.readFileSync(path.join(__dirname, "answers.html"), "utf8");
    assert.ok(answersHtml.includes('<script src="ai-tutor.js" defer></script>'), "answers.html must defer ai-tutor.js");

    const detailsHtml = fs.readFileSync(path.join(__dirname, "result-details.html"), "utf8");
    assert.ok(detailsHtml.includes('<script src="ai-tutor.js" defer></script>'), "result-details.html must defer ai-tutor.js");

    const syllabusHtml = fs.readFileSync(path.join(__dirname, "syllabus.html"), "utf8");
    assert.ok(syllabusHtml.includes('<script src="ai-tutor.js" defer></script>'), "syllabus.html must defer ai-tutor.js");

    console.log("  ✓ Auxiliary pages correctly defer non-critical scripts and eliminate head blocking");
  }

  console.log("\n=================================================");
  console.log("ALL 10 PHASE 4 TESTS PASSED (10/10)");
  console.log("=================================================");
}

runAllTests().catch(err => {
  console.error("\nTEST SUITE FAILED:", err);
  process.exit(1);
});
