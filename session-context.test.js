"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("supabase.js", "utf8");
const window = {
    localStorage: {
        getItem() {
            return null;
        }
    },
    supabase: {
        createClient() {
            return {};
        }
    }
};
vm.runInNewContext(source, { window, console });

const validConfiguration = {
    id: "554e1646-d3a8-4ce4-9f96-9646a6bde9fc",
    academic_year: "2026",
    version: "1",
    duration_seconds: 1800,
    question_count: 80,
    subject_selection_configuration: {
        mode: "fixed_required_subject_count",
        required_subject_count: 4,
        minimum_subjects: 4,
        maximum_subjects: 4,
        allocation_mode: "per_selected_subject",
        questions_per_selected_subject: 20
    },
    scoring_configuration: {
        method: "correct_count",
        marks_per_question: 1,
        negative_mark: 0
    },
    grading_configuration: {
        method: "percentage",
        bands: []
    }
};

const exam = {
    id: "exam-id",
    code: "JAMB",
    name: "Joint Admissions and Matriculation Board"
};
const subjects = ["English", "Mathematics", "Physics", "Chemistry"];

const context = window.buildCbtSessionContext(
    exam,
    "practice",
    validConfiguration,
    subjects
);

const cachedConfiguration = JSON.parse(JSON.stringify(validConfiguration));
const cachedContext = window.buildCbtSessionContextFromCachedConfiguration(
    {
        exam,
        testType: "practice",
        configuration: cachedConfiguration
    },
    subjects
);
assert.equal(cachedContext.configuration.durationSeconds, 1800);
assert.equal(cachedContext.questionPlan.totalQuestionCount, 80);
assert.equal(cachedContext.configuration.scoring.negativeMark, 0);
assert.throws(
    () => window.buildCbtSessionContextFromCachedConfiguration(null, subjects),
    /Cached CBT configuration is unavailable/
);
assert.throws(
    () =>
        window.buildCbtSessionContextFromCachedConfiguration(
            {
                exam,
                testType: "practice",
                configuration: {
                    ...cachedConfiguration,
                    duration_seconds: 0
                }
            },
            subjects
        ),
    /duration_seconds must be a positive integer/
);

assert.equal(context.testType, "practice");
assert.equal(context.configuration.id, validConfiguration.id);
assert.equal(context.configuration.durationSeconds, 1800);
assert.equal(context.configuration.questionCount, 80);
assert.equal(context.configuration.subjectSelection.requiredSubjectCount, 4);
assert.equal(context.questionPlan.questionsPerSelectedSubject, 20);
assert.equal(context.questionPlan.totalQuestionCount, 80);
assert.deepEqual(Array.from(context.selectedSubjects), subjects);
const snapshotMetadata = window.buildCbtAttemptSnapshotMetadata(context);
assert.equal(snapshotMetadata.identity.configurationId, validConfiguration.id);
assert.equal(snapshotMetadata.identity.examCode, "JAMB");
assert.equal(snapshotMetadata.effectiveRules.durationSeconds, 1800);
assert.equal(snapshotMetadata.effectiveRules.questionCount, 80);
assert.equal(
    snapshotMetadata.effectiveRules.subjectSelection.questionsPerSelectedSubject,
    20
);
assert.deepEqual(
    Array.from(snapshotMetadata.effectiveRules.subjectSelection.selectedSubjectNames),
    subjects
);
assert.equal(snapshotMetadata.effectiveRules.scoring.negativeMark, 0);
assert.equal(snapshotMetadata.effectiveRules.grading.method, "percentage");
assert.ok(Object.isFrozen(context));
assert.ok(Object.isFrozen(context.configuration));
assert.throws(
    () => {
        context.selectedSubjects.push("Biology");
    },
    /not extensible/
);

function expectInvalid(mutator, message) {
    const configuration = JSON.parse(JSON.stringify(validConfiguration));
    mutator(configuration);
    assert.throws(
        () => window.buildCbtSessionContext(exam, "practice", configuration, subjects),
        message
    );
}

expectInvalid(
    (configuration) => delete configuration.question_count,
    /configuration\.question_count is required/
);
expectInvalid(
    (configuration) => {
        configuration.duration_seconds = 0;
    },
    /duration_seconds must be a positive integer/
);
expectInvalid(
    (configuration) => {
        configuration.subject_selection_configuration.minimum_subjects = 5;
    },
    /Subject-count configuration is invalid/
);
expectInvalid(
    (configuration) => {
        configuration.subject_selection_configuration.questions_per_selected_subject = 19;
    },
    /Question allocation does not match/
);
expectInvalid(
    (configuration) => {
        configuration.scoring_configuration.method = "weighted";
    },
    /Unsupported scoring method/
);
expectInvalid(
    (configuration) => {
        configuration.grading_configuration.method = "bands";
    },
    /Unsupported grading method/
);

const score = window.calculateConfiguredScore(
    [
        { correct: true, unanswered: false },
        { correct: false, unanswered: false },
        { correct: false, unanswered: true }
    ],
    context.configuration.scoring
);
assert.equal(score.score, 1);
assert.equal(score.maximumScore, 3);
assert.equal(score.correct, 1);
assert.equal(score.wrong, 1);
assert.equal(score.unanswered, 1);
assert.equal(
    window.calculateConfiguredGrade(score, context.configuration.grading),
    33
);

let selectedQuery;
const resolverClient = {
    from(table) {
        selectedQuery = { table, filters: [] };
        return {
            select(fields) {
                selectedQuery.fields = fields;
                return this;
            },
            eq(field, value) {
                selectedQuery.filters.push([field, value]);
                return this;
            },
            maybeSingle: async () => tableResult(selectedQuery)
        };
    }
};
function tableResult(query) {
    if (query.table === "exams") {
        return { data: exam, error: null };
    }
    return { data: validConfiguration, error: null };
}

window.resolveCbtSessionContext(
    resolverClient,
    "JAMB",
    "practice",
    subjects
).then((resolved) => {
    assert.equal(resolved.exam.id, "exam-id");
    assert.deepEqual(
        selectedQuery.filters,
        [["exam_id", "exam-id"], ["test_type", "practice"], ["is_active", true]]
    );
    console.log("session context fixtures passed");
}).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
