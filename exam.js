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

let timeLeft = 30 * 60;

let timer = null;
let questionStartedAt = Date.now();
let questionTimeSpent = {};


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

        if (
            sessionError ||
            !sessionData.session
        ) {

            showAccessDenied(
                "Please login as a student first."
            );

            return false;

        }


        currentUser =
            sessionData.session.user;


        // ==================================
        // GET SUBSCRIPTION
        // ==================================

        const {
            data: subscription,
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
                .limit(1)
                .maybeSingle();


        // ==================================
        // SUBSCRIPTION DATABASE ERROR
        // ==================================

        if (subscriptionError) {

            console.error(
                "Subscription check error:",
                subscriptionError
            );


            isSubscribed = false;

        }

        // ==================================
        // NO SUBSCRIPTION
        // ==================================

        else if (!subscription) {

            isSubscribed = false;

        }

        // ==================================
        // CHECK SUBSCRIPTION
        // ==================================

        else {

            const status =
                String(
                    subscription.status || ""
                )
                .trim()
                .toLowerCase();


            let notExpired = true;


            // ==================================
            // CHECK EXPIRATION
            // ==================================

            if (
                subscription.expires_at
            ) {

                const expiry =
                    new Date(
                        subscription.expires_at
                    );


                if (
                    Number.isNaN(
                        expiry.getTime()
                    )
                ) {

                    notExpired = false;

                }

                else {

                    notExpired =
                        expiry > new Date();

                }

            }


            // ==================================
            // ACTIVE SUBSCRIPTION ONLY
            // ==================================

            isSubscribed =
                (
                    status === "subscribed"
                )
                &&
                notExpired;

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
// GET ADMIN QUESTIONS
// ========================================

let adminQuestions =
    JSON.parse(
        localStorage.getItem(
            "adminQuestions"
        )
    ) || [];


// ========================================
// RANDOM / NO-REPEAT QUESTION SYSTEM
// ========================================

const QUESTION_BATCH_SIZE = 20;
const NO_REPEAT_STORAGE_PREFIX = "jambCBTSeenQuestions_v1";

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
    return [
        NO_REPEAT_STORAGE_PREFIX,
        userId,
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

function selectNoRepeatQuestions(allSubjectQuestions, subject, currentTestType) {
    if (!allSubjectQuestions.length) return [];

    const seenIds = loadSeenQuestionIds(subject, currentTestType);
    let pool = allSubjectQuestions.map((question) => ({
        ...question,
        _questionId: getQuestionFingerprint(question, subject, currentTestType)
    }));

    // Remove duplicate copies from the active pool by stable question ID.
    const uniqueById = new Map();
    pool.forEach((question) => {
        if (!uniqueById.has(question._questionId)) {
            uniqueById.set(question._questionId, question);
        }
    });
    pool = Array.from(uniqueById.values());

    let available = shuffleArray(
        pool.filter((question) => !seenIds.has(question._questionId))
    );

    // When the whole bank has been used, start a fresh cycle automatically.
    // This allows a 500-question subject to give 25 batches of 20 before any
    // question can appear again.
    if (available.length === 0) {
        seenIds.clear();
        available = shuffleArray(pool);
    }

    // If a cycle has fewer than 20 questions left, use those remaining
    // questions now and begin a fresh cycle for the rest. This avoids a repeat
    // inside the same CBT.
    let selected = available.slice(0, QUESTION_BATCH_SIZE);

    if (selected.length < QUESTION_BATCH_SIZE) {
        const selectedIds = new Set(
            selected.map((question) => question._questionId)
        );
        const freshCycle = shuffleArray(
            pool.filter((question) => !selectedIds.has(question._questionId))
        );
        selected = selected.concat(
            freshCycle.slice(0, QUESTION_BATCH_SIZE - selected.length)
        );
    }

    selected.forEach((question) => seenIds.add(question._questionId));
    saveSeenQuestionIds(subject, currentTestType, seenIds);

    return selected.map(({ _questionId, ...question }) => question);
}

// ========================================
// LOAD QUESTIONS FROM SUPABASE
// ========================================

const SUPABASE_PAGE_SIZE = 1000;
const SUPABASE_QUESTION_TABLE = "Questions";

function mapSupabaseQuestion(row) {
    return {
        id: row.id,
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
        import_key: row.import_key ?? ""
    };
}

async function loadSupabaseQuestions() {
    const loaded = [];

    // Fetch every matching row in pages. Supabase/PostgREST commonly limits
    // a single response to 1,000 rows, so one request is NOT enough for this bank.
    for (const subject of selectedSubjects) {
        let from = 0;

        while (true) {
            const to = from + SUPABASE_PAGE_SIZE - 1;

            const { data, error } = await supabaseClient
                .from(SUPABASE_QUESTION_TABLE)
                .select(`
                    id,
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
                    import_key
                `)
                .eq("Subject", subject)
                .eq("test_type", testType)
                .range(from, to);

            if (error) {
                console.error("Supabase Questions load error:", error);
                throw new Error(
                    `Could not load ${testType} questions for ${subject}: ${error.message}`
                );
            }

            const page = Array.isArray(data) ? data : [];
            loaded.push(...page.map(mapSupabaseQuestion));

            console.log(
                `Loaded ${page.length} ${testType} questions for ${subject} (rows ${from}-${from + Math.max(page.length - 1, 0)}).`
            );

            if (page.length < SUPABASE_PAGE_SIZE) {
                break;
            }

            from += SUPABASE_PAGE_SIZE;
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
// BUILD QUESTION LIST
// ========================================

async function buildQuestions() {
    questions = [];

    // Supabase is now the source of truth for the CBT question bank.
    // The old local questions.js file remains in the project for compatibility,
    // but it is deliberately NOT used here, preventing the old ~1,000-question
    // local bank from limiting the CBT.
    const supabaseQuestions = await loadSupabaseQuestions();

    selectedSubjects.forEach(function(subject) {
        const allSubjectQuestions = supabaseQuestions.filter((question) =>
            String(question.subject).toLowerCase() === String(subject).toLowerCase()
        );

        // Keep locally-created admin questions available in addition to Supabase.
        adminQuestions.forEach(function(item) {
            if (
                String(item.subject).toLowerCase() === String(subject).toLowerCase() &&
                item.testType === testType &&
                Array.isArray(item.options) &&
                item.options.length >= 4
            ) {
                allSubjectQuestions.push({
                    id: `admin-${item.id || Math.random().toString(36).slice(2)}`,
                    question: item.question,
                    options: [
                        item.options[0],
                        item.options[1],
                        item.options[2],
                        item.options[3]
                    ],
                    answer: item.answer,
                    subject: subject,
                    testType: testType,
                    explanation: item.explanation || ""
                });
            }
        });

        const selectedQuestions = selectNoRepeatQuestions(
            allSubjectQuestions,
            subject,
            testType
        );

        questions = questions.concat(selectedQuestions);

        console.log(
            `${subject}: ${allSubjectQuestions.length} available ${testType} questions; ${selectedQuestions.length} selected for this CBT.`
        );
    });
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

function getAnsweredCount() {
    return Object.keys(answers).filter(
        key => answers[key]
    ).length;
}

function updateExamStats() {
    const answered = getAnsweredCount();
    const total = questions.length;
    const unanswered = Math.max(0, total - answered);

    const answeredEl = document.getElementById("answeredCount");
    const unansweredEl = document.getElementById("unansweredCount");
    const progressEl = document.getElementById("examProgress");
    const progressText = document.getElementById("progressText");

    if (answeredEl) answeredEl.textContent = answered;
    if (unansweredEl) unansweredEl.textContent = unanswered;

    const percent = total ? Math.round((answered / total) * 100) : 0;
    if (progressEl) progressEl.style.width = percent + "%";
    if (progressText) progressText.textContent = percent + "% answered";

    const mapTotal = document.getElementById("mapTotal");
    if (mapTotal) mapTotal.textContent = total + " Q";
}

function renderQuestionPalette() {
    const palette = document.getElementById("questionStatus");
    if (!palette) return;

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
}

function updateCurrentMeta() {
    const q = questions[currentQuestion];
    if (!q) return;

    const subjectEl = document.getElementById("currentSubject");
    if (subjectEl) {
        subjectEl.textContent = q.subject || selectedSubjects[0] || "JAMB CBT";
    }

    const numberEl = document.getElementById("questionNumber");
    if (numberEl) {
        numberEl.textContent = `Question ${currentQuestion + 1}`;
    }

    const countEl = document.getElementById("questionCount");
    if (countEl) {
        countEl.textContent = `of ${questions.length}`;
    }
}

function updateNavigationButtons() {
    const previous = document.getElementById("previousButton");
    const next = document.getElementById("nextButton");

    if (previous) previous.disabled = currentQuestion === 0;
    if (next) {
        next.innerHTML =
            currentQuestion === questions.length - 1
                ? `Finish Test <span>✓</span>`
                : `Next Question <span>→</span>`;
    }
}

// ========================================
// SHOW QUESTION
// ========================================

window.showQuestion = function() {
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
    const optionIds = ["optionA", "optionB", "optionC", "optionD"];
    const options = q.options || [];

    optionIds.forEach((id, index) => {
        const container = document.getElementById(id);
        if (!container) return;

        const letter = letters[index];
        const selected = answers[currentQuestion] === letter;

        container.innerHTML = `
            <label class="answer-option ${selected ? "selected" : ""}">
                <span class="option-letter">${letter}</span>
                <span class="option-copy">${escapeHTML(options[index] || "")}</span>
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
    });

    renderQuestionPalette();
    updateExamStats();
    updateNavigationButtons();

    const card = document.getElementById("questionCard");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
};

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

window.saveAnswer = function() {
    const selected = document.querySelector(
        "input[name='answer']:checked"
    );

    if (!selected) return;

    if (
        testType === "practice" &&
        !isSubscribed &&
        !answers[currentQuestion]
    ) {
        freeQuestionsUsed++;
        saveFreeQuestionCount();
    }

    answers[currentQuestion] = selected.value;

    document.querySelectorAll(".answer-option").forEach(option => {
        option.classList.remove("selected");
    });

    const selectedOption = selected.closest(".answer-option");
    if (selectedOption) selectedOption.classList.add("selected");

    renderQuestionPalette();
    updateExamStats();
};

// ========================================
// NEXT QUESTION
// ========================================

window.nextQuestion = async function() {
    saveAnswer();
    recordQuestionTime();

    if (currentQuestion < questions.length - 1) {
        currentQuestion++;
        showQuestion();
        return;
    }

    submitExam();
};

// ========================================
// PREVIOUS QUESTION
// ========================================

window.previousQuestion = function() {
    saveAnswer();
    recordQuestionTime();

    if (currentQuestion > 0) {
        currentQuestion--;
        showQuestion();
    }
};

// ========================================
// GO TO QUESTION
// ========================================

window.goToQuestion = async function(number) {
    saveAnswer();
    recordQuestionTime();

    if (number < 0 || number >= questions.length) return;

    currentQuestion = number;
    showQuestion();
};

// ========================================
// SUBMIT EXAM
// ========================================

window.submitExam = function() {
    saveAnswer();

    const unanswered = questions.length - getAnsweredCount();

    const message = unanswered > 0
        ? `You still have ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}. Are you sure you want to submit?`
        : "Are you sure you want to submit your test?";

    if (confirm(message)) {
        finishTest();
    }
};

// ========================================
// FINISH TEST
// ========================================

// REVIEW DATA IS CREATED ONLY AFTER SUBMISSION.
// During the CBT, showQuestion() renders the selected answer only; it never renders
// correctAnswer or explanation. Those values are packaged here after submit/timeout.
window.finishTest = function() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }

    saveAnswer();
    recordQuestionTime();

    let score = 0;
    const subjectStats = {};

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
            score++;
            subjectStats[subject].correct++;
        } else if (userAnswer) {
            subjectStats[subject].wrong++;
        } else {
            subjectStats[subject].unanswered++;
        }

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

    const wrong = questions.length - score - Object.values(subjectStats).reduce((sum, item) => sum + item.unanswered, 0);
    const unanswered = questions.length - getAnsweredCount();
    const percentage = questions.length
        ? Math.round((score / questions.length) * 100)
        : 0;
    const totalAllowedSeconds = 30 * 60;
    const timeUsed = Math.min(totalAllowedSeconds, Math.max(0, totalAllowedSeconds - Math.max(0, timeLeft)));

    const resultRecord = {
        id: Date.now(),
        userId: currentUser?.id || null,
        date: new Date().toISOString(),
        subjects: [...selectedSubjects],
        testType,
        score,
        total: questions.length,
        percentage,
        correct: score,
        wrong,
        unanswered,
        timeUsed,
        timeAllowed: totalAllowedSeconds,
        subjectStats: Object.values(subjectStats),
        questionDetails
    };

    const savedResults = JSON.parse(localStorage.getItem("jambResults")) || [];
    savedResults.unshift(resultRecord);
    localStorage.setItem("jambResults", JSON.stringify(savedResults.slice(0, 50)));

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
};

// ========================================
// TIMER
// ========================================

function startTimer() {
    if (timer) clearInterval(timer);

    timer = setInterval(function() {
        const minutes = Math.floor(timeLeft / 60);
        const seconds = String(timeLeft % 60).padStart(2, "0");
        const timerElement = document.getElementById("timer");

        if (timerElement) {
            timerElement.innerHTML =
                `<span class="timer-dot"></span>${minutes}:${seconds}`;
        }

        if (timeLeft <= 300 && timerElement) {
            timerElement.classList.add("timer-warning");
        }

        if (timeLeft <= 60 && timerElement) {
            timerElement.classList.add("timer-critical");
        }

        timeLeft--;

        if (timeLeft < 0) {
            clearInterval(timer);
            timer = null;
            finishTest();
        }
    }, 1000);
}

// ========================================
// START THE CBT
// ========================================

async function startCBT() {
    const allowed = await checkStudentAccess();
    if (!allowed) return;

    if (selectedSubjects.length !== 4) {
        document.body.innerHTML = `
            <div class="access-page">
                <div class="access-card">
                    <div class="access-icon">📝</div>
                    <h2>Select 4 subjects</h2>
                    <p>Please select exactly 4 subjects before starting your CBT.</p>
                    <button class="primary-action" onclick="location.href='subject.html'">
                        Select Subjects
                    </button>
                </div>
            </div>
        `;
        return;
    }

    try {
        await buildQuestions();
    } catch (error) {
        console.error("CBT question bank error:", error);
        showQuestionLoadError(error);
        return;
    }

    if (questions.length === 0) {
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

    showQuestion();
    startTimer();
}

startCBT();
