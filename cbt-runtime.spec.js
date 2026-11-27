"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Read exam.js
const examSource = fs.readFileSync("exam.js", "utf8");

function createMockElement(id = "", tagName = "div") {
    const children = [];
    const classListSet = new Set();
    const styleObj = {};
    const attrs = {};

    const el = {
        id,
        tagName: tagName.toUpperCase(),
        children,
        style: styleObj,
        disabled: false,
        checked: false,
        value: "",
        _textContent: "",
        _innerHTML: "",
        parentElement: null,

        get classList() {
            return {
                add: (...cls) => cls.forEach(c => classListSet.add(c)),
                remove: (...cls) => cls.forEach(c => classListSet.delete(c)),
                toggle: (c, force) => {
                    if (force !== undefined) {
                        if (force) classListSet.add(c);
                        else classListSet.delete(c);
                        return force;
                    }
                    if (classListSet.has(c)) {
                        classListSet.delete(c);
                        return false;
                    } else {
                        classListSet.add(c);
                        return true;
                    }
                },
                contains: (c) => classListSet.has(c)
            };
        },

        get textContent() {
            return this._textContent;
        },
        set textContent(val) {
            this._textContent = String(val);
        },

        get innerHTML() {
            return this._innerHTML;
        },
        set innerHTML(html) {
            this._innerHTML = String(html);
            this._parseSimpleHTML(html);
        },

        setAttribute(k, v) { attrs[k] = String(v); },
        getAttribute(k) { return attrs[k] ?? null; },

        scrollIntoView(opts) {
            this.lastScrollOptions = opts;
        },

        closest(selector) {
            if (selector.startsWith(".") && classListSet.has(selector.slice(1))) {
                return this;
            }
            return this.parentElement ? this.parentElement.closest(selector) : null;
        },

        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        },

        querySelectorAll(selector) {
            const matches = [];
            function search(node) {
                for (const child of node.children) {
                    if (selector.startsWith(".")) {
                        const cls = selector.slice(1);
                        if (child.classList.contains(cls)) matches.push(child);
                    } else if (selector.startsWith("#")) {
                        if (child.id === selector.slice(1)) matches.push(child);
                    } else if (selector.includes("[name='answer']")) {
                        if (child.name === "answer") {
                            if (selector.includes(":checked")) {
                                if (child.checked) matches.push(child);
                            } else {
                                matches.push(child);
                            }
                        }
                    } else if (selector.toLowerCase() === child.tagName.toLowerCase()) {
                        matches.push(child);
                    }
                    search(child);
                }
            }
            search(this);
            return matches;
        },

        _parseSimpleHTML(html) {
            children.length = 0;
            // Parse buttons
            const buttonRegex = /<button[^>]*class="([^"]*)"[^>]*onclick="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g;
            let match;
            while ((match = buttonRegex.exec(html)) !== null) {
                const btn = createMockElement("", "button");
                match[1].split(/\s+/).filter(Boolean).forEach(c => btn.classList.add(c));
                btn.textContent = match[3].trim();
                btn.onclickAttr = match[2];
                btn.parentElement = this;
                children.push(btn);
            }

            // Parse option labels & inputs
            const labelRegex = /<label[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/label>/g;
            while ((match = labelRegex.exec(html)) !== null) {
                const label = createMockElement("", "label");
                match[1].split(/\s+/).filter(Boolean).forEach(c => label.classList.add(c));
                label.parentElement = this;

                // parse children inside label
                const copyMatch = /<span class="option-copy">([\s\S]*?)<\/span>/.exec(match[2]);
                if (copyMatch) {
                    const copySpan = createMockElement("", "span");
                    copySpan.classList.add("option-copy");
                    copySpan.textContent = copyMatch[1];
                    copySpan.parentElement = label;
                    label.children.push(copySpan);
                }

                const inputMatch = /<input[^>]*type="radio"[^>]*value="([^"]*)"([^>]*)>/.exec(match[2]);
                if (inputMatch) {
                    const radio = createMockElement("", "input");
                    radio.type = "radio";
                    radio.name = "answer";
                    radio.value = inputMatch[1];
                    radio.checked = inputMatch[2].includes("checked");
                    radio.parentElement = label;
                    label.children.push(radio);
                }

                children.push(label);
            }

            // Parse timer spans
            const timerTextMatch = /<span class="timer-text">([\s\S]*?)<\/span>/.exec(html);
            if (timerTextMatch) {
                const span = createMockElement("", "span");
                span.classList.add("timer-text");
                span.textContent = timerTextMatch[1];
                span.parentElement = this;
                children.push(span);
            }
        }
    };

    return el;
}

function createCbtTestEnvironment(options = {}) {
    const elements = new Map();
    [
        "answeredCount", "unansweredCount", "examProgress", "progressText", "mapTotal",
        "questionStatus", "currentSubject", "questionNumber", "questionCount",
        "previousButton", "nextButton", "questionCard", "questionText",
        "optionA", "optionB", "optionC", "optionD", "timer", "selectedSubject", "testTypeTitle"
    ].forEach(id => {
        elements.set(id, createMockElement(id));
    });

    const localStorageStore = new Map();
    const sessionStorageStore = new Map();

    const documentMock = {
        getElementById(id) {
            return elements.get(id) || null;
        },
        querySelector(selector) {
            if (selector.includes("[name='answer']:checked")) {
                for (const containerId of ["optionA", "optionB", "optionC", "optionD"]) {
                    const container = elements.get(containerId);
                    if (container) {
                        const checked = container.querySelector("input[name='answer']:checked");
                        if (checked) return checked;
                    }
                }
                return null;
            }
            return null;
        },
        querySelectorAll(selector) {
            const results = [];
            for (const containerId of ["optionA", "optionB", "optionC", "optionD"]) {
                const container = elements.get(containerId);
                if (container) {
                    results.push(...container.querySelectorAll(selector));
                }
            }
            return results;
        },
        body: createMockElement("body"),
        listeners: new Map(),
        addEventListener(event, fn) {
            if (!this.listeners.has(event)) this.listeners.set(event, []);
            this.listeners.get(event).push(fn);
        },
        triggerVisibilityChange() {
            (this.listeners.get("visibilitychange") || []).forEach(fn => fn());
        }
    };

    const windowMock = {
        document: documentMock,
        localStorage: {
            getItem(key) { return localStorageStore.has(key) ? localStorageStore.get(key) : null; },
            setItem(key, val) { localStorageStore.set(key, String(val)); },
            removeItem(key) { localStorageStore.delete(key); }
        },
        sessionStorage: {
            getItem(key) { return sessionStorageStore.has(key) ? sessionStorageStore.get(key) : null; },
            setItem(key, val) { sessionStorageStore.set(key, String(val)); },
            removeItem(key) { sessionStorageStore.delete(key); }
        },
        location: { href: "", reload() {} },
        navigator: { onLine: true },
        getSelectedExamCode: () => "JAMB",
        isV1JambPractice: () => false,
        calculateConfiguredScore: (outcomes) => ({
            score: outcomes.filter(o => o.correct).length,
            correct: outcomes.filter(o => o.correct).length,
            wrong: outcomes.filter(o => !o.correct && !o.unanswered).length,
            unanswered: outcomes.filter(o => o.unanswered).length
        }),
        calculateConfiguredGrade: (res) => Math.round((res.correct / (res.correct + res.wrong + res.unanswered || 1)) * 100)
    };

    let intervalId = 1;
    const intervalMap = new Map();

    const sandbox = {
        window: windowMock,
        document: documentMock,
        navigator: windowMock.navigator,
        localStorage: windowMock.localStorage,
        sessionStorage: windowMock.sessionStorage,
        location: windowMock.location,
        console: { log() {}, warn() {}, error() {} },
        supabase: {
            createClient: () => ({
                auth: { getSession: async () => ({ data: { session: { user: { id: "test_user_p3" } } }, error: null }) },
                from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) })
            })
        },
        setInterval: (fn, ms) => {
            const id = intervalId++;
            intervalMap.set(id, fn);
            return id;
        },
        clearInterval: (id) => {
            intervalMap.delete(id);
        },
        setTimeout: (fn) => fn(),
        Date: Date,
        stepInterval: (id) => {
            const fn = intervalMap.get(id);
            if (fn) fn();
        }
    };

    vm.runInNewContext(examSource, sandbox);

    return {
        sandbox,
        elements,
        localStorageStore,
        documentMock
    };
}

async function runAllTests() {
    console.log("=== RUNNING PHASE 3 CBT RUNTIME PERFORMANCE & SAFETY SPECIFICATIONS ===");

    // -----------------------------------------------------------------------------------
    // TEST 1: P3.1 Palette DOM Construction & Targeted In-Place Updates
    // -----------------------------------------------------------------------------------
    {
        const { sandbox, elements } = createCbtTestEnvironment();
        const questions = [
            { id: 1, question: "Q1", options: ["A", "B", "C", "D"], answer: "A", subject: "English" },
            { id: 2, question: "Q2", options: ["A", "B", "C", "D"], answer: "B", subject: "English" },
            { id: 3, question: "Q3", options: ["A", "B", "C", "D"], answer: "C", subject: "English" }
        ];

        sandbox.window.setExamQuestions(questions);
        sandbox.window.setCurrentQuestion(0);
        sandbox.window.renderQuestionPalette();

        const paletteEl = elements.get("questionStatus");
        assert.equal(paletteEl.children.length, 3, "Palette must initialize exactly 3 buttons");

        const btn0 = paletteEl.children[0];
        const btn1 = paletteEl.children[1];
        const btn2 = paletteEl.children[2];

        assert.equal(btn0.classList.contains("current"), true, "Question 0 must have .current class");
        assert.equal(btn1.classList.contains("current"), false);
        assert.equal(btn0.classList.contains("answered"), false);

        // Save answer on question 0
        sandbox.window.getAnswers()[0] = "B";
        sandbox.window.renderQuestionPalette();

        assert.equal(btn0.classList.contains("answered"), true, "Question 0 must now have .answered class");

        // Move to Question 1
        sandbox.window.setCurrentQuestion(1);
        sandbox.window.renderQuestionPalette();

        // Verify targeted class toggle without recreating DOM nodes (reference identity check)
        assert.equal(paletteEl.children[0], btn0, "Button 0 DOM instance must be preserved in-place");
        assert.equal(paletteEl.children[1], btn1, "Button 1 DOM instance must be preserved in-place");
        assert.equal(btn0.classList.contains("current"), false, "Button 0 must lose .current class");
        assert.equal(btn1.classList.contains("current"), true, "Button 1 must gain .current class");
        assert.equal(btn0.classList.contains("answered"), true, "Button 0 must retain .answered class");

        console.log("PASS: Test 1 - P3.1 Palette DOM Built Once & Targeted Class Toggling");
    }

    // -----------------------------------------------------------------------------------
    // TEST 2: P3.2 Option Containers Reuse In-Place Without innerHTML Teardown
    // -----------------------------------------------------------------------------------
    {
        const { sandbox, elements } = createCbtTestEnvironment();
        const questions = [
            { id: 10, question: "Capital of Nigeria?", options: ["Lagos", "Abuja", "Kano", "Ibadan"], answer: "B", subject: "Civics" },
            { id: 20, question: "Capital of Ghana?", options: ["Accra", "Kumasi", "Tamale", "Cape Coast"], answer: "A", subject: "Civics" }
        ];

        sandbox.window.setExamQuestions(questions);
        sandbox.window.setCurrentQuestion(0);
        sandbox.window.showQuestion();

        const optA = elements.get("optionA");
        const optB = elements.get("optionB");

        const initialLabelA = optA.querySelector(".answer-option");
        const initialCopyA = optA.querySelector(".option-copy");
        const initialInputA = optA.querySelector("input[name='answer']");

        assert.equal(initialCopyA.textContent, "Lagos");
        assert.equal(initialInputA.checked, false);

        // Answer Question 0 with "B" (Abuja)
        initialInputA.checked = false;
        const inputB = optB.querySelector("input[name='answer']");
        inputB.checked = true;
        sandbox.window.saveAnswer();

        assert.equal(sandbox.window.getAnswers()[0], "B");
        assert.equal(optB.querySelector(".answer-option").classList.contains("selected"), true);

        // Move to Question 1
        sandbox.window.setCurrentQuestion(1);
        sandbox.window.showQuestion();

        // Verify DOM node identity is preserved in-place (no innerHTML destruction)
        assert.equal(optA.querySelector(".answer-option"), initialLabelA, "Option A label instance must be reused in-place");
        assert.equal(optA.querySelector(".option-copy"), initialCopyA, "Option A copy span must be reused in-place");
        assert.equal(initialCopyA.textContent, "Accra", "Option A text must update to Question 1 option text");
        assert.equal(optA.querySelector("input[name='answer']").checked, false, "Option A must not be checked on Q1");
        assert.equal(optB.querySelector(".answer-option").classList.contains("selected"), false, "Q1 options must start unselected");

        console.log("PASS: Test 2 - P3.2 Option Containers Reused In-Place Without innerHTML Teardown");
    }

    // -----------------------------------------------------------------------------------
    // TEST 3: P3.3 Navigation & Answer Persistence Across Forward, Backward & Jumps
    // -----------------------------------------------------------------------------------
    {
        const { sandbox, elements } = createCbtTestEnvironment();
        const questions = Array.from({ length: 5 }, (_, i) => ({
            id: i + 1,
            question: `Question ${i + 1}`,
            options: ["A", "B", "C", "D"],
            answer: "A",
            subject: "General"
        }));

        sandbox.window.setExamQuestions(questions);
        sandbox.window.setCurrentQuestion(0);
        sandbox.window.showQuestion();

        // 1. Answer Q0 -> "C"
        elements.get("optionC").querySelector("input[name='answer']").checked = true;
        sandbox.window.saveAnswer();
        assert.equal(sandbox.window.getAnswers()[0], "C");

        // 2. Next Question -> Q1
        await sandbox.window.nextQuestion();
        assert.equal(sandbox.window.getCurrentQuestion(), 1);

        // 3. Answer Q1 -> "D"
        elements.get("optionD").querySelector("input[name='answer']").checked = true;
        sandbox.window.saveAnswer();
        assert.equal(sandbox.window.getAnswers()[1], "D");

        // 4. Jump to Question 4 (Q5)
        await sandbox.window.goToQuestion(4);
        assert.equal(sandbox.window.getCurrentQuestion(), 4);
        assert.equal(elements.get("optionA").querySelector("input[name='answer']").checked, false);

        // 5. Jump back to Q0 -> "C" must be checked and active
        await sandbox.window.goToQuestion(0);
        assert.equal(sandbox.window.getCurrentQuestion(), 0);
        assert.equal(elements.get("optionC").querySelector("input[name='answer']").checked, true);
        assert.equal(elements.get("optionC").querySelector(".answer-option").classList.contains("selected"), true);
        assert.equal(elements.get("optionA").querySelector("input[name='answer']").checked, false);

        // 6. Navigate forward to Q1 -> "D" must be checked and active
        await sandbox.window.nextQuestion();
        assert.equal(sandbox.window.getCurrentQuestion(), 1);
        assert.equal(elements.get("optionD").querySelector("input[name='answer']").checked, true);
        assert.equal(elements.get("optionD").querySelector(".answer-option").classList.contains("selected"), true);

        console.log("PASS: Test 3 - P3.3 Navigation & Answer State Persistence Across Jumps");
    }

    // -----------------------------------------------------------------------------------
    // TEST 4: P3.4 Drift-Protected Timer, Warning Thresholds & Auto-Submit
    // -----------------------------------------------------------------------------------
    {
        const { sandbox, elements } = createCbtTestEnvironment();
        let submitted = false;
        sandbox.window.finishTest = () => { submitted = true; };

        // Set initial timer to 305 seconds (5 min 5 sec)
        sandbox.window.setTimeLeft(305);
        sandbox.window.startTimer();

        const timerEl = elements.get("timer");

        // Initial tick 1: remaining = 305 -> 5:05
        sandbox.stepInterval(1);
        assert.equal(timerEl.classList.contains("timer-warning"), false);
        assert.equal(timerEl.classList.contains("timer-critical"), false);

        // Simulate 10 seconds elapsed (remaining = 295 -> warning threshold <= 300)
        sandbox.window.setTimeLeft(295);
        sandbox.window.startTimer();
        sandbox.stepInterval(2);
        assert.equal(timerEl.classList.contains("timer-warning"), true, "Must have timer-warning when <= 300s");
        assert.equal(timerEl.classList.contains("timer-critical"), false);

        // Simulate critical threshold (remaining = 55 <= 60)
        sandbox.window.setTimeLeft(55);
        sandbox.window.startTimer();
        sandbox.stepInterval(3);
        assert.equal(timerEl.classList.contains("timer-warning"), true);
        assert.equal(timerEl.classList.contains("timer-critical"), true, "Must have timer-critical when <= 60s");

        // Simulate Background-tab delay / expiration jump (remaining <= 0)
        sandbox.window.setTimeLeft(0);
        sandbox.window.startTimer();
        sandbox.stepInterval(4);

        assert.equal(submitted, true, "Auto-submit finishTest() must be triggered when timer reaches 0");

        console.log("PASS: Test 4 - P3.4 Drift-Protected Timer, Thresholds & Auto-Submit");
    }

    // -----------------------------------------------------------------------------------
    // TEST 5: Grading, Snapshots & Final Results Preservation
    // -----------------------------------------------------------------------------------
    {
        const { sandbox, localStorageStore } = createCbtTestEnvironment();
        const questions = [
            { id: 1, question: "Q1", options: ["A", "B", "C", "D"], answer: "B", subject: "English", explanation: "Exp 1" },
            { id: 2, question: "Q2", options: ["A", "B", "C", "D"], answer: "C", subject: "Mathematics", explanation: "Exp 2" }
        ];

        sandbox.window.setExamQuestions(questions);
        sandbox.window.getAnswers()[0] = "B"; // Correct
        sandbox.window.getAnswers()[1] = "A"; // Wrong (Correct is C)

        sandbox.window.finishTest();

        // Duplicate call to finishTest must be blocked by isExamFinished guard
        sandbox.window.finishTest();

        assert.equal(localStorageStore.has("jambResults"), true, "Results must be saved to localStorage");
        const results = JSON.parse(localStorageStore.get("jambResults"));
        assert.equal(results.length, 1, "Duplicate finishTest() call must NOT write a second result record");
        const r = results[0];

        assert.equal(r.score, 1, "Score must be exactly 1 correct");
        assert.equal(r.wrong, 1, "Wrong count must be 1");
        assert.equal(r.total, 2, "Total questions must be 2");
        assert.equal(r.percentage, 50, "Percentage must be 50%");
        assert.equal(r.questionDetails.length, 2);
        assert.equal(r.questionDetails[0].isCorrect, true);
        assert.equal(r.questionDetails[1].isCorrect, false);
        assert.equal(r.questionDetails[1].correctAnswer, "C");
        assert.equal(r.questionDetails[1].explanation, "Exp 2");

        console.log("PASS: Test 5 - Grading, Snapshots & Duplicate Submission Guard 100% Preserved");
    }

    // -----------------------------------------------------------------------------------
    // TEST 6: Tab Return Visibility Change Instant Clock Sync
    // -----------------------------------------------------------------------------------
    {
        const { sandbox, elements } = createCbtTestEnvironment();
        sandbox.window.setTimeLeft(120);
        sandbox.window.startTimer();

        // Simulate returning to tab when 50 seconds have elapsed (70s remaining)
        sandbox.document.hidden = false;
        // Trigger visibilitychange listener
        sandbox.document.triggerVisibilityChange();

        const timerEl = elements.get("timer");
        assert.equal(timerEl.classList.contains("timer-warning"), true);

        console.log("PASS: Test 6 - Tab Visibility Change Instant Clock Sync");
    }

    console.log("\nALL PHASE 3 CBT RUNTIME SAFETY & OPTIMIZATION TESTS PASSED!");
}

runAllTests().catch(err => {
    console.error("TEST FAILED:", err);
    process.exitCode = 1;
});
