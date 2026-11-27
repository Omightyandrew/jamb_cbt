/**
 * ExamPilot UTME Challenge 2027 — Admin Management Module
 * File: utme-challenge-admin.js
 * 
 * Implements Milestone 1 Admin Panel:
 * 1. Season management (create, list, activate/deactivate)
 * 2. Weekly round management (create, list, edit, status tracking)
 * 3. Round subject configuration (>= 4 accredited subjects, 1-50 Q per subject, default 10)
 * 4. Question bank management & pool health analytics
 * 5. Question approval, rejection & archiving workflow
 * 6. Automated round paper builder
 * 7. Paper preview inspector with missing/unapproved integrity flags
 * 8. Safe round freezing & scheduling
 * 9. Safe round unscheduling (zero student attempts enforced)
 * 10. Comprehensive round overview & attempt monitoring
 * 
 * Uses strictly verified Phase 2B-1 admin RPC functions via window.supabaseClient.
 */

(function () {
  "use strict";

  // Accredited 13 UTME Challenge subjects matching Phase 1 & 2 database CHECK constraints
  const ACCREDITED_SUBJECTS = [
    "English", "Mathematics", "Physics", "Chemistry", "Biology",
    "Government", "Literature in English", "Economics", "Commerce",
    "Accounting", "Geography", "CRS", "History"
  ];

  // Internal module state
  const state = {
    activeSubTab: "overview",
    seasons: [],
    activeSeason: null,
    rounds: [],
    selectedRoundId: null,
    selectedRound: null,
    poolSummary: null,
    questions: [],
    questionsTotal: 0,
    questionsLimit: 25,
    questionsOffset: 0,
    filterSubject: "",
    filterStatus: "",
    previewQuestions: [],
    importPreview: null,
    importing: false,
    busy: false
  };

  /* -------------------------------------------------------------------------- */
  /* Helpers                                                                    */
  /* -------------------------------------------------------------------------- */

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getClient() {
    if (window.supabaseClient) return window.supabaseClient;
    throw new Error("Supabase client is not initialized.");
  }

  function showToast(message, type = "info") {
    let toast = document.getElementById("utmeAdminToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "utmeAdminToast";
      toast.className = "utme-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `utme-toast ${type} active`;
    setTimeout(() => {
      toast.classList.remove("active");
    }, 4000);
  }

  function formatDate(isoStr) {
    if (!isoStr) return "—";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (e) {
      return isoStr;
    }
  }

  function toLocalDatetimeInput(isoStr) {
    if (!isoStr) return "";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return "";
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch (e) {
      return "";
    }
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("active");
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("active");
  }

  /* -------------------------------------------------------------------------- */
  /* Entry Point & Subtab Switching                                             */
  /* -------------------------------------------------------------------------- */

  async function loadUtmeChallengeAdmin() {
    try {
      await refreshAllData();
    } catch (err) {
      console.error("Failed to load UTME Challenge Admin:", err);
      showToast(err.message || "Failed to load UTME Challenge data", "error");
    }
  }

  function switchUtmeTab(tabName) {
    state.activeSubTab = tabName;
    document.querySelectorAll(".utme-subnav button").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tabName);
    });
    document.querySelectorAll(".utme-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `utmePanel_${tabName}`);
    });

    if (tabName === "rounds") {
      loadRounds();
    } else if (tabName === "bank") {
      loadPoolSummary();
      loadQuestions();
    } else if (tabName === "paper") {
      loadRoundsForPaper();
    } else if (tabName === "import") {
      loadImportPreview();
    }
  }

  async function refreshAllData() {
    await loadSeasons();
    await loadRounds();
    await loadPoolSummary();
  }

  /* -------------------------------------------------------------------------- */
  /* 1. Season Management                                                       */
  /* -------------------------------------------------------------------------- */

  async function loadSeasons() {
    try {
      const client = getClient();
      // Query seasons table directly for admin overview
      const { data, error } = await client
        .from("utme_challenge_seasons")
        .select("*")
        .order("year", { ascending: false });

      if (error) throw error;
      state.seasons = data || [];
      state.activeSeason = state.seasons.find((s) => s.is_active) || null;

      renderSeasonsOverview();
      updateSeasonSelectors();
    } catch (err) {
      console.error("Error loading seasons:", err);
      showToast("Failed to load seasons: " + err.message, "error");
    }
  }

  function renderSeasonsOverview() {
    const container = document.getElementById("utmeSeasonsList");
    const activeBadge = document.getElementById("utmeActiveSeasonBadge");
    const activeTitle = document.getElementById("utmeActiveSeasonTitle");

    if (activeBadge && activeTitle) {
      if (state.activeSeason) {
        activeBadge.textContent = "ACTIVE";
        activeBadge.className = "utme-badge badge-active";
        activeTitle.textContent = `${state.activeSeason.title} (${state.activeSeason.year})`;
      } else {
        activeBadge.textContent = "NO ACTIVE SEASON";
        activeBadge.className = "utme-badge badge-draft";
        activeTitle.textContent = "None configured";
      }
    }

    if (!container) return;

    if (state.seasons.length === 0) {
      container.innerHTML = `
        <div class="utme-empty">
          <span class="utme-empty-icon">📅</span>
          <p>No competition seasons found. Click <strong>+ New Season</strong> to set up UTME Challenge 2027.</p>
        </div>`;
      return;
    }

    let html = `
      <div class="utme-table-wrap">
        <table class="utme-table">
          <thead>
            <tr>
              <th>Year</th>
              <th>Title</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>`;

    state.seasons.forEach((season) => {
      const isActive = season.is_active;
      html += `
        <tr>
          <td><strong>${season.year}</strong></td>
          <td>${escapeHtml(season.title)}</td>
          <td>
            <span class="utme-badge ${isActive ? "badge-active" : "badge-draft"}">
              ${isActive ? "Active" : "Inactive"}
            </span>
          </td>
          <td>${formatDate(season.created_at)}</td>
          <td>
            <div class="utme-actions">
              <button class="utme-btn utme-btn-secondary utme-btn-sm" onclick="window.utmeAdmin.editSeason('${season.id}')">
                Edit
              </button>
              ${
                isActive
                  ? `<button class="utme-btn utme-btn-secondary utme-btn-sm" onclick="window.utmeAdmin.toggleSeasonActive('${season.id}', false)">
                      Deactivate
                    </button>`
                  : `<button class="utme-btn utme-btn-primary utme-btn-sm" onclick="window.utmeAdmin.toggleSeasonActive('${season.id}', true)">
                      Make Active
                    </button>`
              }
            </div>
          </td>
        </tr>`;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
  }

  function updateSeasonSelectors() {
    const selects = ["utmeRoundFilterSeason", "utmeNewRoundSeason"];
    selects.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const currentVal = el.value;
      el.innerHTML = state.seasons
        .map(
          (s) => `<option value="${s.id}" ${s.is_active ? "selected" : ""}>${escapeHtml(s.title)} (${s.year})${s.is_active ? " — Active" : ""}</option>`
        )
        .join("");
      if (currentVal && state.seasons.some((s) => s.id === currentVal)) {
        el.value = currentVal;
      }
    });
  }

  function openCreateSeasonModal() {
    document.getElementById("utmeSeasonModalTitle").textContent = "Create New Season";
    document.getElementById("utmeSeasonId").value = "";
    document.getElementById("utmeSeasonYear").value = new Date().getFullYear();
    document.getElementById("utmeSeasonTitle").value = `UTME Challenge ${new Date().getFullYear()}`;
    document.getElementById("utmeSeasonIsActive").checked = state.seasons.length === 0;
    openModal("utmeSeasonModal");
  }

  function editSeason(id) {
    const season = state.seasons.find((s) => s.id === id);
    if (!season) return;
    document.getElementById("utmeSeasonModalTitle").textContent = "Edit Season";
    document.getElementById("utmeSeasonId").value = season.id;
    document.getElementById("utmeSeasonYear").value = season.year;
    document.getElementById("utmeSeasonTitle").value = season.title;
    document.getElementById("utmeSeasonIsActive").checked = season.is_active;
    openModal("utmeSeasonModal");
  }

  async function submitSeason(e) {
    e.preventDefault();
    const btn = document.getElementById("utmeSeasonSubmitBtn");
    const id = document.getElementById("utmeSeasonId").value.trim() || null;
    const year = parseInt(document.getElementById("utmeSeasonYear").value, 10);
    const title = document.getElementById("utmeSeasonTitle").value.trim();
    const isActive = document.getElementById("utmeSeasonIsActive").checked;

    if (isNaN(year) || year < 2026 || year > 2099) {
      showToast("Year must be between 2026 and 2099.", "error");
      return;
    }
    if (title.length < 2 || title.length > 100) {
      showToast("Title must be between 2 and 100 characters.", "error");
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = "Saving...";
      const client = getClient();
      const { data, error } = await client.rpc("utme_challenge_admin_upsert_season", {
        p_id: id,
        p_year: year,
        p_title: title,
        p_is_active: isActive
      });

      if (error) throw error;
      showToast(`Season "${title}" saved successfully.`, "success");
      closeModal("utmeSeasonModal");
      await loadSeasons();
    } catch (err) {
      console.error("Error saving season:", err);
      showToast(err.message || "Failed to save season.", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save Season";
    }
  }

  async function toggleSeasonActive(seasonId, targetActive) {
    const season = state.seasons.find((s) => s.id === seasonId);
    if (!season) return;
    const action = targetActive ? "activate" : "deactivate";
    if (!confirm(`Are you sure you want to ${action} "${season.title}"?`)) return;

    try {
      const client = getClient();
      const { data, error } = await client.rpc("utme_challenge_admin_upsert_season", {
        p_id: season.id,
        p_year: season.year,
        p_title: season.title,
        p_is_active: targetActive
      });
      if (error) throw error;
      showToast(`Season ${action}d successfully.`, "success");
      await loadSeasons();
    } catch (err) {
      console.error("Error toggling season:", err);
      showToast(err.message || `Failed to ${action} season.`, "error");
    }
  }

  /* -------------------------------------------------------------------------- */
  /* 2. Weekly Round Management                                                 */
  /* -------------------------------------------------------------------------- */

  async function loadRounds() {
    const container = document.getElementById("utmeRoundsTableContainer");
    if (!container) return;

    try {
      container.innerHTML = `<div class="utme-empty"><p>Loading rounds...</p></div>`;
      const client = getClient();
      const seasonFilter = document.getElementById("utmeRoundFilterSeason")?.value || null;

      const { data, error } = await client.rpc("utme_challenge_admin_list_rounds", {
        p_season_id: seasonFilter
      });

      if (error) throw error;
      state.rounds = data?.rounds || [];
      renderRoundsTable();
    } catch (err) {
      console.error("Error listing rounds:", err);
      container.innerHTML = `<div class="utme-empty"><p class="utme-btn-danger">${escapeHtml(err.message)}</p></div>`;
      showToast("Failed to load rounds: " + err.message, "error");
    }
  }

  function renderRoundsTable() {
    const container = document.getElementById("utmeRoundsTableContainer");
    if (!container) return;

    if (state.rounds.length === 0) {
      container.innerHTML = `
        <div class="utme-empty">
          <span class="utme-empty-icon">🏆</span>
          <p>No rounds created for this season yet. Click <strong>+ Create Round</strong> to configure one.</p>
        </div>`;
      return;
    }

    let html = `
      <div class="utme-table-wrap">
        <table class="utme-table">
          <thead>
            <tr>
              <th>R#</th>
              <th>Title</th>
              <th>Status</th>
              <th>Window Opens / Closes</th>
              <th>Duration</th>
              <th>Paper Questions</th>
              <th>Registrations</th>
              <th>Attempts</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>`;

    state.rounds.forEach((round) => {
      const isFrozen = round.is_questions_frozen;
      let statusBadgeClass = "badge-draft";
      if (round.status === "scheduled") statusBadgeClass = "badge-scheduled";
      else if (round.status === "open") statusBadgeClass = "badge-open";
      else if (round.status === "closed") statusBadgeClass = "badge-closed";

      html += `
        <tr>
          <td><strong>#${round.round_number}</strong></td>
          <td>
            <strong>${escapeHtml(round.title)}</strong>
            ${isFrozen ? `<span class="utme-badge badge-frozen" style="margin-left:4px">FROZEN</span>` : ""}
          </td>
          <td>
            <span class="utme-badge ${statusBadgeClass}">
              ${round.status}
            </span>
          </td>
          <td>
            <small style="display:block">Starts: ${formatDate(round.start_window_opens_at)}</small>
            <small style="display:block;color:var(--muted)">Closes: ${formatDate(round.start_window_closes_at)}</small>
          </td>
          <td>
            ${round.duration_minutes}m <small style="color:var(--muted)">(+${round.grace_period_seconds}s)</small>
          </td>
          <td>
            <strong>${round.question_count || 0}</strong> assigned
          </td>
          <td>${round.registration_count || 0}</td>
          <td>${round.attempt_count || 0}</td>
          <td>
            <div class="utme-actions">
              <button class="utme-btn utme-btn-secondary utme-btn-sm" onclick="window.utmeAdmin.viewRoundDetails('${round.id}')">
                Overview
              </button>
              ${
                !isFrozen && (round.status === "draft" || round.status === "scheduled")
                  ? `<button class="utme-btn utme-btn-secondary utme-btn-sm" onclick="window.utmeAdmin.openEditRoundModal('${round.id}')">
                      Edit
                    </button>
                    <button class="utme-btn utme-btn-secondary utme-btn-sm" onclick="window.utmeAdmin.openSubjectConfigModal('${round.id}')">
                      Subjects
                    </button>`
                  : ""
              }
              <button class="utme-btn utme-btn-primary utme-btn-sm" onclick="window.utmeAdmin.jumpToPaperTab('${round.id}')">
                Paper
              </button>
            </div>
          </td>
        </tr>`;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
  }

  function openCreateRoundModal() {
    if (!state.activeSeason && state.seasons.length === 0) {
      showToast("Please create a Season before creating rounds.", "error");
      return;
    }
    document.getElementById("utmeRoundModalTitle").textContent = "Create Weekly Round";
    document.getElementById("utmeRoundFormMode").value = "create";
    document.getElementById("utmeRoundId").value = "";

    // Calculate sensible defaults
    const seasonId = state.activeSeason ? state.activeSeason.id : state.seasons[0].id;
    document.getElementById("utmeNewRoundSeason").value = seasonId;

    const existingNums = state.rounds.map((r) => r.round_number);
    const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
    document.getElementById("utmeRoundNumber").value = nextNum;
    document.getElementById("utmeRoundNumber").disabled = false;
    document.getElementById("utmeRoundTitle").value = `Weekly Challenge Round ${nextNum}`;

    // Dates default: registration opens now, closes in 5 days; test opens in 5 days, closes in 7 days
    const now = new Date();
    const regClose = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const winClose = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    document.getElementById("utmeRegOpensAt").value = toLocalDatetimeInput(now.toISOString());
    document.getElementById("utmeRegClosesAt").value = toLocalDatetimeInput(regClose.toISOString());
    document.getElementById("utmeWinOpensAt").value = toLocalDatetimeInput(regClose.toISOString());
    document.getElementById("utmeWinClosesAt").value = toLocalDatetimeInput(winClose.toISOString());

    // Configurable duration (default 45 mins) & grace period (default 30 seconds)
    document.getElementById("utmeRoundDuration").value = 45;
    document.getElementById("utmeRoundGrace").value = 30;

    openModal("utmeRoundModal");
  }

  function openEditRoundModal(roundId) {
    const round = state.rounds.find((r) => r.id === roundId);
    if (!round) return;

    document.getElementById("utmeRoundModalTitle").textContent = `Edit Round #${round.round_number}`;
    document.getElementById("utmeRoundFormMode").value = "edit";
    document.getElementById("utmeRoundId").value = round.id;

    document.getElementById("utmeNewRoundSeason").value = round.season_id;
    document.getElementById("utmeRoundNumber").value = round.round_number;
    document.getElementById("utmeRoundNumber").disabled = true;
    document.getElementById("utmeRoundTitle").value = round.title;

    document.getElementById("utmeRegOpensAt").value = toLocalDatetimeInput(round.registration_opens_at);
    document.getElementById("utmeRegClosesAt").value = toLocalDatetimeInput(round.registration_closes_at);
    document.getElementById("utmeWinOpensAt").value = toLocalDatetimeInput(round.start_window_opens_at);
    document.getElementById("utmeWinClosesAt").value = toLocalDatetimeInput(round.start_window_closes_at);

    document.getElementById("utmeRoundDuration").value = round.duration_minutes || 45;
    document.getElementById("utmeRoundGrace").value = round.grace_period_seconds || 30;

    openModal("utmeRoundModal");
  }

  async function submitRoundForm(e) {
    e.preventDefault();
    const btn = document.getElementById("utmeRoundSubmitBtn");
    const mode = document.getElementById("utmeRoundFormMode").value;
    const roundId = document.getElementById("utmeRoundId").value;
    const seasonId = document.getElementById("utmeNewRoundSeason").value;
    const roundNum = parseInt(document.getElementById("utmeRoundNumber").value, 10);
    const title = document.getElementById("utmeRoundTitle").value.trim();

    const regOpen = document.getElementById("utmeRegOpensAt").value ? new Date(document.getElementById("utmeRegOpensAt").value).toISOString() : null;
    const regClose = document.getElementById("utmeRegClosesAt").value ? new Date(document.getElementById("utmeRegClosesAt").value).toISOString() : null;
    const winOpen = document.getElementById("utmeWinOpensAt").value ? new Date(document.getElementById("utmeWinOpensAt").value).toISOString() : null;
    const winClose = document.getElementById("utmeWinClosesAt").value ? new Date(document.getElementById("utmeWinClosesAt").value).toISOString() : null;

    const duration = parseInt(document.getElementById("utmeRoundDuration").value, 10);
    const grace = parseInt(document.getElementById("utmeRoundGrace").value, 10);

    // Frontend validations matching database constraints
    if (duration < 10 || duration > 180) {
      showToast("Duration must be between 10 and 180 minutes.", "error");
      return;
    }
    if (grace < 0 || grace > 300) {
      showToast("Grace period must be between 0 and 300 seconds.", "error");
      return;
    }
    if (!regOpen || !regClose || !winOpen || !winClose) {
      showToast("All scheduling timestamps are required.", "error");
      return;
    }
    if (new Date(regClose) <= new Date(regOpen)) {
      showToast("Registration close must be after registration open.", "error");
      return;
    }
    if (new Date(winClose) < new Date(winOpen)) {
      showToast("Start window close must be after or equal to start window open.", "error");
      return;
    }
    if (new Date(regClose) > new Date(winOpen)) {
      showToast("Registration close cannot exceed start window open time.", "error");
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = "Saving...";
      const client = getClient();

      if (mode === "create") {
        const { data, error } = await client.rpc("utme_challenge_admin_create_round", {
          p_season_id: seasonId,
          p_round_number: roundNum,
          p_title: title,
          p_registration_opens_at: regOpen,
          p_registration_closes_at: regClose,
          p_start_window_opens_at: winOpen,
          p_start_window_closes_at: winClose,
          p_duration_minutes: duration,
          p_grace_period_seconds: grace
        });
        if (error) throw error;
        showToast(`Round #${roundNum} created successfully.`, "success");
      } else {
        const { data, error } = await client.rpc("utme_challenge_admin_update_round", {
          p_round_id: roundId,
          p_title: title,
          p_registration_opens_at: regOpen,
          p_registration_closes_at: regClose,
          p_start_window_opens_at: winOpen,
          p_start_window_closes_at: winClose,
          p_duration_minutes: duration,
          p_grace_period_seconds: grace
        });
        if (error) throw error;
        showToast(`Round updated successfully.`, "success");
      }

      closeModal("utmeRoundModal");
      await loadRounds();
    } catch (err) {
      console.error("Error saving round:", err);
      showToast(err.message || "Failed to save round.", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save Round";
    }
  }

  /* -------------------------------------------------------------------------- */
  /* 3. Subject Configuration                                                   */
  /* -------------------------------------------------------------------------- */

  async function openSubjectConfigModal(roundId) {
    const round = state.rounds.find((r) => r.id === roundId);
    if (!round) return;

    document.getElementById("utmeSubjectRoundId").value = round.id;
    document.getElementById("utmeSubjectModalTitle").textContent = `Configure Subjects for Round #${round.round_number}`;

    const container = document.getElementById("utmeSubjectListContainer");
    container.innerHTML = `<p class="utme-empty">Loading configured subjects...</p>`;
    openModal("utmeSubjectConfigModal");

    try {
      const client = getClient();
      const { data, error } = await client.rpc("utme_challenge_admin_round_overview", {
        p_round_id: roundId
      });

      if (error) throw error;
      const existing = (data?.subjects || []).map((s) => ({
        subject: s.subject,
        question_count: s.configured_count,
        display_order: s.display_order
      }));
      const existingMap = new Map(existing.map((s) => [s.subject, s]));

      let html = `<div class="utme-subject-config-list">`;
      ACCREDITED_SUBJECTS.forEach((subject, idx) => {
        const isSelected = existingMap.has(subject) || (existing?.length === 0 && idx < 4); // default select first 4 if fresh
        const config = existingMap.get(subject);
        const qCount = config ? config.question_count : 10;
        const displayOrder = config ? config.display_order : idx + 1;

        html += `
          <div class="utme-subject-row ${isSelected ? "selected" : ""}" id="subjRow_${idx}">
            <input type="checkbox" class="utme-subj-check" data-subject="${escapeHtml(subject)}" data-row="${idx}" ${isSelected ? "checked" : ""} onchange="window.utmeAdmin.toggleSubjectRow(${idx})">
            <div>
              <strong>${escapeHtml(subject)}</strong>
              ${subject === "English" ? `<small style="color:var(--green);font-weight:700"> · Recommended Compulsory</small>` : ""}
            </div>
            <div>
              <label style="font-size:10px;color:var(--muted)">Questions (1-50):</label>
              <input type="number" class="utme-subj-count" id="subjCount_${idx}" min="1" max="50" value="${qCount}" ${isSelected ? "" : "disabled"}>
            </div>
            <div>
              <label style="font-size:10px;color:var(--muted)">Order:</label>
              <input type="number" class="utme-subj-order" id="subjOrder_${idx}" min="0" max="999" value="${displayOrder}" ${isSelected ? "" : "disabled"}>
            </div>
          </div>`;
      });
      html += `</div>`;
      container.innerHTML = html;
    } catch (err) {
      console.error("Error loading subject configs:", err);
      container.innerHTML = `<p class="utme-btn-danger">${escapeHtml(err.message)}</p>`;
    }
  }

  function toggleSubjectRow(idx) {
    const row = document.getElementById(`subjRow_${idx}`);
    const check = row.querySelector(".utme-subj-check");
    const countInput = document.getElementById(`subjCount_${idx}`);
    const orderInput = document.getElementById(`subjOrder_${idx}`);

    row.classList.toggle("selected", check.checked);
    countInput.disabled = !check.checked;
    orderInput.disabled = !check.checked;
  }

  async function submitSubjectConfig(e) {
    e.preventDefault();
    const btn = document.getElementById("utmeSubjectConfigSubmitBtn");
    const roundId = document.getElementById("utmeSubjectRoundId").value;

    const rows = document.querySelectorAll(".utme-subject-row");
    const payload = [];

    rows.forEach((row) => {
      const check = row.querySelector(".utme-subj-check");
      if (check && check.checked) {
        const subject = check.getAttribute("data-subject");
        const idx = check.getAttribute("data-row");
        const count = parseInt(document.getElementById(`subjCount_${idx}`).value, 10);
        const order = parseInt(document.getElementById(`subjOrder_${idx}`).value, 10);
        payload.push({
          subject: subject,
          question_count: count,
          display_order: order
        });
      }
    });

    if (payload.length < 4) {
      showToast("At least 4 accredited subjects must be configured.", "error");
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = "Saving...";
      const client = getClient();
      const { data, error } = await client.rpc("utme_challenge_admin_set_round_subjects", {
        p_round_id: roundId,
        p_subjects: payload
      });

      if (error) throw error;
      showToast(`Configured ${payload.length} subjects successfully.`, "success");
      closeModal("utmeSubjectConfigModal");
      await loadRounds();
    } catch (err) {
      console.error("Error setting subjects:", err);
      showToast(err.message || "Failed to configure subjects.", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save Configuration";
    }
  }

  /* -------------------------------------------------------------------------- */
  /* 4. Question Bank & Pool Analytics                                          */
  /* -------------------------------------------------------------------------- */

  async function loadPoolSummary() {
    try {
      const client = getClient();
      const { data, error } = await client.rpc("utme_challenge_admin_question_pool_summary", {
        p_questions_per_subject: 10
      });

      if (error) throw error;
      state.poolSummary = data;
      renderPoolSummary();
    } catch (err) {
      console.error("Error loading pool summary:", err);
    }
  }

  function renderPoolSummary() {
    const summary = state.poolSummary;
    if (!summary) return;

    document.getElementById("utmeStatTotalQuestions").textContent = summary.overall.total_questions || 0;
    document.getElementById("utmeStatApprovedQuestions").textContent = summary.overall.total_approved || 0;
    document.getElementById("utmeStatDraftQuestions").textContent = summary.overall.total_draft || 0;
    document.getElementById("utmeStatRejectedQuestions").textContent = summary.overall.total_rejected || 0;

    const tableBody = document.getElementById("utmePoolSummaryTableBody");
    if (!tableBody) return;

    let html = "";
    summary.subjects.forEach((s) => {
      html += `
        <tr>
          <td><strong>${escapeHtml(s.subject)}</strong></td>
          <td>${s.total_questions}</td>
          <td><strong style="color:var(--green)">${s.approved}</strong></td>
          <td>${s.fresh_approved}</td>
          <td>${s.draft}</td>
          <td>${s.rejected}</td>
          <td><strong>${s.estimated_supportable_rounds_total}</strong> rounds</td>
        </tr>`;
    });
    tableBody.innerHTML = html;
  }

  async function loadQuestions() {
    const container = document.getElementById("utmeQuestionsListContainer");
    if (!container) return;

    try {
      container.innerHTML = `<div class="utme-empty"><p>Loading questions...</p></div>`;
      const client = getClient();
      const subject = state.filterSubject || null;
      const status = state.filterStatus || null;

      const { data, error } = await client.rpc("utme_challenge_admin_list_questions", {
        p_subject: subject,
        p_status: status,
        p_limit: state.questionsLimit,
        p_offset: state.questionsOffset
      });

      if (error) throw error;
      state.questions = data?.questions || [];
      state.questionsTotal = data?.total || 0;
      renderQuestionsList();
    } catch (err) {
      console.error("Error loading bank questions:", err);
      container.innerHTML = `<div class="utme-empty"><p class="utme-btn-danger">${escapeHtml(err.message)}</p></div>`;
      showToast("Failed to load questions: " + err.message, "error");
    }
  }

  function renderQuestionsList() {
    const container = document.getElementById("utmeQuestionsListContainer");
    if (!container) return;

    document.getElementById("utmeQuestionsCountLabel").textContent =
      `Showing ${state.questions.length} of ${state.questionsTotal} questions`;

    if (state.questions.length === 0) {
      container.innerHTML = `
        <div class="utme-empty">
          <span class="utme-empty-icon">📝</span>
          <p>No questions found matching current filters. Click <strong>+ Add Question</strong> to create one.</p>
        </div>`;
      return;
    }

    let html = `<div style="display:flex;flex-direction:column;gap:12px">`;
    state.questions.forEach((q) => {
      let badgeClass = "badge-draft";
      if (q.status === "approved") badgeClass = "badge-approved";
      else if (q.status === "rejected") badgeClass = "badge-rejected";
      else if (q.status === "archived") badgeClass = "badge-archived";

      const opts = Array.isArray(q.options) ? q.options : [];

      html += `
        <div class="utme-preview-card">
          <div class="utme-preview-head">
            <div>
              <span class="utme-badge ${badgeClass}">${q.status}</span>
              <strong style="margin-left:8px">${escapeHtml(q.subject)}</strong>
              <small style="color:var(--muted)"> · ${escapeHtml(q.topic)}</small>
            </div>
            <div>
              <small style="color:var(--muted)">Used: <strong>${q.usage_count || 0}</strong> times</small>
            </div>
          </div>
          <div style="font-size:13px;font-weight:700;line-height:1.5;margin-bottom:8px">
            ${escapeHtml(q.question_text)}
          </div>
          <div class="utme-preview-options">
            <div class="utme-preview-opt ${q.correct_option === "A" ? "is-correct" : ""}">
              <strong>A:</strong> ${escapeHtml(opts[0] || "")}
            </div>
            <div class="utme-preview-opt ${q.correct_option === "B" ? "is-correct" : ""}">
              <strong>B:</strong> ${escapeHtml(opts[1] || "")}
            </div>
            <div class="utme-preview-opt ${q.correct_option === "C" ? "is-correct" : ""}">
              <strong>C:</strong> ${escapeHtml(opts[2] || "")}
            </div>
            <div class="utme-preview-opt ${q.correct_option === "D" ? "is-correct" : ""}">
              <strong>D:</strong> ${escapeHtml(opts[3] || "")}
            </div>
          </div>
          ${q.explanation ? `<div class="utme-preview-explanation"><strong>Explanation:</strong> ${escapeHtml(q.explanation)}</div>` : ""}
          <div class="utme-actions" style="margin-top:12px;justify-content:flex-end">
            <button class="utme-btn utme-btn-secondary utme-btn-sm" onclick="window.utmeAdmin.openEditQuestionModal('${q.id}')">
              Edit
            </button>
            ${
              q.status !== "approved"
                ? `<button class="utme-btn utme-btn-primary utme-btn-sm" onclick="window.utmeAdmin.setQuestionStatus('${q.id}', 'approved')">
                    Approve
                  </button>`
                : ""
            }
            ${
              q.status !== "rejected"
                ? `<button class="utme-btn utme-btn-danger utme-btn-sm" onclick="window.utmeAdmin.setQuestionStatus('${q.id}', 'rejected')">
                    Reject
                  </button>`
                : ""
            }
            ${
              q.status !== "archived"
                ? `<button class="utme-btn utme-btn-secondary utme-btn-sm" onclick="window.utmeAdmin.setQuestionStatus('${q.id}', 'archived')">
                    Archive
                  </button>`
                : ""
            }
          </div>
        </div>`;
    });
    html += `</div>`;
    container.innerHTML = html;
  }

  function applyQuestionFilters() {
    state.filterSubject = document.getElementById("utmeFilterSubject").value;
    state.filterStatus = document.getElementById("utmeFilterStatus").value;
    state.questionsOffset = 0;
    loadQuestions();
  }

  function openAddQuestionModal() {
    document.getElementById("utmeQuestionModalTitle").textContent = "Add Question to Bank";
    document.getElementById("utmeQuestionFormMode").value = "add";
    document.getElementById("utmeQuestionId").value = "";

    document.getElementById("utmeQSubject").value = ACCREDITED_SUBJECTS[0];
    document.getElementById("utmeQSubject").disabled = false;
    document.getElementById("utmeQTopic").value = "";
    document.getElementById("utmeQText").value = "";
    document.getElementById("utmeOptA").value = "";
    document.getElementById("utmeOptB").value = "";
    document.getElementById("utmeOptC").value = "";
    document.getElementById("utmeOptD").value = "";
    document.getElementById("utmeQCorrect").value = "A";
    document.getElementById("utmeQExplanation").value = "";

    openModal("utmeQuestionModal");
  }

  function openEditQuestionModal(qId) {
    const q = state.questions.find((item) => item.id === qId);
    if (!q) return;

    document.getElementById("utmeQuestionModalTitle").textContent = "Edit Question";
    document.getElementById("utmeQuestionFormMode").value = "edit";
    document.getElementById("utmeQuestionId").value = q.id;

    document.getElementById("utmeQSubject").value = q.subject;
    document.getElementById("utmeQSubject").disabled = true; // Subject is immutable post-creation
    document.getElementById("utmeQTopic").value = q.topic;
    document.getElementById("utmeQText").value = q.question_text;

    const opts = Array.isArray(q.options) ? q.options : [];
    document.getElementById("utmeOptA").value = opts[0] || "";
    document.getElementById("utmeOptB").value = opts[1] || "";
    document.getElementById("utmeOptC").value = opts[2] || "";
    document.getElementById("utmeOptD").value = opts[3] || "";
    document.getElementById("utmeQCorrect").value = q.correct_option;
    document.getElementById("utmeQExplanation").value = q.explanation || "";

    openModal("utmeQuestionModal");
  }

  async function submitQuestionForm(e) {
    e.preventDefault();
    const btn = document.getElementById("utmeQuestionSubmitBtn");
    const mode = document.getElementById("utmeQuestionFormMode").value;
    const qId = document.getElementById("utmeQuestionId").value;

    const subject = document.getElementById("utmeQSubject").value;
    const topic = document.getElementById("utmeQTopic").value.trim();
    const qText = document.getElementById("utmeQText").value.trim();
    const optA = document.getElementById("utmeOptA").value.trim();
    const optB = document.getElementById("utmeOptB").value.trim();
    const optC = document.getElementById("utmeOptC").value.trim();
    const optD = document.getElementById("utmeOptD").value.trim();
    const correct = document.getElementById("utmeQCorrect").value;
    const explanation = document.getElementById("utmeQExplanation").value.trim() || null;

    if (topic.length < 2 || topic.length > 100) {
      showToast("Topic must be between 2 and 100 characters.", "error");
      return;
    }
    if (qText.length < 10) {
      showToast("Question text must be at least 10 characters.", "error");
      return;
    }
    if (!optA || !optB || !optC || !optD) {
      showToast("All four options (A, B, C, D) must be provided.", "error");
      return;
    }

    const options = [optA, optB, optC, optD];
    const lowerOpts = options.map((o) => o.toLowerCase());
    if (new Set(lowerOpts).size !== 4) {
      showToast("Options must be distinct (case-insensitive check).", "error");
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = "Saving...";
      const client = getClient();

      if (mode === "add") {
        const { data, error } = await client.rpc("utme_challenge_admin_add_question", {
          p_subject: subject,
          p_topic: topic,
          p_question_text: qText,
          p_options: options,
          p_correct_option: correct,
          p_explanation: explanation
        });
        if (error) throw error;
        showToast("Question added to bank in 'draft' status.", "success");
      } else {
        const { data, error } = await client.rpc("utme_challenge_admin_update_question", {
          p_question_id: qId,
          p_topic: topic,
          p_question_text: qText,
          p_options: options,
          p_correct_option: correct,
          p_explanation: explanation
        });
        if (error) throw error;
        showToast("Question updated successfully.", "success");
      }

      closeModal("utmeQuestionModal");
      await loadPoolSummary();
      await loadQuestions();
    } catch (err) {
      console.error("Error saving question:", err);
      showToast(err.message || "Failed to save question.", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save Question";
    }
  }

  async function setQuestionStatus(qId, newStatus) {
    try {
      const client = getClient();
      const { data, error } = await client.rpc("utme_challenge_admin_set_question_status", {
        p_question_id: qId,
        p_status: newStatus
      });
      if (error) throw error;
      showToast(`Question status updated to "${newStatus}".`, "success");
      await loadPoolSummary();
      await loadQuestions();
    } catch (err) {
      console.error("Error setting question status:", err);
      showToast(err.message || "Failed to update status.", "error");
    }
  }

  /* -------------------------------------------------------------------------- */
  /* 5. Paper Generation, Preview & Lifecycle                                  */
  /* -------------------------------------------------------------------------- */

  async function loadRoundsForPaper() {
    const selector = document.getElementById("utmePaperRoundSelect");
    if (!selector) return;

    selector.innerHTML = state.rounds
      .map(
        (r) => `<option value="${r.id}" ${r.id === state.selectedRoundId ? "selected" : ""}>Round #${r.round_number}: ${escapeHtml(r.title)} (${r.status}${r.is_questions_frozen ? " · FROZEN" : ""})</option>`
      )
      .join("");

    if (state.rounds.length > 0) {
      const targetId = state.selectedRoundId || state.rounds[0].id;
      selector.value = targetId;
      selectPaperRound(targetId);
    }
  }

  function jumpToPaperTab(roundId) {
    state.selectedRoundId = roundId;
    switchUtmeTab("paper");
  }

  function selectPaperRound(roundId) {
    state.selectedRoundId = roundId;
    state.selectedRound = state.rounds.find((r) => r.id === roundId) || null;
    renderPaperControlPanel();
    loadPaperPreview(roundId);
  }

  function renderPaperControlPanel() {
    const round = state.selectedRound;
    const actionsBox = document.getElementById("utmePaperRoundActions");
    const statusBox = document.getElementById("utmePaperRoundStatus");
    if (!round || !actionsBox) return;

    const isFrozen = round.is_questions_frozen;
    const isDraft = round.status === "draft";
    const isScheduled = round.status === "scheduled";
    const hasAttempts = (round.attempt_count || 0) > 0;

    statusBox.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <h4 style="margin:0">Round #${round.round_number}: ${escapeHtml(round.title)}</h4>
        <span class="utme-badge ${isFrozen ? "badge-frozen" : "badge-draft"}">${isFrozen ? "FROZEN &amp; LOCKED" : "UNFROZEN / DRAFT"}</span>
      </div>
      <p style="margin:0;font-size:12px;color:var(--muted)">
        Assigned questions: <strong>${round.question_count || 0}</strong> · Window: ${formatDate(round.start_window_opens_at)} to ${formatDate(round.start_window_closes_at)}
      </p>`;

    actionsBox.innerHTML = `
      ${
        !isFrozen && isDraft
          ? `<button class="utme-btn utme-btn-secondary" onclick="window.utmeAdmin.buildPaper('${round.id}')">
              🎲 Build / Rebuild Paper
            </button>
            <button class="utme-btn utme-btn-primary" onclick="window.utmeAdmin.freezeAndSchedule('${round.id}')">
              🔒 Freeze &amp; Schedule Round
            </button>`
          : ""
      }
      ${
        isFrozen && isScheduled && !hasAttempts
          ? `<button class="utme-btn utme-btn-danger" onclick="window.utmeAdmin.unschedule('${round.id}')">
              🔓 Unschedule Round (Revert to Draft)
            </button>`
          : ""
      }
      ${
        hasAttempts
          ? `<span style="font-size:11px;color:var(--muted);font-weight:600">Student attempts exist. Unschedule is locked.</span>`
          : ""
      }`;
  }

  async function buildPaper(roundId) {
    if (!confirm("Build paper questions for this round? This will allocate approved questions matching configured counts.")) return;

    try {
      showToast("Allocating questions from bank...", "info");
      const client = getClient();
      const { data, error } = await client.rpc("utme_challenge_admin_build_round_paper", {
        p_round_id: roundId
      });
      if (error) throw error;
      showToast(`Paper built successfully! Assigned ${data.total_questions_assigned} questions.`, "success");
      await loadRounds();
      selectPaperRound(roundId);
    } catch (err) {
      console.error("Error building paper:", err);
      showToast(err.message || "Failed to build paper.", "error");
    }
  }

  async function freezeAndSchedule(roundId) {
    const confirmation = confirm(
      "IMPORTANT: Freezing permanently locks all questions in this round paper. " +
      "Snapshots will be validated against the question bank, usage counts will increment, " +
      "and the round will transition to 'scheduled'. Proceed?"
    );
    if (!confirmation) return;

    try {
      showToast("Validating snapshots and freezing paper...", "info");
      const client = getClient();
      const { data, error } = await client.rpc("utme_challenge_admin_freeze_and_schedule_round", {
        p_round_id: roundId
      });
      if (error) throw error;
      showToast(`Round frozen and scheduled successfully! (${data.questions_frozen_count} questions locked)`, "success");
      await loadRounds();
      selectPaperRound(roundId);
    } catch (err) {
      console.error("Error freezing round:", err);
      showToast(err.message || "Snapshot integrity or freeze validation failed.", "error");
    }
  }

  async function unschedule(roundId) {
    const confirmation = confirm(
      "WARNING: Unscheduling will unlock the questions, authoritatively recalculate usage history, " +
      "clear assigned round questions, and revert the round to 'draft' status. Proceed?"
    );
    if (!confirmation) return;

    try {
      showToast("Recalculating usage counts and unscheduling...", "info");
      const client = getClient();
      const { data, error } = await client.rpc("utme_challenge_admin_unschedule_round", {
        p_round_id: roundId
      });
      if (error) throw error;
      showToast("Round reverted to draft successfully.", "success");
      await loadRounds();
      selectPaperRound(roundId);
    } catch (err) {
      console.error("Error unscheduling round:", err);
      showToast(err.message || "Failed to unschedule round.", "error");
    }
  }

  async function loadPaperPreview(roundId) {
    const container = document.getElementById("utmePaperPreviewContainer");
    if (!container) return;

    try {
      container.innerHTML = `<div class="utme-empty"><p>Loading paper preview...</p></div>`;
      const client = getClient();
      const subjectFilter = document.getElementById("utmePaperSubjectFilter")?.value || null;

      const { data, error } = await client.rpc("utme_challenge_admin_preview_round_paper", {
        p_round_id: roundId,
        p_subject: subjectFilter
      });

      if (error) throw error;
      state.previewQuestions = data?.questions || [];
      renderPaperPreview(data);
    } catch (err) {
      console.error("Error loading paper preview:", err);
      container.innerHTML = `<div class="utme-empty"><p class="utme-btn-danger">${escapeHtml(err.message)}</p></div>`;
    }
  }

  function renderPaperPreview(report) {
    const container = document.getElementById("utmePaperPreviewContainer");
    if (!container) return;

    if (!report || report.total_assigned_questions === 0) {
      container.innerHTML = `
        <div class="utme-empty">
          <span class="utme-empty-icon">📄</span>
          <p>No questions assigned to this round paper yet. Click <strong>Build Paper</strong> above to generate questions.</p>
        </div>`;
      return;
    }

    let alertBanner = "";
    if (report.has_integrity_issues) {
      alertBanner = `
        <div style="background:#fff0ee;border:1px solid #fad2cf;border-radius:10px;padding:12px 16px;margin-bottom:14px;color:#a02922;font-size:12px">
          <strong>⚠️ Integrity Issues Detected:</strong>
          ${report.missing_bank_questions_count > 0 ? `<span>${report.missing_bank_questions_count} questions missing from bank. </span>` : ""}
          ${report.unapproved_bank_questions_count > 0 ? `<span>${report.unapproved_bank_questions_count} questions are not in 'approved' status. </span>` : ""}
          Rebuild paper before attempting to freeze!
        </div>`;
    }

    let html = alertBanner + `<div class="utme-preview-list">`;
    report.questions.forEach((q) => {
      const opts = Array.isArray(q.options) ? q.options : [];
      html += `
        <div class="utme-preview-card ${q.has_integrity_issue ? "has-issue" : ""}">
          <div class="utme-preview-head">
            <div>
              <strong>#${q.position}</strong> &nbsp;
              <span class="utme-badge badge-scheduled">${escapeHtml(q.subject)}</span>
              ${q.has_integrity_issue ? `<span class="utme-badge badge-rejected" style="margin-left:6px">INTEGRITY ISSUE</span>` : ""}
            </div>
            <div>
              <small style="color:var(--muted)">Bank Status: <strong>${q.bank_status}</strong></small>
            </div>
          </div>
          <div style="font-size:13px;font-weight:700;line-height:1.5;margin-bottom:8px">
            ${escapeHtml(q.question_text)}
          </div>
          <div class="utme-preview-options">
            <div class="utme-preview-opt ${q.correct_option === "A" ? "is-correct" : ""}">
              <strong>A:</strong> ${escapeHtml(opts[0] || "")}
            </div>
            <div class="utme-preview-opt ${q.correct_option === "B" ? "is-correct" : ""}">
              <strong>B:</strong> ${escapeHtml(opts[1] || "")}
            </div>
            <div class="utme-preview-opt ${q.correct_option === "C" ? "is-correct" : ""}">
              <strong>C:</strong> ${escapeHtml(opts[2] || "")}
            </div>
            <div class="utme-preview-opt ${q.correct_option === "D" ? "is-correct" : ""}">
              <strong>D:</strong> ${escapeHtml(opts[3] || "")}
            </div>
          </div>
          ${q.explanation ? `<div class="utme-preview-explanation"><strong>Explanation:</strong> ${escapeHtml(q.explanation)}</div>` : ""}
        </div>`;
    });
    html += `</div>`;
    container.innerHTML = html;
  }

  /* -------------------------------------------------------------------------- */
  /* 6. Round Monitoring Details                                                */
  /* -------------------------------------------------------------------------- */

  async function viewRoundDetails(roundId) {
    try {
      const client = getClient();
      const { data, error } = await client.rpc("utme_challenge_admin_round_overview", {
        p_round_id: roundId
      });
      if (error) throw error;

      document.getElementById("utmeDetailsRoundTitle").textContent = `Round #${data.round.round_number}: ${data.round.title}`;
      document.getElementById("utmeDetailsSeason").textContent = `${data.round.season_title} (${data.round.season_year})`;
      document.getElementById("utmeDetailsStatus").textContent = data.round.status.toUpperCase();
      document.getElementById("utmeDetailsFrozen").textContent = data.round.is_questions_frozen ? `FROZEN at ${formatDate(data.round.frozen_at)}` : "NO";
      document.getElementById("utmeDetailsDuration").textContent = `${data.round.duration_minutes} mins (+${data.round.grace_period_seconds}s grace)`;

      // Attempts
      document.getElementById("utmeStatTotalAttempts").textContent = data.attempts_summary.total;
      document.getElementById("utmeStatSubmittedAttempts").textContent = data.attempts_summary.submitted;
      document.getElementById("utmeStatInProgressAttempts").textContent = data.attempts_summary.in_progress;
      document.getElementById("utmeStatAvgScore").textContent = `${data.attempts_summary.average_score}%`;
      document.getElementById("utmeStatMaxScore").textContent = `${data.attempts_summary.highest_score}%`;

      // Subjects table
      const subTable = document.getElementById("utmeDetailsSubjectsBody");
      let subHtml = "";
      data.subjects.forEach((s) => {
        subHtml += `
          <tr>
            <td><strong>${escapeHtml(s.subject)}</strong></td>
            <td>${s.configured_count}</td>
            <td><strong>${s.assigned_count}</strong></td>
            <td>${s.available_approved_pool} approved</td>
          </tr>`;
      });
      subTable.innerHTML = subHtml;

      openModal("utmeRoundDetailsModal");
    } catch (err) {
      console.error("Error viewing round details:", err);
      showToast(err.message || "Failed to load round details.", "error");
    }
  }

  /* -------------------------------------------------------------------------- */
  /* 5. Question Bank Import Bridge                                             */
  /* -------------------------------------------------------------------------- */

  async function loadImportPreview(force = false) {
    if (state.importing && !force) return;
    const refreshBtn = document.getElementById("utmeImportRefreshBtn");
    const executeBtn = document.getElementById("utmeImportExecuteBtn");
    const tbody = document.getElementById("utmeImportSubjectTbody");
    const disqList = document.getElementById("utmeImportDisqList");

    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Loading...";
    }

    try {
      const client = getClient();
      const { data, error } = await client.rpc("utme_challenge_admin_preview_question_import", {
        p_test_type: "all",
        p_subject: null
      });

      if (error) throw error;
      state.importPreview = data;
      renderImportPreview(data);
    } catch (err) {
      console.error("Error loading import preview:", err);
      showToast(err.message || "Failed to load import preview.", "error");
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="5" class="utme-empty" style="color:#e53e3e">Failed to load preview: ${escapeHtml(err.message)}</td></tr>`;
      }
      if (disqList) {
        disqList.innerHTML = `<div class="utme-empty" style="color:#e53e3e"><p>Failed to load preview: ${escapeHtml(err.message)}</p></div>`;
      }
    } finally {
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.textContent = "↻ Refresh Preview";
      }
    }
  }

  function renderImportPreview(data) {
    if (!data || !data.summary) return;

    const summary = data.summary;
    const disq = summary.disqualification_breakdown || {};

    // Normalize data.subjects: the RPC returns a JSON array of subject breakdown objects,
    // each with { subject: "English", eligible_new: ..., already_imported: ..., disqualified: ..., ... }
    const subjectMap = {};
    if (Array.isArray(data.subjects)) {
      data.subjects.forEach((s) => {
        if (s && s.subject) {
          subjectMap[s.subject] = s;
        }
      });
    } else if (data.subjects && typeof data.subjects === "object") {
      Object.assign(subjectMap, data.subjects);
    }

    // 1. Stats Cards
    const totalEl = document.getElementById("utmeImportTotalScanned");
    const eligibleEl = document.getElementById("utmeImportEligibleNew");
    const alreadyEl = document.getElementById("utmeImportAlreadyImported");
    const disqEl = document.getElementById("utmeImportDisqualified");

    if (totalEl) totalEl.textContent = Number(summary.total_candidates_scanned || 0).toLocaleString();
    if (eligibleEl) eligibleEl.textContent = Number(summary.eligible_new || 0).toLocaleString();
    if (alreadyEl) alreadyEl.textContent = Number(summary.already_imported || 0).toLocaleString();
    if (disqEl) disqEl.textContent = Number(summary.total_disqualified || 0).toLocaleString();

    // 2. Enable / Disable Import Execute Button
    const executeBtn = document.getElementById("utmeImportExecuteBtn");
    if (executeBtn) {
      const eligibleCount = Number(summary.eligible_new || 0);
      executeBtn.disabled = state.importing || eligibleCount === 0;
      executeBtn.title = eligibleCount === 0 ? "No new eligible questions to import" : "Import eligible questions";
    }

    // 3. Subject Breakdown Table
    const tbody = document.getElementById("utmeImportSubjectTbody");
    if (tbody) {
      let rowsHtml = "";
      ACCREDITED_SUBJECTS.forEach((subj) => {
        const sData = subjectMap[subj] || {
          eligible_new: 0,
          already_imported: 0,
          disqualified: 0,
          current_bank_total: 0,
          current_bank_approved: 0
        };
        const elNew = Number(sData.eligible_new || 0);
        const alImp = Number(sData.already_imported || 0);
        const disqCount = Number(sData.disqualified || 0);
        const bankTotal = Number(sData.current_bank_total || 0);
        const bankAppr = Number(sData.current_bank_approved || 0);

        rowsHtml += `
          <tr>
            <td><strong>${escapeHtml(subj)}</strong></td>
            <td><span style="font-weight:700;color:${elNew > 0 ? "var(--primary, #00b074)" : "var(--muted)"}">${elNew.toLocaleString()}</span></td>
            <td>${alImp.toLocaleString()}</td>
            <td>${disqCount > 0 ? `<span style="color:#e53e3e">${disqCount.toLocaleString()}</span>` : "0"}</td>
            <td>${bankTotal.toLocaleString()} <span style="font-size:11px;color:var(--muted)">(${bankAppr} approved)</span></td>
          </tr>
        `;
      });
      tbody.innerHTML = rowsHtml;
    }

    // 4. Disqualification Breakdown List
    const disqList = document.getElementById("utmeImportDisqList");
    if (disqList) {
      const reasons = [
        { key: "unsupported_subject", label: "Non-accredited / Unmapped Subject", desc: "Question subject does not match any of the 13 UTME Challenge subjects." },
        { key: "invalid_question_text", label: "Invalid Question Text", desc: "Missing question text or fewer than 10 non-whitespace characters." },
        { key: "incomplete_options", label: "Incomplete Options (A, B, C, D)", desc: "One or more options (A, B, C, or D) are blank or missing." },
        { key: "duplicate_options", label: "Duplicate Option Texts", desc: "Two or more options contain identical text." },
        { key: "invalid_answer_key", label: "Invalid Answer Key", desc: "Correct answer could not be normalized to a valid option (A, B, C, or D)." }
      ];

      let listHtml = `<div style="display:flex;flex-direction:column;gap:10px">`;
      reasons.forEach((r) => {
        const count = Number(disq[r.key] || 0);
        listHtml += `
          <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 14px;background:#f8faf9;border-radius:8px;border:1px solid #eef2f0;gap:12px">
            <div>
              <div style="font-weight:600;font-size:13px;color:#1e293b">${escapeHtml(r.label)}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px">${escapeHtml(r.desc)}</div>
            </div>
            <span class="utme-disq-pill">${count.toLocaleString()}</span>
          </div>
        `;
      });
      listHtml += `</div>`;
      disqList.innerHTML = listHtml;
    }
  }

  function confirmAndImportQuestions() {
    if (state.importing) return;
    const eligibleCount = state.importPreview && state.importPreview.summary
      ? Number(state.importPreview.summary.eligible_new || 0)
      : 0;

    const detailsEl = document.getElementById("utmeImportConfirmDetails");
    if (detailsEl) {
      detailsEl.innerHTML = `You are about to import <strong>${eligibleCount.toLocaleString()}</strong> eligible active JAMB questions into the UTME Challenge question bank as <strong>drafts</strong>.`;
    }

    openModal("utmeImportConfirmModal");
  }

  async function executeQuestionImport() {
    if (state.importing) return;
    closeModal("utmeImportConfirmModal");

    state.importing = true;
    const executeBtn = document.getElementById("utmeImportExecuteBtn");
    const refreshBtn = document.getElementById("utmeImportRefreshBtn");
    const banner = document.getElementById("utmeImportResultBanner");

    if (executeBtn) {
      executeBtn.disabled = true;
      executeBtn.textContent = "⏳ Importing Questions...";
    }
    if (refreshBtn) {
      refreshBtn.disabled = true;
    }

    if (banner) {
      banner.style.display = "block";
      banner.className = "utme-alert utme-alert-info";
      banner.innerHTML = `<strong>Import in progress...</strong> Validating and inserting eligible questions into the Challenge bank. Please wait.`;
    }

    try {
      const client = getClient();
      const { data, error } = await client.rpc("utme_challenge_admin_import_questions", {
        p_test_type: "all",
        p_subject: null,
        p_limit: null
      });

      if (error) throw error;

      const imported = Number(data.imported_count || 0);
      const skipped = Number(data.skipped_already_imported_count || 0);
      const disqualified = Number(data.disqualified_count || 0);

      if (banner) {
        banner.className = "utme-alert utme-alert-success";
        banner.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-size:16px">✅</span>
            <strong>Import Completed Successfully!</strong>
          </div>
          <div>
            <strong>${imported.toLocaleString()}</strong> new questions imported as <strong>drafts</strong>.
            <span style="color:#4a5568">(${skipped.toLocaleString()} duplicate/already-imported skipped, ${disqualified.toLocaleString()} disqualified)</span>
          </div>
        `;
      }
      showToast(`Successfully imported ${imported.toLocaleString()} questions!`, "success");

      // Auto-refresh preview to update stats
      state.importing = false;
      await loadImportPreview(true);

      // Refresh pool summary in background for Question Bank tab
      loadPoolSummary();
    } catch (err) {
      console.error("Error executing question import:", err);
      showToast(err.message || "Failed to import questions.", "error");
      if (banner) {
        banner.className = "utme-alert utme-alert-error";
        banner.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-size:16px">❌</span>
            <strong>Import Failed</strong>
          </div>
          <div>${escapeHtml(err.message || "An unexpected error occurred during import.")}</div>
        `;
      }
    } finally {
      state.importing = false;
      if (executeBtn) {
        executeBtn.textContent = "📥 Import All Eligible Questions";
        const eligibleCount = state.importPreview && state.importPreview.summary
          ? Number(state.importPreview.summary.eligible_new || 0)
          : 0;
        executeBtn.disabled = eligibleCount === 0;
      }
      if (refreshBtn) {
        refreshBtn.disabled = false;
      }
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Public Interface Exposed on window.utmeAdmin                               */
  /* -------------------------------------------------------------------------- */

  window.loadUtmeChallengeAdmin = loadUtmeChallengeAdmin;
  window.utmeAdmin = {
    switchTab: switchUtmeTab,
    refreshAll: refreshAllData,

    // Seasons
    openCreateSeasonModal,
    editSeason,
    submitSeason,
    toggleSeasonActive,

    // Rounds
    openCreateRoundModal,
    openEditRoundModal,
    submitRoundForm,
    viewRoundDetails,
    openSubjectConfigModal,
    toggleSubjectRow,
    submitSubjectConfig,

    // Bank
    applyQuestionFilters,
    openAddQuestionModal,
    openEditQuestionModal,
    submitQuestionForm,
    setQuestionStatus,

    // Paper
    jumpToPaperTab,
    selectPaperRound,
    buildPaper,
    freezeAndSchedule,
    unschedule,
    loadPaperPreview,

    // Import Bridge
    loadImportPreview,
    confirmAndImportQuestions,
    executeQuestionImport,

    // Modals
    closeModal
  };

})();
