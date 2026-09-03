const SUPABASE_URL = "https://afdnfqmsjmpwlvhloopy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_LQlMraaULDTdAKeYysPWkA_a8CKvA1V";

const SUPABASE_QUESTION_TABLE = "Questions";
const SUPABASE_QUESTION_COMPAT_VIEW = "questions";
const SUPABASE_QUESTION_COLUMNS = [
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

const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);