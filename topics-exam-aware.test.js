"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("topics-exam-aware.js", "utf8");
const activeCodes = new Set(["JAMB", "WAEC", "NECO"]);
const examIds = { JAMB: "jamb-id", WAEC: "waec-id", NECO: "neco-id" };
const records = {
    syllabus_subjects: [
        { id: "jamb-math", exam_id: "jamb-id", name: "Mathematics", display_name: "Mathematics", is_active: true },
        { id: "waec-math", exam_id: "waec-id", name: "Mathematics", display_name: "Mathematics", is_active: true }
    ],
    syllabus_sections: [
        { id: "jamb-algebra", subject_id: "jamb-math", title: "JAMB Algebra", is_active: true },
        { id: "waec-algebra", subject_id: "waec-math", title: "WAEC Algebra", is_active: true }
    ],
    syllabus_topics: [
        { id: "jamb-equations", section_id: "jamb-algebra", title: "JAMB Equations", is_active: true },
        { id: "waec-equations", section_id: "waec-algebra", title: "WAEC Equations", is_active: true }
    ]
};

const window = {
    getSelectedExamCode() {
        return "JAMB";
    },
    async resolveExamId(_client, code) {
        if (!activeCodes.has(code)) throw new Error(`Exam "${code}" is unavailable.`);
        return examIds[code];
    }
};
const document = {
    readyState: "loading",
    addEventListener() {}
};
vm.runInNewContext(source, { window, document, console });

function makeClient(catalogue, options = {}) {
    const calls = [];
    return {
        calls,
        from(table) {
            const filters = [];
            const query = {
                select() { return this; },
                eq(column, value) { filters.push(["eq", column, value]); return this; },
                in(column, values) { filters.push(["in", column, values]); return this; },
                order() { return this; },
                then(resolve, reject) {
                    calls.push({ table, filters });
                    const rows = catalogue[table] || [];
                    const data = rows.filter((row) => filters.every(([kind, column, value]) => {
                        if (kind === "eq") return row[column] === value;
                        if (options.ignoreIn) return true;
                        return value.includes(row[column]);
                    }));
                    return Promise.resolve({ data, error: null }).then(resolve, reject);
                }
            };
            return query;
        }
    };
}

(async () => {
    const client = makeClient(records);
    const jamb = await window.ExamPilotTopicsRuntime.loadExamCatalogue(client, "JAMB");
    assert.equal(jamb.exam.id, "jamb-id");
    assert.equal(jamb.subjects[0].name, "Mathematics");
    assert.equal(jamb.subjects[0].sections[0].topics[0].title, "JAMB Equations");

    const waec = await window.ExamPilotTopicsRuntime.loadExamCatalogue(client, "WAEC");
    assert.equal(waec.exam.id, "waec-id");
    assert.equal(waec.subjects.length, 1);
    assert.equal(waec.subjects[0].sections[0].title, "WAEC Algebra");
    assert.equal(waec.subjects[0].sections[0].topics[0].title, "WAEC Equations");
    assert.ok(client.calls.some((call) =>
        call.table === "syllabus_subjects" &&
        call.filters.some((filter) => filter[1] === "exam_id" && filter[2] === "waec-id")
    ));

    const inactiveClient = makeClient(records);
    await assert.rejects(
        window.ExamPilotTopicsRuntime.loadExamCatalogue(inactiveClient, "NABTEB"),
        /unavailable/
    );
    assert.equal(inactiveClient.calls.length, 0);

    const noSyllabus = makeClient({
        syllabus_subjects: [],
        syllabus_sections: [],
        syllabus_topics: []
    });
    await assert.rejects(
        window.ExamPilotTopicsRuntime.loadExamCatalogue(noSyllabus, "NECO"),
        /No active syllabus subjects/
    );

    const foreignParent = makeClient({
        syllabus_subjects: [records.syllabus_subjects[1]],
        syllabus_sections: [records.syllabus_sections[0]],
        syllabus_topics: []
    }, { ignoreIn: true });
    await assert.rejects(
        window.ExamPilotTopicsRuntime.loadExamCatalogue(foreignParent, "WAEC"),
        /outside the selected exam catalogue/
    );

    console.log("exam-aware topics fixtures passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});