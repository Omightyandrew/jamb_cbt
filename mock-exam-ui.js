(function () {
    "use strict";

    const app = document.getElementById("mockApp");
    const timerElement = document.getElementById("mockTimer");
    const headerSubmit = document.getElementById("mockHeaderSubmit");
    const availableSubjects = [
        "Mathematics", "Physics", "Chemistry", "Biology", "Government", "Economics",
        "Literature", "CRS", "History", "Geography", "Commerce", "Accounting"
    ];
    const state = {
        attempt: null,
        activePosition: 1,
        activeSubject: "All",
        selectedAdditionalSubjects: new Set(),
        reviewPositions: new Set(),
        answerSaving: false,
        startBusy: false,
        submitBusy: false,
        deadlinePending: false,
        clockInterval: null,
        deadlinePoll: null
    };

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
        })[character]);
    }

    function showMessage(message, kind) {
        const element = document.getElementById("mockMessage");
        if (!element) return;
        element.textContent = message || "";
        element.className = `mock-message${kind ? ` is-${kind}` : ""}`;
    }

    function unwrapApiResult(response) {
        if (!response || response.error) {
            throw response?.error || new Error("Mock request failed.");
        }
        const envelope = response.data;
        if (!envelope || envelope.error || !Object.prototype.hasOwnProperty.call(envelope, "data")) {
            const error = envelope?.error;
            throw new Error(error?.message || "Mock request failed.");
        }
        return envelope.data;
    }

    function isPremiumDenial(error) {
        if (!error || error.status !== 403 || error.code !== "forbidden") {
            return false;
        }
        const isKnownDenial = (text) => typeof text === "string" && /^mock access is not permitted\.?$/i.test(text.trim());
        const isNormalizedDenial = (text) => typeof text === "string" && text.trim() === "An active Premium subscription is required.";
        return isKnownDenial(error.message) || isKnownDenial(error.rawMessage) || isNormalizedDenial(error.message);
    }

    function newUuid() {
        if (window.crypto?.randomUUID) return window.crypto.randomUUID();
        if (!window.crypto?.getRandomValues) {
            throw new Error("A secure browser context is required to start or save this Mock.");
        }
        const bytes = window.crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    function selectedSubjects() {
        return ["English", ...Array.from(state.selectedAdditionalSubjects)];
    }

    function renderSelection() {
        stopClock();
        timerElement.hidden = true;
        headerSubmit.hidden = true;
        const subjectChoices = availableSubjects.map((subject) => `
            <label class="mock-subject-choice">
                <input type="checkbox" name="mock-subject" value="${escapeHtml(subject)}" ${state.selectedAdditionalSubjects.has(subject) ? "checked" : ""}>
                <span>${escapeHtml(subject)}</span>
            </label>`).join("");

        app.innerHTML = `
            <section class="mock-page-heading">
                <p class="eyebrow">PREMIUM EXAMINATION</p>
                <h1>JAMB Mock</h1>
                <h2>Experience the JAMB exam environment</h2>
                <p>Take a full-length, timed JAMB-style simulation designed to help you practise managing questions, subjects, and time under realistic exam conditions.</p>
                <p>This is a JAMB-style simulation, not the official JAMB examination.</p>
                <div class="mock-structure" aria-label="Mock format">
                    <span>180 Questions</span><span>120 Minutes</span><span>English: 60</span><span>Other subjects: 40 each</span>
                </div>
            </section>
            <section class="mock-selection-card" aria-labelledby="mockSubjectHeading">
                <h2 id="mockSubjectHeading">Choose your subjects</h2>
                <p>English is compulsory. Select exactly three additional subjects.</p>
                <div class="mock-english-lock"><span><strong>English</strong><small>Compulsory · 60 questions</small></span><span aria-label="Selected">✓</span></div>
                <div class="mock-subject-grid">${subjectChoices}</div>
                <div class="mock-selection-footer">
                    <div class="mock-selection-count">Selected: <strong id="mockSelectionCount">1 of 4</strong></div>
                    <div class="mock-selection-actions"><a class="mock-back-link" href="dashboard.html">Dashboard</a><button class="mock-primary" id="mockStart" type="button" ${state.selectedAdditionalSubjects.size !== 3 || state.startBusy ? "disabled" : ""}>${state.startBusy ? "Starting…" : "Start Mock"}</button></div>
                </div>
                <p class="mock-server-rule">The server validates permitted subject combinations and Premium access when you start.</p>
                <p class="mock-message" id="mockMessage" role="status"></p>
            </section>`;
        updateSelectionCount();
    }

    function updateSelectionCount() {
        const count = document.getElementById("mockSelectionCount");
        const button = document.getElementById("mockStart");
        if (count) count.textContent = `${state.selectedAdditionalSubjects.size + 1} of 4`;
        if (button) button.disabled = state.selectedAdditionalSubjects.size !== 3 || state.startBusy;
    }

    function validateAttempt(attempt) {
        if (!attempt || !Array.isArray(attempt.questions) || attempt.questions.length !== 180) {
            throw new Error("The server returned an incomplete Mock attempt.");
        }
        const positions = new Set();
        const subjectCounts = new Map();
        for (const question of attempt.questions) {
            if (!Number.isInteger(question.position) || question.position < 1 || question.position > 180 || positions.has(question.position)) {
                throw new Error("The server returned an invalid question order.");
            }
            if (typeof question.subject !== "string" || !question.subject ||
                typeof question.question !== "string" || !Array.isArray(question.options) ||
                question.options.length !== 4 || question.options.some((option) => typeof option !== "string")) {
                throw new Error("The server returned an invalid question payload.");
            }
            if (!Number.isInteger(question.answer_revision) || question.answer_revision < 0 ||
                !(question.selected_answer === null || ["A", "B", "C", "D"].includes(question.selected_answer))) {
                throw new Error("The server returned invalid saved-answer state.");
            }
            positions.add(question.position);
            subjectCounts.set(question.subject, (subjectCounts.get(question.subject) || 0) + 1);
        }
        if (subjectCounts.size !== 4 || subjectCounts.get("English") !== 60 ||
            Array.from(subjectCounts.entries()).some(([subject, count]) => subject !== "English" && count !== 40)) {
            throw new Error("The server returned a question allocation that does not match the JAMB Mock structure.");
        }
        attempt.questions.sort((left, right) => left.position - right.position);
        return attempt;
    }

    function currentQuestion() {
        return state.attempt?.questions.find((question) => question.position === state.activePosition) || null;
    }

    function visibleQuestions() {
        if (!state.attempt) return [];
        return state.activeSubject === "All"
            ? state.attempt.questions
            : state.attempt.questions.filter((question) => question.subject === state.activeSubject);
    }

    function subjectTotals() {
        const totals = new Map();
        for (const question of state.attempt.questions) {
            totals.set(question.subject, (totals.get(question.subject) || 0) + 1);
        }
        return totals;
    }

    function formatRemaining() {
        const deadline = Date.parse(state.attempt?.expires_at || "");
        const remaining = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        const seconds = remaining % 60;
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    function stopClock() {
        if (state.clockInterval) window.clearInterval(state.clockInterval);
        if (state.deadlinePoll) window.clearTimeout(state.deadlinePoll);
        state.clockInterval = null;
        state.deadlinePoll = null;
    }

    function startClock() {
        stopClock();
        timerElement.hidden = false;
        headerSubmit.hidden = false;
        const tick = () => {
            timerElement.textContent = formatRemaining();
            const deadline = Date.parse(state.attempt?.expires_at || "");
            if (Number.isFinite(deadline) && deadline <= Date.now()) {
                state.deadlinePending = true;
                renderExam();
                pollDeadline();
            }
        };
        tick();
        if (!state.deadlinePending && state.attempt?.status === "in_progress") {
            state.clockInterval = window.setInterval(tick, 1000);
        }
    }

    function renderExam() {
        const attempt = state.attempt;
        if (!attempt) return;
        const question = currentQuestion();
        const totals = subjectTotals();
        const answeredCount = attempt.questions.filter((item) => item.selected_answer !== null).length;
        const filters = ["All", ...totals.keys()].map((subject) => `
            <button class="mock-filter" type="button" data-subject-filter="${escapeHtml(subject)}" aria-pressed="${state.activeSubject === subject}">${escapeHtml(subject)}${subject === "All" ? "" : ` · ${totals.get(subject)}`}</button>`).join("");
        const palette = visibleQuestions().map((item) => {
            const classes = [
                "palette-btn",
                item.position === state.activePosition ? "current" : "",
                item.selected_answer !== null ? "answered" : "",
                state.reviewPositions.has(item.position) ? "is-review" : ""
            ].filter(Boolean).join(" ");
            return `<button class="${classes}" type="button" data-position="${item.position}" aria-label="Question ${item.position}${state.reviewPositions.has(item.position) ? ", marked for review" : ""}" aria-current="${item.position === state.activePosition ? "step" : "false"}">${item.position}</button>`;
        }).join("");
        const options = question.options.map((option, index) => {
            const choice = String.fromCharCode(65 + index);
            const selected = question.selected_answer === choice;
            return `<button class="answer-option mock-option${selected ? " is-selected selected" : ""}" type="button" data-choice="${choice}" ${state.answerSaving || state.deadlinePending || attempt.status !== "in_progress" ? "disabled" : ""} aria-pressed="${selected}"><span class="option-letter">${choice}</span><span class="option-copy">${escapeHtml(option)}</span><span class="option-check" aria-hidden="true">✓</span></button>`;
        }).join("");

        app.innerHTML = `
            <div class="mock-subject-filters" aria-label="Filter question map by subject">${filters}</div>
            <div class="exam-shell mock-exam-shell">
                <section class="exam-main">
                    <div class="exam-toolbar mock-toolbar"><div><div class="eyebrow">CURRENT QUESTION</div><div class="question-index"><strong>Question ${question.position}</strong><span>of 180</span></div></div><span class="current-subject-pill">${escapeHtml(question.subject)}</span></div>
                    <div class="progress-track"><div class="progress-fill" style="width:${Math.round(answeredCount / 180 * 100)}%"></div></div>
                    <div class="progress-copy"><span>${answeredCount} answered · ${180 - answeredCount} unanswered</span><span>Position ${question.position} of 180</span></div>
                    <p class="mock-save-state" id="mockMessage" role="status">${state.deadlinePending ? "Checking the server deadline…" : state.answerSaving ? "Saving answer…" : "Answers save to your Mock attempt."}</p>
                    <article class="question-card mock-question-card"><span class="question-label">QUESTION ${question.position}</span><strong id="questionText">${escapeHtml(question.question)}</strong><div class="answer-list">${options}</div>
                        <div class="exam-actions mock-exam-actions"><button class="secondary-action nav-button" type="button" data-nav="previous" ${state.answerSaving || visibleQuestions()[0].position === question.position || state.deadlinePending ? "disabled" : ""}>Previous</button><div class="mock-action-group"><button class="mock-warning-button mock-review-toggle" type="button" data-review-toggle aria-pressed="${state.reviewPositions.has(question.position)}" ${state.deadlinePending ? "disabled" : ""}>${state.reviewPositions.has(question.position) ? "Marked for review" : "Mark for review"}</button><button class="primary-action nav-button" type="button" data-nav="next" ${state.answerSaving || visibleQuestions().at(-1).position === question.position || state.deadlinePending ? "disabled" : ""}>Next</button></div></div>
                        <button class="mock-secondary mock-submit-mobile" type="button" data-submit ${state.answerSaving || state.submitBusy || state.deadlinePending ? "disabled" : ""}>${state.submitBusy ? "Submitting…" : "Submit Mock"}</button>
                        <p class="mock-review-note">Review marks are temporary for this page and are not saved to the server.</p>
                    </article>
                </section>
                <aside class="exam-sidebar"><section class="sidebar-card"><div class="mock-sidebar-title"><div><div class="eyebrow">QUESTION MAP</div><h2>Navigate</h2></div><span class="map-count">${visibleQuestions().length} shown</span></div><div class="mock-palette-legend"><span><i class="mock-legend-dot answered"></i>Answered</span><span><i class="mock-legend-dot review"></i>Review</span><span><i class="mock-legend-dot"></i>Unanswered</span></div><div class="question-palette">${palette}</div><button class="mock-primary mock-sidebar-submit" type="button" data-submit ${state.answerSaving || state.submitBusy || state.deadlinePending ? "disabled" : ""}>${state.submitBusy ? "Submitting…" : "Submit Mock"}</button><p class="mock-message" id="mockSidebarMessage" role="status"></p></section></aside>
            </div>`;
        timerElement.hidden = false;
        headerSubmit.hidden = false;
        timerElement.textContent = formatRemaining();
        headerSubmit.disabled = state.answerSaving || state.submitBusy || state.deadlinePending;
    }

    function setAttempt(attempt) {
        state.attempt = validateAttempt(attempt);
        state.activePosition = state.attempt.questions[0].position;
        state.activeSubject = "All";
        state.deadlinePending = false;
    }

    async function apiCall(method, ...args) {
        if (!window.MockExamApi || typeof window.MockExamApi[method] !== "function") {
            throw new Error("Mock API is unavailable. Please reload the page.");
        }
        return unwrapApiResult(await window.MockExamApi[method](...args));
    }

    async function showFinalResult(attemptId) {
        stopClock();
        state.submitBusy = false;
        const result = await apiCall("getMockResult", attemptId);
        if (!result || result.status !== "submitted") {
            throw new Error("The final Mock result is not available yet.");
        }
        renderResult(result);
    }

    async function handleSubmittedAttempt(attempt) {
        stopClock();
        state.attempt = attempt;
        const attemptId = attempt?.attempt_id || new URLSearchParams(window.location.search).get("attempt");
        if (!attemptId) throw new Error("The submitted attempt could not be identified.");
        await showFinalResult(attemptId);
    }

    function renderResult(result) {
        timerElement.hidden = true;
        headerSubmit.hidden = true;
        const subjects = Object.entries(result.per_subject_summary || {}).map(([subject, stats]) => `
            <article class="mock-subject-result"><h3>${escapeHtml(subject)}</h3><p>${Number(stats.correct) || 0} correct · ${Number(stats.wrong) || 0} wrong · ${Number(stats.unanswered) || 0} unanswered</p><p>Score ${Number(stats.score) || 0} / ${Number(stats.max_score) || 0} · ${Number(stats.percentage) || 0}%</p></article>`).join("");
        const completion = result.completion_reason === "deadline" ? "Deadline reached" : result.completion_reason === "manual" ? "Submitted by you" : "Submitted";
        const xpFeedbackHtml = result.status === "submitted"
            ? '<div class="mock-xp-feedback" style="display:inline-flex;align-items:center;gap:6px;margin-top:12px;padding:6px 14px;border-radius:999px;background:rgba(255,255,255,.18);color:#fff;font-weight:750;font-size:13px;border:1px solid rgba(255,255,255,.28);">✨ +25 XP Earned!</div>'
            : '';
        app.innerHTML = `
            <section class="mock-result-page result-page"><section class="result-hero"><div class="result-icon">✓</div><p class="eyebrow">JAMB MOCK COMPLETE</p><h1>Your result</h1><p>180 questions · 120 minutes</p>${xpFeedbackHtml}</section><p class="mock-result-meta">${escapeHtml(completion)} · ${escapeHtml(result.submitted_at || "")}</p><section class="score-grid"><article class="score-card primary-score"><span>Score</span><strong>${Number(result.score) || 0} / ${Number(result.max_score) || 0}</strong></article><article class="score-card"><span>Percentage</span><strong>${Number(result.percentage) || 0}%</strong></article><article class="score-card"><span>Correct</span><strong>${Number(result.correct) || 0}</strong></article><article class="score-card"><span>Wrong</span><strong>${Number(result.wrong) || 0}</strong></article><article class="score-card"><span>Unanswered</span><strong>${Number(result.unanswered) || 0}</strong></article><article class="score-card"><span>Status</span><strong>Submitted</strong></article></section><section><div class="section-heading"><div><p class="eyebrow">SUBJECT PERFORMANCE</p><h2>Breakdown</h2></div></div><div class="mock-result-subjects">${subjects}</div></section><div class="mock-result-actions"><a href="dashboard.html">Return to Dashboard</a></div></section>`;
    }

    async function startAttempt() {
        if (state.startBusy || state.selectedAdditionalSubjects.size !== 3) return;
        state.startBusy = true;
        renderSelection();
        showMessage("Starting your Mock…", "success");
        try {
            const attempt = await apiCall("startMock", {
                startIdempotencyKey: newUuid(),
                selectedSubjects: selectedSubjects()
            });
            if (!attempt?.attempt_id) throw new Error("The server did not return an attempt ID.");
            const url = new URL(window.location.href);
            url.searchParams.set("attempt", attempt.attempt_id);
            window.history.replaceState({}, "", url);
            if (attempt.status === "submitted") {
                await handleSubmittedAttempt(attempt);
                return;
            }
            setAttempt(attempt);
            renderExam();
            startClock();
        } catch (error) {
            state.startBusy = false;
            renderSelection();
            if (isPremiumDenial(error)) {
                openSubscriptionModal();
                showMessage("JAMB Mock requires an active Premium subscription. Upgrade to continue.", "error");
                return;
            }
            showMessage(error?.message || "Unable to start the Mock. Please try again.", "error");
        }
    }

    async function loadAttempt(attemptId) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptId)) {
            throw new Error("The attempt link is invalid.");
        }
        const attempt = await apiCall("resumeMock", attemptId);
        if (attempt.status === "submitted") {
            await handleSubmittedAttempt(attempt);
            return;
        }
        setAttempt(attempt);
        renderExam();
        startClock();
    }

    function updateAttemptFromSave(response) {
        if (response.attempt?.status === "submitted") {
            return handleSubmittedAttempt(response.attempt);
        }
        if (response.attempt) {
            const priorReviewPositions = state.reviewPositions;
            state.attempt = validateAttempt(response.attempt);
            state.reviewPositions = priorReviewPositions;
        }
        renderExam();
        if (!response.accepted) showMessage("The answer was not saved. The server attempt state was refreshed.", "error");
    }

    async function saveAnswer(choice) {
        if (!state.attempt || state.answerSaving || state.deadlinePending || state.attempt.status !== "in_progress") return;
        const question = currentQuestion();
        if (!question) return;
        state.answerSaving = true;
        renderExam();
        try {
            const response = await apiCall("saveMockAnswer", {
                attemptId: state.attempt.attempt_id,
                position: question.position,
                choice,
                requestId: newUuid(),
                expectedRevision: question.answer_revision
            });
            state.answerSaving = false;
            await updateAttemptFromSave(response);
        } catch (error) {
            state.answerSaving = false;
            renderExam();
            showMessage(error?.message || "Answer could not be saved. Your server state is unchanged.", "error");
        }
    }

    async function submitAttempt() {
        if (!state.attempt || state.submitBusy || state.answerSaving || state.deadlinePending) return;
        const unanswered = state.attempt.questions.filter((question) => question.selected_answer === null).length;
        const message = unanswered
            ? `You have ${unanswered} unanswered questions. Submit the Mock?`
            : "Submit your Mock now?";
        if (!window.confirm(message)) return;

        state.submitBusy = true;
        renderExam();
        try {
            const attempt = await apiCall("submitMock", state.attempt.attempt_id);
            if (attempt.status !== "submitted") throw new Error("The server has not finalized this attempt yet.");
            await showFinalResult(attempt.attempt_id);
        } catch (error) {
            state.submitBusy = false;
            renderExam();
            showMessage(error?.message || "Submission could not be confirmed. Please retry.", "error");
        }
    }

    async function pollDeadline() {
        stopClock();
        state.deadlinePending = true;
        renderExam();
        try {
            const attempt = await apiCall("resumeMock", state.attempt.attempt_id);
            if (attempt.status === "submitted") {
                await handleSubmittedAttempt(attempt);
                return;
            }
            setAttempt(attempt);
            const deadline = Date.parse(attempt.expires_at);
            if (Number.isFinite(deadline) && deadline > Date.now()) {
                state.deadlinePending = false;
                renderExam();
                startClock();
                return;
            }
        } catch (error) {
            showMessage(error?.message || "Checking the server deadline…", "error");
        }
        state.deadlinePending = true;
        renderExam();
        state.deadlinePoll = window.setTimeout(pollDeadline, 2500);
    }

    async function syncFromServer() {
        if (!state.attempt || state.attempt.status !== "in_progress" || state.answerSaving || state.submitBusy) return;
        try {
            const attempt = await apiCall("resumeMock", state.attempt.attempt_id);
            if (attempt.status === "submitted") {
                await handleSubmittedAttempt(attempt);
                return;
            }
            const savedReviewPositions = state.reviewPositions;
            setAttempt(attempt);
            state.reviewPositions = savedReviewPositions;
            renderExam();
            startClock();
        } catch (error) {
            showMessage(error?.message || "Unable to sync this attempt.", "error");
        }
    }

    app.addEventListener("change", (event) => {
        const checkbox = event.target.closest('input[name="mock-subject"]');
        if (!checkbox || state.startBusy) return;
        if (checkbox.checked) {
            if (state.selectedAdditionalSubjects.size >= 3) {
                checkbox.checked = false;
                showMessage("Select exactly three additional subjects.", "error");
                return;
            }
            state.selectedAdditionalSubjects.add(checkbox.value);
        } else {
            state.selectedAdditionalSubjects.delete(checkbox.value);
        }
        updateSelectionCount();
        showMessage(state.selectedAdditionalSubjects.size === 3
            ? "Subject count complete. The server validates the allowed combination when you start."
            : "English is compulsory; select three additional subjects.");
    });

    app.addEventListener("click", async (event) => {
        const target = event.target.closest("button");
        if (!target) return;
        if (target.id === "mockStart") return startAttempt();
        if (target.dataset.choice) return saveAnswer(target.dataset.choice);
        if (target.dataset.position) {
            const position = Number(target.dataset.position);
            if (Number.isInteger(position)) {
                state.activePosition = position;
                renderExam();
            }
            return;
        }
        if (target.dataset.subjectFilter) {
            state.activeSubject = target.dataset.subjectFilter;
            const visible = visibleQuestions();
            if (!visible.some((question) => question.position === state.activePosition)) {
                state.activePosition = visible[0]?.position || 1;
            }
            renderExam();
            return;
        }
        if (target.hasAttribute("data-review-toggle")) {
            const position = state.activePosition;
            if (state.reviewPositions.has(position)) state.reviewPositions.delete(position);
            else state.reviewPositions.add(position);
            renderExam();
            return;
        }
        if (target.dataset.nav) {
            const visible = visibleQuestions();
            const currentIndex = visible.findIndex((question) => question.position === state.activePosition);
            const nextQuestion = visible[currentIndex + (target.dataset.nav === "next" ? 1 : -1)];
            if (nextQuestion) {
                state.activePosition = nextQuestion.position;
                renderExam();
            }
            return;
        }
        if (target.hasAttribute("data-submit") || target.id === "mockHeaderSubmit") {
            return submitAttempt();
        }
    });

    headerSubmit.addEventListener("click", submitAttempt);

    function openSubscriptionModal() {
        const modal = document.getElementById("subscriptionModal");
        if (!modal) return;
        modal.classList.add("show");
        modal.setAttribute("aria-hidden", "false");
    }

    function closeSubscriptionModal() {
        const modal = document.getElementById("subscriptionModal");
        if (!modal) return;
        modal.classList.remove("show");
        modal.setAttribute("aria-hidden", "true");
    }

    function initSubscriptionModal() {
        const modal = document.getElementById("subscriptionModal");
        const closeBtn = document.getElementById("mockSubscriptionModalClose");
        const cancelBtn = document.getElementById("mockSubscriptionModalSecondary");
        const pay30Btn = document.getElementById("mockPay30DaysBtn");
        const pay1YearBtn = document.getElementById("mockPay1YearBtn");

        if (closeBtn) closeBtn.addEventListener("click", closeSubscriptionModal);
        if (cancelBtn) cancelBtn.addEventListener("click", closeSubscriptionModal);
        if (modal) {
            modal.addEventListener("click", (event) => {
                if (event.target === modal) closeSubscriptionModal();
            });
        }
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && modal?.classList.contains("show")) {
                closeSubscriptionModal();
            }
        });

        if (pay30Btn) {
            pay30Btn.addEventListener("click", () => {
                if (typeof window.payFor30Days === "function") {
                    window.payFor30Days();
                } else if (typeof window.startPaystackPayment === "function") {
                    window.startPaystackPayment(1500, 30);
                } else {
                    window.location.href = "dashboard.html?upgrade=1&feature=mock";
                }
            });
        }

        if (pay1YearBtn) {
            pay1YearBtn.addEventListener("click", () => {
                if (typeof window.payFor1Year === "function") {
                    window.payFor1Year();
                } else if (typeof window.startPaystackPayment === "function") {
                    window.startPaystackPayment(4000, 365);
                } else {
                    window.location.href = "dashboard.html?upgrade=1&feature=mock";
                }
            });
        }

        window.showDashboard = async function () {
            closeSubscriptionModal();
            showMessage("Payment successful! Your Premium subscription is active. Click Start Mock to begin.", "success");
        };
    }

    async function init() {
        initSubscriptionModal();
        if (!window.supabaseClient || typeof window.supabaseClient.auth?.getSession !== "function") {
            app.innerHTML = `<section class="access-page"><div class="access-card mock-auth-card"><h1>Mock unavailable</h1><p>Authentication is not ready on this page.</p><a href="dashboard.html">Return to Dashboard</a></div></section>`;
            return;
        }
        try {
            const { data, error } = await window.supabaseClient.auth.getSession();
            if (error || !data?.session) {
                app.innerHTML = `<section class="access-page"><div class="access-card mock-auth-card"><p class="eyebrow">SIGN IN REQUIRED</p><h1>JAMB Mock</h1><p>Sign in to start or resume your Mock attempt.</p><a href="student.html">Go to Student Login</a></div></section>`;
                return;
            }
            const attemptId = new URLSearchParams(window.location.search).get("attempt");
            if (attemptId) {
                await loadAttempt(attemptId);
            } else {
                renderSelection();
            }
        } catch (error) {
            renderSelection();
            showMessage(error?.message || "Unable to load the Mock. Please try again online.", "error");
        }
    }

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && state.attempt?.status === "in_progress") syncFromServer();
    });

    init();
})();
