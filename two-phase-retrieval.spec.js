"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Read exam.js
const examSource = fs.readFileSync("exam.js", "utf8");

function createMockEnvironment(options = {}) {
    const localStorageStore = new Map(options.initialStorage ? Object.entries(options.initialStorage) : []);
    const offlineIndexedDB = new Map(options.initialOfflineSets ? Object.entries(options.initialOfflineSets) : []);

    const defaultClient = options.supabaseClient || {
        auth: {
            async getSession() {
                return {
                    data: {
                        session: {
                            user: { id: options.userId || "user_test_1" }
                        }
                    },
                    error: null
                };
            }
        },
        from(tableName) {
            return {
                select() { return this; },
                eq() { return this; },
                in() { return this; },
                order() { return this; },
                range: async () => ({ data: [], error: null })
            };
        }
    };

    const windowMock = {
        localStorage: {
            getItem(key) {
                return localStorageStore.has(key) ? localStorageStore.get(key) : null;
            },
            setItem(key, value) {
                localStorageStore.set(key, String(value));
            },
            removeItem(key) {
                localStorageStore.delete(key);
            }
        },
        sessionStorage: {
            getItem(key) {
                if (key === "cbtSelectedSubjects") {
                    return JSON.stringify(options.subjects || ["English", "Mathematics"]);
                }
                if (key === "cbtTestType") {
                    return options.testType || "practice";
                }
                return null;
            },
            setItem() {},
            removeItem() {}
        },
        location: {
            search: options.search || "?testType=practice",
            href: "",
            reload() {}
        },
        document: {
            getElementById() {
                return { textContent: "", innerHTML: "", style: {}, classList: { add() {}, remove() {} } };
            },
            body: { innerHTML: "", appendChild() {} }
        },
        navigator: {
            onLine: options.onLine !== undefined ? options.onLine : true
        },
        crypto: {
            randomUUID() { return "mock-uuid-1234"; }
        },
        requestIdleCallback(callback) {
            callback();
        },
        getSelectedExamCode() {
            return options.examCode || "JAMB";
        },
        isV1JambPractice() {
            return false;
        },
        resolveExamId: async () => options.examId || "mock-exam-id-1",
        resolveCbtSubjectSelectionRules: async () => ({
            requiredSubjectCount: (options.subjects || ["English", "Mathematics"]).length,
            minimumSubjects: (options.subjects || ["English", "Mathematics"]).length,
            maximumSubjects: (options.subjects || ["English", "Mathematics"]).length
        }),
        resolveCbtSessionContext: async () => ({
            exam: { id: options.examId || "mock-exam-id-1", code: options.examCode || "JAMB" },
            testType: options.testType || "practice",
            questionPlan: {
                questionsPerSelectedSubject: options.questionsPerSubject || 20,
                totalQuestionCount: (options.subjects || ["English", "Mathematics"]).length * (options.questionsPerSubject || 20)
            },
            configuration: {
                id: "config-1",
                durationSeconds: 1800,
                questionCount: (options.subjects || ["English", "Mathematics"]).length * (options.questionsPerSubject || 20),
                subjectSelection: {
                    requiredSubjectCount: (options.subjects || ["English", "Mathematics"]).length,
                    minimumSubjects: (options.subjects || ["English", "Mathematics"]).length,
                    maximumSubjects: (options.subjects || ["English", "Mathematics"]).length
                }
            }
        }),
        OfflineQuestionStore: {
            maxQuestionsPerSet: 120,
            async getSet(examCode, subject, testType) {
                const key = `${examCode}::${testType}::${subject.toLowerCase()}`;
                return offlineIndexedDB.get(key) || null;
            },
            async saveSet(examCode, subject, testType, questions, version) {
                const key = `${examCode}::${testType}::${subject.toLowerCase()}`;
                // Faithful to offline-store.js: sanitize each question
                const safeQuestions = (Array.isArray(questions) ? questions : [])
                    .slice(0, 120)
                    .map(q => {
                        if (!q || typeof q.question !== "string" || !Array.isArray(q.options) || q.options.length !== 4) {
                            return null;
                        }
                        return {
                            id: q.id ?? null,
                            question: q.question,
                            options: q.options.map(o => String(o ?? "")),
                            answer: String(q.answer ?? ""),
                            subject: String(q.subject || subject).trim(),
                            testType: q.testType === "past" ? "past" : "practice",
                            topic: String(q.topic ?? ""),
                            explanation: String(q.explanation ?? ""),
                            year: q.year ?? null,
                            source: String(q.source ?? ""),
                            import_key: String(q.import_key ?? "")
                        };
                    })
                    .filter(Boolean);

                offlineIndexedDB.set(key, {
                    key,
                    examCode,
                    subject,
                    testType,
                    datasetVersion: version || null,
                    questions: safeQuestions
                });
                return true;
            },
            showOfflineNotice() {}
        },
        buildCbtAttemptSnapshotMetadata() {
            return { identity: {}, effectiveRules: {} };
        }
    };

    const sandbox = {
        window: windowMock,
        document: windowMock.document,
        navigator: windowMock.navigator,
        localStorage: windowMock.localStorage,
        sessionStorage: windowMock.sessionStorage,
        location: windowMock.location,
        console: {
            log() {},
            warn() {},
            error() {}
        },
        supabase: {
            createClient() {
                return defaultClient;
            }
        },
        currentUser: { id: options.userId || "user_test_1" },
        clearInterval() {},
        setInterval() { return 1; },
        setTimeout(fn) { fn(); return 1; }
    };

    vm.runInNewContext(examSource, sandbox);

    return {
        sandbox,
        localStorageStore,
        offlineIndexedDB
    };
}

// ----------------------------------------------------
// TEST 1: Candidate vs Full Record Fingerprint Parity
// ----------------------------------------------------
{
    const { sandbox } = createMockEnvironment();
    const rawRow = {
        id: 101,
        exam_id: "mock-exam-id-1",
        Subject: "English",
        Question: "  What is the capital of France?  ",
        Option_a: " London ",
        Option_b: " Paris ",
        Option_c: " Rome ",
        Option_d: " Berlin ",
        Correct_Answer: "B",
        test_type: "practice",
        Topic: "Geography",
        Explanation: "Paris is the capital.",
        updated_at: "2026-01-01T00:00:00Z"
    };

    const candidate = sandbox.window.mapSupabaseCandidate(rawRow);
    const fullRecord = sandbox.mapSupabaseQuestion(rawRow);

    const candidateFingerprint = sandbox.getQuestionFingerprint(candidate, "English", "practice");
    const fullFingerprint = sandbox.getQuestionFingerprint(fullRecord, "English", "practice");

    assert.equal(typeof candidateFingerprint, "string");
    assert.equal(candidateFingerprint.length > 0, true);
    assert.equal(
        candidateFingerprint,
        fullFingerprint,
        "Candidate fingerprint MUST be byte-for-byte identical to full record fingerprint"
    );

    // Backward compatibility with localStorage
    const storageKey = sandbox.getNoRepeatStorageKey("English", "practice");
    sandbox.localStorage.setItem(storageKey, JSON.stringify([fullFingerprint]));
    const loadedSeen = sandbox.loadSeenQuestionIds("English", "practice");
    assert.equal(loadedSeen.has(candidateFingerprint), true, "Candidate fingerprint must match loaded localStorage history");
    console.log("PASS: Test 1 - Fingerprint Normalization Parity & localStorage Compatibility");
}

// ----------------------------------------------------
// TEST 2: Transactional Commitment - Pure Selection Stages History Without Writing
// ----------------------------------------------------
{
    const { sandbox, localStorageStore } = createMockEnvironment({
        userId: "student_42"
    });

    const candidates = [
        { id: 1, question: "Q1", options: ["A", "B", "C", "D"], subject: "English", testType: "practice" },
        { id: 2, question: "Q2", options: ["A", "B", "C", "D"], subject: "English", testType: "practice" }
    ];

    const storageKey = sandbox.getNoRepeatStorageKey("English", "practice");
    assert.equal(localStorageStore.has(storageKey), false);

    const { selectedCandidates, stagedSeenIds } = sandbox.window.selectNoRepeatCandidates(
        candidates,
        "English",
        "practice",
        1
    );

    assert.equal(selectedCandidates.length, 1);
    assert.equal(stagedSeenIds.size, 1);
    assert.equal(localStorageStore.has(storageKey), false, "localStorage must NOT be modified by selectNoRepeatCandidates");

    // Failure before commit gate -> localStorage remains untouched
    assert.equal(localStorageStore.has(storageKey), false);

    // Commit Gate
    sandbox.saveSeenQuestionIds("English", "practice", stagedSeenIds);
    assert.equal(localStorageStore.has(storageKey), true, "localStorage must be updated only at commit gate");
    const committedIds = JSON.parse(localStorageStore.get(storageKey));
    assert.deepEqual(committedIds, Array.from(stagedSeenIds));

    console.log("PASS: Test 2 - Transactional Commitment & Staged Selection");
}

// ----------------------------------------------------
// TEST 3: Cycle-Reset Safety on Retrieval Lifecycle
// ----------------------------------------------------
{
    const { sandbox, localStorageStore } = createMockEnvironment({
        userId: "student_reset_test"
    });

    const fp1 = "fingerprint_1";
    const fp2 = "fingerprint_2";
    const storageKey = sandbox.getNoRepeatStorageKey("English", "practice");
    localStorageStore.set(storageKey, JSON.stringify([fp1, fp2]));

    const candidates = [
        { id: 1, question: "Q1", options: ["A", "B", "C", "D"], subject: "English", testType: "practice", _questionId: fp1 },
        { id: 2, question: "Q2", options: ["A", "B", "C", "D"], subject: "English", testType: "practice", _questionId: fp2 }
    ];

    const { selectedCandidates, stagedSeenIds } = sandbox.window.selectNoRepeatCandidates(
        candidates,
        "English",
        "practice",
        1
    );

    assert.equal(stagedSeenIds.size, 1);
    // localStorage STILL has the previous 2 fingerprints
    const uncommittedHistory = JSON.parse(localStorageStore.get(storageKey));
    assert.equal(uncommittedHistory.length, 2, "Historical cycle must remain unreset in localStorage until commit gate");

    console.log("PASS: Test 3 - Cycle-Reset Preservation on Retrieval Lifecycle");
}

// ----------------------------------------------------
// TEST 4: Full Record Validation Gate Checks
// ----------------------------------------------------
{
    const { sandbox } = createMockEnvironment();

    const candidates = [
        {
            id: 10,
            question: "Question 10",
            options: ["A", "B", "C", "D"],
            subject: "English",
            testType: "practice",
            _questionId: sandbox.getQuestionFingerprint(
                { question: "Question 10", options: ["A", "B", "C", "D"] },
                "English",
                "practice"
            )
        },
        {
            id: 20,
            question: "Question 20",
            options: ["A", "B", "C", "D"],
            subject: "English",
            testType: "practice",
            _questionId: sandbox.getQuestionFingerprint(
                { question: "Question 20", options: ["A", "B", "C", "D"] },
                "English",
                "practice"
            )
        }
    ];

    const validRawRows = [
        {
            id: 20,
            exam_id: "mock-exam-id-1",
            Subject: "English",
            Question: "Question 20",
            Option_a: "A", Option_b: "B", Option_c: "C", Option_d: "D",
            Correct_Answer: "C",
            test_type: "practice"
        },
        {
            id: 10,
            exam_id: "mock-exam-id-1",
            Subject: "English",
            Question: "Question 10",
            Option_a: "A", Option_b: "B", Option_c: "C", Option_d: "D",
            Correct_Answer: "A",
            test_type: "practice"
        }
    ];

    // Case 4A: Valid matching response & order preservation
    const assembled = sandbox.window.validateAndAssembleFullQuestions(
        candidates,
        validRawRows,
        "English",
        "practice"
    );
    assert.equal(assembled.length, 2);
    assert.equal(assembled[0].id, 10);
    assert.equal(assembled[1].id, 20);

    // Case 4B: Missing Record
    assert.throws(
        () => sandbox.window.validateAndAssembleFullQuestions(candidates, [validRawRows[0]], "English", "practice"),
        /Question count mismatch for English/
    );

    // Case 4C: Duplicate Record
    assert.throws(
        () => sandbox.window.validateAndAssembleFullQuestions(candidates, [validRawRows[0], validRawRows[0]], "English", "practice"),
        /Duplicate question record detected/
    );

    // Case 4D: Metadata Mismatch
    const mismatchedSubjectRow = { ...validRawRows[1], Subject: "Mathematics" };
    assert.throws(
        () => sandbox.window.validateAndAssembleFullQuestions(candidates, [validRawRows[0], mismatchedSubjectRow], "English", "practice"),
        /Metadata mismatch/
    );

    // Case 4E: Content modified concurrently
    const tamperedContentRow = { ...validRawRows[1], Option_b: "Tampered Option" };
    assert.throws(
        () => sandbox.window.validateAndAssembleFullQuestions(candidates, [validRawRows[0], tamperedContentRow], "English", "practice"),
        /Content integrity mismatch/
    );

    console.log("PASS: Test 4 - 4-Point Full Record Validation Gate");
}

// ----------------------------------------------------
// TEST 5: Preserve 120-Question Offline Pool in IndexedDB
// ----------------------------------------------------
(async () => {
    const existing120 = [];
    for (let i = 1; i <= 120; i++) {
        existing120.push({
            id: i,
            question: `Existing Cached Question ${i}`,
            options: ["A", "B", "C", "D"],
            answer: "A",
            subject: "English",
            testType: "practice"
        });
    }

    const { sandbox, offlineIndexedDB } = createMockEnvironment({
        initialOfflineSets: {
            "JAMB::practice::english": {
                key: "JAMB::practice::english",
                examCode: "JAMB",
                subject: "English",
                testType: "practice",
                questions: existing120
            }
        }
    });

    const newSessionQuestions = [];
    for (let i = 201; i <= 220; i++) {
        newSessionQuestions.push({
            id: i,
            question: `New Session Question ${i}`,
            options: ["A", "B", "C", "D"],
            answer: "B",
            subject: "English",
            testType: "practice"
        });
    }

    await sandbox.window.preserveAndSaveOfflineQuestionPool(
        "JAMB",
        "English",
        "practice",
        newSessionQuestions
    );

    const savedRecord = offlineIndexedDB.get("JAMB::practice::english");
    assert.equal(savedRecord.questions.length, 120, "IndexedDB pool must maintain exactly 120 questions, NOT 20");
    const savedIds = new Set(savedRecord.questions.map(q => q.id));
    for (let i = 201; i <= 220; i++) {
        assert.equal(savedIds.has(i), true, `New question ID ${i} must be merged into offline pool`);
    }

    console.log("PASS: Test 5 - 120-Question Offline Pool Preservation & Deduplication");
})().then(async () => {
    // ----------------------------------------------------
    // TEST 6: Cold-Start Background Offline Hydration
    // ----------------------------------------------------
    const candidatePool = [];
    for (let i = 1; i <= 150; i++) {
        candidatePool.push({
            id: i,
            question: `Candidate Q${i}`,
            options: ["A", "B", "C", "D"],
            subject: "English",
            testType: "practice"
        });
    }

    const mockSupabaseClient = {
        auth: {
            async getSession() {
                return { data: { session: null }, error: null };
            }
        },
        from() {
            const query = {
                queriedIds: null,
                select() { return this; },
                eq() { return this; },
                in(field, ids) {
                    this.queriedIds = ids;
                    return this;
                },
                then: undefined,
                range: async () => ({ data: [], error: null }),
                async then(resolve) {
                    const data = (this.queriedIds || []).map(id => ({
                        id,
                        exam_id: "mock-exam-id-1",
                        Subject: "English",
                        Question: `Candidate Q${id}`,
                        Option_a: "A", Option_b: "B", Option_c: "C", Option_d: "D",
                        Correct_Answer: "A",
                        test_type: "practice"
                    }));
                    resolve({ data, error: null });
                }
            };
            return query;
        }
    };

    const { sandbox, offlineIndexedDB } = createMockEnvironment({
        supabaseClient: mockSupabaseClient
    });

    const sessionQuestionIds = [1, 2, 3, 4, 5];
    const initialSessionQuestions = sessionQuestionIds.map(id => ({
        id,
        question: `Candidate Q${id}`,
        options: ["A", "B", "C", "D"],
        answer: "A",
        subject: "English",
        testType: "practice"
    }));

    await sandbox.window.preserveAndSaveOfflineQuestionPool(
        "JAMB",
        "English",
        "practice",
        initialSessionQuestions
    );

    assert.equal(offlineIndexedDB.get("JAMB::practice::english").questions.length, 5);

    sandbox.window.scheduleBackgroundOfflinePoolFill(
        "JAMB",
        "mock-exam-id-1",
        "English",
        "practice",
        candidatePool,
        sessionQuestionIds
    );

    await new Promise(r => setTimeout(r, 50));

    const hydratedRecord = offlineIndexedDB.get("JAMB::practice::english");
    assert.equal(hydratedRecord.questions.length, 120, "Background hydration must fill pool up to max 120 questions");
    console.log("PASS: Test 6 - Cold-Start Background Offline Hydration");

    // ----------------------------------------------------
    // TEST 7: End-to-End Online buildQuestions() Execution
    // ----------------------------------------------------
    {
        const subjects = ["English", "Mathematics"];
        const candidatesBySubject = {};
        for (const subj of subjects) {
            candidatesBySubject[subj] = [];
            for (let i = 1; i <= 25; i++) {
                candidatesBySubject[subj].push({
                    id: subj === "English" ? i : i + 100,
                    exam_id: "mock-exam-id-1",
                    Subject: subj,
                    Question: `${subj} Question ${i}`,
                    Option_a: "A", Option_b: "B", Option_c: "C", Option_d: "D",
                    Correct_Answer: "A",
                    test_type: "practice",
                    is_active: true
                });
            }
        }

        const mockClient = {
            auth: {
                async getSession() { return { data: { session: null }, error: null }; }
            },
            from() {
                const query = {
                    currentSubject: null,
                    queriedIds: null,
                    select() { return this; },
                    eq(field, val) {
                        if (field === "Subject") this.currentSubject = val;
                        return this;
                    },
                    in(field, ids) {
                        this.queriedIds = ids;
                        return this;
                    },
                    order() { return this; },
                    then: undefined,
                    async range(from, to) {
                        const all = candidatesBySubject[this.currentSubject] || [];
                        return { data: all.slice(from, to + 1), error: null };
                    },
                    async then(resolve) {
                        const all = candidatesBySubject[this.currentSubject] || [];
                        const filtered = all.filter(q => (this.queriedIds || []).includes(q.id));
                        resolve({ data: filtered, error: null });
                    }
                };
                return query;
            }
        };

        const { sandbox, localStorageStore } = createMockEnvironment({
            subjects,
            questionsPerSubject: 20,
            initialStorage: {
                selectedSubjects: JSON.stringify(subjects)
            },
            supabaseClient: mockClient
        });

        await sandbox.buildQuestions();

        const loadedQuestions = sandbox.window.getExamQuestions();
        assert.equal(loadedQuestions.length, 40, "buildQuestions() must assemble 40 questions (20 per subject)");

        const englishStorageKey = sandbox.getNoRepeatStorageKey("English", "practice");
        const mathStorageKey = sandbox.getNoRepeatStorageKey("Mathematics", "practice");
        assert.equal(localStorageStore.has(englishStorageKey), true);
        assert.equal(localStorageStore.has(mathStorageKey), true);
        assert.equal(JSON.parse(localStorageStore.get(englishStorageKey)).length, 20);
        assert.equal(JSON.parse(localStorageStore.get(mathStorageKey)).length, 20);

        console.log("PASS: Test 7 - End-to-End Online buildQuestions() Execution");
    }

    // ----------------------------------------------------
    // TEST 8: Online Phase 2 Failure Rollback (Zero History Mutation)
    // ----------------------------------------------------
    {
        const subjects = ["English", "Mathematics"];
        const candidatesBySubject = {
            English: Array.from({ length: 25 }, (_, i) => ({
                id: i + 1, exam_id: "mock-exam-id-1", Subject: "English",
                Question: `English Q${i + 1}`, Option_a: "A", Option_b: "B", Option_c: "C", Option_d: "D",
                Correct_Answer: "A", test_type: "practice", is_active: true
            })),
            Mathematics: Array.from({ length: 25 }, (_, i) => ({
                id: i + 101, exam_id: "mock-exam-id-1", Subject: "Mathematics",
                Question: `Math Q${i + 1}`, Option_a: "A", Option_b: "B", Option_c: "C", Option_d: "D",
                Correct_Answer: "A", test_type: "practice", is_active: true
            }))
        };

        const partialFailingClient = {
            auth: {
                async getSession() { return { data: { session: null }, error: null }; }
            },
            from() {
                const query = {
                    currentSubject: null,
                    queriedIds: null,
                    select() { return this; },
                    eq(field, val) {
                        if (field === "Subject") this.currentSubject = val;
                        return this;
                    },
                    in(field, ids) {
                        this.queriedIds = ids;
                        return this;
                    },
                    order() { return this; },
                    then: undefined,
                    async range(from, to) {
                        const all = candidatesBySubject[this.currentSubject] || [];
                        return { data: all.slice(from, to + 1), error: null };
                    },
                    async then(resolve, reject) {
                        // Fail on Mathematics immediately during Phase 2
                        if (this.currentSubject === "Mathematics") {
                            resolve({ data: null, error: { message: "Simulated PostgREST 500 error on Mathematics" } });
                        } else {
                            // Delay English to simulate in-flight request resolving after rejection
                            await new Promise(r => setTimeout(r, 20));
                            const all = candidatesBySubject[this.currentSubject] || [];
                            const filtered = all.filter(q => (this.queriedIds || []).includes(q.id));
                            resolve({ data: filtered, error: null });
                        }
                    }
                };
                return query;
            }
        };

        const { sandbox, localStorageStore } = createMockEnvironment({
            subjects,
            questionsPerSubject: 20,
            initialStorage: {
                selectedSubjects: JSON.stringify(subjects)
            },
            supabaseClient: partialFailingClient
        });

        await assert.rejects(
            async () => { await sandbox.buildQuestions(); },
            /Could not load full practice questions for Mathematics/
        );

        // Wait to ensure delayed in-flight request has finished executing
        await new Promise(r => setTimeout(r, 40));

        assert.equal(sandbox.window.getExamQuestions().length, 0, "Active session questions array must remain empty when retrieval fails");

        const englishStorageKey = sandbox.getNoRepeatStorageKey("English", "practice");
        const mathStorageKey = sandbox.getNoRepeatStorageKey("Mathematics", "practice");
        assert.equal(localStorageStore.has(englishStorageKey), false, "English history MUST NOT be committed when Mathematics fails Phase 2");
        assert.equal(localStorageStore.has(mathStorageKey), false, "Mathematics history MUST NOT be committed when Mathematics fails Phase 2");

        console.log("PASS: Test 8 - Online Phase 2 Failure Rollback (Zero Partial History Mutation)");
    }

    // ----------------------------------------------------
    // TEST 9: Offline Assembly Rollback on Insufficient Subject Questions
    // ----------------------------------------------------
    {
        const subjects = ["English", "Mathematics"];
        // English has 20 questions, but Mathematics only has 5 (insufficient for 20-batch)
        const cachedPool = [
            ...Array.from({ length: 20 }, (_, i) => ({
                id: i + 1, question: `English Q${i + 1}`, options: ["A", "B", "C", "D"],
                answer: "A", subject: "English", testType: "practice"
            })),
            ...Array.from({ length: 5 }, (_, i) => ({
                id: i + 101, question: `Math Q${i + 1}`, options: ["A", "B", "C", "D"],
                answer: "A", subject: "Mathematics", testType: "practice"
            }))
        ];

        const { sandbox, localStorageStore } = createMockEnvironment({
            subjects,
            questionsPerSubject: 20,
            onLine: false,
            initialStorage: {
                selectedSubjects: JSON.stringify(subjects)
            },
            initialOfflineSets: {
                "JAMB::practice::english": {
                    key: "JAMB::practice::english", examCode: "JAMB", subject: "English",
                    testType: "practice", questions: cachedPool.filter(q => q.subject === "English")
                },
                "JAMB::practice::mathematics": {
                    key: "JAMB::practice::mathematics", examCode: "JAMB", subject: "Mathematics",
                    testType: "practice", questions: cachedPool.filter(q => q.subject === "Mathematics")
                }
            }
        });

        await assert.rejects(
            async () => { await sandbox.buildQuestions(); },
            /Insufficient offline questions for Mathematics/
        );

        const englishStorageKey = sandbox.getNoRepeatStorageKey("English", "practice");
        const mathStorageKey = sandbox.getNoRepeatStorageKey("Mathematics", "practice");
        assert.equal(localStorageStore.has(englishStorageKey), false, "English history MUST NOT be committed when Mathematics has insufficient offline questions");
        assert.equal(localStorageStore.has(mathStorageKey), false, "Mathematics history MUST NOT be committed when Mathematics fails");

        console.log("PASS: Test 9 - Offline Assembly Rollback on Insufficient Subject Questions");
    }

    // ----------------------------------------------------
    // TEST 10: Complete Offline Assembly Success & Commit Gate
    // ----------------------------------------------------
    {
        const subjects = ["English", "Mathematics"];
        const cachedPool = [
            ...Array.from({ length: 30 }, (_, i) => ({
                id: i + 1, question: `English Q${i + 1}`, options: ["A", "B", "C", "D"],
                answer: "A", subject: "English", testType: "practice"
            })),
            ...Array.from({ length: 30 }, (_, i) => ({
                id: i + 101, question: `Math Q${i + 1}`, options: ["A", "B", "C", "D"],
                answer: "A", subject: "Mathematics", testType: "practice"
            }))
        ];

        const { sandbox, localStorageStore } = createMockEnvironment({
            subjects,
            questionsPerSubject: 20,
            onLine: false,
            initialStorage: {
                selectedSubjects: JSON.stringify(subjects)
            },
            initialOfflineSets: {
                "JAMB::practice::english": {
                    key: "JAMB::practice::english", examCode: "JAMB", subject: "English",
                    testType: "practice", questions: cachedPool.filter(q => q.subject === "English")
                },
                "JAMB::practice::mathematics": {
                    key: "JAMB::practice::mathematics", examCode: "JAMB", subject: "Mathematics",
                    testType: "practice", questions: cachedPool.filter(q => q.subject === "Mathematics")
                }
            }
        });

        await sandbox.buildQuestions();

        const loadedQuestions = sandbox.window.getExamQuestions();
        assert.equal(loadedQuestions.length, 40, "Offline assembly must return 40 questions (20 per subject)");

        const englishStorageKey = sandbox.getNoRepeatStorageKey("English", "practice");
        const mathStorageKey = sandbox.getNoRepeatStorageKey("Mathematics", "practice");
        assert.equal(localStorageStore.has(englishStorageKey), true);
        assert.equal(localStorageStore.has(mathStorageKey), true);
        assert.equal(JSON.parse(localStorageStore.get(englishStorageKey)).length, 20);
        assert.equal(JSON.parse(localStorageStore.get(mathStorageKey)).length, 20);

        console.log("PASS: Test 10 - Complete Offline Assembly Success & Commit Gate");
    }

    // ----------------------------------------------------
    // TEST 11: OfflineQuestionStore Sanitization & 120-Cap Contract
    // ----------------------------------------------------
    {
        const { sandbox, offlineIndexedDB } = createMockEnvironment();

        const mixedQualityQuestions = [
            { id: 1, question: "Valid Q1", options: ["A", "B", "C", "D"], answer: "A", subject: "English", testType: "practice" },
            { id: 2, question: 12345, options: ["A", "B", "C", "D"] }, // INVALID: question not string
            { id: 3, question: "Invalid Options", options: ["A", "B"] }, // INVALID: options not 4 items
            null, // INVALID: null row
            { id: 4, question: "Valid Q4", options: ["A", "B", "C", "D"], answer: "D", subject: "English", testType: "practice" }
        ];

        await sandbox.window.preserveAndSaveOfflineQuestionPool("JAMB", "English", "practice", mixedQualityQuestions);

        const savedRecord = offlineIndexedDB.get("JAMB::practice::english");
        assert.equal(savedRecord.questions.length, 2, "Only the 2 structurally valid questions must be stored");
        assert.equal(savedRecord.questions[0].id, 1);
        assert.equal(savedRecord.questions[1].id, 4);

        console.log("PASS: Test 11 - OfflineQuestionStore Sanitization & Schema Protection");
    }

    console.log("\nALL 11 TWO-PHASE RETRIEVAL SAFETY & TRANSACTION TESTS PASSED!");
}).catch(err => {
    console.error("TEST FAILED:", err);
    process.exitCode = 1;
});
