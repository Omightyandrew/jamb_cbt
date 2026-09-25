"use strict";

const assert = require("node:assert/strict");
const {
    normalizeResultRecord,
    normalizeResultRecords,
    compareNormalizedResults
} = require("./result-adapter.js");

function baseResult(overrides) {
    return {
        id: 1,
        userId: "user-1",
        date: "2026-09-22T12:00:00.000Z",
        subjects: ["English", "Mathematics"],
        testType: "practice",
        score: 1,
        total: 2,
        percentage: 50,
        correct: 1,
        wrong: 1,
        unanswered: 0,
        timeUsed: 600,
        timeAllowed: 1800,
        subjectStats: [{ subject: "English", correct: 1, total: 1, percentage: 100 }],
        questionDetails: [],
        ...overrides
    };
}

function snapshot(overrides) {
    return {
        schemaVersion: 1,
        identity: {
            attemptId: "attempt-2",
            startedAt: "2026-09-22T11:31:00.000Z",
            submittedAt: "2026-09-22T12:01:00.000Z",
            examId: "exam-1",
            examCode: "JAMB",
            testType: "practice",
            configurationId: "config-1",
            academicYear: 2026,
            configurationVersion: 1
        },
        effectiveRules: {
            authority: "legacy_v1",
            questionCount: 2,
            durationSeconds: 1800,
            scoring: {
                method: "correct_count",
                marks_per_question: 1,
                negative_mark: 0
            },
            grading: { method: "percentage", bands: [] },
            subjectSelection: {
                mode: "required",
                requiredSubjectCount: 2,
                minimumSubjects: 2,
                maximumSubjects: 2,
                allocationMode: "fixed_per_subject",
                questionsPerSelectedSubject: 1,
                selectedSubjectIds: ["english-id", "math-id"],
                selectedSubjectCodes: ["ENG", "MATH"],
                selectedSubjectNames: ["English", "Mathematics"]
            }
        },
        content: {
            selectedQuestionIds: [11, 12],
            questionOrder: [
                { position: 0, questionId: 11, subject: "English" },
                { position: 1, questionId: 12, subject: "Mathematics" }
            ],
            questionDatasetVersion: "dataset-1"
        },
        runtime: {
            status: "submitted",
            currentQuestionIndex: 1,
            answers: { 0: "A" },
            questionTimeSpent: { 0: 20 },
            remainingTime: 1200
        },
        ...overrides
    };
}

const currentPractice = baseResult({
    id: 2,
    date: "2026-09-22T12:01:00.000Z",
    attemptSnapshot: snapshot()
});
const practiceNormalized = normalizeResultRecord(currentPractice);
assert.equal(practiceNormalized.state.validation, "valid");
assert.equal(practiceNormalized.identity.attemptId, "attempt-2");
assert.equal(practiceNormalized.exam.examId, "exam-1");
assert.equal(practiceNormalized.test.classification, "practice");
assert.deepEqual(practiceNormalized.subjectStats, currentPractice.subjectStats);
assert.equal(practiceNormalized.effectiveRules.questionCount, 2);
assert.equal(practiceNormalized.effectiveRules.durationSeconds, 1800);
assert.equal(
    practiceNormalized.effectiveRules.subjectSelection.questionsPerSelectedSubject,
    1
);
assert.equal(practiceNormalized.effectiveRules.scoring.negativeMark, 0);
assert.equal(practiceNormalized.effectiveRules.grading.method, "percentage");
assert.equal(practiceNormalized.state.status, "submitted");

const currentPast = baseResult({
    id: 3,
    testType: "past",
    attemptSnapshot: undefined
});
const pastNormalized = normalizeResultRecord(currentPast);
assert.equal(pastNormalized.state.validation, "legacy_compatible");
assert.equal(pastNormalized.test.classification, "past");
assert.equal(pastNormalized.identity.legacyClassification, "legacy_v1");

const offlinePractice = normalizeResultRecord(baseResult({
    id: 4,
    testType: "practice",
    attemptSnapshot: undefined
}));
assert.equal(offlinePractice.test.classification, "practice");
assert.equal(offlinePractice.state.validation, "legacy_compatible");

const missingSubjectStats = normalizeResultRecord(baseResult({
    subjectStats: undefined
}));
assert.deepEqual(missingSubjectStats.subjectStats, []);
assert.equal(missingSubjectStats.state.validation, "legacy_compatible");
assert.ok(missingSubjectStats.diagnostics.missingFields.includes("subjectStats"));

const mismatch = normalizeResultRecord(baseResult({
    attemptSnapshot: snapshot({
        effectiveRules: {
            ...snapshot().effectiveRules,
            questionCount: 3
        },
        content: {
            ...snapshot().content,
            selectedQuestionIds: [11],
            questionOrder: [{ position: 0, questionId: 11 }]
        }
    })
}));
assert.equal(mismatch.state.validation, "partial");
assert.ok(mismatch.diagnostics.warnings.some((item) => item.includes("question count")));
assert.ok(mismatch.diagnostics.warnings.some((item) => item.includes("questionOrder")));

const selectedOrderMismatch = normalizeResultRecord(baseResult({
    attemptSnapshot: snapshot({
        content: {
            ...snapshot().content,
            selectedQuestionIds: [11, 12, 13]
        }
    })
}));
assert.equal(selectedOrderMismatch.state.validation, "partial");
assert.ok(
    selectedOrderMismatch.diagnostics.warnings.some((item) =>
        item.includes("selectedQuestionIds count differs from questionOrder length")
    )
);

const rulesConflict = normalizeResultRecord(baseResult({
    effectiveRules: { questionCount: 99 },
    attemptSnapshot: snapshot()
}));
assert.equal(rulesConflict.effectiveRules.questionCount, 2);
assert.ok(rulesConflict.diagnostics.conflicts.includes(
    "effectiveRules differs between attemptSnapshot and top-level metadata."
));
assert.equal(rulesConflict.state.validation, "partial");

const statsConflict = normalizeResultRecord(baseResult({
    subjectStats: [{ subject: "Other", percentage: 0 }],
    attemptSnapshot: snapshot({ subjectStats: [{ subject: "English", percentage: 100 }] })
}));
assert.deepEqual(statsConflict.subjectStats, [{ subject: "English", percentage: 100 }]);
assert.ok(statsConflict.diagnostics.conflicts.includes(
    "subjectStats differs between attemptSnapshot and top-level metadata."
));

const unknownType = normalizeResultRecord(baseResult({ testType: "mock" }));
assert.equal(unknownType.test.testType, "mock");
assert.equal(unknownType.test.classification, "unknown");

const incompleteRules = normalizeResultRecord(baseResult({
    attemptSnapshot: snapshot({
        effectiveRules: { authority: "legacy_v1" }
    })
}));
assert.equal(incompleteRules.state.validation, "partial");
assert.ok(incompleteRules.diagnostics.missingFields.includes("effectiveRules.questionCount"));

const inProgress = normalizeResultRecord(baseResult({
    attemptSnapshot: snapshot({
        identity: {
            ...snapshot().identity,
            submittedAt: undefined
        },
        runtime: { status: "in_progress", currentQuestionIndex: 1 }
    })
}));
assert.equal(inProgress.recordKind, "resumable_attempt");
assert.equal(inProgress.state.status, "in_progress");
assert.equal(inProgress.state.validation, "valid");

const invalidStatus = normalizeResultRecord(baseResult({
    attemptSnapshot: snapshot({ runtime: { status: "paused" } })
}));
assert.equal(invalidStatus.state.validation, "partial");
assert.ok(invalidStatus.diagnostics.warnings.some((item) => item.includes("Unknown runtime status")));

const malformed = normalizeResultRecord(null);
assert.equal(malformed.state.validation, "invalid");

const ordered = normalizeResultRecords([
    baseResult({ id: 1 }),
    currentPractice
]);
assert.deepEqual(ordered.map((record) => record.identity.legacyId), [2, 1]);
assert.equal(compareNormalizedResults(ordered[0], ordered[1]) < 0, true);

console.log("result-adapter fixtures passed");
