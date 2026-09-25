window.SUPABASE_URL = "https://afdnfqmsjmpwlvhloopy.supabase.co";

window.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_LQlMraaULDTdAKeYysPWkA_a8CKvA1V";

window.SUPABASE_QUESTION_TABLE = "Questions";
window.SUPABASE_QUESTION_COMPAT_VIEW = "questions";
window.SUPABASE_QUESTION_COLUMNS = [
    "id",
    "Subject",
    "Question",
    "Option_a",
    "Option_b",
    "Option_c",
    "Option_d",
    "Correct_Answer",
    "test_type",
    "Topic",
    "Explanation",
    "exam",
    "year",
    "source",
    "is_active",
    "updated_at",
    "import_key"
];

window.EXAMPILOT_DEFAULT_EXAM_CODE = "JAMB";

window.getSelectedExamCode = function () {
    const stored = window.localStorage
        ? window.localStorage.getItem("selectedExamCode")
        : "";
    return String(stored || window.EXAMPILOT_DEFAULT_EXAM_CODE)
        .trim()
        .toUpperCase();
};

window.resolveExamId = async function (client, examCode) {
    if (!client || typeof client.from !== "function") {
        throw new Error("Supabase client is unavailable.");
    }

    const code = String(
        examCode || window.EXAMPILOT_DEFAULT_EXAM_CODE
    ).trim().toUpperCase();

    const { data, error } = await client
        .from("exams")
        .select("id")
        .eq("code", code)
        .eq("is_active", true)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!data?.id) {
        throw new Error(`Exam "${code}" is unavailable.`);
    }

    return data.id;
};

window.resolveActiveExamConfiguration = async function (client, examId, testType) {
    if (!client || typeof client.from !== "function") {
        throw new Error("Supabase client is unavailable.");
    }

    if (!examId) {
        throw new Error("An exam ID is required to resolve an exam configuration.");
    }

    const normalizedTestType = String(testType || "").trim().toLowerCase();
    if (!normalizedTestType) {
        throw new Error("A test type is required to resolve an exam configuration.");
    }

    const { data, error } = await client
        .from("exam_configurations")
        .select("*")
        .eq("exam_id", examId)
        .eq("test_type", normalizedTestType)
        .eq("is_active", true)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data || null;
};

function cbtFiniteNumber(value, fieldName) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        throw new Error(`${fieldName} must be a finite number.`);
    }
    return number;
}

function cbtPositiveInteger(value, fieldName) {
    if (value === undefined || value === null || value === "") {
        throw new Error(`${fieldName} is required.`);
    }
    const number = cbtFiniteNumber(value, fieldName);
    if (!Number.isInteger(number) || number <= 0) {
        throw new Error(`${fieldName} must be a positive integer.`);
    }
    return number;
}

function cbtRequiredString(value, fieldName) {
    const string = String(value ?? "").trim();
    if (!string) {
        throw new Error(`${fieldName} is required.`);
    }
    return string;
}

function deepFreezeCbtContext(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
        return value;
    }
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreezeCbtContext(value[key]));
    return value;
}

window.buildCbtSessionContext = function (exam, testType, configuration, selectedSubjects) {
    if (!exam || typeof exam !== "object") {
        throw new Error("Exam identity is required.");
    }
    if (!configuration || typeof configuration !== "object") {
        throw new Error("An active exam configuration is required.");
    }
    if (configuration.is_active === false) {
        throw new Error("The exam configuration is not active.");
    }

    const examIdentity = {
        id: cbtRequiredString(exam.id, "exam.id"),
        code: cbtRequiredString(exam.code, "exam.code").toUpperCase(),
        name: cbtRequiredString(exam.name, "exam.name")
    };
    const normalizedTestType = cbtRequiredString(testType, "testType").toLowerCase();
    const configurationId = cbtRequiredString(configuration.id, "configuration.id");
    const academicYear = cbtRequiredString(
        configuration.academic_year,
        "configuration.academic_year"
    );
    const version = cbtRequiredString(configuration.version, "configuration.version");
    const durationSeconds = cbtPositiveInteger(
        configuration.duration_seconds,
        "configuration.duration_seconds"
    );
    const questionCount = cbtPositiveInteger(
        configuration.question_count,
        "configuration.question_count"
    );
    const subjectSelection = configuration.subject_selection_configuration;
    if (!subjectSelection || typeof subjectSelection !== "object" || Array.isArray(subjectSelection)) {
        throw new Error("configuration.subject_selection_configuration is required.");
    }

    const requiredSubjectCount = cbtPositiveInteger(
        subjectSelection.required_subject_count,
        "subject_selection_configuration.required_subject_count"
    );
    const minimumSubjects = cbtPositiveInteger(
        subjectSelection.minimum_subjects,
        "subject_selection_configuration.minimum_subjects"
    );
    const maximumSubjects = cbtPositiveInteger(
        subjectSelection.maximum_subjects,
        "subject_selection_configuration.maximum_subjects"
    );
    if (minimumSubjects > maximumSubjects ||
        requiredSubjectCount < minimumSubjects ||
        requiredSubjectCount > maximumSubjects) {
        throw new Error("Subject-count configuration is invalid.");
    }

    const allocationMode = cbtRequiredString(
        subjectSelection.allocation_mode,
        "subject_selection_configuration.allocation_mode"
    );
    if (allocationMode !== "per_selected_subject") {
        throw new Error(`Unsupported question allocation mode: ${allocationMode}.`);
    }
    const questionsPerSelectedSubject = cbtPositiveInteger(
        subjectSelection.questions_per_selected_subject,
        "subject_selection_configuration.questions_per_selected_subject"
    );
    const subjects = Array.isArray(selectedSubjects)
        ? selectedSubjects.map((subject) => cbtRequiredString(subject, "selected subject"))
        : [];
    if (subjects.length !== requiredSubjectCount ||
        subjects.length < minimumSubjects ||
        subjects.length > maximumSubjects) {
        throw new Error(
            `Selected subject count must be ${requiredSubjectCount} for this configuration.`
        );
    }
    const totalQuestionCount = subjects.length * questionsPerSelectedSubject;
    if (totalQuestionCount !== questionCount) {
        throw new Error(
            "Question allocation does not match configuration.question_count."
        );
    }

    const scoringConfiguration = configuration.scoring_configuration;
    if (!scoringConfiguration || typeof scoringConfiguration !== "object" || Array.isArray(scoringConfiguration)) {
        throw new Error("configuration.scoring_configuration is required.");
    }
    const scoringMethod = cbtRequiredString(
        scoringConfiguration.method,
        "scoring_configuration.method"
    );
    if (scoringMethod !== "correct_count") {
        throw new Error(`Unsupported scoring method: ${scoringMethod}.`);
    }
    const marksPerQuestion = cbtFiniteNumber(
        scoringConfiguration.marks_per_question,
        "scoring_configuration.marks_per_question"
    );
    const negativeMark = cbtFiniteNumber(
        scoringConfiguration.negative_mark,
        "scoring_configuration.negative_mark"
    );
    if (marksPerQuestion <= 0 || negativeMark < 0) {
        throw new Error("Scoring configuration is invalid.");
    }

    const gradingConfiguration = configuration.grading_configuration;
    if (!gradingConfiguration || typeof gradingConfiguration !== "object" || Array.isArray(gradingConfiguration)) {
        throw new Error("configuration.grading_configuration is required.");
    }
    const gradingMethod = cbtRequiredString(
        gradingConfiguration.method,
        "grading_configuration.method"
    );
    if (gradingMethod !== "percentage") {
        throw new Error(`Unsupported grading method: ${gradingMethod}.`);
    }

    return deepFreezeCbtContext({
        exam: examIdentity,
        testType: normalizedTestType,
        configuration: {
            id: configurationId,
            academicYear,
            version,
            durationSeconds,
            questionCount,
            subjectSelection: {
                mode: subjectSelection.mode || null,
                requiredSubjectCount,
                minimumSubjects,
                maximumSubjects
            },
            questionAllocation: {
                mode: allocationMode,
                questionsPerSelectedSubject,
                totalQuestionCount
            },
            scoring: {
                method: scoringMethod,
                marksPerQuestion,
                negativeMark
            },
            grading: {
                method: gradingMethod,
                bands: Array.isArray(gradingConfiguration.bands)
                    ? [...gradingConfiguration.bands]
                    : []
            }
        },
        selectedSubjects: [...subjects],
        questionPlan: {
            allocationMode,
            questionsPerSelectedSubject,
            totalQuestionCount
        }
    });
};

window.resolveCbtSessionContext = async function (
    client,
    examCode,
    testType,
    selectedSubjects
) {
    if (!client || typeof client.from !== "function") {
        throw new Error("Supabase client is unavailable.");
    }
    const code = cbtRequiredString(examCode, "examCode").toUpperCase();
    const normalizedTestType = cbtRequiredString(testType, "testType").toLowerCase();
    const { data: exam, error: examError } = await client
        .from("exams")
        .select("id, code, name")
        .eq("code", code)
        .eq("is_active", true)
        .maybeSingle();
    if (examError) throw examError;
    if (!exam) throw new Error(`Exam "${code}" is unavailable.`);

    const configuration = await window.resolveActiveExamConfiguration(
        client,
        exam.id,
        normalizedTestType
    );
    if (!configuration) {
        throw new Error(
            `No active ${normalizedTestType} configuration is available for exam ${code}.`
        );
    }
    return window.buildCbtSessionContext(
        exam,
        normalizedTestType,
        configuration,
        selectedSubjects
    );
};

window.resolveCbtSubjectSelectionRules = async function (
    client,
    examCode,
    testType
) {
    const code = cbtRequiredString(examCode, "examCode").toUpperCase();
    const normalizedTestType = cbtRequiredString(testType, "testType").toLowerCase();
    let exam;
    let configuration;
    const getCachedConfiguration = async function () {
        if (!window.OfflineQuestionStore?.getConfiguration) {
            return null;
        }
        return window.OfflineQuestionStore.getConfiguration(
            code,
            normalizedTestType
        );
    };
    const loadCachedConfiguration = async function () {
        const cached = await getCachedConfiguration();
        if (!cached) {
            throw new Error(
                `No cached ${normalizedTestType} configuration is available for exam ${code}.`
            );
        }
        return cached;
    };

    await new Promise((resolve) => setTimeout(resolve, 100));
    if (navigator.onLine === false) {
        const cached = await loadCachedConfiguration();
        exam = cached.exam;
        configuration = cached.configuration;
    } else {
        const cachedBeforeResolution = await getCachedConfiguration();
        if (navigator.onLine === false && cachedBeforeResolution) {
            exam = cachedBeforeResolution.exam;
            configuration = cachedBeforeResolution.configuration;
        } else {
          try {
            if (!client || typeof client.from !== "function") {
                throw new Error("Supabase client is unavailable.");
            }
            const { data: resolvedExam, error: examError } = await client
                .from("exams")
                .select("id, code, name")
                .eq("code", code)
                .eq("is_active", true)
                .maybeSingle();
            if (examError) throw examError;
            if (!resolvedExam) {
                throw new Error(`Exam "${code}" is unavailable.`);
            }
            exam = resolvedExam;
            configuration = await window.resolveActiveExamConfiguration(
                client,
                exam.id,
                normalizedTestType
            );
            if (!configuration) {
                throw new Error(
                    `No active ${normalizedTestType} configuration is available for exam ${code}.`
                );
            }
          } catch (error) {
            const message = String(error?.message || error).toLowerCase();
            if (!navigator.onLine ||
                error instanceof TypeError ||
                message.includes("failed to fetch") ||
                message.includes("network")) {
                const cached = cachedBeforeResolution || await loadCachedConfiguration();
                exam = cached.exam;
                configuration = cached.configuration;
            } else {
                throw error;
            }
          }
        }
    }

    if (configuration.is_active === false) {
        throw new Error("The exam configuration is not active.");
    }
    const subjectSelection = configuration.subject_selection_configuration;
    if (!subjectSelection || typeof subjectSelection !== "object" || Array.isArray(subjectSelection)) {
        throw new Error("configuration.subject_selection_configuration is required.");
    }
    const requiredSubjectCount = cbtPositiveInteger(
        subjectSelection.required_subject_count,
        "subject_selection_configuration.required_subject_count"
    );
    const minimumSubjects = cbtPositiveInteger(
        subjectSelection.minimum_subjects,
        "subject_selection_configuration.minimum_subjects"
    );
    const maximumSubjects = cbtPositiveInteger(
        subjectSelection.maximum_subjects,
        "subject_selection_configuration.maximum_subjects"
    );
    if (minimumSubjects > maximumSubjects ||
        requiredSubjectCount < minimumSubjects ||
        requiredSubjectCount > maximumSubjects) {
        throw new Error("Subject-count configuration is invalid.");
    }
    window.buildCbtSessionContext(
        exam,
        normalizedTestType,
        configuration,
        Array.from(
            { length: requiredSubjectCount },
            (_, index) => `configuration-subject-${index + 1}`
        )
    );

    return Object.freeze({
        exam: {
            id: exam.id,
            code: exam.code,
            name: exam.name
        },
        testType: normalizedTestType,
        requiredSubjectCount,
        minimumSubjects,
        maximumSubjects
    });
};

window.buildCbtSessionContextFromCachedConfiguration = function (
    cachedConfiguration,
    selectedSubjects
) {
    if (!cachedConfiguration || typeof cachedConfiguration !== "object") {
        throw new Error("Cached CBT configuration is unavailable.");
    }
    return window.buildCbtSessionContext(
        cachedConfiguration.exam,
        cachedConfiguration.testType,
        cachedConfiguration.configuration,
        selectedSubjects
    );
};

window.buildCbtAttemptSnapshotMetadata = function (context) {
    if (!context || !context.configuration) {
        throw new Error("A resolved CBT session context is required.");
    }
    return {
        identity: {
            examId: context.exam.id,
            examCode: context.exam.code,
            testType: context.testType,
            configurationId: context.configuration.id,
            academicYear: context.configuration.academicYear,
            configurationVersion: context.configuration.version
        },
        effectiveRules: {
            authority: "exam_configuration",
            questionCount: context.configuration.questionCount,
            durationSeconds: context.configuration.durationSeconds,
            subjectSelection: {
                ...context.configuration.subjectSelection,
                allocationMode: context.configuration.questionAllocation.mode,
                questionsPerSelectedSubject:
                    context.configuration.questionAllocation.questionsPerSelectedSubject,
                selectedSubjectIds: [],
                selectedSubjectCodes: [],
                selectedSubjectNames: [...context.selectedSubjects]
            },
            scoring: { ...context.configuration.scoring },
            grading: { ...context.configuration.grading }
        }
    };
};

window.calculateConfiguredScore = function (outcomes, scoring) {
    if (!scoring || scoring.method !== "correct_count") {
        throw new Error(`Unsupported scoring method: ${scoring?.method || "missing"}.`);
    }
    const marksPerQuestion = cbtFiniteNumber(
        scoring.marksPerQuestion,
        "scoring.marksPerQuestion"
    );
    const negativeMark = cbtFiniteNumber(scoring.negativeMark, "scoring.negativeMark");
    const correct = outcomes.filter((outcome) => outcome.correct).length;
    const unanswered = outcomes.filter((outcome) => outcome.unanswered).length;
    const wrong = outcomes.length - correct - unanswered;
    return {
        score: correct * marksPerQuestion - wrong * negativeMark,
        maximumScore: outcomes.length * marksPerQuestion,
        correct,
        wrong,
        unanswered
    };
};

window.calculateConfiguredGrade = function (scoreResult, grading) {
    if (!grading || grading.method !== "percentage") {
        throw new Error(`Unsupported grading method: ${grading?.method || "missing"}.`);
    }
    return scoreResult.maximumScore
        ? Math.round((scoreResult.score / scoreResult.maximumScore) * 100)
        : 0;
};

function canonicalQuestionValue(row, ...keys) {
    for (const key of keys) {
        if (row && row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
            return row[key];
        }
    }
    return "";
}

function normalizeCanonicalQuestionRow(row = {}) {
    const options = [
        canonicalQuestionValue(row, "Option_a", "option_a", "OptionA", "optionA"),
        canonicalQuestionValue(row, "Option_b", "option_b", "OptionB", "optionB"),
        canonicalQuestionValue(row, "Option_c", "option_c", "OptionC", "optionC"),
        canonicalQuestionValue(row, "Option_d", "option_d", "OptionD", "optionD")
    ];

    return {
        id: row.id ?? null,
        Subject: canonicalQuestionValue(row, "Subject", "subject") || "",
        Question: canonicalQuestionValue(row, "Question", "question") || "",
        Option_a: String(options[0] ?? ""),
        Option_b: String(options[1] ?? ""),
        Option_c: String(options[2] ?? ""),
        Option_d: String(options[3] ?? ""),
        Correct_Answer: canonicalQuestionValue(row, "Correct_Answer", "correct_answer") || "",
        test_type: canonicalQuestionValue(row, "test_type", "testType") || "practice",
        Topic: canonicalQuestionValue(row, "Topic", "topic") || "",
        Explanation: canonicalQuestionValue(row, "Explanation", "explanation") || "",
        exam: canonicalQuestionValue(row, "exam") || "",
        year: row.year ?? null,
        source: canonicalQuestionValue(row, "source") || "",
        is_active: row.is_active ?? true,
        updated_at: row.updated_at ?? null,
        import_key: canonicalQuestionValue(row, "import_key") || ""
    };
}

function buildCanonicalQuestionPayload(data = {}) {
    return {
        Subject: String(data.Subject ?? data.subject ?? "").trim(),
        Question: String(data.Question ?? data.question ?? "").trim(),
        Option_a: String(data.Option_a ?? data.option_a ?? "").trim(),
        Option_b: String(data.Option_b ?? data.option_b ?? "").trim(),
        Option_c: String(data.Option_c ?? data.option_c ?? "").trim(),
        Option_d: String(data.Option_d ?? data.option_d ?? "").trim(),
        Correct_Answer: String(data.Correct_Answer ?? data.correct_answer ?? "").trim().toUpperCase(),
        test_type: String(data.test_type ?? data.testType ?? "practice").trim().toLowerCase(),
        Topic: String(data.Topic ?? data.topic ?? "").trim(),
        Explanation: String(data.Explanation ?? data.explanation ?? "").trim(),
        exam: String(data.exam ?? "").trim(),
        year: data.year ?? null,
        source: String(data.source ?? "").trim(),
        is_active: data.is_active ?? true,
        updated_at: data.updated_at ?? new Date().toISOString(),
        import_key: String(data.import_key ?? "").trim()
    };
}

var _supabaseClientInit = window.supabaseClient || (
    window.supabase && typeof window.supabase.createClient === 'function'
        ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY)
        : null
);

window.supabaseClient = _supabaseClientInit;