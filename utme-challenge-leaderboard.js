/**
 * ExamPilot UTME Challenge 2027 - Leaderboard & Competition Results
 * Phase 4 Frontend Implementation
 *
 * Implements:
 * 1. Nationwide Overall Rankings across all subject combinations.
 * 2. Combination Rankings (candidate's combination + ability to browse any combination).
 * 3. Individual Subject Rankings (configured subjects for round).
 * 4. Personal Performance Summary ("My Performance" card, including unattempted state).
 * 5. Competition Statistics (Season registrations & Round completed attempts breakdown).
 * 6. Non-finalized / pending finalization status handling.
 * 7. Paginated navigation (previous/next, limit, offset, entry count display).
 * 8. Candidate privacy: display names only, zero user_id/email/phone exposure.
 * 9. Universal access: open to all registered participants (Free & Premium).
 */
(function () {
    'use strict';

    // Application State for Leaderboard
    const state = {
        round: null,
        reg: null,
        user: null,
        scope: 'overall',             // 'overall' | 'combination' | 'subject'
        activeTab: 'overall',         // 'overall' | 'combination' | 'subject' | 'statistics'
        combinationKey: null,         // Selected combination filter
        subject: 'English',           // Selected subject filter
        limit: 50,
        offset: 0,
        loading: false,
        error: null,
        data: null,                   // Cached RPC response
        allCombinations: [],          // Unique list of combinations
        roundSubjects: []             // Configured subjects in this round
    };

    const ACCREDITED_SUBJECTS = [
        'English', 'Mathematics', 'Physics', 'Chemistry', 'Biology',
        'Economics', 'Government', 'Literature in English', 'Commerce',
        'Accounting', 'Geography', 'CRS', 'History'
    ];

    function getClient() {
        return window.supabaseClient;
    }

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function extractCombinationsAndSubjects(data, round, reg) {
        // 1. Combinations
        const comboSet = new Set();
        if (reg?.combination_key) comboSet.add(reg.combination_key);

        if (data?.season_statistics?.combination_registrations) {
            data.season_statistics.combination_registrations.forEach(c => {
                if (c.combination_key) comboSet.add(c.combination_key);
            });
        }
        if (data?.round_statistics?.combination_completions) {
            data.round_statistics.combination_completions.forEach(c => {
                if (c.combination_key) comboSet.add(c.combination_key);
            });
        }
        state.allCombinations = Array.from(comboSet).sort();

        // If no combination selected yet, default to candidate's combination or first available
        if (!state.combinationKey) {
            state.combinationKey = reg?.combination_key || (state.allCombinations.length > 0 ? state.allCombinations[0] : null);
        }

        // 2. Round Subjects
        if (round && Array.isArray(round.round_subjects) && round.round_subjects.length > 0) {
            state.roundSubjects = round.round_subjects.map(s => s.subject);
        } else {
            state.roundSubjects = [...ACCREDITED_SUBJECTS];
        }

        if (!state.subject) {
            state.subject = 'English';
        }
    }

    // =========================================================================
    // 1. DATA FETCHING (RPC INVOCATION)
    // =========================================================================

    async function loadLeaderboardData(resetOffset = false) {
        if (resetOffset) {
            state.offset = 0;
        }

        state.loading = true;
        state.error = null;
        renderLeaderboard();

        try {
            const client = getClient();
            if (!client) {
                throw new Error('Supabase client is not available. Please refresh the page.');
            }

            const roundId = state.round?.id;
            if (!roundId) {
                throw new Error('No valid examination round selected.');
            }

            const rpcParams = {
                p_round_id: roundId,
                p_scope: state.scope,
                p_combination_key: state.scope === 'combination' ? state.combinationKey : null,
                p_subject: state.scope === 'subject' ? state.subject : null,
                p_limit: state.limit,
                p_offset: state.offset
            };

            const { data, error } = await client.rpc('utme_challenge_get_leaderboard', rpcParams);

            if (error) {
                console.error('Error invoking utme_challenge_get_leaderboard:', error);
                throw new Error(error.message || 'Failed to fetch leaderboard data.');
            }

            state.data = data;
            state.loading = false;

            if (data && data.available) {
                extractCombinationsAndSubjects(data, state.round, state.reg);
            }

            renderLeaderboard();
        } catch (err) {
            state.loading = false;
            state.error = err.message || 'An unexpected error occurred.';
            renderLeaderboard();
        }
    }

    // =========================================================================
    // 2. MAIN ENTRY POINTS
    // =========================================================================

    function openLeaderboard(round, reg, user) {
        state.round = round;
        state.reg = reg;
        state.user = user;
        state.scope = 'overall';
        state.activeTab = 'overall';
        state.offset = 0;
        state.combinationKey = reg?.combination_key || null;
        state.subject = 'English';
        state.data = null;
        state.error = null;

        // Initialize subjects from round
        if (round && Array.isArray(round.round_subjects) && round.round_subjects.length > 0) {
            state.roundSubjects = round.round_subjects.map(s => s.subject);
        } else {
            state.roundSubjects = [...ACCREDITED_SUBJECTS];
        }

        loadLeaderboardData(true);
    }

    function closeLeaderboard() {
        state.data = null;
        state.error = null;
        if (window.utmeUI && typeof window.utmeUI.loadOverview === 'function') {
            window.utmeUI.loadOverview();
        } else if (window.utmeUI && typeof window.utmeUI.render === 'function') {
            window.utmeUI.render();
        }
    }

    // =========================================================================
    // 3. UI RENDERING
    // =========================================================================

    function renderLeaderboard() {
        const root = document.getElementById('utmeApp');
        if (!root) return;

        const round = state.round || {};
        const data = state.data;

        // Header view
        let contentHtml = `
            <div class="utme-leaderboard-page" id="utmeLeaderboardView">
                <div class="utme-leaderboard-top-nav">
                    <button type="button" class="utme-btn utme-btn-secondary utme-btn-sm" id="btnBackToHub">
                        ← Back to Challenge Hub
                    </button>
                    <div>
                        <span class="utme-pill ${data?.available ? 'utme-pill-purple' : 'utme-pill-gold'}">
                            ${data?.available ? '🏆 Official Leaderboard' : '⏳ Results Pending'}
                        </span>
                    </div>
                </div>

                <div class="utme-card utme-leaderboard-hero-card">
                    <div class="utme-ldb-hero-content">
                        <div class="utme-ldb-trophy-badge">🏆</div>
                        <div>
                            <div class="utme-round-num-pill" style="display:inline-block; margin-bottom: 6px;">
                                Round ${round.round_number || data?.round_number || ''}
                            </div>
                            <h2 class="utme-card-title" style="margin: 0 0 6px;">
                                ${escapeHtml(round.title || data?.round_title || 'Weekly UTME Challenge Round')}
                            </h2>
                            <p class="utme-card-subtitle" style="margin: 0;">
                                Official nationwide rankings, combination analysis, and psychometric statistics.
                            </p>
                        </div>
                    </div>
                </div>
        `;

        // Error Banner
        if (state.error) {
            contentHtml += `
                <div class="utme-card utme-alert utme-alert-error" style="margin-bottom: 20px;">
                    <div>
                        <strong>⚠️ Error Loading Leaderboard:</strong> ${escapeHtml(state.error)}
                    </div>
                    <div style="margin-top: 10px;">
                        <button type="button" class="utme-btn utme-btn-sm utme-btn-primary" id="btnRetryLdb">
                            🔄 Retry
                        </button>
                    </div>
                </div>
            `;
            root.innerHTML = contentHtml + '</div>';
            attachLeaderboardEvents(root);
            return;
        }

        // Loading State
        if (state.loading && !data) {
            contentHtml += `
                <div class="utme-card utme-empty-state">
                    <div class="utme-loading-spinner" style="margin: 0 auto 16px;"></div>
                    <h3>Loading Leaderboard &amp; Statistics...</h3>
                    <p class="utme-muted">Verifying finalized attempt rankings across Nigeria...</p>
                </div>
            `;
            root.innerHTML = contentHtml + '</div>';
            attachLeaderboardEvents(root);
            return;
        }

        // Pending Finalization State (available === false)
        if (data && !data.available) {
            contentHtml += `
                <div class="utme-card utme-pending-box">
                    <div class="utme-pending-icon">⏳</div>
                    <h3 class="utme-pending-title">Results Pending Finalization</h3>
                    <p class="utme-pending-text">
                        Results are pending finalization. Official rankings will be published once the round is officially finalized.
                    </p>
                    <div class="utme-alert utme-alert-info" style="max-width: 620px; margin: 16px auto 24px; text-align: left;">
                        <div>
                            ℹ️ <strong>Round Status:</strong> <code>${escapeHtml(data.status || round.status || 'closed')}</code><br>
                            ${escapeHtml(data.message || 'Official rankings and competition statistics are published after all candidate attempts expire and round finalization completes.')}
                        </div>
                    </div>
                    <button type="button" class="utme-btn utme-btn-primary" id="btnPendingReturn">
                        ← Return to UTME Challenge Hub
                    </button>
                </div>
            `;
            root.innerHTML = contentHtml + '</div>';
            attachLeaderboardEvents(root);
            return;
        }

        // Finalized Leaderboard Data Present
        if (data && data.available) {
            // 1. KPI Statistics Banner
            contentHtml += renderCompetitionKpis(data);

            // 2. Personal Performance Card ("My Performance")
            contentHtml += renderMyPerformanceCard(data.my_performance, data.round_number);

            // 3. Navigation Tabs
            contentHtml += renderTabsBar();

            // 4. Tab Body Content
            if (state.activeTab === 'statistics') {
                contentHtml += renderStatisticsTab(data);
            } else {
                contentHtml += renderRankingsTab(data);
            }
        }

        contentHtml += `</div>`;
        root.innerHTML = contentHtml;
        attachLeaderboardEvents(root);
    }

    // =========================================================================
    // 4. SUB-COMPONENT RENDERERS
    // =========================================================================

    function renderCompetitionKpis(data) {
        const seasonStats = data.season_statistics || {};
        const roundStats = data.round_statistics || {};

        // Find candidate combination completions
        const callerCombo = state.reg?.combination_key;
        let callerComboStat = null;
        if (callerCombo && Array.isArray(roundStats.combination_completions)) {
            callerComboStat = roundStats.combination_completions.find(c => c.combination_key === callerCombo);
        }

        return `
            <div class="utme-stats-kpi-grid">
                <div class="utme-kpi-card">
                    <div class="utme-kpi-icon">👥</div>
                    <div class="utme-kpi-info">
                        <span class="utme-kpi-label">TOTAL REGISTERED</span>
                        <strong class="utme-kpi-val">${seasonStats.total_registered_candidates != null ? seasonStats.total_registered_candidates : '—'}</strong>
                        <span class="utme-kpi-sub">Season Candidates</span>
                    </div>
                </div>

                <div class="utme-kpi-card">
                    <div class="utme-kpi-icon">📝</div>
                    <div class="utme-kpi-info">
                        <span class="utme-kpi-label">COMPLETED ATTEMPTS</span>
                        <strong class="utme-kpi-val">${roundStats.total_completed_attempts != null ? roundStats.total_completed_attempts : '—'}</strong>
                        <span class="utme-kpi-sub">Round ${data.round_number || ''} Submissions</span>
                    </div>
                </div>

                <div class="utme-kpi-card">
                    <div class="utme-kpi-icon">🎯</div>
                    <div class="utme-kpi-info">
                        <span class="utme-kpi-label">MY COMBINATION</span>
                        <strong class="utme-kpi-val">${callerComboStat ? callerComboStat.completed_attempts : '—'}</strong>
                        <span class="utme-kpi-sub">
                            ${callerComboStat ? `Avg: ${callerComboStat.average_percentage}% · Top: ${callerComboStat.highest_percentage}%` : 'No attempts in combination'}
                        </span>
                    </div>
                </div>
            </div>
        `;
    }

    function renderMyPerformanceCard(perf, roundNumber) {
        if (!perf) return '';

        if (!perf.has_attempt) {
            return `
                <div class="utme-card utme-my-perf-card">
                    <div class="utme-perf-unattempted">
                        <div class="utme-unattempted-icon">ℹ️</div>
                        <div class="utme-unattempted-details">
                            <h4 style="margin: 0 0 4px; font-size: 15px; font-weight: 800; color: var(--utme-text);">
                                Registered Candidate · No Attempt Submitted for Round ${roundNumber || ''}
                            </h4>
                            <p style="margin: 0; font-size: 13px; color: var(--utme-muted);">
                                You are registered for the season with combination <strong>${escapeHtml(perf.combination_key || 'Accredited 4-Subject')}</strong>, but you did not take an examination attempt during this round's testing window. No official rank was assigned.
                            </p>
                        </div>
                    </div>
                </div>
            `;
        }

        // Candidate took the exam: Show comprehensive breakdown
        let subjectCardsHtml = '';
        const subjBreakdown = perf.subject_breakdown || {};
        const subjRanks = perf.subject_ranks || {};

        Object.keys(subjBreakdown).forEach(subj => {
            const sData = subjBreakdown[subj] || {};
            const sRankData = subjRanks[subj] || {};
            const rankText = sRankData.rank != null ? `#${sRankData.rank}` : '—';

            subjectCardsHtml += `
                <div class="utme-sub-perf-box">
                    <div class="utme-sub-perf-top">
                        <span class="utme-sub-perf-name">${escapeHtml(subj)}</span>
                        <span class="utme-pill utme-pill-purple utme-pill-sm">${rankText}</span>
                    </div>
                    <div class="utme-sub-perf-pct">${sData.percentage != null ? `${sData.percentage}%` : '—'}</div>
                    <div class="utme-sub-perf-meta">${sData.correct != null ? `${sData.correct} / ${sData.total} correct` : ''}</div>
                </div>
            `;
        });

        return `
            <div class="utme-card utme-my-perf-card">
                <div class="utme-my-perf-header">
                    <div>
                        <span class="utme-pill utme-pill-green" style="margin-bottom: 6px;">Your Official Performance</span>
                        <h3 class="utme-card-title" style="margin: 0;">${escapeHtml(perf.display_name)}</h3>
                        <p class="utme-card-subtitle" style="margin: 0;">
                            Combination: <strong>${escapeHtml(perf.combination_key)}</strong>
                        </p>
                    </div>
                    <div class="utme-perf-ranks-group">
                        <div class="utme-rank-badge-box">
                            <span class="rank-box-label">NATIONWIDE RANK</span>
                            <strong class="rank-box-val">#${perf.overall_rank != null ? perf.overall_rank : '—'}</strong>
                        </div>
                        <div class="utme-rank-badge-box">
                            <span class="rank-box-label">COMBINATION RANK</span>
                            <strong class="rank-box-val">#${perf.combination_rank != null ? perf.combination_rank : '—'}</strong>
                        </div>
                    </div>
                </div>

                <div class="utme-perf-summary-bar">
                    <div class="utme-perf-summary-item">
                        <span class="summary-lbl">FINAL PERCENTAGE</span>
                        <strong class="summary-val" style="color: var(--utme-green-dark);">${perf.final_percentage}%</strong>
                    </div>
                    <div class="utme-perf-summary-item">
                        <span class="summary-lbl">USE OF ENGLISH</span>
                        <strong class="summary-val">${perf.english_percentage}%</strong>
                    </div>
                    <div class="utme-perf-summary-item">
                        <span class="summary-lbl">TOTAL CORRECT</span>
                        <strong class="summary-val">${perf.total_correct}</strong>
                    </div>
                </div>

                ${subjectCardsHtml ? `
                    <div style="margin-top: 14px;">
                        <span class="stat-label" style="display:block; margin-bottom: 8px;">SUBJECT-BY-SUBJECT BREAKDOWN &amp; SUBJECT RANKS</span>
                        <div class="utme-sub-perf-grid">
                            ${subjectCardsHtml}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderTabsBar() {
        return `
            <div class="utme-ldb-tabs-bar">
                <button type="button" class="utme-ldb-tab-btn ${state.activeTab === 'overall' ? 'active' : ''}" data-tab="overall">
                    🌍 Nationwide Overall
                </button>
                <button type="button" class="utme-ldb-tab-btn ${state.activeTab === 'combination' ? 'active' : ''}" data-tab="combination">
                    🎯 By Subject Combination
                </button>
                <button type="button" class="utme-ldb-tab-btn ${state.activeTab === 'subject' ? 'active' : ''}" data-tab="subject">
                    📚 By Individual Subject
                </button>
                <button type="button" class="utme-ldb-tab-btn ${state.activeTab === 'statistics' ? 'active' : ''}" data-tab="statistics">
                    📊 Competition Statistics
                </button>
            </div>
        `;
    }

    function renderRankingsTab(data) {
        const pagination = data.pagination || { total_entries: 0, limit: state.limit, offset: 0, has_more: false };
        const entries = Array.isArray(data.entries) ? data.entries : [];
        const isSubjectScope = state.scope === 'subject';

        // Filter Controls Bar
        let filterBarHtml = '';
        if (state.activeTab === 'combination') {
            const comboOptions = state.allCombinations.map(combo => {
                const isSelected = combo === state.combinationKey;
                const isMine = combo === state.reg?.combination_key;
                return `<option value="${escapeHtml(combo)}" ${isSelected ? 'selected' : ''}>${escapeHtml(combo)}${isMine ? ' (My Combination)' : ''}</option>`;
            }).join('');

            filterBarHtml = `
                <div class="utme-filter-bar">
                    <label for="comboFilterSelect" class="utme-filter-label">
                        <strong>Filter Subject Combination:</strong>
                    </label>
                    <select id="comboFilterSelect" class="utme-select utme-filter-select">
                        ${comboOptions}
                    </select>
                </div>
            `;
        } else if (state.activeTab === 'subject') {
            const subjOptions = state.roundSubjects.map(subj => {
                const isSelected = subj === state.subject;
                return `<option value="${escapeHtml(subj)}" ${isSelected ? 'selected' : ''}>${escapeHtml(subj)}</option>`;
            }).join('');

            filterBarHtml = `
                <div class="utme-filter-bar">
                    <label for="subjectFilterSelect" class="utme-filter-label">
                        <strong>Select Subject:</strong>
                    </label>
                    <select id="subjectFilterSelect" class="utme-select utme-filter-select">
                        ${subjOptions}
                    </select>
                </div>
            `;
        }

        // Shared Rank Detection in current batch
        const rankCounts = {};
        entries.forEach(e => {
            rankCounts[e.rank] = (rankCounts[e.rank] || 0) + 1;
        });

        // Table Rows
        let tableRowsHtml = '';
        if (entries.length === 0) {
            tableRowsHtml = `
                <tr>
                    <td colspan="${isSubjectScope ? 6 : 6}" style="text-align: center; padding: 32px 16px; color: var(--utme-muted);">
                        No candidate rankings found for this selection.
                    </td>
                </tr>
            `;
        } else {
            entries.forEach(entry => {
                const isSelf = Boolean(entry.is_self);
                const isShared = rankCounts[entry.rank] > 1;

                let medalHtml = '';
                if (entry.rank === 1) medalHtml = '<span class="utme-medal">🥇</span>';
                else if (entry.rank === 2) medalHtml = '<span class="utme-medal">🥈</span>';
                else if (entry.rank === 3) medalHtml = '<span class="utme-medal">🥉</span>';

                const tieBadgeHtml = isShared
                    ? `<span class="utme-pill utme-pill-muted utme-pill-xs" title="Shared dense rank">= Shared</span>`
                    : '';

                if (isSubjectScope) {
                    tableRowsHtml += `
                        <tr class="${isSelf ? 'utme-tr-self' : ''}">
                            <td class="utme-td-rank">
                                <div class="utme-rank-cell">
                                    ${medalHtml}
                                    <span class="utme-rank-num">#${entry.rank}</span>
                                    ${tieBadgeHtml}
                                </div>
                            </td>
                            <td class="utme-td-candidate">
                                <span class="utme-candidate-title">${escapeHtml(entry.display_name)}</span>
                                ${isSelf ? '<span class="utme-pill utme-pill-green utme-pill-xs" style="margin-left: 6px;">You</span>' : ''}
                            </td>
                            <td class="utme-td-subject-pct">
                                <strong>${entry.subject_percentage != null ? `${entry.subject_percentage}%` : '—'}</strong>
                            </td>
                            <td class="utme-td-correct">
                                ${entry.subject_correct != null ? `${entry.subject_correct} / ${entry.subject_total}` : '—'}
                            </td>
                            <td class="utme-td-final-pct">
                                ${entry.final_percentage != null ? `${entry.final_percentage}%` : '—'}
                            </td>
                            <td class="utme-td-combo">
                                <span class="utme-combo-text">${escapeHtml(entry.combination_key || '')}</span>
                            </td>
                        </tr>
                    `;
                } else {
                    tableRowsHtml += `
                        <tr class="${isSelf ? 'utme-tr-self' : ''}">
                            <td class="utme-td-rank">
                                <div class="utme-rank-cell">
                                    ${medalHtml}
                                    <span class="utme-rank-num">#${entry.rank}</span>
                                    ${tieBadgeHtml}
                                </div>
                            </td>
                            <td class="utme-td-candidate">
                                <span class="utme-candidate-title">${escapeHtml(entry.display_name)}</span>
                                ${isSelf ? '<span class="utme-pill utme-pill-green utme-pill-xs" style="margin-left: 6px;">You</span>' : ''}
                            </td>
                            <td class="utme-td-combo">
                                <span class="utme-combo-text">${escapeHtml(entry.combination_key || '')}</span>
                            </td>
                            <td class="utme-td-final-pct">
                                <strong style="color: var(--utme-green-dark);">${entry.final_percentage != null ? `${entry.final_percentage}%` : '—'}</strong>
                            </td>
                            <td class="utme-td-eng-pct">
                                ${entry.english_percentage != null ? `${entry.english_percentage}%` : '—'}
                            </td>
                            <td class="utme-td-correct">
                                ${entry.total_correct != null ? entry.total_correct : '—'}
                            </td>
                        </tr>
                    `;
                }
            });
        }

        // Pagination metadata
        const total = pagination.total_entries || 0;
        const offset = pagination.offset || 0;
        const limit = pagination.limit || state.limit;
        const startItem = total > 0 ? offset + 1 : 0;
        const endItem = total > 0 ? Math.min(offset + limit, total) : 0;
        const hasPrev = offset > 0;
        const hasNext = Boolean(pagination.has_more);

        return `
            <div class="utme-card utme-table-card">
                ${filterBarHtml}

                <div class="utme-table-wrapper">
                    <table class="utme-table">
                        <thead>
                            ${isSubjectScope ? `
                                <tr>
                                    <th style="width: 110px;">Rank</th>
                                    <th>Candidate</th>
                                    <th>Subject %</th>
                                    <th>Correct</th>
                                    <th>Overall %</th>
                                    <th>Combination</th>
                                </tr>
                            ` : `
                                <tr>
                                    <th style="width: 110px;">Rank</th>
                                    <th>Candidate</th>
                                    <th>Combination</th>
                                    <th>Final %</th>
                                    <th>English %</th>
                                    <th>Total Correct</th>
                                </tr>
                            `}
                        </thead>
                        <tbody>
                            ${tableRowsHtml}
                        </tbody>
                    </table>
                </div>

                <div class="utme-pagination-bar">
                    <div class="utme-pagination-info">
                        Showing <strong>${startItem}–${endItem}</strong> of <strong>${total}</strong> candidates
                    </div>
                    <div class="utme-pagination-actions">
                        <button type="button" class="utme-btn utme-btn-secondary utme-btn-sm" id="btnLdbPrev" ${!hasPrev || state.loading ? 'disabled' : ''}>
                            ← Previous
                        </button>
                        <button type="button" class="utme-btn utme-btn-secondary utme-btn-sm" id="btnLdbNext" ${!hasNext || state.loading ? 'disabled' : ''}>
                            Next →
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderStatisticsTab(data) {
        const seasonStats = data.season_statistics || {};
        const roundStats = data.round_statistics || {};

        const comboRegs = Array.isArray(seasonStats.combination_registrations) ? seasonStats.combination_registrations : [];
        const comboComps = Array.isArray(roundStats.combination_completions) ? roundStats.combination_completions : [];

        let regRows = '';
        if (comboRegs.length === 0) {
            regRows = '<tr><td colspan="2" style="text-align: center; color: var(--utme-muted);">No registrations recorded.</td></tr>';
        } else {
            comboRegs.forEach(r => {
                regRows += `
                    <tr>
                        <td><strong>${escapeHtml(r.combination_key)}</strong></td>
                        <td style="text-align: right; font-weight: 700;">${r.registered_candidates}</td>
                    </tr>
                `;
            });
        }

        let compRows = '';
        if (comboComps.length === 0) {
            compRows = '<tr><td colspan="4" style="text-align: center; color: var(--utme-muted);">No completed attempts recorded.</td></tr>';
        } else {
            comboComps.forEach(c => {
                compRows += `
                    <tr>
                        <td><strong>${escapeHtml(c.combination_key)}</strong></td>
                        <td style="text-align: center; font-weight: 700;">${c.completed_attempts}</td>
                        <td style="text-align: right; color: var(--utme-green-dark); font-weight: 700;">${c.average_percentage}%</td>
                        <td style="text-align: right; font-weight: 800;">${c.highest_percentage}%</td>
                    </tr>
                `;
            });
        }

        return `
            <div class="utme-card">
                <div class="utme-card-header">
                    <div>
                        <h3 class="utme-card-title">Season &amp; Round Competition Statistics</h3>
                        <p class="utme-card-subtitle">Aggregated participation breakdowns by subject combination.</p>
                    </div>
                </div>

                <div class="utme-stats-sections-grid">
                    <div>
                        <h4 style="font-size: 14px; font-weight: 800; margin: 0 0 10px; color: var(--utme-text);">
                            👥 Season Registered Candidates by Combination
                        </h4>
                        <div class="utme-table-wrapper">
                            <table class="utme-table">
                                <thead>
                                    <tr>
                                        <th>Subject Combination</th>
                                        <th style="text-align: right;">Registered</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${regRows}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div>
                        <h4 style="font-size: 14px; font-weight: 800; margin: 0 0 10px; color: var(--utme-text);">
                            📝 Round ${data.round_number || ''} Completed Attempts by Combination
                        </h4>
                        <div class="utme-table-wrapper">
                            <table class="utme-table">
                                <thead>
                                    <tr>
                                        <th>Subject Combination</th>
                                        <th style="text-align: center;">Completed</th>
                                        <th style="text-align: right;">Average %</th>
                                        <th style="text-align: right;">Top %</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${compRows}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // =========================================================================
    // 5. EVENT HANDLERS
    // =========================================================================

    function attachLeaderboardEvents(root) {
        // Back button
        const btnBack = root.querySelector('#btnBackToHub') || root.querySelector('#btnPendingReturn');
        if (btnBack) {
            btnBack.addEventListener('click', closeLeaderboard);
        }

        // Retry button
        const btnRetry = root.querySelector('#btnRetryLdb');
        if (btnRetry) {
            btnRetry.addEventListener('click', () => loadLeaderboardData(false));
        }

        // Tab buttons
        const tabBtns = root.querySelectorAll('.utme-ldb-tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.getAttribute('data-tab');
                if (targetTab === state.activeTab) return;

                state.activeTab = targetTab;
                if (targetTab === 'overall') {
                    state.scope = 'overall';
                    loadLeaderboardData(true);
                } else if (targetTab === 'combination') {
                    state.scope = 'combination';
                    loadLeaderboardData(true);
                } else if (targetTab === 'subject') {
                    state.scope = 'subject';
                    loadLeaderboardData(true);
                } else if (targetTab === 'statistics') {
                    renderLeaderboard();
                }
            });
        });

        // Combination Filter select
        const comboSelect = root.querySelector('#comboFilterSelect');
        if (comboSelect) {
            comboSelect.addEventListener('change', (e) => {
                state.combinationKey = e.target.value;
                loadLeaderboardData(true);
            });
        }

        // Subject Filter select
        const subjSelect = root.querySelector('#subjectFilterSelect');
        if (subjSelect) {
            subjSelect.addEventListener('change', (e) => {
                state.subject = e.target.value;
                loadLeaderboardData(true);
            });
        }

        // Pagination Prev
        const btnPrev = root.querySelector('#btnLdbPrev');
        if (btnPrev) {
            btnPrev.addEventListener('click', () => {
                if (state.offset > 0 && !state.loading) {
                    state.offset = Math.max(0, state.offset - state.limit);
                    loadLeaderboardData(false);
                }
            });
        }

        // Pagination Next
        const btnNext = root.querySelector('#btnLdbNext');
        if (btnNext) {
            btnNext.addEventListener('click', () => {
                if (state.data?.pagination?.has_more && !state.loading) {
                    state.offset += state.limit;
                    loadLeaderboardData(false);
                }
            });
        }
    }

    // =========================================================================
    // 6. EXPORT GLOBAL INTERFACE
    // =========================================================================

    window.utmeLeaderboard = {
        state,
        openLeaderboard,
        closeLeaderboard,
        loadLeaderboardData,
        renderLeaderboard,
        escapeHtml
    };

})();
