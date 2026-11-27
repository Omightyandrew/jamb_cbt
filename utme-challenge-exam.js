/**
 * ExamPilot UTME Challenge 2027 - Student Examination Interface
 * Phase 3 Implementation
 *
 * Implements:
 * 1. Pre-exam instructions and explicit start confirmation.
 * 2. Active examination interface (English compulsory + 3 electives, questions, palette, navigation).
 * 3. Authoritative timer loop derived from server-provided expires_at (no client drift/manipulation).
 * 4. Reliable autosave manager (max 20 answers/batch, monotonic client_seq, UUID request_id, retry queue).
 * 5. Manual submission with confirmation & duplicate prevention, and automatic submission at expiry.
 * 6. Result breakdown rendering using actual RPC response.
 * 7. In-progress attempt resume experience.
 *
 * ZERO question key or explanation leakage: operates strictly on sanitized attempt question payloads.
 */
(function () {
    'use strict';

    // Application State
    const state = {
        user: null,
        reg: null,
        round: null,
        attempt: null,
        questions: [], // Sorted by candidate_position
        activePosition: 1, // 1-based candidate_position
        activeSubject: 'All', // 'All' | subject name
        reviewPositions: new Set(),

        // Autosave Engine
        clientSequences: {}, // round_question_id -> client_seq integer
        dirtyQueue: new Map(), // round_question_id -> { round_question_id, choice, client_seq }
        inFlight: null, // { requestId, payload } or null
        retryRequestId: null, // Preserved UUID for identical retry
        retryPayload: null, // Preserved exact answer batch for identical retry
        retryTimer: null,
        saveStatus: 'saved', // 'saved' | 'saving' | 'failed'

        // Timer & Expiry
        clockInterval: null,
        remainingSeconds: 0,
        isExpired: false,

        // Submission
        submitting: false,
        submissionResult: null,

        // View Mode: null (Hub active) | 'instructions' | 'exam' | 'result'
        currentView: null
    };

    function getClient() {
        return window.supabaseClient;
    }

    function newUuid() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        if (window.crypto && window.crypto.getRandomValues) {
            const bytes = window.crypto.getRandomValues(new Uint8Array(16));
            bytes[6] = (bytes[6] & 0x0f) | 0x40;
            bytes[8] = (bytes[8] & 0x3f) | 0x80;
            const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
            return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function sanitizeText(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    function formatTime(totalSeconds) {
        const sec = Math.max(0, Math.floor(totalSeconds));
        const hours = Math.floor(sec / 3600);
        const minutes = Math.floor((sec % 3600) / 60);
        const seconds = sec % 60;
        if (hours > 0) {
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    // =========================================================================
    // 1. PUBLIC API ENTRY POINTS (CALLED FROM UTME-CHALLENGE-UI.JS)
    // =========================================================================

    function handleAction(action, round, reg, user) {
        state.round = round;
        state.reg = reg;
        state.user = user;

        if (action === 'start-exam') {
            openInstructions(round, reg);
        } else if (action === 'resume-exam') {
            launchAttempt(round.id, true);
        } else if (action === 'view-result') {
            launchAttempt(round.id, false);
        }
    }

    function openInstructions(round, reg) {
        state.round = round;
        state.reg = reg;
        state.currentView = 'instructions';
        renderInstructions();
    }

    function returnToHub() {
        stopTimer();
        if (state.retryTimer) {
            clearTimeout(state.retryTimer);
            state.retryTimer = null;
        }
        state.currentView = null;
        state.attempt = null;
        state.questions = [];
        state.submissionResult = null;
        state.dirtyQueue.clear();
        state.inFlight = null;
        state.retryRequestId = null;
        state.retryPayload = null;
        state.saveStatus = 'saved';

        // Trigger hub re-render in utme-challenge-ui.js
        if (window.utmeUI && typeof window.utmeUI.loadOverview === 'function') {
            window.utmeUI.loadOverview();
        } else {
            window.location.reload();
        }
    }

    // =========================================================================
    // 2. ATTEMPT START & RESUME ENGINE
    // =========================================================================

    async function launchAttempt(roundId, isResume) {
        const client = getClient();
        if (!client) {
            alert('Database connection unavailable. Please refresh.');
            return;
        }

        const root = document.getElementById('utmeApp');
        if (root) {
            root.innerHTML = `
                <div class="utme-card utme-empty-state">
                    <div class="utme-loading-spinner"></div>
                    <h3>${isResume ? 'Resuming Your Examination...' : 'Preparing Examination Paper...'}</h3>
                    <p>Securing your official 4-subject question paper snapshot and setting up countdown timer.</p>
                </div>
            `;
        }

        try {
            const { data, error } = await client.rpc('utme_challenge_start_attempt', {
                p_round_id: roundId
            });

            if (error) throw error;

            // Check if attempt is already completed/finalized
            if (data.already_completed || data.status === 'submitted' || data.status === 'expired') {
                state.attempt = data;
                state.submissionResult = data.result || data;
                state.currentView = 'result';
                renderResult();
                return;
            }

            // In-progress attempt (new or resumed)
            state.attempt = data;
            state.questions = Array.isArray(data.questions)
                ? [...data.questions].sort((a, b) => a.candidate_position - b.candidate_position)
                : [];

            // Initialize sequence map from server response
            state.clientSequences = {};
            state.questions.forEach(q => {
                state.clientSequences[q.round_question_id] = Number.isInteger(q.client_seq) ? q.client_seq : 0;
            });

            state.dirtyQueue.clear();
            state.inFlight = null;
            state.retryRequestId = null;
            state.retryPayload = null;
            if (state.retryTimer) {
                clearTimeout(state.retryTimer);
                state.retryTimer = null;
            }
            state.saveStatus = 'saved';
            state.activePosition = state.questions.length > 0 ? state.questions[0].candidate_position : 1;
            state.activeSubject = 'All';
            state.isExpired = false;
            state.currentView = 'exam';

            renderExam();
            startTimer();
        } catch (err) {
            console.error('Error starting UTME Challenge attempt:', err);
            let msg = err.message || 'Unable to start examination.';
            if (msg.includes('START_WINDOW_CLOSED')) {
                msg = 'The testing window for this round is closed.';
            } else if (msg.includes('ROUND_NOT_ACTIVE')) {
                msg = 'This round is not currently open for examination.';
            } else if (msg.includes('NOT_REGISTERED')) {
                msg = 'You must complete registration before taking this examination.';
            }

            alert(`Examination Launch Error: ${msg}`);
            returnToHub();
        }
    }

    // =========================================================================
    // 3. INSTRUCTIONS VIEW RENDERER
    // =========================================================================

    function renderInstructions() {
        const root = document.getElementById('utmeApp');
        if (!root || !state.round) return;

        const round = state.round;
        const reg = state.reg;
        const subjects = reg && Array.isArray(reg.selected_subjects) ? reg.selected_subjects : ['English'];
        const durationMins = round.duration_minutes || 60;

        let subjectPills = subjects.map(s => `
            <span class="utme-summary-pill">
                ${s === 'English' ? '🔒' : '✓'} ${sanitizeText(s)}
            </span>
        `).join('');

        root.innerHTML = `
            <div class="utme-card" id="utmeInstructionsCard" style="max-width: 820px; margin: 0 auto;">
                <div class="utme-card-header">
                    <div>
                        <div class="meta-label">UTME CHALLENGE 2027 · ROUND ${round.round_number}</div>
                        <h2 class="utme-card-title">${sanitizeText(round.title || 'Official Examination Round ' + round.round_number)}</h2>
                    </div>
                    <button type="button" class="utme-btn utme-btn-secondary utme-btn-sm" id="btnCancelInstructions">
                        ← Back to Hub
                    </button>
                </div>

                <div class="utme-candidate-banner" style="margin-bottom: 24px;">
                    <div class="utme-candidate-details">
                        <div class="utme-candidate-avatar">👤</div>
                        <div>
                            <h3 class="utme-candidate-name">${sanitizeText(reg?.display_name || 'Candidate')}</h3>
                            <p class="utme-candidate-meta">Subject Combination: <strong>${sanitizeText(reg?.combination_key || subjects.join(' | '))}</strong></p>
                        </div>
                    </div>
                    <span class="utme-pill utme-pill-green">Verified Combination</span>
                </div>

                <div class="utme-summary-tray" style="margin-bottom: 24px;">
                    <div class="utme-summary-title">Your 4 Examination Subjects</div>
                    <div class="utme-summary-pills">
                        ${subjectPills}
                    </div>
                </div>

                <div class="utme-rules-grid" style="margin-bottom: 28px;">
                    <div class="utme-rule-box">
                        <div class="utme-rule-icon">⏱️</div>
                        <h4>${durationMins} Minutes Duration</h4>
                        <p>The examination countdown begins the moment you click Start. The server records your exact expiry deadline.</p>
                    </div>
                    <div class="utme-rule-box">
                        <div class="utme-rule-icon">⚖️</div>
                        <h4>25% Equal Weight</h4>
                        <p>Use of English and your 3 electives contribute exactly 25% each to your final overall score.</p>
                    </div>
                    <div class="utme-rule-box">
                        <div class="utme-rule-icon">💾</div>
                        <h4>Continuous Autosave</h4>
                        <p>Your answers save to the database in real-time. If disconnected or refreshed, your saved answers are preserved.</p>
                    </div>
                    <div class="utme-rule-box">
                        <div class="utme-rule-icon">🔒</div>
                        <h4>Permanent Subject Lock</h4>
                        <p>Starting this examination permanently locks your 4-subject combination for the remainder of the season.</p>
                    </div>
                </div>

                <div class="utme-alert utme-alert-warning" style="margin-bottom: 24px;">
                    <div>
                        ⚠️ <strong>Important Examination Rules:</strong>
                        <ul style="margin: 8px 0 0 18px; padding: 0; font-size: 13px;">
                            <li>Do not use multiple browser tabs; your answers are synchronized continuously.</li>
                            <li>Refreshing the page will <strong>not</strong> pause or reset your examination timer.</li>
                            <li>When your timer runs out, the server will automatically finalize and grade your attempt.</li>
                        </ul>
                    </div>
                </div>

                <div style="background: #f8faf9; padding: 16px; border-radius: var(--utme-radius-md); border: 1px solid var(--utme-border); margin-bottom: 24px;">
                    <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer;">
                        <input type="checkbox" id="chkAgreeInstructions" style="width: 20px; height: 20px; margin-top: 2px; accent-color: var(--utme-green);">
                        <span style="font-size: 14px; font-weight: 600; color: var(--utme-text);">
                            I have read the instructions, confirmed my 4 subjects, and am ready to begin my timed examination attempt.
                        </span>
                    </label>
                </div>

                <div style="display: flex; gap: 14px; justify-content: flex-end;">
                    <button type="button" class="utme-btn utme-btn-secondary" id="btnCancelInstructionsBottom">
                        Cancel
                    </button>
                    <button type="button" class="utme-btn utme-btn-primary" id="btnConfirmStartExam" disabled>
                        🚀 Start Examination Now
                    </button>
                </div>
            </div>
        `;

        const chk = root.querySelector('#chkAgreeInstructions');
        const btnStart = root.querySelector('#btnConfirmStartExam');
        const btnCancelTop = root.querySelector('#btnCancelInstructions');
        const btnCancelBottom = root.querySelector('#btnCancelInstructionsBottom');

        if (chk && btnStart) {
            chk.addEventListener('change', () => {
                btnStart.disabled = !chk.checked;
            });

            btnStart.addEventListener('click', () => {
                btnStart.disabled = true;
                btnStart.textContent = 'Launching Examination...';
                launchAttempt(round.id, false);
            });
        }

        const handleCancel = () => returnToHub();
        if (btnCancelTop) btnCancelTop.addEventListener('click', handleCancel);
        if (btnCancelBottom) btnCancelBottom.addEventListener('click', handleCancel);
    }

    // =========================================================================
    // 4. EXAMINATION SCREEN RENDERER (CBT VIEW)
    // =========================================================================

    function currentQuestion() {
        return state.questions.find(q => q.candidate_position === state.activePosition) || state.questions[0];
    }

    function visibleQuestions() {
        if (state.activeSubject === 'All') return state.questions;
        return state.questions.filter(q => q.subject === state.activeSubject);
    }

    function subjectCounts() {
        const counts = new Map();
        state.questions.forEach(q => {
            if (!counts.has(q.subject)) {
                counts.set(q.subject, { total: 0, answered: 0 });
            }
            const s = counts.get(q.subject);
            s.total++;
            if (q.selected_option !== null && q.selected_option !== undefined) {
                s.answered++;
            }
        });
        return counts;
    }

    function renderExam() {
        const root = document.getElementById('utmeApp');
        if (!root || !state.attempt || state.questions.length === 0) return;

        const q = currentQuestion();
        const totalQ = state.questions.length;
        const totalAnswered = state.questions.filter(item => item.selected_option != null).length;
        const totalUnanswered = totalQ - totalAnswered;
        const pctAnswered = Math.round((totalAnswered / totalQ) * 100);

        const subCounts = subjectCounts();

        // Subject filter tabs
        let filterTabsHtml = `
            <button type="button" class="utme-sub-tab ${state.activeSubject === 'All' ? 'active' : ''}" data-subject-filter="All">
                All Subjects (${totalAnswered}/${totalQ})
            </button>
        `;
        subCounts.forEach((val, subName) => {
            const isActive = state.activeSubject === subName;
            filterTabsHtml += `
                <button type="button" class="utme-sub-tab ${isActive ? 'active' : ''}" data-subject-filter="${sanitizeText(subName)}">
                    ${sanitizeText(subName)} (${val.answered}/${val.total})
                </button>
            `;
        });

        // Question Palette
        const visQuestions = visibleQuestions();
        let paletteHtml = visQuestions.map(item => {
            const isCurr = item.candidate_position === state.activePosition;
            const isAns = item.selected_option != null;
            const isRev = state.reviewPositions.has(item.candidate_position);

            let classes = 'utme-palette-btn';
            if (isCurr) classes += ' current';
            if (isAns) classes += ' answered';
            if (isRev) classes += ' is-review';

            return `
                <button type="button"
                        class="${classes}"
                        data-target-pos="${item.candidate_position}"
                        title="Question ${item.candidate_position} (${sanitizeText(item.subject)})">
                    ${item.candidate_position}
                </button>
            `;
        }).join('');

        // Options A-D
        const options = Array.isArray(q.options) ? q.options : [];
        let optionsHtml = options.map((optText, idx) => {
            const letter = String.fromCharCode(65 + idx);
            const isSelected = q.selected_option === letter;
            return `
                <button type="button"
                        class="utme-option-btn ${isSelected ? 'selected' : ''}"
                        data-choice="${letter}"
                        ${state.submitting || state.isExpired ? 'disabled' : ''}>
                    <span class="utme-option-letter">${letter}</span>
                    <span class="utme-option-text">${sanitizeText(optText)}</span>
                    <span class="utme-option-check">${isSelected ? '✓' : ''}</span>
                </button>
            `;
        }).join('');

        const isFirst = state.activePosition === 1;
        const isLast = state.activePosition === totalQ;
        const isMarkedReview = state.reviewPositions.has(q.candidate_position);

        let autosavePillHtml = '';
        if (state.saveStatus === 'saving') {
            autosavePillHtml = '<span class="utme-save-status utme-save-saving">⏳ Saving...</span>';
        } else if (state.saveStatus === 'failed') {
            autosavePillHtml = '<span class="utme-save-status utme-save-failed">⚠️ Retrying save...</span>';
        } else {
            autosavePillHtml = '<span class="utme-save-status utme-save-success">✓ Saved</span>';
        }

        root.innerHTML = `
            <div class="utme-cbt-container">
                <!-- Top CBT Sticky Header -->
                <div class="utme-cbt-header">
                    <div class="utme-cbt-brand">
                        <span class="utme-brand-sub">Round ${state.round?.round_number || 1}</span>
                        <h3 class="utme-cbt-title">${sanitizeText(state.round?.title || 'UTME Challenge 2027')}</h3>
                    </div>

                    <div class="utme-cbt-header-controls">
                        <div class="utme-cbt-status-tray">
                            ${autosavePillHtml}
                        </div>

                        <div class="utme-cbt-timer-box ${state.remainingSeconds <= 300 ? 'danger-pulse' : ''}" id="utmeTimerBox">
                            <span class="timer-dot"></span>
                            <span id="utmeTimerText">${formatTime(state.remainingSeconds)}</span>
                        </div>

                        <button type="button" class="utme-btn utme-btn-danger utme-btn-sm" id="btnHeaderSubmitExam">
                            Submit Exam
                        </button>
                    </div>
                </div>

                <!-- Subject Tabs -->
                <div class="utme-sub-tabs-bar">
                    ${filterTabsHtml}
                </div>

                <!-- Progress Track -->
                <div class="utme-cbt-progress-wrapper">
                    <div class="utme-progress-track">
                        <div class="utme-progress-fill" style="width: ${pctAnswered}%;"></div>
                    </div>
                    <div class="utme-progress-stats">
                        <span>${totalAnswered} answered · ${totalUnanswered} unanswered</span>
                        <span>${pctAnswered}% complete</span>
                    </div>
                </div>

                ${state.isExpired ? `
                    <div class="utme-alert utme-alert-danger" style="margin-bottom: 16px;">
                        <div>⏰ <strong>Examination Time Expired:</strong> Finalizing and submitting your examination answers to the server. Please wait...</div>
                    </div>
                ` : ''}

                <!-- CBT Layout Body -->
                <div class="utme-cbt-body">
                    <!-- Main Question Panel -->
                    <main class="utme-cbt-main">
                        <div class="utme-card utme-question-card">
                            <div class="utme-question-meta">
                                <div>
                                    <div class="meta-label">CURRENT QUESTION</div>
                                    <div class="utme-question-idx">Question ${q.candidate_position} <span style="font-weight: 500; font-size: 14px; color: var(--utme-muted);">of ${totalQ}</span></div>
                                </div>
                                <span class="utme-pill utme-pill-green">${sanitizeText(q.subject)}</span>
                            </div>

                            <div class="utme-question-text" id="utmeQuestionText">
                                ${sanitizeText(q.question_text)}
                            </div>

                            <div class="utme-options-list">
                                ${optionsHtml}
                            </div>

                            <div class="utme-card-actions">
                                <button type="button" class="utme-btn utme-btn-secondary" id="btnPrevQ" ${isFirst ? 'disabled' : ''}>
                                    ← Previous
                                </button>
                                <div style="display: flex; gap: 8px;">
                                    <button type="button" class="utme-btn ${isMarkedReview ? 'utme-btn-gold' : 'utme-btn-secondary'}" id="btnToggleReview">
                                        ${isMarkedReview ? '★ Marked for Review' : '☆ Mark for Review'}
                                    </button>
                                    <button type="button" class="utme-btn utme-btn-primary" id="btnNextQ" ${isLast ? 'disabled' : ''}>
                                        Next →
                                    </button>
                                </div>
                            </div>
                        </div>
                    </main>

                    <!-- Sidebar Question Map -->
                    <aside class="utme-cbt-sidebar">
                        <div class="utme-card utme-sidebar-card">
                            <div class="utme-sidebar-header">
                                <div>
                                    <div class="meta-label">QUESTION PALETTE</div>
                                    <h4 style="margin: 0; font-size: 15px;">Navigate</h4>
                                </div>
                                <span class="utme-pill utme-pill-muted">${visQuestions.length} Shown</span>
                            </div>

                            <div class="utme-palette-legend">
                                <span><i class="legend-dot answered"></i> Answered</span>
                                <span><i class="legend-dot review"></i> Review</span>
                                <span><i class="legend-dot unanswered"></i> Unanswered</span>
                            </div>

                            <div class="utme-palette-grid">
                                ${paletteHtml}
                            </div>

                            <div style="margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--utme-border);">
                                <button type="button" class="utme-btn utme-btn-danger utme-btn-full" id="btnSidebarSubmitExam">
                                    Submit Examination
                                </button>
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
        `;

        attachExamEventHandlers(root);
    }

    function attachExamEventHandlers(root) {
        // Subject Filter Tabs
        const subTabs = root.querySelectorAll('[data-subject-filter]');
        subTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const sub = tab.getAttribute('data-subject-filter');
                if (sub) {
                    state.activeSubject = sub;
                    // If current question not in filtered subject, jump to first question in that subject
                    const vis = visibleQuestions();
                    if (vis.length > 0 && !vis.some(q => q.candidate_position === state.activePosition)) {
                        state.activePosition = vis[0].candidate_position;
                    }
                    renderExam();
                }
            });
        });

        // Option selection
        const optionBtns = root.querySelectorAll('.utme-option-btn');
        optionBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const choice = btn.getAttribute('data-choice');
                const q = currentQuestion();
                if (q && choice && !state.submitting && !state.isExpired) {
                    selectAnswer(q.round_question_id, choice);
                }
            });
        });

        // Previous / Next Buttons
        const btnPrev = root.querySelector('#btnPrevQ');
        if (btnPrev) {
            btnPrev.addEventListener('click', () => {
                if (state.activePosition > 1) {
                    state.activePosition--;
                    renderExam();
                }
            });
        }

        const btnNext = root.querySelector('#btnNextQ');
        if (btnNext) {
            btnNext.addEventListener('click', () => {
                if (state.activePosition < state.questions.length) {
                    state.activePosition++;
                    renderExam();
                }
            });
        }

        // Toggle Review Button
        const btnReview = root.querySelector('#btnToggleReview');
        if (btnReview) {
            btnReview.addEventListener('click', () => {
                const pos = state.activePosition;
                if (state.reviewPositions.has(pos)) {
                    state.reviewPositions.delete(pos);
                } else {
                    state.reviewPositions.add(pos);
                }
                renderExam();
            });
        }

        // Palette Button navigation
        const palBtns = root.querySelectorAll('[data-target-pos]');
        palBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const pos = parseInt(btn.getAttribute('data-target-pos'), 10);
                if (Number.isInteger(pos) && pos >= 1 && pos <= state.questions.length) {
                    state.activePosition = pos;
                    renderExam();
                }
            });
        });

        // Submit Buttons
        const handleSubmitClick = () => showSubmitConfirmation();
        const btnHeaderSub = root.querySelector('#btnHeaderSubmitExam');
        const btnSidebarSub = root.querySelector('#btnSidebarSubmitExam');
        if (btnHeaderSub) btnHeaderSub.addEventListener('click', handleSubmitClick);
        if (btnSidebarSub) btnSidebarSub.addEventListener('click', handleSubmitClick);
    }

    // =========================================================================
    // 5. AUTOSAVE ENGINE (MAX 20 BATCH, MONOTONIC SEQ, UUID IDEMPOTENCY)
    // =========================================================================

    function selectAnswer(roundQuestionId, choice) {
        const q = state.questions.find(item => item.round_question_id === roundQuestionId);
        if (!q) return;

        // Advance client_seq monotonically
        const nextSeq = (state.clientSequences[roundQuestionId] || 0) + 1;
        state.clientSequences[roundQuestionId] = nextSeq;

        // Update local object immediately
        q.selected_option = choice;
        q.client_seq = nextSeq;

        // Enqueue dirty answer
        state.dirtyQueue.set(roundQuestionId, {
            round_question_id: roundQuestionId,
            choice: choice,
            client_seq: nextSeq
        });

        // Re-render UI immediately for zero input latency
        renderExam();

        // Dispatch autosave
        dispatchAutosave();
    }

    async function dispatchAutosave() {
        if (!state.attempt || state.attempt.status !== 'in_progress') return;

        // If an RPC request is already in-flight, it will chain upon completion
        if (state.inFlight) return;

        // If a retry backoff timer is active, wait for backoff unless flushed
        if (state.retryTimer) return;

        // If no retry payload and dirtyQueue is empty, everything is saved
        if ((!state.retryPayload || state.retryPayload.length === 0) && state.dirtyQueue.size === 0) {
            state.saveStatus = 'saved';
            updateAutosavePill();
            return;
        }

        let batch;
        let requestId;

        if (state.retryPayload && state.retryPayload.length > 0) {
            // Reuse identical request ID and exact unchanged payload from previous failure
            batch = state.retryPayload;
            requestId = state.retryRequestId;
            state.retryPayload = null;
            state.retryRequestId = null;
        } else {
            // Prepare bounded batch of up to 20 items from dirtyQueue
            batch = Array.from(state.dirtyQueue.values()).slice(0, 20);
            requestId = newUuid();
        }

        state.inFlight = { requestId, payload: batch };
        state.saveStatus = 'saving';
        updateAutosavePill();

        const client = getClient();
        if (!client) {
            handleSaveFailure(requestId, batch, new Error('Client unavailable'));
            return;
        }

        try {
            const { data, error } = await client.rpc('utme_challenge_save_answers', {
                p_attempt_id: state.attempt.attempt_id,
                p_request_id: requestId,
                p_answers: batch
            });

            if (error) throw error;

            // Commit saved items
            batch.forEach(item => {
                const currentDirty = state.dirtyQueue.get(item.round_question_id);
                // If candidate did not click a newer choice while in-flight, remove from dirty map
                if (currentDirty && currentDirty.client_seq === item.client_seq) {
                    state.dirtyQueue.delete(item.round_question_id);
                }
            });

            state.inFlight = null;
            state.saveStatus = (state.dirtyQueue.size > 0 || state.retryPayload) ? 'saving' : 'saved';
            updateAutosavePill();

            // If more items remain in queue or retry pending, dispatch immediately
            if (state.dirtyQueue.size > 0 || state.retryPayload) {
                dispatchAutosave();
            }
        } catch (err) {
            handleSaveFailure(requestId, batch, err);
        }
    }

    function handleSaveFailure(requestId, batch, err) {
        console.warn('Autosave encountered network/server error; preserving requestId and payload for retry:', err);
        // Preserve request_id and exact payload for identical idempotent retry
        state.retryRequestId = requestId;
        state.retryPayload = batch;
        state.inFlight = null;
        state.saveStatus = 'failed';
        updateAutosavePill();

        if (state.retryTimer) clearTimeout(state.retryTimer);
        state.retryTimer = setTimeout(() => {
            state.retryTimer = null;
            dispatchAutosave();
        }, 2500);
    }

    function updateAutosavePill() {
        const tray = document.querySelector('.utme-cbt-status-tray');
        if (!tray) return;

        if (state.saveStatus === 'saving') {
            tray.innerHTML = '<span class="utme-save-status utme-save-saving">⏳ Saving...</span>';
        } else if (state.saveStatus === 'failed') {
            tray.innerHTML = '<span class="utme-save-status utme-save-failed">⚠️ Retrying save...</span>';
        } else {
            tray.innerHTML = '<span class="utme-save-status utme-save-success">✓ Saved</span>';
        }
    }

    // Flush pending autosaves before submitting
    async function flushPendingAutosaves() {
        let retries = 0;
        while ((state.dirtyQueue.size > 0 || state.inFlight || state.retryPayload) && retries < 4) {
            if (state.retryTimer) {
                clearTimeout(state.retryTimer);
                state.retryTimer = null;
            }
            await dispatchAutosave();
            await new Promise(r => setTimeout(r, 400));
            retries++;
        }
    }

    // =========================================================================
    // 6. COUNTDOWN TIMER & EXPIRY ENGINE (DERIVED FROM EXPIRES_AT)
    // =========================================================================

    function startTimer() {
        stopTimer();

        const tick = () => {
            if (!state.attempt || !state.attempt.expires_at) return;

            const deadlineMs = Date.parse(state.attempt.expires_at);
            if (!Number.isFinite(deadlineMs)) return;

            state.remainingSeconds = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));

            const timerText = document.getElementById('utmeTimerText');
            const timerBox = document.getElementById('utmeTimerBox');
            if (timerText) timerText.textContent = formatTime(state.remainingSeconds);
            if (timerBox) {
                if (state.remainingSeconds <= 300) {
                    timerBox.classList.add('danger-pulse');
                } else {
                    timerBox.classList.remove('danger-pulse');
                }
            }

            // Expiry boundary reached
            if (state.remainingSeconds <= 0 && !state.isExpired) {
                state.isExpired = true;
                stopTimer();
                handleAutoExpiry();
            }
        };

        tick();
        state.clockInterval = setInterval(tick, 1000);
    }

    function stopTimer() {
        if (state.clockInterval) {
            clearInterval(state.clockInterval);
            state.clockInterval = null;
        }
    }

    function handleAutoExpiry() {
        renderExam();
        // Execute automatic submission
        executeSubmission(true);
    }

    // =========================================================================
    // 7. SUBMISSION ENGINE & RESULT SCREEN
    // =========================================================================

    function showSubmitConfirmation() {
        if (state.submitting || state.isExpired) return;

        const totalQ = state.questions.length;
        const answered = state.questions.filter(q => q.selected_option != null).length;
        const unanswered = totalQ - answered;

        const modalDiv = document.createElement('div');
        modalDiv.className = 'utme-modal-backdrop';
        modalDiv.id = 'utmeSubmitModal';
        modalDiv.innerHTML = `
            <div class="utme-modal" role="dialog" aria-modal="true">
                <div class="utme-modal-head">
                    <h3>Confirm Examination Submission</h3>
                </div>

                <div style="margin: 18px 0;">
                    <p style="margin: 0 0 12px; font-size: 15px; color: var(--utme-text);">
                        You have answered <strong>${answered} of ${totalQ}</strong> questions.
                    </p>
                    ${unanswered > 0 ? `
                        <div class="utme-alert utme-alert-warning" style="margin-bottom: 12px;">
                            <div>⚠️ You have <strong>${unanswered} unanswered question${unanswered === 1 ? '' : 's'}</strong>. Once submitted, you cannot resume or change any answers.</div>
                        </div>
                    ` : `
                        <div class="utme-alert utme-alert-info" style="margin-bottom: 12px;">
                            <div>✓ All ${totalQ} questions answered! Ready for scoring.</div>
                        </div>
                    `}
                    <p style="font-size: 13px; color: var(--utme-muted); margin: 0;">
                        Are you sure you want to finalize and submit your examination?
                    </p>
                </div>

                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button type="button" class="utme-btn utme-btn-secondary" id="btnCancelSubmitModal">
                        Return to Questions
                    </button>
                    <button type="button" class="utme-btn utme-btn-danger" id="btnConfirmSubmitModal">
                        Yes, Submit My Examination
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modalDiv);

        const btnCancel = modalDiv.querySelector('#btnCancelSubmitModal');
        const btnConfirm = modalDiv.querySelector('#btnConfirmSubmitModal');

        btnCancel.addEventListener('click', () => {
            modalDiv.remove();
        });

        btnConfirm.addEventListener('click', () => {
            btnConfirm.disabled = true;
            btnConfirm.textContent = 'Submitting...';
            modalDiv.remove();
            executeSubmission(false);
        });
    }

    async function executeSubmission(isAutoExpiry) {
        if (state.submitting) return;
        state.submitting = true;
        stopTimer();

        const root = document.getElementById('utmeApp');
        if (root) {
            root.innerHTML = `
                <div class="utme-card utme-empty-state">
                    <div class="utme-loading-spinner"></div>
                    <h3>${isAutoExpiry ? 'Time Expired · Finalizing Examination...' : 'Submitting Your Examination...'}</h3>
                    <p>Flushing pending answers, calculating official psychometric scores, and storing results.</p>
                </div>
            `;
        }

        const client = getClient();
        if (!client) {
            alert('Supabase client unavailable. Please refresh.');
            state.submitting = false;
            return;
        }

        try {
            // Flush any pending autosaves before submitting
            await flushPendingAutosaves();

            const { data, error } = await client.rpc('utme_challenge_submit_attempt', {
                p_attempt_id: state.attempt.attempt_id
            });

            if (error) throw error;

            state.submitting = false;
            state.submissionResult = data;
            state.currentView = 'result';
            renderResult();
        } catch (err) {
            console.error('Error submitting UTME Challenge attempt:', err);
            state.submitting = false;
            alert(`Submission Error: ${err.message || 'Please retry submitting your examination.'}`);
            renderExam();
        }
    }

    // =========================================================================
    // 8. RESULT BREAKDOWN SCREEN
    // =========================================================================

    function renderResult() {
        const root = document.getElementById('utmeApp');
        if (!root || !state.submissionResult) return;

        const res = state.submissionResult;
        const status = res.status || 'submitted';
        const pct = res.percentage != null ? res.percentage : 0;
        const engPct = res.english_percentage != null ? res.english_percentage : 0;
        const totalCorrect = res.total_correct != null ? res.total_correct : 0;
        const rawScore = res.raw_score != null ? res.raw_score : totalCorrect;
        const breakdown = res.subject_breakdown || {};

        let breakdownHtml = '';
        Object.entries(breakdown).forEach(([subjName, s]) => {
            const correct = s.correct != null ? s.correct : 0;
            const total = s.total != null ? s.total : 0;
            const sPct = s.percentage != null ? s.percentage : 0;

            breakdownHtml += `
                <div class="utme-subject-score-card">
                    <div class="utme-sub-score-top">
                        <span class="utme-sub-score-name">${subjName === 'English' ? '📖 ' : ''}${sanitizeText(subjName)}</span>
                        <strong class="utme-sub-score-pct">${sPct}%</strong>
                    </div>
                    <div class="utme-sub-score-meta">
                        ${correct} correct out of ${total} questions
                    </div>
                    <div class="utme-progress-track" style="margin-top: 8px;">
                        <div class="utme-progress-fill" style="width: ${Math.min(100, sPct)}%;"></div>
                    </div>
                </div>
            `;
        });

        root.innerHTML = `
            <div class="utme-card" id="utmeResultCard" style="max-width: 820px; margin: 0 auto;">
                <div class="utme-result-hero">
                    <div class="utme-result-icon">
                        ${status === 'expired' ? '⚠️' : '🎉'}
                    </div>
                    <h2 class="utme-result-title">
                        ${status === 'expired' ? 'Examination Finalized (Time Expired)' : 'Examination Successfully Completed!'}
                    </h2>
                    <p class="utme-result-subtitle">
                        Your examination attempt for Round ${state.round?.round_number || ''} has been recorded and scored against official snapshots.
                    </p>
                </div>

                <div class="utme-score-grid">
                    <div class="utme-score-stat-box primary">
                        <span class="stat-label">OVERALL PERCENTAGE</span>
                        <strong class="stat-value">${pct}%</strong>
                        <span class="stat-hint">Unweighted 4-subject average (25% each)</span>
                    </div>

                    <div class="utme-score-stat-box">
                        <span class="stat-label">USE OF ENGLISH</span>
                        <strong class="stat-value">${engPct}%</strong>
                        <span class="stat-hint">Compulsory subject score</span>
                    </div>

                    <div class="utme-score-stat-box">
                        <span class="stat-label">TOTAL CORRECT</span>
                        <strong class="stat-value">${totalCorrect}</strong>
                        <span class="stat-hint">Raw questions answered correctly</span>
                    </div>

                    <div class="utme-score-stat-box">
                        <span class="stat-label">SUBMISSION STATUS</span>
                        <strong class="stat-value" style="text-transform: capitalize; font-size: 20px;">
                            ${status === 'expired' ? 'Expired' : 'Submitted'}
                        </strong>
                        <span class="stat-hint">${res.submitted_at ? new Date(res.submitted_at).toLocaleTimeString() : 'Recorded'}</span>
                    </div>
                </div>

                <div style="margin: 28px 0 20px;">
                    <h3 style="margin: 0 0 14px; font-size: 16px; font-weight: 800;">Subject-by-Subject Performance</h3>
                    <div class="utme-subjects-score-grid">
                        ${breakdownHtml}
                    </div>
                </div>

                <div class="utme-alert utme-alert-info" style="margin-bottom: 24px;">
                    <div>
                        🏆 <strong>Leaderboard Publication:</strong> Official nationwide rankings and shared ranks are published as soon as this round testing window closes and finalization completes. Check back on the hub to view your rank!
                    </div>
                </div>

                <div style="display: flex; justify-content: center; gap: 12px; flex-wrap: wrap;">
                    <button type="button" class="utme-btn utme-btn-secondary" id="btnReturnToHub">
                        ← Return to UTME Challenge Hub
                    </button>
                    <button type="button" class="utme-btn utme-btn-primary" id="btnViewLeaderboardFromResult">
                        🏆 View Round Leaderboard &amp; Stats
                    </button>
                </div>
            </div>
        `;

        const btnReturn = root.querySelector('#btnReturnToHub');
        if (btnReturn) {
            btnReturn.addEventListener('click', () => {
                returnToHub();
            });
        }

        const btnViewLdb = root.querySelector('#btnViewLeaderboardFromResult');
        if (btnViewLdb) {
            btnViewLdb.addEventListener('click', () => {
                stopTimer();
                if (window.utmeLeaderboard && typeof window.utmeLeaderboard.openLeaderboard === 'function') {
                    window.utmeLeaderboard.openLeaderboard(state.round, state.reg, state.user);
                } else {
                    returnToHub();
                }
            });
        }
    }

    // =========================================================================
    // 9. EXPORT GLOBAL NAMESPACE
    // =========================================================================

    window.utmeExam = {
        state,
        handleAction,
        openInstructions,
        launchAttempt,
        selectAnswer,
        dispatchAutosave,
        flushPendingAutosaves,
        startTimer,
        stopTimer,
        formatTime,
        newUuid,
        returnToHub,
        showSubmitConfirmation,
        executeSubmission
    };

})();
