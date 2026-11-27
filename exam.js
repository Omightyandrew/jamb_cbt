// ========================================
// SUPABASE CONNECTION
// ========================================

const SUPABASE_URL =
    "https://afdnfqmsjmpwlvhloopy.supabase.co";


const SUPABASE_KEY =
    "sb_publishable_LQlMraaULDTdAKeYysPWkA_a8CKvA1V";


const supabaseClient =
    supabase.createClient(
        SUPABASE_URL,
        SUPABASE_KEY
    );


// ========================================
// GET SELECTED SUBJECTS
// ========================================

let selectedSubjects =
    JSON.parse(
        localStorage.getItem(
            "selectedSubjects"
        )
    ) || [];


// ========================================
// GET TEST TYPE
// ========================================

let testType =
    localStorage.getItem(
        "testType"
    ) || "practice";

const selectedExamCode =
    typeof window.getSelectedExamCode === "function"
        ? window.getSelectedExamCode()
        : "JAMB";

let selectedExamId = null;
let sessionContext = null;


// ========================================
// SHOW SELECTED SUBJECTS
// ========================================

document.getElementById(
    "selectedSubject"
).textContent =
    "Subjects: " +
    selectedSubjects.join(", ");


// ========================================
// SHOW TEST TYPE
// ========================================

document.getElementById(
    "testTypeTitle"
).textContent =
    testType === "past"
        ? "Past Questions"
        : "Practice Test";


// ========================================
// MAIN VARIABLES
// ========================================

let questions = [];

let currentQuestion = 0;

let answers = {};

let timeLeft = 0;

let timer = null;
let questionStartedAt = Date.now();
let questionTimeSpent = {};
let practiceAttemptSnapshot = null;


// ========================================
// FREE PRACTICE LIMIT
// ========================================

const FREE_QUESTION_LIMIT = 15;


// ========================================
// STUDENT INFORMATION
// ========================================

let currentUser = null;

let isSubscribed = false;

let freeQuestionsUsed = 0;


// ========================================
// GET FREE QUESTION COUNTER KEY
// ========================================

function getFreeQuestionKey() {

    if (!currentUser) {

        return null;

    }


    const today = new Date().toISOString().slice(0, 10);

    return (
        "freePracticeQuestions_" +
        currentUser.id +
        "_" +
        today
    );

}


// ========================================
// LOAD FREE QUESTION COUNT
// ========================================

function loadFreeQuestionCount() {

    const key =
        getFreeQuestionKey();


    if (!key) {

        freeQuestionsUsed = 0;

        return;

    }


    freeQuestionsUsed =
        parseInt(
            localStorage.getItem(key)
        ) || 0;

}


// ========================================
// SAVE FREE QUESTION COUNT
// ========================================

function saveFreeQuestionCount() {

    const key =
        getFreeQuestionKey();


    if (!key) {

        return;

    }


    localStorage.setItem(
        key,
        String(freeQuestionsUsed)
    );

}


// ========================================
// CHECK STUDENT ACCESS
// ========================================

async function checkStudentAccess() {

    try {

        const {
            data: sessionData,
            error: sessionError
        } =
            await supabaseClient.auth.getSession();


        // ==================================
        // CHECK LOGIN
        // ==================================

        let isOfflineSession = false;

        if (
            sessionError ||
            !sessionData ||
            !sessionData.session
        ) {
            const rawOffline = localStorage.getItem("examPilotOfflineSession");
            if (rawOffline) {
                try {
                    const offlineSession = JSON.parse(rawOffline);
                    if (offlineSession && offlineSession.userId) {
                        isOfflineSession = true;
                        currentUser = {
                            id: offlineSession.userId,
                            email: offlineSession.email || ""
                        };
                    }
                } catch (e) {}
            }

            if (!currentUser) {
                showAccessDenied(
                    "Please login as a student first."
                );

                return false;
            }
        } else {
            currentUser =
                sessionData.session.user;
        }


        // Offline access is limited to cached practice questions. Keep the
        // local free-use policy active without treating the student as a
        // verified subscriber.
        if (
            (isOfflineSession || navigator.onLine === false) &&
            testType === "practice"
        ) {

            isSubscribed = false;
            loadFreeQuestionCount();

            if (
                freeQuestionsUsed >=
                FREE_QUESTION_LIMIT
            ) {

                showSubscriptionRequired(
                    "You have used your 15 free practice questions for today."
                );

                return false;

            }

            return true;

        }

        if (isOfflineSession && testType === "past") {
            showSubscriptionRequired(
                "Past Questions are available to subscribers only."
            );
            return false;
        }


        // ==================================
        // GET SUBSCRIPTION
        // ==================================

        const {
            data: subscriptions,
            error: subscriptionError
        } =
            await supabaseClient
                .from("subscriptions")
                .select(
                    "id, status, plan, expires_at, payment_reference"
                )
                .eq(
                    "user_id",
                    currentUser.id
                )
                .order(
                    "id",
                    {
                        ascending: false
                    }
                )


        // ==================================
        // SUBSCRIPTION DATABASE ERROR
        // ==================================

        if (subscriptionError) {

            console.error(
                "Subscription check error:",
                subscriptionError
            );

            if (
                testType === "practice" &&
                isQuestionNetworkFailure(subscriptionError)
            ) {
                isSubscribed = false;
                loadFreeQuestionCount();

                if (
                    freeQuestionsUsed >=
                    FREE_QUESTION_LIMIT
                ) {
                    showSubscriptionRequired(
                        "You have used your 15 free practice questions for today."
                    );

                    return false;
                }

                return true;
            }


            isSubscribed = false;

        }

        // ==================================
        // NO SUBSCRIPTION
        // ==================================

        else if (!Array.isArray(subscriptions) || subscriptions.length === 0) {

            isSubscribed = false;

        }

        // ==================================
        // CHECK SUBSCRIPTION
        // ==================================

        else {
            isSubscribed = subscriptions.some((subscription) => {
                const status = String(
                    subscription.status || ""
                ).trim().toLowerCase();
                const expiresAt =
                    subscription.expires_at ||
                    subscription.expiry_date ||
                    subscription.expiration_date ||
                    subscription.current_period_end ||
                    subscription.ends_at ||
                    null;
                const isActiveStatus = [
                    "active",
                    "paid",
                    "premium",
                    "subscribed",
                    "success",
                    "successful",
                    "succeeded",
                    "completed"
                ].includes(status);

                if (!isActiveStatus || !expiresAt) {
                    return isActiveStatus;
                }

                const expiry = new Date(expiresAt);
                return Number.isNaN(expiry.getTime()) ||
                    expiry > new Date();
            });
        }


        // ==================================
        // LOAD FREE QUESTION COUNT
        // ==================================

        loadFreeQuestionCount();


        // ==================================
        // PAST QUESTIONS
        // ==================================

        if (
            testType === "past" &&
            !isSubscribed
        ) {

            showSubscriptionRequired(
                "Past Questions are available to subscribers only."
            );

            return false;

        }


        // ==================================
        // FREE PRACTICE LIMIT
        // ==================================

        if (
            testType === "practice" &&
            !isSubscribed &&
            freeQuestionsUsed >=
            FREE_QUESTION_LIMIT
        ) {

            showSubscriptionRequired(
                "You have used your 15 free practice questions for today."
            );

            return false;

        }


        return true;

    }

    catch (error) {

        console.error(
            "Student access error:",
            error
        );


        showAccessDenied(
            "Something went wrong while checking your account."
        );


        return false;

    }

}


// ========================================
// ACCESS DENIED PAGE
// ========================================

function showAccessDenied(message) {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }

    resetCbtDomCaches();

    document.body.innerHTML = `
        <div class="access-page">
            <div class="access-card">
                <div class="access-icon">🔒</div>
                <p class="eyebrow">ACCOUNT ACCESS</p>
                <h1>Login required</h1>
                <p>${escapeHTML(message)}</p>
                <button class="primary-action" onclick="location.href='student.html'">
                    Go to Student Login
                </button>
            </div>
        </div>
    `;
}

function showSubscriptionRequired(message) {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }

    resetCbtDomCaches();

    document.body.innerHTML = `
        <div class="access-page">
            <div class="access-card">
                <div class="access-icon">🔐</div>
                <p class="eyebrow">PREMIUM ACCESS</p>
                <h1>Subscription required</h1>
                <p>${escapeHTML(message)}</p>
                <div class="usage-box">
                    <span>Free practice used</span>
                    <strong>${isSubscribed ? "Subscribed" : freeQuestionsUsed + " / " + FREE_QUESTION_LIMIT}</strong>
                </div>
                <button class="primary-action" onclick="location.href='student.html'">
                    Manage Subscription
                </button>
                <button class="secondary-action" onclick="location.href='subject.html'">
                    Back to Subjects
                </button>
            </div>
        </div>
    `;
}

// ========================================
// REMOVE LEGACY ADMIN QUESTION CACHE
// ========================================

localStorage.removeItem("adminQuestions");


// ========================================
// RANDOM / NO-REPEAT QUESTION SYSTEM
// ========================================

const QUESTION_BATCH_SIZE = 20;
const NO_REPEAT_STORAGE_PREFIX = "examPilotSeenQuestions_v1";

function normalizeQuestionText(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function getQuestionFingerprint(question, subject, currentTestType) {
    const raw = [
        subject,
        currentTestType,
        question.question,
        ...(Array.isArray(question.options) ? question.options : [])
    ].map(normalizeQuestionText).join("||");

    // Stable lightweight hash so the same question gets the same ID every time.
    let hash = 2166136261;
    for (let i = 0; i < raw.length; i++) {
        hash ^= raw.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

function getNoRepeatStorageKey(subject, currentTestType) {
    const userId = currentUser?.id || "guest";
    const examCode = String(
        typeof window.getSelectedExamCode === "function"
            ? window.getSelectedExamCode()
            : "JAMB"
    ).trim().toUpperCase() || "JAMB";
    return [
        NO_REPEAT_STORAGE_PREFIX,
        userId,
        examCode,
        String(subject).toLowerCase(),
        currentTestType
    ].join("_");
}

function loadSeenQuestionIds(subject, currentTestType) {
    try {
        const saved = JSON.parse(
            localStorage.getItem(
                getNoRepeatStorageKey(subject, currentTestType)
            ) || "[]"
        );
        return new Set(Array.isArray(saved) ? saved : []);
    } catch (error) {
        console.warn("Could not load no-repeat question history:", error);
        return new Set();
    }
}

function saveSeenQuestionIds(subject, currentTestType, seenIds) {
    try {
        localStorage.setItem(
            getNoRepeatStorageKey(subject, currentTestType),
            JSON.stringify(Array.from(seenIds))
        );
    } catch (error) {
        console.warn("Could not save no-repeat question history:", error);
    }
}

function shuffleArray(items) {
    const array = [...items];
    for (let i = array.length - 1; i > 0; i--) {
        const randomIndex = Math.floor(Math.random() * (i + 1));
        [array[i], array[randomIndex]] = [array[randomIndex], array[i]];
    }
    return array;
}

function selectNoRepeatCandidates(
    candidatePool,
    subject,
    currentTestType,
    requestedCount
) {
    if (!candidatePool.length) {
        return { selectedCandidates: [], stagedSeenIds: new Set() };
    }
    const batchSize = Number(requestedCount);
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
        throw new Error("Question allocation is unavailable for this CBT session.");
    }

    const seenIds = loadSeenQuestionIds(subject, currentTestType);
    const stagedSeenIds = new Set(seenIds);

    let pool = candidatePool.map((candidate) => ({
        ...candidate,
        _questionId: candidate._questionId || getQuestionFingerprint(candidate, subject, currentTestType)
    }));

    // Remove duplicate copies from the active pool by stable question ID.
    const uniqueById = new Map();
    pool.forEach((candidate) => {
        if (!uniqueById.has(candidate._questionId)) {
            uniqueById.set(candidate._questionId, candidate);
        }
    });
    pool = Array.from(uniqueById.values());

    let available = shuffleArray(
        pool.filter((candidate) => !stagedSeenIds.has(candidate._questionId))
    );

    // When the whole bank has been used, start a fresh cycle automatically.
    // This allows a 500-question subject to give 25 batches of 20 before any
    // question can appear again.
    if (available.length === 0) {
        stagedSeenIds.clear();
        available = shuffleArray(pool);
    }

    // If a cycle has fewer than 20 questions left, use those remaining
    // questions now and begin a fresh cycle for the rest. This avoids a repeat
    // inside the same CBT.
    let selected = available.slice(0, batchSize);

    if (selected.length < batchSize) {
        const selectedIds = new Set(
            selected.map((candidate) => candidate._questionId)
        );
        const freshCycle = shuffleArray(
            pool.filter((candidate) => !selectedIds.has(candidate._questionId))
        );
        selected = selected.concat(
            freshCycle.slice(0, batchSize - selected.length)
        );
    }

    // Stage newly selected question fingerprints without immediately persisting
    selected.forEach((candidate) => stagedSeenIds.add(candidate._questionId));

    return {
        selectedCandidates: selected,
        stagedSeenIds: stagedSeenIds
    };
}

function selectNoRepeatQuestions(
    allSubjectQuestions,
    subject,
    currentTestType,
    requestedCount
) {
    const { selectedCandidates, stagedSeenIds } = selectNoRepeatCandidates(
        allSubjectQuestions,
        subject,
        currentTestType,
        requestedCount
    );

    if (selectedCandidates.length > 0) {
        saveSeenQuestionIds(subject, currentTestType, stagedSeenIds);
    }

    return selectedCandidates.map(({ _questionId, ...question }) => question);
}

// ========================================
// LOAD QUESTIONS FROM SUPABASE
// ========================================

const SUPABASE_PAGE_SIZE = 1000;
const SUPABASE_QUESTION_TABLE = "Questions";

function mapSupabaseCandidate(row) {
    return {
        id: row.id,
        examId: row.exam_id ?? null,
        question: row.Question ?? row.question ?? "",
        options: [
            row.Option_a ?? row.option_a ?? "",
            row.Option_b ?? row.option_b ?? "",
            row.Option_c ?? row.option_c ?? "",
            row.Option_d ?? row.option_d ?? ""
        ],
        subject: row.Subject ?? row.subject ?? "",
        testType: row.test_type ?? "",
        import_key: row.import_key ?? "",
        updated_at: row.updated_at ?? null
    };
}

function mapSupabaseQuestion(row) {
    return {
        id: row.id,
        examId: row.exam_id ?? null,
        question: row.Question ?? row.question ?? "",
        options: [
            row.Option_a ?? row.option_a ?? "",
            row.Option_b ?? row.option_b ?? "",
            row.Option_c ?? row.option_c ?? "",
            row.Option_d ?? row.option_d ?? ""
        ],
        answer: row.Correct_Answer ?? row.correct_answer ?? "",
        subject: row.Subject ?? row.subject ?? "",
        testType: row.test_type ?? "",
        topic: row.Topic ?? row.topic ?? "",
        explanation: row.Explanation ?? row.explanation ?? "",
        year: row.year ?? null,
        source: row.source ?? "",
        import_key: row.import_key ?? "",
        updated_at: row.updated_at ?? null
    };
}

function isQuestionNetworkFailure(error) {
    const message = String(error?.message || error || "").toLowerCase();
    return navigator.onLine === false ||
        error instanceof TypeError ||
        message.includes("network") ||
        message.includes("failed to fetch") ||
        message.includes("offline");
}

function getQuestionDatasetVersion(questionSet) {
    const versions = questionSet
        .map((question) => question.updated_at)
        .filter(Boolean)
        .sort();
    return versions.length ? versions[versions.length - 1] : null;
}

async function initializePracticeSessionContext() {
    if (
        testType !== "practice" ||
        window.isV1JambPractice(selectedExamCode, testType)
    ) {
        timeLeft = 30 * 60;
        return;
    }

    if (navigator.onLine === false) {
        if (!window.OfflineQuestionStore?.getConfiguration) {
            throw new Error("Offline Practice configuration is unavailable.");
        }
        const cached = await window.OfflineQuestionStore.getConfiguration(
            selectedExamCode,
            testType
        );
        if (!cached) {
            throw new Error(
                `No cached ${testType} configuration is available for exam ${selectedExamCode}.`
            );
        }
        sessionContext = window.buildCbtSessionContextFromCachedConfiguration(
            cached,
            selectedSubjects
        );
    } else {
        sessionContext = await window.resolveCbtSessionContext(
            supabaseClient,
            selectedExamCode,
            testType,
            selectedSubjects
        );
        if (window.OfflineQuestionStore?.saveConfiguration) {
            try {
                await window.OfflineQuestionStore.saveConfiguration(
                    sessionContext.exam,
                    sessionContext.testType,
                    {
                        id: sessionContext.configuration.id,
                        academic_year: sessionContext.configuration.academicYear,
                        version: sessionContext.configuration.version,
                        duration_seconds: sessionContext.configuration.durationSeconds,
                        question_count: sessionContext.configuration.questionCount,
                        subject_selection_configuration: {
                            mode: sessionContext.configuration.subjectSelection.mode,
                            required_subject_count:
                                sessionContext.configuration.subjectSelection.requiredSubjectCount,
                            minimum_subjects:
                                sessionContext.configuration.subjectSelection.minimumSubjects,
                            maximum_subjects:
                                sessionContext.configuration.subjectSelection.maximumSubjects,
                            allocation_mode: sessionContext.configuration.questionAllocation.mode,
                            questions_per_selected_subject:
                                sessionContext.configuration.questionAllocation.questionsPerSelectedSubject
                        },
                        scoring_configuration: {
                            method: sessionContext.configuration.scoring.method,
                            marks_per_question: sessionContext.configuration.scoring.marksPerQuestion,
                            negative_mark: sessionContext.configuration.scoring.negativeMark
                        },
                        grading_configuration: {
                            method: sessionContext.configuration.grading.method,
                            bands: [...sessionContext.configuration.grading.bands]
                        },
                        is_active: true
                    }
                );
            } catch (error) {
                console.warn("Could not cache CBT configuration for offline use:", error);
            }
        }
    }
    selectedExamId = sessionContext.exam.id;
    timeLeft = sessionContext.configuration.durationSeconds;
}

function createPracticeAttemptId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }

    return `practice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createPracticeAttemptSnapshot() {
    if (testType !== "practice") {
        return null;
    }

    if (practiceAttemptSnapshot) {
        return practiceAttemptSnapshot;
    }

    const startedAt = new Date().toISOString();
    questionStartedAt = Date.now();

    const context = sessionContext;
    if (!context) {
        throw new Error("Practice session context is unavailable.");
    }
    const selectedQuestionIds = questions.map((question) => question.id ?? null);
    const questionOrder = questions.map((question, index) => ({
        position: index,
        questionId: question.id ?? null,
        subject: question.subject || null
    }));

    const snapshotMetadata = window.buildCbtAttemptSnapshotMetadata(context);
    practiceAttemptSnapshot = {
        schemaVersion: 1,
        identity: {
            attemptId: createPracticeAttemptId(),
            startedAt,
            submittedAt: null,
            ...snapshotMetadata.identity
        },
        effectiveRules: snapshotMetadata.effectiveRules,
        content: {
            selectedQuestionIds,
            questionOrder,
            questionDatasetVersion: getQuestionDatasetVersion(questions)
        },
        runtime: {
            status: "in_progress",
            currentQuestionIndex: 0,
            answers: {},
            questionTimeSpent: {},
            remainingTime: timeLeft
        }
    };

    return practiceAttemptSnapshot;
}

function copySubmittedPracticeAttemptSnapshot() {
    if (testType !== "practice" || !practiceAttemptSnapshot) {
        return null;
    }

    try {
        practiceAttemptSnapshot.identity.submittedAt =
            new Date().toISOString();
        practiceAttemptSnapshot.runtime.status = "submitted";
        practiceAttemptSnapshot.runtime.currentQuestionIndex =
            currentQuestion;
        practiceAttemptSnapshot.runtime.answers = { ...answers };
        practiceAttemptSnapshot.runtime.questionTimeSpent = {
            ...questionTimeSpent
        };
        practiceAttemptSnapshot.runtime.remainingTime = timeLeft;

        return JSON.parse(JSON.stringify(practiceAttemptSnapshot));
    } catch (error) {
        console.warn(
            "Could not attach Practice attempt snapshot; preserving the V1 result.",
            error
        );
        return null;
    }
}

async function loadAllOfflinePracticeQuestions() {
    if (!window.OfflineQuestionStore) {
        return null;
    }

    const cachedSets = await Promise.all(
        selectedSubjects.map((subject) =>
            window.OfflineQuestionStore.getSet(
                selectedExamCode,
                subject,
                "practice"
            )
        )
    );

    const questionsList = [];
    cachedSets.forEach((cachedSet, index) => {
        if (
            !cachedSet ||
            !Array.isArray(cachedSet.questions) ||
            !cachedSet.questions.length
        ) {
            throw new Error(
                `Could not load practice questions for ${selectedSubjects[index]}. No saved questions are available offline.`
            );
        }

        questionsList.push(...cachedSet.questions);
    });

    window.OfflineQuestionStore.showOfflineNotice();
    return questionsList;
}

async function loadSupabaseQuestions() {
    let loaded = [];

    if (
        testType === "practice" &&
        navigator.onLine === false &&
        window.OfflineQuestionStore
    ) {
        const cachedQuestions = await loadAllOfflinePracticeQuestions();
        if (cachedQuestions) {
            loaded = cachedQuestions;
        }
    } else {
        try {
            selectedExamId = sessionContext
                ? sessionContext.exam.id
                : await window.resolveExamId(supabaseClient, selectedExamCode);
            // Fetch every matching row in pages. Supabase/PostgREST commonly limits
            // a single response to 1,000 rows, so one request is NOT enough for this bank.
            for (const subject of selectedSubjects) {
                const subjectQuestions = [];
                let from = 0;

                while (true) {
                    const to = from + SUPABASE_PAGE_SIZE - 1;

                    let questionQuery = supabaseClient
                        .from(SUPABASE_QUESTION_TABLE)
                        .select(`
                            id,
                            exam_id,
                            Subject,
                            Question,
                            Option_a,
                            Option_b,
                            Option_c,
                            Option_d,
                            Correct_Answer,
                            test_type,
                            Topic,
                            topic,
                            Explanation,
                            explanation,
                            year,
                            source,
                            is_active,
                            updated_at,
                            import_key
                        `)
                        .eq("Subject", subject)
                        .eq("exam_id", selectedExamId)
                        .eq("test_type", testType)
                        .eq("is_active", true)
                        .order("id", { ascending: true });

                    const { data, error } = await questionQuery.range(from, to);

                    if (error) {
                        throw new Error(
                            `Could not load ${testType} questions for ${subject}: ${error.message}`
                        );
                    }

                    const page = Array.isArray(data) ? data : [];
                    subjectQuestions.push(...page.map(mapSupabaseQuestion));

                    console.log(
                        `Loaded ${page.length} ${testType} questions for ${subject} (rows ${from}-${from + Math.max(page.length - 1, 0)}).`
                    );

                    if (page.length < SUPABASE_PAGE_SIZE) {
                        break;
                    }

                    from += SUPABASE_PAGE_SIZE;
                }

                loaded.push(...subjectQuestions);
                if (window.OfflineQuestionStore) {
                    try {
                        await window.OfflineQuestionStore.saveSet(
                            selectedExamCode,
                            subject,
                            testType,
                            subjectQuestions,
                            getQuestionDatasetVersion(subjectQuestions)
                        );
                    } catch (storageError) {
                        console.warn("Could not save CBT questions for offline use:", storageError);
                    }
                }
            }
        } catch (error) {
            console.error("Supabase Questions load error:", error);
            if (!isQuestionNetworkFailure(error) || !window.OfflineQuestionStore) {
                throw error;
            }

            if (testType === "practice") {
                const cachedQuestions = await loadAllOfflinePracticeQuestions();
                if (cachedQuestions) {
                    loaded = cachedQuestions;
                    console.warn(
                        `Using saved practice questions for ${selectedSubjects.join(", ")}; online Supabase data was unavailable.`
                    );
                }
            } else {
                throw error;
            }
        }
    }

    // Remove duplicate database rows by id/import_key before the no-repeat
    // selection system runs. This does not delete anything from Supabase.
    const unique = new Map();
    loaded.forEach((question) => {
        const key = question.id != null
            ? `id:${question.id}`
            : `key:${question.import_key || getQuestionFingerprint(question, question.subject, testType)}`;
        if (!unique.has(key)) unique.set(key, question);
    });

    const result = Array.from(unique.values());

    console.log(
        `Supabase question bank ready: ${result.length} ${testType} questions loaded for ${selectedSubjects.length} selected subjects.`
    );

    return result;
}

function showQuestionLoadError(error) {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }

    const message = error?.message || "Unable to load questions from Supabase.";

    resetCbtDomCaches();

    document.body.innerHTML = `
        <div class="access-page">
            <div class="access-card">
                <div class="access-icon">⚠️</div>
                <p class="eyebrow">QUESTION BANK ERROR</p>
                <h1>Could not load questions</h1>
                <p>${escapeHTML(message)}</p>
                <p>Please check your internet connection and try again. Your Supabase question bank has not been changed.</p>
                <button class="primary-action" onclick="location.reload()">Try Again</button>
                <button class="secondary-action" onclick="location.href='subject.html'">Back to Subjects</button>
            </div>
        </div>
    `;
}

// ========================================
// TWO-PHASE RETRIEVAL & VALIDATION GATES
// ========================================

function validateAndAssembleFullQuestions(selectedCandidates, rawFullRows, subject, testType) {
    if (!Array.isArray(rawFullRows)) {
        throw new Error(`Invalid response format received for ${subject}.`);
    }

    const mappedFull = rawFullRows.map(mapSupabaseQuestion);
    const fullMap = new Map();

    for (const record of mappedFull) {
        if (fullMap.has(record.id)) {
            throw new Error(`Duplicate question record detected in retrieval for ID ${record.id}.`);
        }
        fullMap.set(record.id, record);
    }

    if (fullMap.size !== selectedCandidates.length) {
        throw new Error(
            `Question count mismatch for ${subject}: expected ${selectedCandidates.length} active records, received ${fullMap.size}. Some questions may have been deactivated or removed.`
        );
    }

    const orderedQuestions = [];

    for (const candidate of selectedCandidates) {
        const fullRecord = fullMap.get(candidate.id);
        if (!fullRecord) {
            throw new Error(`Missing full record for candidate question ID ${candidate.id}.`);
        }

        if (
            String(fullRecord.subject).toLowerCase() !== String(candidate.subject).toLowerCase() ||
            fullRecord.testType !== candidate.testType
        ) {
            throw new Error(`Metadata mismatch between candidate and full record for question ID ${candidate.id}.`);
        }

        const fullFingerprint = getQuestionFingerprint(fullRecord, subject, testType);
        if (fullFingerprint !== candidate._questionId) {
            throw new Error(
                `Content integrity mismatch: Question ID ${candidate.id} was modified concurrently during session initialization.`
            );
        }

        orderedQuestions.push(fullRecord);
    }

    return orderedQuestions;
}

function assembleOfflineSessionQuestions(cachedQuestions) {
    const stagedHistoryBySubject = new Map();
    const assembledBySubject = new Map();

    for (const subject of selectedSubjects) {
        const allSubjectQuestions = (cachedQuestions || []).filter((q) =>
            String(q.subject).toLowerCase() === String(subject).toLowerCase()
        );
        const questionsPerSubject = sessionContext
            ? sessionContext.questionPlan.questionsPerSelectedSubject
            : QUESTION_BATCH_SIZE;

        const { selectedCandidates, stagedSeenIds } = selectNoRepeatCandidates(
            allSubjectQuestions,
            subject,
            testType,
            questionsPerSubject
        );

        if (selectedCandidates.length !== questionsPerSubject) {
            throw new Error(
                `Insufficient offline questions for ${subject}: needed ${questionsPerSubject}, found ${selectedCandidates.length}.`
            );
        }

        assembledBySubject.set(
            subject,
            selectedCandidates.map(({ _questionId, ...q }) => q)
        );
        stagedHistoryBySubject.set(subject, stagedSeenIds);
    }

    let assembledList = [];
    for (const subject of selectedSubjects) {
        assembledList = assembledList.concat(assembledBySubject.get(subject));
    }

    const expectedTotal = sessionContext
        ? sessionContext.questionPlan.totalQuestionCount
        : selectedSubjects.length * QUESTION_BATCH_SIZE;

    if (assembledList.length !== expectedTotal) {
        throw new Error(
            `Offline cache returned ${assembledList.length} questions; ` +
            `the active configuration requires ${expectedTotal}.`
        );
    }

    // COMMIT GATE: All subjects successfully assembled and verified
    stagedHistoryBySubject.forEach((stagedSeenIds, subject) => {
        saveSeenQuestionIds(subject, testType, stagedSeenIds);
    });

    return assembledList;
}

async function preserveAndSaveOfflineQuestionPool(examCode, subject, testType, newFullQuestions) {
    if (!window.OfflineQuestionStore?.saveSet) {
        return;
    }

    try {
        let existingQuestions = [];
        if (window.OfflineQuestionStore.getSet) {
            const cachedSet = await window.OfflineQuestionStore.getSet(examCode, subject, testType);
            if (cachedSet && Array.isArray(cachedSet.questions)) {
                existingQuestions = cachedSet.questions;
            }
        }

        const mergedMap = new Map();
        for (const q of (newFullQuestions || [])) {
            if (!q || typeof q !== "object") continue;
            const key = q.id != null ? `id:${q.id}` : `key:${q.import_key || getQuestionFingerprint(q, subject, testType)}`;
            mergedMap.set(key, q);
        }
        for (const q of (existingQuestions || [])) {
            if (!q || typeof q !== "object") continue;
            const key = q.id != null ? `id:${q.id}` : `key:${q.import_key || getQuestionFingerprint(q, subject, testType)}`;
            if (!mergedMap.has(key)) {
                mergedMap.set(key, q);
            }
        }

        const maxQuestions = window.OfflineQuestionStore.maxQuestionsPerSet || 120;
        const mergedPool = Array.from(mergedMap.values()).slice(0, maxQuestions);
        await window.OfflineQuestionStore.saveSet(
            examCode,
            subject,
            testType,
            mergedPool,
            getQuestionDatasetVersion(mergedPool)
        );
    } catch (storageError) {
        console.warn("Could not preserve and save offline question pool:", storageError);
    }
}

function scheduleBackgroundOfflinePoolFill(examCode, examId, subject, testType, candidatePool, alreadyFetchedIds) {
    if (!window.OfflineQuestionStore?.saveSet || navigator.onLine === false) {
        return;
    }

    const runBackgroundFill = async () => {
        try {
            let currentCachedCount = 0;
            if (window.OfflineQuestionStore.getSet) {
                const cached = await window.OfflineQuestionStore.getSet(examCode, subject, testType);
                if (cached && Array.isArray(cached.questions)) {
                    currentCachedCount = cached.questions.length;
                }
            }

            const targetMax = window.OfflineQuestionStore.maxQuestionsPerSet || 120;
            if (currentCachedCount >= targetMax) {
                return;
            }

            const neededCount = targetMax - currentCachedCount;
            const alreadyFetchedSet = new Set(alreadyFetchedIds);
            const candidatesToFetch = (candidatePool || [])
                .filter((c) => !alreadyFetchedSet.has(c.id))
                .slice(0, neededCount);

            if (!candidatesToFetch.length) {
                return;
            }

            const idsToFetch = candidatesToFetch.map((c) => c.id);
            const { data, error } = await supabaseClient
                .from(SUPABASE_QUESTION_TABLE)
                .select(`
                    id,
                    exam_id,
                    Subject,
                    Question,
                    Option_a,
                    Option_b,
                    Option_c,
                    Option_d,
                    Correct_Answer,
                    test_type,
                    Topic,
                    topic,
                    Explanation,
                    explanation,
                    year,
                    source,
                    is_active,
                    updated_at,
                    import_key
                `)
                .eq("Subject", subject)
                .eq("exam_id", examId)
                .eq("test_type", testType)
                .eq("is_active", true)
                .in("id", idsToFetch);

            if (error || !Array.isArray(data)) {
                return;
            }

            const mappedAdditional = data.map(mapSupabaseQuestion);
            await preserveAndSaveOfflineQuestionPool(examCode, subject, testType, mappedAdditional);
        } catch (err) {
            console.warn("Background offline pool fill skipped:", err?.message || err);
        }
    };

    if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => { runBackgroundFill(); }, { timeout: 5000 });
    } else {
        setTimeout(runBackgroundFill, 1500);
    }
}

// ========================================
// BUILD QUESTION LIST
// ========================================

async function buildQuestions() {
    questions = [];

    // Offline Practice Mode: load from cached IndexedDB pool
    if (
        testType === "practice" &&
        navigator.onLine === false &&
        window.OfflineQuestionStore
    ) {
        const cachedQuestions = await loadAllOfflinePracticeQuestions();
        if (cachedQuestions) {
            questions = assembleOfflineSessionQuestions(cachedQuestions);
            return;
        }
    }

    // Online Two-Phase Flow
    try {
        selectedExamId = sessionContext
            ? sessionContext.exam.id
            : await window.resolveExamId(supabaseClient, selectedExamCode);

        const stagedHistoryBySubject = new Map();
        const assembledQuestionsBySubject = new Map();
        const candidatesBySubject = new Map();
        const selectedCandidatesBySubject = new Map();

        // Phase 1: Fetch candidates per subject and select without committing history
        for (const subject of selectedSubjects) {
            const subjectCandidates = [];
            let from = 0;

            while (true) {
                const to = from + SUPABASE_PAGE_SIZE - 1;
                const candidateQuery = supabaseClient
                    .from(SUPABASE_QUESTION_TABLE)
                    .select(`
                        id,
                        exam_id,
                        Subject,
                        Question,
                        Option_a,
                        Option_b,
                        Option_c,
                        Option_d,
                        test_type,
                        import_key,
                        updated_at
                    `)
                    .eq("Subject", subject)
                    .eq("exam_id", selectedExamId)
                    .eq("test_type", testType)
                    .eq("is_active", true)
                    .order("id", { ascending: true });

                const { data, error } = await candidateQuery.range(from, to);
                if (error) {
                    throw new Error(
                        `Could not load ${testType} question candidates for ${subject}: ${error.message}`
                    );
                }

                const page = Array.isArray(data) ? data : [];
                subjectCandidates.push(...page.map(mapSupabaseCandidate));

                if (page.length < SUPABASE_PAGE_SIZE) {
                    break;
                }
                from += SUPABASE_PAGE_SIZE;
            }

            // Remove duplicate candidate rows by id/import_key
            const uniqueCandidates = new Map();
            subjectCandidates.forEach((candidate) => {
                const key = candidate.id != null
                    ? `id:${candidate.id}`
                    : `key:${candidate.import_key || getQuestionFingerprint(candidate, subject, testType)}`;
                if (!uniqueCandidates.has(key)) {
                    uniqueCandidates.set(key, candidate);
                }
            });
            const candidatePool = Array.from(uniqueCandidates.values());
            candidatesBySubject.set(subject, candidatePool);

            const questionsPerSubject = sessionContext
                ? sessionContext.questionPlan.questionsPerSelectedSubject
                : QUESTION_BATCH_SIZE;

            const { selectedCandidates, stagedSeenIds } = selectNoRepeatCandidates(
                candidatePool,
                subject,
                testType,
                questionsPerSubject
            );

            if (selectedCandidates.length !== questionsPerSubject) {
                throw new Error(
                    `Insufficient questions available for ${subject}: needed ${questionsPerSubject}, found ${selectedCandidates.length}.`
                );
            }

            selectedCandidatesBySubject.set(subject, selectedCandidates);
            stagedHistoryBySubject.set(subject, stagedSeenIds);
        }

        // Phase 2: Fetch full records for selected candidates, validate, and assemble in parallel across subjects
        let isPhase2Aborted = false;
        await Promise.all(
            selectedSubjects.map(async (subject) => {
                const selectedCandidates = selectedCandidatesBySubject.get(subject);
                const selectedIds = selectedCandidates.map((c) => c.id);

                try {
                    const { data, error } = await supabaseClient
                        .from(SUPABASE_QUESTION_TABLE)
                        .select(`
                            id,
                            exam_id,
                            Subject,
                            Question,
                            Option_a,
                            Option_b,
                            Option_c,
                            Option_d,
                            Correct_Answer,
                            test_type,
                            Topic,
                            topic,
                            Explanation,
                            explanation,
                            year,
                            source,
                            is_active,
                            updated_at,
                            import_key
                        `)
                        .eq("Subject", subject)
                        .eq("exam_id", selectedExamId)
                        .eq("test_type", testType)
                        .eq("is_active", true)
                        .in("id", selectedIds);

                    if (isPhase2Aborted) return;

                    if (error) {
                        throw new Error(
                            `Could not load full ${testType} questions for ${subject}: ${error.message}`
                        );
                    }

                    // Point 4: Validate full records (filters, cardinality, fingerprint parity, ordering)
                    const orderedFullQuestions = validateAndAssembleFullQuestions(
                        selectedCandidates,
                        data,
                        subject,
                        testType
                    );

                    if (isPhase2Aborted) return;

                    assembledQuestionsBySubject.set(subject, orderedFullQuestions);
                } catch (err) {
                    isPhase2Aborted = true;
                    throw err;
                }
            })
        );

        // Assemble all questions in subject order
        for (const subject of selectedSubjects) {
            const subjectQuestions = assembledQuestionsBySubject.get(subject);
            questions = questions.concat(subjectQuestions);
        }

        // Verify total question count
        const expectedTotal = sessionContext
            ? sessionContext.questionPlan.totalQuestionCount
            : selectedSubjects.length * QUESTION_BATCH_SIZE;

        if (questions.length !== expectedTotal) {
            throw new Error(
                `Question bank returned ${questions.length} questions; ` +
                `the active configuration requires ${expectedTotal}.`
            );
        }

        // COMMIT GATE: All retrieval, validation, and assembly succeeded!
        // Now commit no-repeat history to localStorage
        stagedHistoryBySubject.forEach((stagedSeenIds, subject) => {
            saveSeenQuestionIds(subject, testType, stagedSeenIds);
        });

        // Offline Cache Preservation: Merge session questions into IndexedDB (preserve 120-pool)
        for (const subject of selectedSubjects) {
            const subjectQuestions = assembledQuestionsBySubject.get(subject);
            await preserveAndSaveOfflineQuestionPool(
                selectedExamCode,
                subject,
                testType,
                subjectQuestions
            );

            // Schedule non-blocking background hydration if IndexedDB pool has room
            const candidatePool = candidatesBySubject.get(subject) || [];
            scheduleBackgroundOfflinePoolFill(
                selectedExamCode,
                selectedExamId,
                subject,
                testType,
                candidatePool,
                subjectQuestions.map((q) => q.id)
            );
        }

        console.log(
            `Supabase two-phase retrieval complete: ${questions.length} validated ${testType} questions ready for CBT.`
        );

    } catch (onlineError) {
        console.error("Online question retrieval error:", onlineError);

        // Fallback to offline questions if network failure and offline cache available
        if (isQuestionNetworkFailure(onlineError) && window.OfflineQuestionStore) {
            if (testType === "practice") {
                const cachedQuestions = await loadAllOfflinePracticeQuestions();
                if (cachedQuestions) {
                    questions = assembleOfflineSessionQuestions(cachedQuestions);
                    console.warn(
                        `Using saved practice questions for ${selectedSubjects.join(", ")}; online Supabase retrieval failed.`
                    );
                    return;
                }
            }
        }
        throw onlineError;
    }
}

if (typeof window !== "undefined") {
    window.mapSupabaseCandidate = mapSupabaseCandidate;
    window.selectNoRepeatCandidates = selectNoRepeatCandidates;
    window.validateAndAssembleFullQuestions = validateAndAssembleFullQuestions;
    window.preserveAndSaveOfflineQuestionPool = preserveAndSaveOfflineQuestionPool;
    window.scheduleBackgroundOfflinePoolFill = scheduleBackgroundOfflinePoolFill;
    window.assembleOfflineSessionQuestions = assembleOfflineSessionQuestions;
    window.getExamQuestions = () => questions;
    window.renderQuestionPalette = renderQuestionPalette;
    window.updateExamStats = updateExamStats;
    window.startTimer = startTimer;
    window.getAnswers = () => answers;
    window.getTimeLeft = () => timeLeft;
    window.setTimeLeft = (t) => { timeLeft = t; };
    window.getCurrentQuestion = () => currentQuestion;
    window.setCurrentQuestion = (n) => { currentQuestion = n; };
    window.setExamQuestions = (qs) => { questions = qs; };
    window.resetCbtDomCaches = resetCbtDomCaches;
    window.setIsExamFinished = (v) => { isExamFinished = v; };
}

// ========================================
// EXAM UI HELPERS
// ========================================

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

let paletteButtonElements = [];
let activePaletteButtonIndex = -1;
let cachedTimerEl = null;
let cachedTimerTextSpan = null;
let examEndTime = null;

let cachedStatsEls = null;
let cachedMetaEls = null;
let cachedNavEls = null;
let cachedOptionContainers = null;

function getCachedStatsElements() {
    if (!cachedStatsEls) {
        cachedStatsEls = {
            answered: document.getElementById("answeredCount"),
            unanswered: document.getElementById("unansweredCount"),
            progress: document.getElementById("examProgress"),
            progressText: document.getElementById("progressText"),
            mapTotal: document.getElementById("mapTotal")
        };
    }
    return cachedStatsEls;
}

function getCachedMetaElements() {
    if (!cachedMetaEls) {
        cachedMetaEls = {
            subject: document.getElementById("currentSubject"),
            number: document.getElementById("questionNumber"),
            count: document.getElementById("questionCount")
        };
    }
    return cachedMetaEls;
}

function getCachedNavElements() {
    if (!cachedNavEls) {
        cachedNavEls = {
            previous: document.getElementById("previousButton"),
            next: document.getElementById("nextButton")
        };
    }
    return cachedNavEls;
}

function getCachedOptionContainers() {
    if (!cachedOptionContainers) {
        cachedOptionContainers = ["optionA", "optionB", "optionC", "optionD"].map(
            (id) => document.getElementById(id)
        );
    }
    return cachedOptionContainers;
}

let isExamFinished = false;

function resetCbtDomCaches() {
    paletteButtonElements = [];
    activePaletteButtonIndex = -1;
    cachedTimerEl = null;
    cachedTimerTextSpan = null;
    examEndTime = null;
    cachedStatsEls = null;
    cachedMetaEls = null;
    cachedNavEls = null;
    cachedOptionContainers = null;
}

function getAnsweredCount() {
    return Object.keys(answers).filter(
        key => answers[key]
    ).length;
}

function updateExamStats() {
    const answered = getAnsweredCount();
    const total = questions.length;
    const unanswered = Math.max(0, total - answered);

    const els = getCachedStatsElements();

    if (els.answered) els.answered.textContent = answered;
    if (els.unanswered) els.unanswered.textContent = unanswered;

    const percent = total ? Math.round((answered / total) * 100) : 0;
    if (els.progress) els.progress.style.width = percent + "%";
    if (els.progressText) els.progressText.textContent = percent + "% answered";

    if (els.mapTotal) els.mapTotal.textContent = total + " Q";
}

function renderQuestionPalette() {
    const palette = document.getElementById("questionStatus");
    if (!palette) return;

    // P3.1: Build palette DOM once if not yet initialized or if question count changed
    if (paletteButtonElements.length !== questions.length || palette.children.length !== questions.length) {
        palette.innerHTML = questions.map((_, i) => {
            const answered = Boolean(answers[i]);
            const current = i === currentQuestion;
            const classes = [
                "palette-btn",
                current ? "current" : "",
                answered ? "answered" : ""
            ].filter(Boolean).join(" ");

            return `
                <button
                    type="button"
                    class="${classes}"
                    onclick="goToQuestion(${i})"
                    aria-label="Go to question ${i + 1}"
                >${i + 1}</button>
            `;
        }).join("");
        paletteButtonElements = Array.from(palette.querySelectorAll(".palette-btn"));
        activePaletteButtonIndex = currentQuestion;
        return;
    }

    // P3.1: Fast-path targeted update: update only previous active and newly active buttons
    if (activePaletteButtonIndex !== currentQuestion) {
        if (paletteButtonElements[activePaletteButtonIndex]) {
            paletteButtonElements[activePaletteButtonIndex].classList.remove("current");
        }
        if (paletteButtonElements[currentQuestion]) {
            paletteButtonElements[currentQuestion].classList.add("current");
        }
        activePaletteButtonIndex = currentQuestion;
    }

    // Synchronize answered class on current button
    if (paletteButtonElements[currentQuestion]) {
        paletteButtonElements[currentQuestion].classList.toggle(
            "answered",
            Boolean(answers[currentQuestion])
        );
    }
}

function updateCurrentMeta() {
    const q = questions[currentQuestion];
    if (!q) return;

    const els = getCachedMetaElements();

    if (els.subject) {
        els.subject.textContent = q.subject || selectedSubjects[0] || "ExamPilot";
    }

    if (els.number) {
        els.number.textContent = `Question ${currentQuestion + 1}`;
    }

    if (els.count) {
        els.count.textContent = `of ${questions.length}`;
    }
}

function updateNavigationButtons() {
    const els = getCachedNavElements();

    if (els.previous) els.previous.disabled = currentQuestion === 0;
    if (els.next) {
        els.next.innerHTML =
            currentQuestion === questions.length - 1
                ? `Finish Test <span>✓</span>`
                : `Next Question <span>→</span>`;
    }
}

// ========================================
// SHOW QUESTION
// ========================================

function showQuestion() {
    const q = questions[currentQuestion];
    if (!q) return;

    if (
        testType === "practice" &&
        !isSubscribed &&
        freeQuestionsUsed >= FREE_QUESTION_LIMIT &&
        !answers[currentQuestion]
    ) {
        showSubscriptionRequired(
            "You have used your 15 free practice questions for today."
        );
        return;
    }

    updateCurrentMeta();

    const questionText = document.getElementById("questionText");
    if (questionText) {
        const prompt = q.question ?? q.questionText ?? q.text ?? "Question text unavailable";
        questionText.textContent = String(prompt);
    }

    const letters = ["A", "B", "C", "D"];
    const containers = getCachedOptionContainers();
    const options = q.options || [];

    containers.forEach((container, index) => {
        if (!container) return;

        const letter = letters[index];
        const selected = answers[currentQuestion] === letter;
        const optionCopyText = options[index] || "";

        const existingLabel = container.querySelector(".answer-option");
        const existingCopy = container.querySelector(".option-copy");
        const existingInput = container.querySelector("input[name='answer']");

        // P3.2: In-place update to prevent destructive DOM teardown
        if (existingLabel && existingCopy && existingInput) {
            existingCopy.textContent = optionCopyText;
            existingInput.value = letter;
            existingInput.checked = selected;
            existingLabel.classList.toggle("selected", selected);
        } else {
            container.innerHTML = `
                <label class="answer-option ${selected ? "selected" : ""}">
                    <span class="option-letter">${letter}</span>
                    <span class="option-copy">${escapeHTML(optionCopyText)}</span>
                    <input
                        type="radio"
                        name="answer"
                        value="${letter}"
                        ${selected ? "checked" : ""}
                        onchange="saveAnswer()"
                    >
                    <span class="option-check" aria-hidden="true">✓</span>
                </label>
            `;
        }
    });

    renderQuestionPalette();
    updateExamStats();
    updateNavigationButtons();

    // P3.5: Instant scrolling prevents animation frame queues on budget devices
    const card = document.getElementById("questionCard");
    if (card && typeof card.scrollIntoView === "function") {
        card.scrollIntoView({ behavior: "auto", block: "start" });
    }
}
window.showQuestion = showQuestion;

// ========================================
// QUESTION TIME TRACKING
// ========================================

function recordQuestionTime() {
    if (!questions[currentQuestion]) return;
    const now = Date.now();
    const elapsed = Math.max(0, Math.round((now - questionStartedAt) / 1000));
    questionTimeSpent[currentQuestion] = (questionTimeSpent[currentQuestion] || 0) + elapsed;
    questionStartedAt = now;
}

function formatDuration(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return minutes + ':' + String(secs).padStart(2, '0');
}

// ========================================
// SAVE ANSWER
// ========================================

function saveAnswer() {
    const selected = document.querySelector(
        "input[name='answer']:checked"
    );

    if (!selected) return;

    // P3.3: Fast-path return if answer is already saved and UI is in sync
    if (answers[currentQuestion] === selected.value) {
        return;
    }

    if (
        testType === "practice" &&
        !isSubscribed &&
        !answers[currentQuestion]
    ) {
        freeQuestionsUsed++;
        saveFreeQuestionCount();
    }

    answers[currentQuestion] = selected.value;

    const containers = getCachedOptionContainers();
    containers.forEach((container) => {
        if (!container) return;
        const label = container.querySelector(".answer-option");
        const input = container.querySelector("input[name='answer']");
        if (label && input) {
            label.classList.toggle("selected", input.value === selected.value);
        }
    });

    if (paletteButtonElements[currentQuestion]) {
        paletteButtonElements[currentQuestion].classList.add("answered");
    } else {
        renderQuestionPalette();
    }
    updateExamStats();
}
window.saveAnswer = saveAnswer;

// ========================================
// NEXT QUESTION
// ========================================

async function nextQuestion() {
    saveAnswer();
    recordQuestionTime();

    if (currentQuestion < questions.length - 1) {
        currentQuestion++;
        showQuestion();
        return;
    }

    submitExam();
}
window.nextQuestion = nextQuestion;

// ========================================
// PREVIOUS QUESTION
// ========================================

function previousQuestion() {
    saveAnswer();
    recordQuestionTime();

    if (currentQuestion > 0) {
        currentQuestion--;
        showQuestion();
    }
}
window.previousQuestion = previousQuestion;

// ========================================
// GO TO QUESTION
// ========================================

async function goToQuestion(number) {
    saveAnswer();
    recordQuestionTime();

    if (number < 0 || number >= questions.length) return;

    currentQuestion = number;
    showQuestion();
}
window.goToQuestion = goToQuestion;

// ========================================
// SUBMIT EXAM
// ========================================

function submitExam() {
    saveAnswer();

    const unanswered = questions.length - getAnsweredCount();

    const message = unanswered > 0
        ? `You still have ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}. Are you sure you want to submit?`
        : "Are you sure you want to submit your test?";

    if (confirm(message)) {
        if (typeof window !== "undefined" && typeof window.finishTest === "function") {
            window.finishTest();
        } else {
            finishTest();
        }
    }
}
window.submitExam = submitExam;

// ========================================
// FINISH TEST
// ========================================

function finishTest() {
    if (isExamFinished) return;
    isExamFinished = true;

    if (timer) {
        clearInterval(timer);
        timer = null;
    }

    saveAnswer();
    recordQuestionTime();

    const subjectStats = {};
    const outcomes = [];

    const questionDetails = questions.map((question, i) => {
        const userAnswer = answers[i] || null;
        const correctAnswer = question.answer;
        const isCorrect = userAnswer === correctAnswer;
        const subject = question.subject || selectedSubjects[0] || "General";

        if (!subjectStats[subject]) {
            subjectStats[subject] = {
                subject,
                total: 0,
                correct: 0,
                wrong: 0,
                unanswered: 0,
                percentage: 0
            };
        }

        subjectStats[subject].total++;
        if (isCorrect) {
            subjectStats[subject].correct++;
        } else if (userAnswer) {
            subjectStats[subject].wrong++;
        } else {
            subjectStats[subject].unanswered++;
        }
        outcomes.push({
            correct: isCorrect,
            unanswered: !userAnswer
        });

        return {
            number: i + 1,
            subject,
            question: question.question,
            options: Array.isArray(question.options) ? question.options : [],
            userAnswer,
            correctAnswer,
            isCorrect,
            unanswered: !userAnswer,
            timeSpent: questionTimeSpent[i] || 0,
            explanation: question.explanation || ""
        };
    });

    Object.keys(subjectStats).forEach(function(key) {
        const stat = subjectStats[key];
        stat.percentage = stat.total
            ? Math.round((stat.correct / stat.total) * 100)
            : 0;
    });

    const scoring = sessionContext?.configuration.scoring || {
        method: "correct_count",
        marksPerQuestion: 1,
        negativeMark: 0
    };
    const grading = sessionContext?.configuration.grading || {
        method: "percentage"
    };
    const scoreResult = window.calculateConfiguredScore(outcomes, scoring);
    const percentage = window.calculateConfiguredGrade(scoreResult, grading);
    const score = scoreResult.score;
    const wrong = scoreResult.wrong;
    const unanswered = scoreResult.unanswered;
    const totalAllowedSeconds = sessionContext
        ? sessionContext.configuration.durationSeconds
        : 30 * 60;
    const timeUsed = Math.min(totalAllowedSeconds, Math.max(0, totalAllowedSeconds - Math.max(0, timeLeft)));
    const attemptSnapshot = copySubmittedPracticeAttemptSnapshot();

    const resultRecord = {
        id: Date.now(),
        userId: currentUser?.id || null,
        examCode: selectedExamCode || (sessionContext?.exam?.code) || "JAMB",
        examId: selectedExamId || (sessionContext?.exam?.id) || null,
        date: new Date().toISOString(),
        subjects: [...selectedSubjects],
        testType,
        score,
        total: questions.length,
        percentage,
        correct: scoreResult.correct,
        wrong,
        unanswered,
        timeUsed,
        timeAllowed: totalAllowedSeconds,
        subjectStats: Object.values(subjectStats),
        questionDetails,
        ...(attemptSnapshot ? { attemptSnapshot } : {})
    };

    const savedResults = JSON.parse(localStorage.getItem("jambResults")) || [];
    savedResults.unshift(resultRecord);
    localStorage.setItem("jambResults", JSON.stringify(savedResults.slice(0, 50)));

    resetCbtDomCaches();

    document.body.innerHTML = `
        <main class="result-page">
            <section class="result-hero">
                <div class="result-icon">✓</div>
                <p class="eyebrow">TEST COMPLETED</p>
                <h1>Great job, Student!</h1>
                <p>${escapeHTML(testType === "past" ? "Past Questions" : "Practice Test")} • ${escapeHTML(selectedSubjects.join(", "))}</p>
            </section>

            <section class="score-grid">
                <div class="score-card primary-score"><span>Score</span><strong>${score}/${questions.length}</strong><small>${percentage}%</small></div>
                <div class="score-card"><span>Correct</span><strong>${score}</strong></div>
                <div class="score-card"><span>Wrong</span><strong>${wrong}</strong></div>
                <div class="score-card"><span>Unanswered</span><strong>${unanswered}</strong></div>
                <div class="score-card"><span>Time Used</span><strong>${formatDuration(timeUsed)}</strong></div>
            </section>

            <section class="result-section-card">
                <div class="section-heading"><div><p class="eyebrow">PERFORMANCE</p><h2>Subject Breakdown</h2></div></div>
                <div class="subject-result-grid">
                    ${Object.values(subjectStats).map(stat => `
                        <article class="subject-result-card">
                            <div class="subject-result-head"><strong>${escapeHTML(stat.subject)}</strong><span>${stat.percentage}%</span></div>
                            <div class="subject-bar"><span style="width:${stat.percentage}%"></span></div>
                            <div class="subject-result-meta"><span>${stat.correct} correct</span><span>${stat.wrong} wrong</span><span>${stat.unanswered} unanswered</span></div>
                        </article>
                    `).join("")}
                </div>
            </section>

            <div class="result-actions">
                <button class="primary-action" onclick="location.href='result-details.html?id=${resultRecord.id}'">View Full Analysis</button>
                <button class="secondary-action" onclick="location.href='results.html'">Results History</button>
                <button class="secondary-action" onclick="location.href='subject.html'">Choose Another Test</button>
            </div>
        </main>
    `;
}
window.finishTest = finishTest;

// ========================================
// TIMER
// ========================================

function startTimer() {
    if (timer) clearInterval(timer);

    cachedTimerEl = document.getElementById("timer");
    cachedTimerTextSpan = null;
    examEndTime = Date.now() + Math.max(0, timeLeft) * 1000;

    timer = setInterval(function() {
        // P3.4: Derive timeLeft from wall clock delta to prevent background-tab drift
        const now = Date.now();
        const remaining = Math.max(0, Math.round((examEndTime - now) / 1000));
        timeLeft = remaining;

        const minutes = Math.floor(timeLeft / 60);
        const seconds = String(timeLeft % 60).padStart(2, "0");
        const timerText = `${minutes}:${seconds}`;

        if (cachedTimerEl) {
            if (!cachedTimerTextSpan) {
                cachedTimerTextSpan = cachedTimerEl.querySelector(".timer-text");
                if (!cachedTimerTextSpan) {
                    cachedTimerEl.innerHTML = `<span class="timer-dot"></span><span class="timer-text">${timerText}</span>`;
                    cachedTimerTextSpan = cachedTimerEl.querySelector(".timer-text");
                } else {
                    cachedTimerTextSpan.textContent = timerText;
                }
            } else {
                cachedTimerTextSpan.textContent = timerText;
            }

            cachedTimerEl.classList.toggle("timer-warning", timeLeft <= 300);
            cachedTimerEl.classList.toggle("timer-critical", timeLeft <= 60);
        }

        if (timeLeft <= 0) {
            clearInterval(timer);
            timer = null;
            if (typeof window !== "undefined" && typeof window.finishTest === "function") {
                window.finishTest();
            } else {
                finishTest();
            }
        }
    }, 1000);
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", function() {
        if (!document.hidden && examEndTime && timer && !isExamFinished) {
            const now = Date.now();
            timeLeft = Math.max(0, Math.round((examEndTime - now) / 1000));
            if (cachedTimerEl) {
                const minutes = Math.floor(timeLeft / 60);
                const seconds = String(timeLeft % 60).padStart(2, "0");
                const timerText = `${minutes}:${seconds}`;
                if (cachedTimerTextSpan) {
                    cachedTimerTextSpan.textContent = timerText;
                }
                cachedTimerEl.classList.toggle("timer-warning", timeLeft <= 300);
                cachedTimerEl.classList.toggle("timer-critical", timeLeft <= 60);
            }
            if (timeLeft <= 0) {
                clearInterval(timer);
                timer = null;
                if (typeof window !== "undefined" && typeof window.finishTest === "function") {
                    window.finishTest();
                } else {
                    finishTest();
                }
            }
        }
    });
}

// ========================================
// START THE CBT
// ========================================

async function startCBT() {
    isExamFinished = false;
    const allowed = await checkStudentAccess();
    if (!allowed) return;

    let subjectRules;
    try {
        subjectRules = await window.resolveCbtSubjectSelectionRules(
            supabaseClient,
            window.getSelectedExamCode(),
            testType
        );
    } catch (error) {
        console.error("CBT subject-selection rules error:", error);
        showQuestionLoadError(error);
        return;
    }

    if (
        selectedSubjects.length < subjectRules.minimumSubjects ||
        selectedSubjects.length > subjectRules.maximumSubjects ||
        selectedSubjects.length !== subjectRules.requiredSubjectCount
    ) {
        const required = subjectRules.requiredSubjectCount;
        const min = subjectRules.minimumSubjects;
        const max = subjectRules.maximumSubjects;
        const message = min === max
            ? `Please select exactly ${required} subjects before starting your CBT.`
            : `Please select between ${min} and ${max} subjects before starting your CBT.`;
        resetCbtDomCaches();

    document.body.innerHTML = `
            <div class="access-page">
                <div class="access-card">
                    <div class="access-icon">📝</div>
                    <h2>${min === max ? `Select ${required} subjects` : `Select ${min}–${max} subjects`}</h2>
                    <p>${message}</p>
                    <button class="primary-action" onclick="location.href='subject.html'">
                        Select Subjects
                    </button>
                </div>
            </div>
        `;
        return;
    }

    try {
        await initializePracticeSessionContext();
        const subjectSelection = sessionContext?.configuration.subjectSelection;
        if (
            subjectSelection &&
            (selectedSubjects.length < subjectSelection.minimumSubjects ||
                selectedSubjects.length > subjectSelection.maximumSubjects ||
                selectedSubjects.length !== subjectSelection.requiredSubjectCount)
        ) {
            throw new Error(
                `Please select exactly ${subjectSelection.requiredSubjectCount} subjects before starting your CBT.`
            );
        }
        await buildQuestions();
    } catch (error) {
        console.error("CBT question bank error:", error);
        showQuestionLoadError(error);
        return;
    }

    if (questions.length === 0) {
        resetCbtDomCaches();

    document.body.innerHTML = `
            <div class="access-page">
                <div class="access-card">
                    <div class="access-icon">📚</div>
                    <h2>No questions found</h2>
                    <p>No questions are available for your selected subjects and test type.</p>
                    <button class="primary-action" onclick="location.href='subject.html'">
                        Go Back
                    </button>
                </div>
            </div>
        `;
        return;
    }

    if (sessionContext) {
        createPracticeAttemptSnapshot();
    }
    showQuestion();
    startTimer();
}

startCBT();
