(function (root, factory) {
    const adapter = factory();

    if (typeof module !== "undefined" && module.exports) {
        module.exports = adapter;
    }

    if (root) {
        root.ExamPilotResultAdapter = adapter;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const VALID_STATUSES = new Set([
        "submitted",
        "in_progress",
        "abandoned",
        "unknown"
    ]);

    function isObject(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function hasValue(value) {
        return value !== undefined && value !== null && value !== "";
    }

    function finiteNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function validString(value) {
        return typeof value === "string" && value.trim() ? value.trim() : null;
    }

    function validDate(value) {
        if (!hasValue(value)) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : String(value);
    }

    function sameValue(left, right) {
        return JSON.stringify(left) === JSON.stringify(right);
    }

    function addConflict(diagnostics, field, snapshotValue, topLevelValue) {
        if (
            hasValue(snapshotValue) &&
            hasValue(topLevelValue) &&
            !sameValue(snapshotValue, topLevelValue)
        ) {
            diagnostics.conflicts.push(
                `${field} differs between attemptSnapshot and top-level metadata.`
            );
        }
    }

    function snapshotValue(snapshot, path) {
        return path.reduce(
            (value, key) => (isObject(value) ? value[key] : undefined),
            snapshot
        );
    }

    function chooseSnapshotValue(snapshot, topLevelValue, path) {
        const value = snapshotValue(snapshot, path);
        return hasValue(value) ? value : topLevelValue;
    }

    function cloneValue(value) {
        if (Array.isArray(value)) {
            return value.map(cloneValue);
        }
        if (isObject(value)) {
            return Object.keys(value).reduce(function (copy, key) {
                copy[key] = cloneValue(value[key]);
                return copy;
            }, {});
        }
        return value;
    }

    function normalizeSubjectStats(record, snapshot, diagnostics) {
        const snapshotStats = snapshotValue(snapshot, ["subjectStats"]);
        const stats = Array.isArray(snapshotStats)
            ? snapshotStats
            : Array.isArray(record.subjectStats)
                ? record.subjectStats
                : [];
        addConflict(diagnostics, "subjectStats", snapshotStats, record.subjectStats);
        if (!Array.isArray(snapshotStats) && !Array.isArray(record.subjectStats)) {
            diagnostics.missingFields.push("subjectStats");
        }
        return stats.map(function (stat) {
            return isObject(stat) ? cloneValue(stat) : stat;
        });
    }

    function normalizeEffectiveRules(record, snapshot, diagnostics) {
        const snapshotRules = snapshotValue(snapshot, ["effectiveRules"]);
        const topLevelRules = record.effectiveRules;
        addConflict(diagnostics, "effectiveRules", snapshotRules, topLevelRules);
        const rules = isObject(snapshotRules)
            ? snapshotRules
            : isObject(topLevelRules)
                ? topLevelRules
                : {};
        const selection = isObject(rules.subjectSelection)
            ? rules.subjectSelection
            : {};
        const scoring = isObject(rules.scoring) ? rules.scoring : {};
        const grading = isObject(rules.grading) ? rules.grading : {};
        const effectiveRules = {
            authority: validString(rules.authority),
            questionCount: finiteNumber(rules.questionCount),
            durationSeconds: finiteNumber(rules.durationSeconds),
            subjectSelection: {
                mode: validString(selection.mode),
                requiredSubjectCount: finiteNumber(selection.requiredSubjectCount),
                minimumSubjects: finiteNumber(selection.minimumSubjects),
                maximumSubjects: finiteNumber(selection.maximumSubjects),
                allocationMode: validString(selection.allocationMode),
                questionsPerSelectedSubject: finiteNumber(
                    selection.questionsPerSelectedSubject
                ),
                selectedSubjectIds: Array.isArray(selection.selectedSubjectIds)
                    ? [...selection.selectedSubjectIds]
                    : [],
                selectedSubjectCodes: Array.isArray(selection.selectedSubjectCodes)
                    ? [...selection.selectedSubjectCodes]
                    : [],
                selectedSubjectNames: Array.isArray(selection.selectedSubjectNames)
                    ? [...selection.selectedSubjectNames]
                    : []
            },
            scoring: {
                method: validString(scoring.method),
                marksPerQuestion: finiteNumber(
                    scoring.marksPerQuestion ?? scoring.marks_per_question
                ),
                negativeMark: finiteNumber(
                    scoring.negativeMark ?? scoring.negative_mark
                )
            },
            grading: {
                method: validString(grading.method),
                bands: Array.isArray(grading.bands) ? cloneValue(grading.bands) : null
            }
        };
        const hasRules = Object.keys(rules).length > 0;
        if (hasRules && effectiveRules.questionCount === null) {
            diagnostics.missingFields.push("effectiveRules.questionCount");
        }
        if (hasRules && effectiveRules.durationSeconds === null) {
            diagnostics.missingFields.push("effectiveRules.durationSeconds");
        }
        if (hasRules && !effectiveRules.scoring.method) {
            diagnostics.missingFields.push("effectiveRules.scoring.method");
        }
        if (hasRules && !effectiveRules.grading.method) {
            diagnostics.missingFields.push("effectiveRules.grading.method");
        }
        return effectiveRules;
    }

    function classifyTestType(testType) {
        const normalized = validString(testType);
        if (normalized === "past") return "past";
        if (normalized === "practice") return "practice";
        return "unknown";
    }

    function normalizeSubjects(record, snapshot, diagnostics) {
        const names = Array.isArray(record.subjects) ? record.subjects : [];
        const snapshotSelection = snapshotValue(snapshot, [
            "effectiveRules",
            "subjectSelection"
        ]);
        const topLevelSelection = isObject(record.effectiveRules) &&
            isObject(record.effectiveRules.subjectSelection)
            ? record.effectiveRules.subjectSelection
            : {};
        if (Object.keys(topLevelSelection).length > 0) {
            addConflict(
                diagnostics,
                "effectiveRules.subjectSelection",
                snapshotSelection,
                topLevelSelection
            );
        }
        const selection = isObject(snapshotSelection)
            ? snapshotSelection
            : topLevelSelection;
        const ids = Array.isArray(selection.selectedSubjectIds)
            ? selection.selectedSubjectIds
            : [];
        const codes = Array.isArray(selection.selectedSubjectCodes)
            ? selection.selectedSubjectCodes
            : [];
        const snapshotNames = Array.isArray(selection.selectedSubjectNames)
            ? selection.selectedSubjectNames
            : [];
        const subjectNames = snapshotNames.length ? snapshotNames : names;
        const length = Math.max(subjectNames.length, ids.length, codes.length);

        if (!Array.isArray(record.subjects) && !snapshotNames.length) {
            diagnostics.missingFields.push("subjects");
        }

        return Array.from({ length }, function (_, index) {
            return {
                id: ids[index] ?? null,
                code: validString(codes[index]),
                name: String(subjectNames[index] ?? "")
            };
        });
    }

    function normalizeGrading(record, snapshot, diagnostics) {
        const snapshotScoring = snapshotValue(snapshot, [
            "effectiveRules",
            "scoring"
        ]);
        const snapshotGrading = snapshotValue(snapshot, [
            "effectiveRules",
            "grading"
        ]);
        const topLevelScoring = isObject(record.effectiveRules)
            ? record.effectiveRules.scoring
            : record.scoring;
        const topLevelGrading = isObject(record.effectiveRules)
            ? record.effectiveRules.grading
            : record.grading;
        addConflict(diagnostics, "scoring", snapshotScoring, topLevelScoring);
        addConflict(diagnostics, "grading", snapshotGrading, topLevelGrading);
        const scoring = isObject(snapshotScoring)
            ? snapshotScoring
            : isObject(topLevelScoring) ? topLevelScoring : {};
        const grading = isObject(snapshotGrading)
            ? snapshotGrading
            : isObject(topLevelGrading) ? topLevelGrading : {};
        const snapshotPercentage = snapshotValue(snapshot, [
            "effectiveRules",
            "grading",
            "percentage"
        ]);

        const legacyProjection = {
            score: finiteNumber(record.score),
            total: finiteNumber(record.total),
            percentage: finiteNumber(record.percentage),
            correct: finiteNumber(record.correct),
            wrong: finiteNumber(record.wrong),
            unanswered: finiteNumber(record.unanswered)
        };

        const method = validString(grading.method) ||
            validString(scoring.method) ||
            (hasValue(record.percentage) ? "percentage" : null);
        const percentage = method === "percentage"
            ? finiteNumber(hasValue(snapshotPercentage)
                ? snapshotPercentage
                : record.percentage)
            : null;

        if (method !== "percentage" && hasValue(record.percentage)) {
            diagnostics.warnings.push(
                "Legacy percentage is retained only as a compatibility projection for non-percentage grading."
            );
        }

        return {
            model: {
                method,
                marksPerQuestion: finiteNumber(scoring.marks_per_question ?? scoring.marksPerQuestion),
                negativeMark: finiteNumber(scoring.negative_mark ?? scoring.negativeMark),
                authority: validString(snapshotValue(snapshot, [
                    "effectiveRules",
                    "authority"
                ]))
            },
            result: {
                score: legacyProjection.score,
                maximumScore: legacyProjection.total,
                percentage,
                grade: validString(record.grade),
                band: validString(record.band),
                passed: typeof record.passed === "boolean" ? record.passed : null
            },
            legacyProjection
        };
    }

    function normalizeResultRecord(rawRecord, options) {
        const settings = isObject(options) ? options : {};
        const diagnostics = {
            warnings: [],
            conflicts: [],
            missingFields: []
        };

        if (!isObject(rawRecord)) {
            return {
                recordKind: "completed_result",
                schemaVersion: 1,
                identity: {
                    attemptId: null,
                    legacyId: null,
                    userId: null,
                    source: settings.source || "legacy_local",
                    legacyClassification: null
                },
                exam: {
                    examId: null,
                    examCode: null,
                    identityStatus: "unknown"
                },
                test: {
                    testType: null,
                    configurationId: null,
                    academicYear: null,
                    configurationVersion: null,
                    configurationStatus: "unknown"
                },
                timing: {
                    startedAt: null,
                    submittedAt: null,
                    legacyDate: null,
                    timeUsed: null,
                    timeAllowed: null
                },
                subjects: [],
                subjectStats: [],
                effectiveRules: {
                    authority: null,
                    questionCount: null,
                    durationSeconds: null,
                    subjectSelection: {
                        mode: null,
                        requiredSubjectCount: null,
                        minimumSubjects: null,
                        maximumSubjects: null,
                        allocationMode: null,
                        questionsPerSelectedSubject: null,
                        selectedSubjectIds: [],
                        selectedSubjectCodes: [],
                        selectedSubjectNames: []
                    },
                    scoring: {
                        method: null,
                        marksPerQuestion: null,
                        negativeMark: null
                    },
                    grading: { method: null, bands: null }
                },
                content: {
                    selectedQuestionIds: [],
                    questionOrder: [],
                    questionDatasetVersion: null,
                    questionDetails: []
                },
                grading: {
                    model: {
                        method: null,
                        marksPerQuestion: null,
                        negativeMark: null,
                        authority: null
                    },
                    result: {
                        score: null,
                        maximumScore: null,
                        percentage: null,
                        grade: null,
                        band: null,
                        passed: null
                    },
                    legacyProjection: {
                        score: null,
                        total: null,
                        percentage: null,
                        correct: null,
                        wrong: null,
                        unanswered: null
                    }
                },
                state: {
                    status: "unknown",
                    validation: "invalid"
                },
                runtime: {
                    currentQuestionIndex: null,
                    answers: null,
                    questionTimeSpent: null,
                    remainingTime: null
                },
                diagnostics: {
                    warnings: ["Result record must be an object."],
                    conflicts: [],
                    missingFields: []
                },
                raw: {
                    record: rawRecord
                }
            };
        }

        const snapshot = isObject(rawRecord.attemptSnapshot)
            ? rawRecord.attemptSnapshot
            : null;
        const snapshotIdentity = snapshot?.identity || {};
        const snapshotRuntime = snapshot?.runtime || {};
        const snapshotContent = snapshot?.content || {};
        const topLevelRuntime = isObject(rawRecord.runtime) ? rawRecord.runtime : {};
        const rawStatus = chooseSnapshotValue(
            snapshot,
            rawRecord.status,
            ["runtime", "status"]
        ) || topLevelRuntime.status;
        if (hasValue(rawStatus) && !VALID_STATUSES.has(rawStatus)) {
            diagnostics.warnings.push(`Unknown runtime status: ${String(rawStatus)}.`);
        }
        const status = VALID_STATUSES.has(rawStatus) ? rawStatus : "submitted";
        const attemptId = validString(snapshotIdentity.attemptId) ||
            validString(rawRecord.attemptId);
        const legacyId = hasValue(rawRecord.id) ? rawRecord.id : null;
        const examId = chooseSnapshotValue(snapshot, rawRecord.examId, ["identity", "examId"]) ||
            rawRecord.examId ||
            null;
        const examCode = chooseSnapshotValue(snapshot, rawRecord.examCode, ["identity", "examCode"]) ||
            rawRecord.examCode ||
            null;
        const testType = chooseSnapshotValue(snapshot, rawRecord.testType, ["identity", "testType"]) ||
            rawRecord.testType ||
            null;
        const configurationId = chooseSnapshotValue(snapshot, rawRecord.configurationId, [
            "identity",
            "configurationId"
        ]) || rawRecord.configurationId || null;
        const academicYear = chooseSnapshotValue(snapshot, rawRecord.academicYear, [
            "identity",
            "academicYear"
        ]) ?? rawRecord.academicYear ?? null;
        const configurationVersion = chooseSnapshotValue(snapshot, rawRecord.configurationVersion, [
            "identity",
            "configurationVersion"
        ]) ?? rawRecord.configurationVersion ?? null;

        addConflict(diagnostics, "attemptId", snapshotIdentity.attemptId, rawRecord.attemptId);
        addConflict(diagnostics, "examId", snapshotIdentity.examId, rawRecord.examId);
        addConflict(diagnostics, "examCode", snapshotIdentity.examCode, rawRecord.examCode);
        addConflict(diagnostics, "testType", snapshotIdentity.testType, rawRecord.testType);
        addConflict(diagnostics, "configurationId", snapshotIdentity.configurationId, rawRecord.configurationId);
        addConflict(diagnostics, "academicYear", snapshotIdentity.academicYear, rawRecord.academicYear);
        addConflict(diagnostics, "configurationVersion", snapshotIdentity.configurationVersion, rawRecord.configurationVersion);
        addConflict(
            diagnostics,
            "effectiveRules",
            snapshotValue(snapshot, ["effectiveRules"]),
            rawRecord.effectiveRules
        );
        addConflict(
            diagnostics,
            "selectedQuestionIds",
            snapshotContent.selectedQuestionIds,
            rawRecord.selectedQuestionIds
        );
        addConflict(
            diagnostics,
            "questionOrder",
            snapshotContent.questionOrder,
            rawRecord.questionOrder
        );
        addConflict(
            diagnostics,
            "questionDatasetVersion",
            snapshotContent.questionDatasetVersion,
            rawRecord.questionDatasetVersion
        );

        const selectedQuestionIds = Array.isArray(snapshotContent.selectedQuestionIds)
            ? [...snapshotContent.selectedQuestionIds]
            : Array.isArray(rawRecord.selectedQuestionIds)
                ? [...rawRecord.selectedQuestionIds]
                : [];
        const questionOrder = Array.isArray(snapshotContent.questionOrder)
            ? snapshotContent.questionOrder.map((item) => (
                isObject(item) ? { ...item } : item
            ))
            : Array.isArray(rawRecord.questionOrder)
                ? rawRecord.questionOrder.map((item) => (
                    isObject(item) ? { ...item } : item
                ))
                : [];

        const effectiveRules = normalizeEffectiveRules(rawRecord, snapshot, diagnostics);
        const subjectStats = normalizeSubjectStats(rawRecord, snapshot, diagnostics);
        const classification = classifyTestType(testType);
        addConflict(diagnostics, "submittedAt", snapshotIdentity.submittedAt, rawRecord.submittedAt);
        if (Object.keys(topLevelRuntime).length > 0) {
            addConflict(
                diagnostics,
                "runtime",
                snapshotRuntime,
                topLevelRuntime
            );
        }
        if (!attemptId) diagnostics.missingFields.push("attemptId");
        if (!testType) diagnostics.missingFields.push("testType");
        if (!rawRecord.questionDetails) diagnostics.missingFields.push("questionDetails");

        const questionCount = effectiveRules.questionCount;
        if (questionCount !== null && selectedQuestionIds.length !== questionCount) {
            diagnostics.warnings.push("selectedQuestionIds count differs from effective question count.");
        }
        if (questionCount !== null && questionOrder.length !== questionCount) {
            diagnostics.warnings.push("questionOrder count differs from effective question count.");
        }
        if (selectedQuestionIds.length !== questionOrder.length) {
            diagnostics.warnings.push("selectedQuestionIds count differs from questionOrder length.");
        }
        if (
            questionCount !== null &&
            finiteNumber(rawRecord.total) !== null &&
            finiteNumber(rawRecord.total) !== questionCount
        ) {
            diagnostics.warnings.push("Snapshot question count differs from legacy result total.");
        }
        if (status === "submitted" && snapshot && !snapshotIdentity.submittedAt) {
            diagnostics.missingFields.push("identity.submittedAt");
        }
        if (
            snapshot &&
            status === "submitted" &&
            snapshotIdentity.submittedAt &&
            !validDate(snapshotIdentity.submittedAt)
        ) {
            diagnostics.warnings.push("Submitted timestamp is invalid.");
        }

        const identityStatus = examId
            ? "verified"
            : examCode
                ? "provided"
                : "legacy_inferred";
        const isLegacy = !snapshot && !attemptId;
        const normalized = {
            recordKind: status === "in_progress"
                ? "resumable_attempt"
                : "completed_result",
            schemaVersion: 1,
            identity: {
                attemptId,
                legacyId,
                userId: validString(rawRecord.userId),
                source: settings.source || (snapshot ? "v2_local" : "legacy_local"),
                legacyClassification: isLegacy ? "legacy_v1" : null
            },
            exam: {
                examId: validString(examId),
                examCode: validString(examCode),
                identityStatus: isLegacy ? "legacy_inferred" : identityStatus
            },
            test: {
                testType: validString(testType),
                classification,
                configurationId: validString(configurationId),
                academicYear,
                configurationVersion,
                configurationStatus: configurationId
                    ? "captured"
                    : snapshot
                        ? "unavailable"
                        : "unknown"
            },
            timing: {
                startedAt: validDate(
                    chooseSnapshotValue(snapshot, rawRecord.startedAt, ["identity", "startedAt"])
                ),
                submittedAt: validDate(
                    chooseSnapshotValue(snapshot, rawRecord.submittedAt, ["identity", "submittedAt"])
                ),
                legacyDate: validDate(rawRecord.date),
                timeUsed: finiteNumber(rawRecord.timeUsed),
                timeAllowed: finiteNumber(rawRecord.timeAllowed)
            },
            subjects: normalizeSubjects(rawRecord, snapshot, diagnostics),
            subjectStats,
            effectiveRules,
            content: {
                selectedQuestionIds,
                questionOrder,
                questionDatasetVersion: validString(
                    snapshotContent.questionDatasetVersion ||
                    rawRecord.questionDatasetVersion
                ),
                questionDetails: Array.isArray(rawRecord.questionDetails)
                    ? rawRecord.questionDetails.map((item) => (
                        isObject(item) ? { ...item } : item
                    ))
                    : []
            },
            grading: normalizeGrading(rawRecord, snapshot, diagnostics),
            state: {
                status,
                validation: snapshot ? "valid" : "legacy_compatible"
            },
            runtime: {
                currentQuestionIndex: finiteNumber(
                    chooseSnapshotValue(snapshot, topLevelRuntime.currentQuestionIndex, [
                        "runtime",
                        "currentQuestionIndex"
                    ])
                ),
                answers: isObject(snapshotRuntime.answers)
                    ? cloneValue(snapshotRuntime.answers)
                    : isObject(topLevelRuntime.answers)
                        ? cloneValue(topLevelRuntime.answers)
                    : null,
                questionTimeSpent: isObject(snapshotRuntime.questionTimeSpent)
                    ? cloneValue(snapshotRuntime.questionTimeSpent)
                    : isObject(topLevelRuntime.questionTimeSpent)
                        ? cloneValue(topLevelRuntime.questionTimeSpent)
                    : null,
                remainingTime: finiteNumber(
                    chooseSnapshotValue(snapshot, topLevelRuntime.remainingTime, [
                        "runtime",
                        "remainingTime"
                    ])
                )
            },
            diagnostics,
            raw: {
                record: rawRecord
            }
        };

        normalized.ordering = {
            submittedAt: normalized.timing.submittedAt,
            legacyDate: normalized.timing.legacyDate,
            legacyId: finiteNumber(legacyId),
            storedIndex: finiteNumber(settings.storedIndex)
        };

        const incompleteSnapshot = Boolean(
            snapshot && (
                !attemptId ||
                !testType ||
                !snapshotIdentity.startedAt ||
                (status === "submitted" && !snapshotIdentity.submittedAt)
            )
        );

        if (normalized.state.validation === "valid" && (
            incompleteSnapshot ||
            diagnostics.conflicts.length ||
            diagnostics.warnings.length ||
            diagnostics.missingFields.length
        )) {
            normalized.state.validation = "partial";
        }

        return normalized;
    }

    function dateValue(value) {
        if (!value) return null;
        const time = new Date(value).getTime();
        return Number.isFinite(time) ? time : null;
    }

    function compareNormalizedResults(left, right) {
        const leftOrdering = left?.ordering || {};
        const rightOrdering = right?.ordering || {};
        const leftSubmitted = dateValue(leftOrdering.submittedAt);
        const rightSubmitted = dateValue(rightOrdering.submittedAt);
        if (leftSubmitted !== null || rightSubmitted !== null) {
            const difference =
                (rightSubmitted ?? -Infinity) - (leftSubmitted ?? -Infinity);
            if (difference !== 0) return difference;
        }

        const leftDate = dateValue(leftOrdering.legacyDate);
        const rightDate = dateValue(rightOrdering.legacyDate);
        if (leftDate !== null || rightDate !== null) {
            const difference =
                (rightDate ?? -Infinity) - (leftDate ?? -Infinity);
            if (difference !== 0) return difference;
        }

        const idDifference = (rightOrdering.legacyId ?? -Infinity) -
            (leftOrdering.legacyId ?? -Infinity);
        if (idDifference !== 0) return idDifference;

        return (leftOrdering.storedIndex ?? Infinity) -
            (rightOrdering.storedIndex ?? Infinity);
    }

    function normalizeResultRecords(rawRecords, options) {
        const records = Array.isArray(rawRecords) ? rawRecords : [];
        const settings = isObject(options) ? options : {};

        return records
            .map((record, index) => normalizeResultRecord(record, {
                ...settings,
                storedIndex: index
            }))
            .filter((record) => record.state.validation !== "invalid")
            .sort(compareNormalizedResults);
    }

    return {
        normalizeResultRecord,
        normalizeResultRecords,
        compareNormalizedResults
    };
});
