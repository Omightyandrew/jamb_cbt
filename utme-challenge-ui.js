/**
 * ExamPilot UTME Challenge 2027 - Student Hub & Registration UI
 * Milestone 2 Implementation
 */
(function () {
    'use strict';

    // 13 accredited UTME Challenge subjects (English compulsory)
    const ACCREDITED_SUBJECTS = [
        { name: 'English', compulsory: true, icon: '📖' },
        { name: 'Mathematics', compulsory: false, icon: '📐' },
        { name: 'Physics', compulsory: false, icon: '⚡' },
        { name: 'Chemistry', compulsory: false, icon: '🧪' },
        { name: 'Biology', compulsory: false, icon: '🧬' },
        { name: 'Economics', compulsory: false, icon: '📊' },
        { name: 'Government', compulsory: false, icon: '🏛️' },
        { name: 'Literature in English', compulsory: false, icon: '🎭' },
        { name: 'Commerce', compulsory: false, icon: '💼' },
        { name: 'Accounting', compulsory: false, icon: '📈' },
        { name: 'Geography', compulsory: false, icon: '🌍' },
        { name: 'CRS', compulsory: false, icon: '✝️' },
        { name: 'History', compulsory: false, icon: '📜' }
    ];

    // Reactive State
    const state = {
        loading: true,
        session: null,
        user: null,
        overview: null,
        error: null,
        // Registration Form State
        displayName: '',
        selectedSubjects: ['English'], // English is always locked and selected
        isEditing: false,
        submitting: false,
        feedbackMessage: null,
        feedbackType: 'info' // 'info', 'warning', 'success', 'danger'
    };

    function getClient() {
        return window.supabaseClient;
    }

    function sanitizeText(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    function formatDate(isoString) {
        if (!isoString) return 'Not set';
        try {
            const d = new Date(isoString);
            if (isNaN(d.getTime())) return 'Not set';
            return d.toLocaleString('en-NG', {
                dateStyle: 'medium',
                timeStyle: 'short'
            });
        } catch (e) {
            return String(isoString);
        }
    }

    // Initialize application
    async function init() {
        const root = document.getElementById('utmeApp');
        if (!root) {
            console.error('UTME Challenge UI: Root container #utmeApp not found.');
            return;
        }

        render();

        const client = getClient();
        if (!client) {
            state.loading = false;
            state.error = 'Supabase client is not initialized. Please refresh the page.';
            render();
            return;
        }

        try {
            const { data, error } = await client.auth.getSession();
            if (error) throw error;

            state.session = data.session;
            state.user = data.session ? data.session.user : null;

            if (state.user) {
                // Pre-fill display name from user metadata if available
                const metaName = state.user.user_metadata?.full_name ||
                    state.user.user_metadata?.name ||
                    state.user.user_metadata?.display_name ||
                    (state.user.email ? state.user.email.split('@')[0] : '');
                if (metaName && !state.displayName) {
                    state.displayName = metaName.slice(0, 30);
                }
                await loadOverview();
            } else {
                state.loading = false;
                render();
            }
        } catch (err) {
            console.error('Error initializing UTME Challenge:', err);
            state.loading = false;
            state.error = err.message || 'Failed to authenticate session.';
            render();
        }
    }

    // Load Overview Data from Supabase RPC
    async function loadOverview() {
        const client = getClient();
        if (!client) return;

        state.loading = true;
        state.error = null;
        render();

        try {
            const { data, error } = await client.rpc('utme_challenge_get_overview');
            if (error) throw error;

            state.overview = data;

            // Sync registration state if student already has a registered combination
            if (data.registration) {
                state.displayName = data.registration.display_name || state.displayName;
                if (Array.isArray(data.registration.selected_subjects) && data.registration.selected_subjects.length > 0) {
                    state.selectedSubjects = [...data.registration.selected_subjects];
                    // Ensure English is present
                    if (!state.selectedSubjects.includes('English')) {
                        state.selectedSubjects.unshift('English');
                    }
                }
            }

            state.loading = false;
            render();
        } catch (err) {
            console.error('Error loading UTME Challenge overview:', err);
            state.loading = false;
            state.error = err.message || 'Failed to load challenge details.';
            render();
        }
    }

    // Handle Subject Selection Toggle
    function toggleSubject(subjectName) {
        if (subjectName === 'English') return; // English is compulsory and locked

        const index = state.selectedSubjects.indexOf(subjectName);
        if (index > -1) {
            // Deselect
            state.selectedSubjects.splice(index, 1);
            state.feedbackMessage = null;
        } else {
            // Check if limit of 4 is already reached
            if (state.selectedSubjects.length >= 4) {
                setFeedback('You have already selected 4 subjects. Deselect an elective first to choose another.', 'warning');
                render();
                return;
            }
            state.selectedSubjects.push(subjectName);
            state.feedbackMessage = null;
        }
        render();
    }

    function setFeedback(msg, type) {
        state.feedbackMessage = msg;
        state.feedbackType = type || 'info';
    }

    // Submit Registration via Supabase RPC
    async function submitRegistration(e) {
        if (e) e.preventDefault();

        const client = getClient();
        if (!client || !state.user) {
            setFeedback('Authentication required. Please sign in.', 'danger');
            render();
            return;
        }

        const cleanName = (state.displayName || '').trim();
        if (cleanName.length < 2 || cleanName.length > 30) {
            setFeedback('Display name must be between 2 and 30 characters.', 'warning');
            render();
            return;
        }

        if (state.selectedSubjects.length !== 4) {
            setFeedback('Please select exactly 4 subjects (English + 3 electives).', 'warning');
            render();
            return;
        }

        if (!state.selectedSubjects.includes('English')) {
            setFeedback('Use of English is compulsory.', 'warning');
            render();
            return;
        }

        state.submitting = true;
        setFeedback('Submitting registration...', 'info');
        render();

        try {
            // Strictly adhering to backend RPC signature:
            // public.utme_challenge_register(p_display_name text, p_subjects text[])
            const { data, error } = await client.rpc('utme_challenge_register', {
                p_display_name: cleanName,
                p_subjects: state.selectedSubjects
            });

            if (error) throw error;

            state.submitting = false;
            state.isEditing = false;
            setFeedback('Registration successfully saved! You are confirmed for UTME Challenge 2027.', 'success');

            // Refresh overview data
            await loadOverview();
        } catch (err) {
            console.error('Error submitting registration:', err);
            state.submitting = false;

            let msg = err.message || 'Registration failed. Please try again.';
            if (msg.includes('REGISTRATION_WINDOW_CLOSED')) {
                msg = 'Registration is not currently open for any round in this season.';
            } else if (msg.includes('REGISTRATION_LOCKED')) {
                msg = 'Subject choices are permanently locked and cannot be modified because an examination attempt has started.';
            } else if (msg.includes('NO_ACTIVE_SEASON')) {
                msg = 'No active UTME Challenge season found.';
            } else if (msg.includes('INVALID_DISPLAY_NAME')) {
                msg = 'Display name must be between 2 and 30 characters.';
            }

            setFeedback(msg, 'danger');
            render();
        }
    }

    // Main Render Routine
    function render() {
        const root = document.getElementById('utmeApp');
        if (!root) return;

        // 1. Loading State
        if (state.loading) {
            root.innerHTML = `
                <div class="utme-card utme-empty-state">
                    <div class="utme-loading-spinner"></div>
                    <h3>Loading UTME Challenge 2027...</h3>
                    <p>Fetching active season details, weekly rounds, and registration status.</p>
                </div>
            `;
            return;
        }

        // 2. Unauthenticated State
        if (!state.user) {
            root.innerHTML = `
                <div class="utme-hero">
                    <span class="utme-hero-badge">ExamPilot Weekly Competition</span>
                    <h1 class="utme-hero-title">UTME Challenge 2027</h1>
                    <p class="utme-hero-desc">Compete weekly with students across Nigeria, test your preparation under authentic JAMB CBT conditions, and climb the verified leaderboard.</p>
                </div>

                <div class="utme-card utme-empty-state">
                    <div class="utme-empty-icon">🔐</div>
                    <h3>Account Required</h3>
                    <p>Participation is free for all registered ExamPilot students. Please sign in or create your free ExamPilot account to enter the Challenge.</p>
                    <a href="dashboard.html" class="utme-btn utme-btn-primary">Go to Dashboard / Sign In →</a>
                </div>
            `;
            return;
        }

        // 3. No Active Season State
        if (!state.overview || !state.overview.has_active_season || !state.overview.season) {
            root.innerHTML = `
                <div class="utme-hero">
                    <span class="utme-hero-badge">ExamPilot Weekly Competition</span>
                    <h1 class="utme-hero-title">UTME Challenge 2027</h1>
                    <p class="utme-hero-desc">Compete weekly with students nationwide under authentic JAMB conditions.</p>
                </div>

                <div class="utme-card utme-empty-state">
                    <div class="utme-empty-icon">⏳</div>
                    <h3>No Active Season</h3>
                    <p>There is currently no active UTME Challenge season configured. The administrator will announce the next challenge season soon.</p>
                    <a href="dashboard.html" class="utme-btn utme-btn-secondary">← Return to Dashboard</a>
                </div>
            `;
            return;
        }

        const season = state.overview.season;
        const reg = state.overview.registration;
        const rounds = Array.isArray(state.overview.rounds) ? state.overview.rounds : [];

        // Check if any round currently has registration open
        const anyRegOpen = rounds.some(r => r.computed_phase === 'registration_open');

        let html = '';

        // Top Hero
        html += `
            <div class="utme-hero">
                <span class="utme-hero-badge">Season ${sanitizeText(season.year)} · Active</span>
                <h1 class="utme-hero-title">${sanitizeText(season.title || 'UTME Challenge ' + season.year)}</h1>
                <p class="utme-hero-desc">Nationwide weekly UTME competition. 4 accredited subjects, timed examination rounds, and verified server-graded rankings.</p>
                <div class="utme-hero-stats">
                    <div class="utme-hero-stat-item">
                        <span>Status:</span>
                        <strong>${reg ? '✅ Registered' : (anyRegOpen ? '🟢 Registration Open' : '⚪ Waiting for Round')}</strong>
                    </div>
                    <div class="utme-hero-stat-item">
                        <span>Access:</span>
                        <strong>100% Free for all students</strong>
                    </div>
                    <div class="utme-hero-stat-item">
                        <span>Weekly Rounds:</span>
                        <strong>${rounds.length} Total Rounds</strong>
                    </div>
                </div>
            </div>
        `;

        // Notification / Alert Banner
        if (state.feedbackMessage) {
            html += `
                <div class="utme-alert utme-alert-${state.feedbackType}">
                    <div>${sanitizeText(state.feedbackMessage)}</div>
                </div>
            `;
        }

        // Section: Registration or Registered Card
        if (!reg || state.isEditing) {
            html += renderRegistrationForm(reg, anyRegOpen);
        } else {
            html += renderRegisteredCard(reg, anyRegOpen);
        }

        // Section: Weekly Rounds Schedule
        html += renderRoundsSchedule(rounds, reg);

        // Section: Rules & Information
        html += renderRulesInfo();

        root.innerHTML = html;

        // Attach DOM Events
        attachEventHandlers(root, reg);
    }

    // Render Registration Form
    function renderRegistrationForm(reg, anyRegOpen) {
        const isUpdate = Boolean(reg);
        const electivesChosen = state.selectedSubjects.filter(s => s !== 'English').length;
        const totalChosen = state.selectedSubjects.length;
        const isComplete = totalChosen === 4 && (state.displayName || '').trim().length >= 2;

        let subjectCardsHtml = '';
        ACCREDITED_SUBJECTS.forEach(subj => {
            const isCompulsory = subj.compulsory;
            const isSelected = state.selectedSubjects.includes(subj.name);
            const isDisabled = !isSelected && totalChosen >= 4 && !isCompulsory;

            let cardClasses = 'utme-subject-card';
            if (isCompulsory) cardClasses += ' compulsory selected locked';
            else if (isSelected) cardClasses += ' selected';
            else if (isDisabled) cardClasses += ' disabled';

            subjectCardsHtml += `
                <div class="${cardClasses}" data-subject="${sanitizeText(subj.name)}">
                    <span class="utme-subject-icon">${subj.icon}</span>
                    <div class="utme-subject-info">
                        <div class="utme-subject-name">${sanitizeText(subj.name)}</div>
                        <div class="utme-subject-tag">${isCompulsory ? 'Compulsory' : (isSelected ? 'Selected' : 'Elective')}</div>
                    </div>
                    <input type="checkbox"
                           class="utme-subject-checkbox"
                           ${isSelected ? 'checked' : ''}
                           ${isCompulsory || isDisabled ? 'disabled' : ''}
                           tabindex="-1"
                           aria-hidden="true">
                </div>
            `;
        });

        // Summary Pills (4 slots)
        let pillsHtml = '';
        for (let i = 0; i < 4; i++) {
            const subjName = state.selectedSubjects[i];
            if (subjName) {
                pillsHtml += `
                    <span class="utme-summary-pill">
                        ${subjName === 'English' ? '🔒' : '✓'} ${sanitizeText(subjName)}
                    </span>
                `;
            } else {
                pillsHtml += `
                    <span class="utme-summary-pill-empty">
                        + Elective Subject ${i}
                    </span>
                `;
            }
        }

        return `
            <div class="utme-card" id="registrationCard">
                <div class="utme-card-header">
                    <div>
                        <h2 class="utme-card-title">
                            <span>📝</span> ${isUpdate ? 'Update Subject Combination' : 'Student Registration'}
                        </h2>
                        <p class="utme-card-subtitle">Choose your official 4-subject combination for UTME Challenge 2027.</p>
                    </div>
                    ${isUpdate ? `<button type="button" class="utme-btn utme-btn-secondary utme-btn-sm" id="btnCancelEdit">Cancel</button>` : ''}
                </div>

                ${!anyRegOpen ? `
                    <div class="utme-alert utme-alert-warning">
                        <div>⚠️ <strong>Registration Window Notice:</strong> There is currently no active round with an open registration window. You can prepare your selection, but saving requires an open registration window.</div>
                    </div>
                ` : ''}

                <form id="utmeRegForm">
                    <div class="utme-form-group">
                        <label class="utme-label" for="displayNameInput">
                            Candidate Display Name <span class="utme-label-hint">(2–30 characters, visible on public leaderboard)</span>
                        </label>
                        <input type="text"
                               id="displayNameInput"
                               class="utme-input"
                               placeholder="e.g. Victor Okafor"
                               maxlength="30"
                               minlength="2"
                               required
                               value="${sanitizeText(state.displayName)}">
                    </div>

                    <div class="utme-subjects-section">
                        <div class="utme-counter-banner">
                            <span class="utme-counter-text">
                                Electives Selected: <strong>${electivesChosen} of 3</strong> (Total: ${totalChosen} of 4)
                            </span>
                            <span class="utme-pill ${totalChosen === 4 ? 'utme-pill-green' : 'utme-pill-gold'}">
                                ${totalChosen === 4 ? '✓ Combination Complete' : 'Pick ' + (3 - electivesChosen) + ' more elective' + (3 - electivesChosen === 1 ? '' : 's')}
                            </span>
                        </div>

                        <div class="utme-subjects-grid">
                            ${subjectCardsHtml}
                        </div>

                        <div class="utme-summary-tray">
                            <div class="utme-summary-title">Your 4-Subject Combination Summary</div>
                            <div class="utme-summary-pills">
                                ${pillsHtml}
                            </div>
                        </div>

                        <div class="utme-alert utme-alert-info">
                            <div>
                                🔒 <strong>Subject Choice Locking:</strong> Use of English is compulsory for all candidates. Your chosen 4 subjects will be tested in each round. <strong>Important:</strong> Your subject combination locks permanently once you start your first round attempt.
                            </div>
                        </div>

                        <div style="margin-top: 20px;">
                            <button type="submit"
                                    class="utme-btn utme-btn-primary utme-btn-full"
                                    id="btnSubmitReg"
                                    ${!isComplete || state.submitting ? 'disabled' : ''}>
                                ${state.submitting ? 'Saving Registration...' : (isUpdate ? 'Save Updated Combination' : 'Complete Registration')}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        `;
    }

    // Render Registered Candidate Card
    function renderRegisteredCard(reg, anyRegOpen) {
        const isLocked = Boolean(reg.locked_at);
        const subjects = Array.isArray(reg.selected_subjects) ? reg.selected_subjects : [];

        let pillsHtml = subjects.map(s => `
            <span class="utme-summary-pill">
                ${s === 'English' ? '📖' : '✓'} ${sanitizeText(s)}
            </span>
        `).join('');

        return `
            <div class="utme-card" id="registeredCard">
                <div class="utme-candidate-banner">
                    <div class="utme-candidate-details">
                        <div class="utme-candidate-avatar">🎓</div>
                        <div>
                            <h2 class="utme-candidate-name">${sanitizeText(reg.display_name)}</h2>
                            <p class="utme-candidate-meta">
                                Registered: ${formatDate(reg.created_at)} · Combination: <strong>${sanitizeText(reg.combination_key || 'Accredited 4-Subject')}</strong>
                            </p>
                        </div>
                    </div>
                    <div>
                        ${isLocked ? `
                            <span class="utme-pill utme-pill-purple">🔒 Combination Locked (${formatDate(reg.locked_at)})</span>
                        ` : `
                            <span class="utme-pill utme-pill-green">🟢 Registered (Editable)</span>
                        `}
                    </div>
                </div>

                <div style="margin-bottom: 18px;">
                    <div class="utme-summary-title">Registered UTME Subject Combination</div>
                    <div class="utme-summary-pills">
                        ${pillsHtml}
                    </div>
                </div>

                ${!isLocked ? `
                    <div class="utme-alert utme-alert-info" style="margin-bottom: 14px;">
                        <div>
                            💡 You can adjust your subject combination while registration remains open. Once you start your first examination attempt, these subjects lock permanently.
                        </div>
                    </div>
                    <button type="button" class="utme-btn utme-btn-secondary utme-btn-sm" id="btnEditReg" ${!anyRegOpen ? 'disabled title="Registration window is currently closed"' : ''}>
                        ✏️ Edit Subject Combination
                    </button>
                ` : `
                    <div class="utme-alert utme-alert-warning">
                        <div>
                            🔒 <strong>Permanently Locked:</strong> You have initiated an examination attempt for this season. Your subject combination is locked and cannot be changed.
                        </div>
                    </div>
                `}
            </div>
        `;
    }

    // Render Weekly Rounds Schedule
    function renderRoundsSchedule(rounds, reg) {
        if (!rounds || rounds.length === 0) {
            return `
                <div class="utme-card">
                    <h3 class="utme-card-title">Weekly Rounds</h3>
                    <p class="utme-card-subtitle">No weekly rounds have been scheduled yet for this season. Check back soon!</p>
                </div>
            `;
        }

        let roundsHtml = '';
        rounds.forEach(r => {
            const phase = r.computed_phase || 'pending';
            const attempt = r.attempt;

            let phaseBadge = '';
            switch (phase) {
                case 'registration_open':
                    phaseBadge = '<span class="utme-pill utme-pill-green">🟢 Registration Open</span>';
                    break;
                case 'waiting':
                    phaseBadge = '<span class="utme-pill utme-pill-blue">⏳ Awaiting Test Window</span>';
                    break;
                case 'open':
                    phaseBadge = '<span class="utme-pill utme-pill-gold">⚡ Test Window Open</span>';
                    break;
                case 'closed':
                    phaseBadge = '<span class="utme-pill utme-pill-muted">⚪ Window Closed</span>';
                    break;
                case 'finalized':
                    phaseBadge = '<span class="utme-pill utme-pill-purple">🏆 Finalized</span>';
                    break;
                default:
                    phaseBadge = '<span class="utme-pill utme-pill-muted">Upcoming</span>';
            }

            let attemptBadge = '';
            let actionBtn = '';
            if (attempt) {
                if (attempt.status === 'submitted') {
                    attemptBadge = `
                        <div class="utme-round-attempt-box">
                            <div>
                                <strong>Attempt Status:</strong> ✅ Completed
                                <span style="margin-left: 8px; color: var(--utme-green-dark); font-weight: 800;">
                                    Score: ${attempt.percentage}% (English: ${attempt.english_percentage}%)
                                </span>
                            </div>
                            <span class="utme-pill utme-pill-green">Submitted</span>
                        </div>
                    `;
                    if (phase === 'finalized') {
                        actionBtn = `
                            <button type="button" class="utme-btn utme-btn-secondary utme-btn-sm" data-action="view-result" data-round-id="${r.id}">📊 View Result Details</button>
                            <button type="button" class="utme-btn utme-btn-primary utme-btn-sm" data-action="view-leaderboard" data-round-id="${r.id}" style="margin-left: 8px;">🏆 View Leaderboard &amp; Stats</button>
                        `;
                    } else {
                        actionBtn = `
                            <button type="button" class="utme-btn utme-btn-secondary utme-btn-sm" data-action="view-result" data-round-id="${r.id}">📊 View Result Details</button>
                            <button type="button" class="utme-btn utme-btn-secondary utme-btn-sm" data-action="view-leaderboard" data-round-id="${r.id}" style="margin-left: 8px;">🏆 Leaderboard (Pending)</button>
                        `;
                    }
                } else if (attempt.status === 'expired') {
                    attemptBadge = `
                        <div class="utme-round-attempt-box" style="background:#fff5f5; border-color:#fecaca;">
                            <div>
                                <strong>Attempt Status:</strong> ⚠️ Expired
                                <span style="margin-left: 8px; color: var(--utme-red); font-weight: 800;">
                                    Score: ${attempt.percentage}%
                                </span>
                            </div>
                            <span class="utme-pill utme-pill-danger">Expired</span>
                        </div>
                    `;
                    if (phase === 'finalized') {
                        actionBtn = `
                            <button type="button" class="utme-btn utme-btn-secondary utme-btn-sm" data-action="view-result" data-round-id="${r.id}">📊 View Result Details</button>
                            <button type="button" class="utme-btn utme-btn-primary utme-btn-sm" data-action="view-leaderboard" data-round-id="${r.id}" style="margin-left: 8px;">🏆 View Leaderboard &amp; Stats</button>
                        `;
                    } else {
                        actionBtn = `
                            <button type="button" class="utme-btn utme-btn-secondary utme-btn-sm" data-action="view-result" data-round-id="${r.id}">📊 View Result Details</button>
                            <button type="button" class="utme-btn utme-btn-secondary utme-btn-sm" data-action="view-leaderboard" data-round-id="${r.id}" style="margin-left: 8px;">🏆 Leaderboard (Pending)</button>
                        `;
                    }
                } else if (attempt.status === 'in_progress') {
                    attemptBadge = `
                        <div class="utme-round-attempt-box" style="background:#fffbeb; border-color:#fde68a;">
                            <div>
                                <strong>Attempt Status:</strong> ⏳ In Progress (Started: ${formatDate(attempt.started_at)})
                            </div>
                            <span class="utme-pill utme-pill-gold">In Progress</span>
                        </div>
                    `;
                    actionBtn = `<button type="button" class="utme-btn utme-btn-primary utme-btn-sm" data-action="resume-exam" data-round-id="${r.id}">⏳ Resume Examination</button>`;
                }
            } else {
                attemptBadge = `
                    <div class="utme-round-attempt-box" style="background:#f8faf9; border-color:#e2ebe6;">
                        <div style="font-size: 13px; color: var(--utme-muted);">
                            <strong>Attempt Status:</strong> Not yet started
                        </div>
                        ${phase === 'open' ? (reg ? '<span class="utme-pill utme-pill-gold">Ready for Exam</span>' : '<span class="utme-pill utme-pill-muted">Registration Required</span>') : ''}
                    </div>
                `;
                if (phase === 'open') {
                    if (reg) {
                        actionBtn = `<button type="button" class="utme-btn utme-btn-primary utme-btn-sm" data-action="start-exam" data-round-id="${r.id}">🚀 Start Examination</button>`;
                    } else {
                        actionBtn = `<a href="#registrationCard" class="utme-btn utme-btn-secondary utme-btn-sm">Register to Take Exam</a>`;
                    }
                } else if (phase === 'finalized') {
                    actionBtn = `<button type="button" class="utme-btn utme-btn-primary utme-btn-sm" data-action="view-leaderboard" data-round-id="${r.id}">🏆 View Leaderboard &amp; Stats</button>`;
                } else if (phase === 'closed') {
                    actionBtn = `<button type="button" class="utme-btn utme-btn-secondary utme-btn-sm" data-action="view-leaderboard" data-round-id="${r.id}">🏆 Leaderboard (Pending)</button>`;
                }
            }

            roundsHtml += `
                <div class="utme-round-item ${phase === 'open' ? 'active-round' : ''}">
                    <div class="utme-round-top">
                        <div class="utme-round-title-group">
                            <span class="utme-round-num-pill">Round ${r.round_number}</span>
                            <h4 class="utme-round-title">${sanitizeText(r.title || 'Weekly Challenge Round ' + r.round_number)}</h4>
                        </div>
                        <div>
                            ${phaseBadge}
                        </div>
                    </div>

                    <div class="utme-round-dates-grid">
                        <div class="utme-date-block">
                            <span class="utme-date-label">Registration Window</span>
                            <span class="utme-date-val">${formatDate(r.registration_opens_at)} – ${formatDate(r.registration_closes_at)}</span>
                        </div>
                        <div class="utme-date-block">
                            <span class="utme-date-label">Examination Window</span>
                            <span class="utme-date-val">${formatDate(r.start_window_opens_at)} – ${formatDate(r.start_window_closes_at)}</span>
                        </div>
                        <div class="utme-date-block">
                            <span class="utme-date-label">Round Configuration</span>
                            <span class="utme-date-val">
                                ${r.duration_minutes != null ? `${r.duration_minutes} mins duration` : 'Duration pending'}
                                ${r.grace_period_seconds != null ? ` · ${r.grace_period_seconds}s grace` : ''}
                                ${r.candidate_total_questions != null ? ` · ${r.candidate_total_questions} Questions` : (r.total_questions ? ` · ${r.total_questions} Total Questions` : ' · Questions pending')}
                            </span>
                        </div>
                    </div>

                    ${attemptBadge}
                    ${actionBtn ? `<div style="margin-top: 12px; display: flex; justify-content: flex-end;">${actionBtn}</div>` : ''}
                </div>
            `;
        });

        return `
            <div class="utme-card">
                <div class="utme-card-header">
                    <div>
                        <h2 class="utme-card-title">
                            <span>📅</span> Weekly Rounds Schedule
                        </h2>
                        <p class="utme-card-subtitle">Check registration windows, examination start times, and your attempt progress.</p>
                    </div>
                </div>
                <div class="utme-rounds-list">
                    ${roundsHtml}
                </div>
            </div>
        `;
    }

    // Render Rules & Fair Play Info
    function renderRulesInfo() {
        return `
            <div class="utme-card">
                <div class="utme-card-header">
                    <div>
                        <h2 class="utme-card-title">
                            <span>⚖️</span> Challenge Rules &amp; Fairness Guarantees
                        </h2>
                        <p class="utme-card-subtitle">Official competition guidelines for UTME Challenge 2027.</p>
                    </div>
                </div>

                <div class="utme-rules-grid">
                    <div class="utme-rule-box">
                        <div class="utme-rule-icon">📚</div>
                        <h4>Shared Round Papers · 4 Subjects</h4>
                        <p>Configured questions per subject matching your registered combination. Every candidate taking the same subject in a round answers the exact same questions.</p>
                    </div>
                    <div class="utme-rule-box">
                        <div class="utme-rule-icon">⏱️</div>
                        <h4>Timed Examination Rounds</h4>
                        <p>Each round provides a single timed attempt with a network grace period as configured by the administration. The countdown begins upon attempt launch.</p>
                    </div>
                    <div class="utme-rule-box">
                        <div class="utme-rule-icon">📊</div>
                        <h4>25% Equal Subject Weight</h4>
                        <p>Your overall score is the unweighted average of your 4 subject percentages. Each subject contributes exactly 25% to your final score.</p>
                    </div>
                    <div class="utme-rule-box">
                        <div class="utme-rule-icon">🏆</div>
                        <h4>Psychometric Tie-Breaking</h4>
                        <p>Ties are broken first by Use of English percentage, then by total correct questions answered, never by arbitrary completion speed.</p>
                    </div>
                </div>
            </div>
        `;
    }

    // Attach Event Handlers
    function attachEventHandlers(root, reg) {
        // Display Name Input listener
        const nameInput = root.querySelector('#displayNameInput');
        if (nameInput) {
            nameInput.addEventListener('input', (e) => {
                state.displayName = e.target.value;
                const btnSubmit = root.querySelector('#btnSubmitReg');
                if (btnSubmit) {
                    const validName = state.displayName.trim().length >= 2;
                    const validSubs = state.selectedSubjects.length === 4;
                    btnSubmit.disabled = !validName || !validSubs || state.submitting;
                }
            });
        }

        // Subject Card click listener
        const cards = root.querySelectorAll('.utme-subject-card:not(.compulsory)');
        cards.forEach(card => {
            card.addEventListener('click', () => {
                const subj = card.getAttribute('data-subject');
                if (subj) toggleSubject(subj);
            });
        });

        // Registration Form Submit
        const form = root.querySelector('#utmeRegForm');
        if (form) {
            form.addEventListener('submit', submitRegistration);
        }

        // Edit Registration Button
        const btnEdit = root.querySelector('#btnEditReg');
        if (btnEdit) {
            btnEdit.addEventListener('click', () => {
                state.isEditing = true;
                state.feedbackMessage = null;
                render();
            });
        }

        // Cancel Edit Button
        const btnCancel = root.querySelector('#btnCancelEdit');
        if (btnCancel) {
            btnCancel.addEventListener('click', () => {
                state.isEditing = false;
                state.feedbackMessage = null;
                // Reset selections to registered subjects
                if (reg && Array.isArray(reg.selected_subjects)) {
                    state.selectedSubjects = [...reg.selected_subjects];
                    state.displayName = reg.display_name;
                }
                render();
            });
        }

        // Action buttons (start-exam, resume-exam, view-result, view-leaderboard)
        const actionBtns = root.querySelectorAll('[data-action]');
        actionBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.getAttribute('data-action');
                const roundId = btn.getAttribute('data-round-id');
                const rounds = state.overview?.rounds || [];
                const roundObj = rounds.find(r => r.id === roundId);
                if (action === 'view-leaderboard') {
                    if (window.utmeLeaderboard && typeof window.utmeLeaderboard.openLeaderboard === 'function') {
                        window.utmeLeaderboard.openLeaderboard(roundObj, state.overview?.registration, state.user);
                    }
                } else if (window.utmeExam && typeof window.utmeExam.handleAction === 'function') {
                    window.utmeExam.handleAction(action, roundObj, state.overview?.registration, state.user);
                }
            });
        });
    }

    // Export UI helper for coordination
    window.utmeUI = {
        state,
        loadOverview,
        render
    };

    // Auto-init on DOMContentLoaded or immediately if already loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
