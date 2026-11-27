-- ExamPilot UTME Challenge 2027: Phase 2A Student Functions
-- Migration: 20261124020000_utme_challenge_phase2a_student_functions.sql
-- Strictly additive. Implements student-facing and internal evaluation functions.
-- All functions are SECURITY DEFINER with SET search_path = pg_catalog, public.
-- Direct table privileges remain fully protected; question keys are never exposed.

BEGIN;

-- ============================================================================
-- 1. UTME CHALLENGE IS PREMIUM (INTERNAL HELPER)
-- Replicates EXACTLY the application's Premium entitlement logic from
-- premium-access.js (lines 167-175) and dashboard.html (lines 2000-2022).
-- In the application, all rows for the candidate in public.subscriptions are
-- evaluated with subs.find(...) or subs.some(...). If ANY active and unexpired
-- row exists, the candidate is entitled to Premium benefits.
-- Strictly internal: NO grants to PUBLIC, anon, or authenticated.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_is_premium_internal(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = p_user_id
      AND lower(btrim(COALESCE(s.status, ''))) IN (
        'active', 'paid', 'premium', 'subscribed', 'success', 'successful', 'succeeded', 'completed'
      )
      AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_is_premium_internal(uuid) FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 2. UTME CHALLENGE GRADE ATTEMPT INTERNAL (INTERNAL EVALUATOR)
-- Authoritatively grades an attempt against immutable question snapshots.
-- Subject question denominator is taken strictly from utme_challenge_round_subjects.
-- Guarantees 25% equal weight per subject; final percentage is unweighted average.
-- Enforces unified expiry: 'expired' status is permitted ONLY when clock_timestamp()
-- is strictly greater than expires_at + grace_period_seconds.
-- Surviving Failure Telemetry: If a configuration error occurs (e.g. invalid
-- question_count), finalize_fail_count and last_finalize_error are updated and
-- returned in an error payload WITHOUT raising an unhandled exception, ensuring
-- the telemetry persists in the database.
-- Strictly internal: NO grants to PUBLIC, anon, or authenticated.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_grade_attempt_internal(
  p_attempt_id uuid,
  p_target_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempt public.utme_challenge_attempts%ROWTYPE;
  v_grace_seconds integer;
  v_subj text;
  v_q_count integer;
  v_subj_correct integer;
  v_subj_pct numeric(5, 2);
  v_sum_pct numeric(7, 2) := 0;
  v_final_pct numeric(5, 2);
  v_english_pct numeric(5, 2) := 0;
  v_total_correct integer := 0;
  v_breakdown jsonb := '{}'::jsonb;
BEGIN
  -- 1. Validate target status
  IF p_target_status NOT IN ('submitted', 'expired') THEN
    RAISE EXCEPTION 'INVALID_TARGET_STATUS: Must be submitted or expired.';
  END IF;

  -- 2. Lock attempt exclusively FOR UPDATE
  SELECT * INTO v_attempt
  FROM public.utme_challenge_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF v_attempt.id IS NULL THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
  END IF;

  -- 3. If already finalized, return stored result idempotently
  IF v_attempt.status IN ('submitted', 'expired') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'attempt_id', v_attempt.id,
      'status', v_attempt.status,
      'submitted_at', v_attempt.submitted_at,
      'percentage', v_attempt.percentage,
      'english_percentage', v_attempt.english_percentage,
      'total_correct', v_attempt.total_correct,
      'raw_score', v_attempt.raw_score,
      'subject_breakdown', v_attempt.subject_breakdown,
      'already_finalized', true
    );
  END IF;

  -- 4. Unified expiry rule: target 'expired' is permitted ONLY after expires_at + grace_period_seconds
  v_grace_seconds := COALESCE((v_attempt.configuration_snapshot ->> 'grace_period_seconds')::integer, 30);
  IF p_target_status = 'expired' AND clock_timestamp() <= (v_attempt.expires_at + (v_grace_seconds || ' seconds')::interval) THEN
    RAISE EXCEPTION 'CANNOT_EXPIRE_ACTIVE_ATTEMPT: Current time is before attempt deadline plus grace period.';
  END IF;

  -- 5. Mark correctness on pre-created answer rows against frozen round snapshots
  -- Unanswered questions (selected_option IS NULL) evaluate to is_correct = false.
  UPDATE public.utme_challenge_attempt_answers aa
  SET is_correct = (
    aa.selected_option IS NOT NULL AND
    aa.selected_option = (rq.question_snapshot ->> 'correct_option')
  )
  FROM public.utme_challenge_round_questions rq
  WHERE aa.attempt_id = p_attempt_id
    AND rq.id = aa.round_question_id;

  -- 6. Evaluate per-subject scores using authoritative round_subjects denominator
  FOREACH v_subj IN ARRAY v_attempt.selected_subjects
  LOOP
    SELECT rs.question_count INTO v_q_count
    FROM public.utme_challenge_round_subjects rs
    WHERE rs.round_id = v_attempt.round_id AND rs.subject = v_subj;

    -- Fail-safe guard: missing or zero question count records telemetry that SURVIVES.
    -- Returning an error object instead of raising an unhandled exception allows
    -- the counter increment and error message to be committed to the attempt row.
    IF v_q_count IS NULL OR v_q_count <= 0 THEN
      UPDATE public.utme_challenge_attempts
      SET finalize_fail_count = finalize_fail_count + 1,
          last_finalize_error = 'MISSING_OR_ZERO_QUESTION_COUNT: Subject ' || v_subj
      WHERE id = p_attempt_id;

      RETURN jsonb_build_object(
        'ok', false,
        'error', 'CONFIGURATION_ERROR',
        'message', 'Subject "' || v_subj || '" has invalid question_count in round_subjects.',
        'attempt_id', p_attempt_id,
        'finalize_fail_count', v_attempt.finalize_fail_count + 1,
        'last_finalize_error', 'MISSING_OR_ZERO_QUESTION_COUNT: Subject ' || v_subj
      );
    END IF;

    -- Count correct answers for this subject
    SELECT COUNT(*)::integer INTO v_subj_correct
    FROM public.utme_challenge_attempt_answers aa
    WHERE aa.attempt_id = p_attempt_id
      AND aa.subject = v_subj
      AND aa.is_correct = true;

    -- Subject percentage rounded to 2 decimal places
    v_subj_pct := round((v_subj_correct::numeric / v_q_count::numeric) * 100.0, 2);
    v_sum_pct := v_sum_pct + v_subj_pct;
    v_total_correct := v_total_correct + v_subj_correct;

    IF v_subj = 'English' THEN
      v_english_pct := v_subj_pct;
    END IF;

    v_breakdown := v_breakdown || jsonb_build_object(
      v_subj, jsonb_build_object(
        'correct', v_subj_correct,
        'total', v_q_count,
        'percentage', v_subj_pct
      )
    );
  END LOOP;

  -- 7. Final score: unweighted average of the four subject percentages (25% each)
  v_final_pct := round((v_sum_pct / 4.0), 2);

  -- 8. Persist authoritative score and finalize attempt atomically
  UPDATE public.utme_challenge_attempts
  SET raw_score = v_total_correct,
      total_correct = v_total_correct,
      percentage = v_final_pct,
      english_percentage = v_english_pct,
      subject_breakdown = v_breakdown,
      submitted_at = clock_timestamp(),
      status = p_target_status
  WHERE id = p_attempt_id;

  RETURN jsonb_build_object(
    'ok', true,
    'attempt_id', p_attempt_id,
    'status', p_target_status,
    'submitted_at', clock_timestamp(),
    'percentage', v_final_pct,
    'english_percentage', v_english_pct,
    'total_correct', v_total_correct,
    'raw_score', v_total_correct,
    'subject_breakdown', v_breakdown,
    'already_finalized', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_grade_attempt_internal(uuid, text) FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 3. UTME CHALLENGE REGISTER (STUDENT RPC)
-- Registers or updates candidate's accredited 4-subject combination for active season.
-- Enforces: display_name 2-30 chars, active season, open registration window, locked_at immutability.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_register(
  p_display_name text,
  p_subjects text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_clean_name text;
  v_season_id uuid;
  v_reg_window_open boolean;
  v_existing public.utme_challenge_registrations%ROWTYPE;
  v_saved public.utme_challenge_registrations%ROWTYPE;
BEGIN
  -- 1. Authentication check
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  -- 2. Validate display name
  v_clean_name := btrim(COALESCE(p_display_name, ''));
  IF length(v_clean_name) < 2 OR length(v_clean_name) > 30 THEN
    RAISE EXCEPTION 'INVALID_DISPLAY_NAME: Display name must be between 2 and 30 characters.';
  END IF;

  -- 3. Check for active season
  SELECT id INTO v_season_id
  FROM public.utme_challenge_seasons
  WHERE is_active = true
  LIMIT 1;

  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'NO_ACTIVE_SEASON: No active UTME Challenge season found.';
  END IF;

  -- 4. Check for at least one non-draft round whose registration window is currently open
  SELECT EXISTS (
    SELECT 1
    FROM public.utme_challenge_rounds r
    WHERE r.season_id = v_season_id
      AND r.status <> 'draft'
      AND clock_timestamp() >= r.registration_opens_at
      AND clock_timestamp() <= r.registration_closes_at
  ) INTO v_reg_window_open;

  IF NOT v_reg_window_open THEN
    RAISE EXCEPTION 'REGISTRATION_WINDOW_CLOSED: Registration is not currently open for any round in this season.';
  END IF;

  -- 5. Lock and inspect existing registration if present
  SELECT * INTO v_existing
  FROM public.utme_challenge_registrations
  WHERE season_id = v_season_id AND user_id = v_user_id
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    -- Block modifications if candidate has already started an attempt (locked_at set)
    IF v_existing.locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'REGISTRATION_LOCKED: Subject choices are permanently locked and cannot be modified.';
    END IF;

    -- Update existing registration (trigger validates 4 subjects, English compulsory, computes combination_key)
    UPDATE public.utme_challenge_registrations
    SET display_name = v_clean_name,
        selected_subjects = p_subjects,
        updated_at = clock_timestamp()
    WHERE id = v_existing.id
    RETURNING * INTO v_saved;
  ELSE
    -- Create new registration
    INSERT INTO public.utme_challenge_registrations (
      season_id,
      user_id,
      display_name,
      selected_subjects
    ) VALUES (
      v_season_id,
      v_user_id,
      v_clean_name,
      p_subjects
    )
    RETURNING * INTO v_saved;
  END IF;

  RETURN jsonb_build_object(
    'id', v_saved.id,
    'season_id', v_saved.season_id,
    'display_name', v_saved.display_name,
    'selected_subjects', v_saved.selected_subjects,
    'combination_key', v_saved.combination_key,
    'locked_at', v_saved.locked_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_register(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_register(text, text[]) TO authenticated;


-- ============================================================================
-- 4. UTME CHALLENGE GET OVERVIEW (STUDENT RPC)
-- Returns active season, rounds with COMPUTED phases from clock_timestamp(),
-- candidate's registration, and attempt statuses. Zero question content returned.
-- Phase Lifecycle:
--   - 'finalized': Administrative finalization complete, leaderboard published.
--   - 'closed': Start window has closed (now > start_window_closes_at).
--               NOTE: In-progress attempts started before closure continue running
--               until their individual expires_at + grace_period_seconds.
--   - 'open': Active testing window (now BETWEEN start_window_opens_at AND start_window_closes_at).
--   - 'waiting': Registration closed, awaiting test window start (now BETWEEN registration_closes_at AND start_window_opens_at).
--   - 'registration_open': Open for candidate registrations (now BETWEEN registration_opens_at AND registration_closes_at).
--   - 'pending': Before registration opening or unconfigured.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_get_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_season jsonb;
  v_registration jsonb;
  v_rounds jsonb;
  v_active_season_id uuid;
BEGIN
  -- 1. Authentication check
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  -- 2. Fetch active season
  SELECT jsonb_build_object(
    'id', s.id,
    'year', s.year,
    'title', s.title,
    'is_active', s.is_active
  ), s.id INTO v_season, v_active_season_id
  FROM public.utme_challenge_seasons s
  WHERE s.is_active = true
  LIMIT 1;

  IF v_active_season_id IS NULL THEN
    RETURN jsonb_build_object(
      'has_active_season', false,
      'season', null,
      'registration', null,
      'rounds', '[]'::jsonb
    );
  END IF;

  -- 3. Fetch candidate registration for active season
  SELECT jsonb_build_object(
    'id', reg.id,
    'display_name', reg.display_name,
    'selected_subjects', reg.selected_subjects,
    'combination_key', reg.combination_key,
    'locked_at', reg.locked_at,
    'created_at', reg.created_at
  ) INTO v_registration
  FROM public.utme_challenge_registrations reg
  WHERE reg.season_id = v_active_season_id AND reg.user_id = v_user_id;

  -- 4. Fetch non-draft rounds with COMPUTED phase from clock_timestamp()
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'round_number', r.round_number,
      'title', r.title,
      'duration_minutes', r.duration_minutes,
      'registration_opens_at', r.registration_opens_at,
      'registration_closes_at', r.registration_closes_at,
      'start_window_opens_at', r.start_window_opens_at,
      'start_window_closes_at', r.start_window_closes_at,
      'raw_status', r.status,
      'computed_phase', CASE
        WHEN r.status = 'finalized' THEN 'finalized'
        WHEN clock_timestamp() > r.start_window_closes_at THEN 'closed'
        WHEN clock_timestamp() >= r.start_window_opens_at AND clock_timestamp() <= r.start_window_closes_at THEN 'open'
        WHEN clock_timestamp() > r.registration_closes_at AND clock_timestamp() < r.start_window_opens_at THEN 'waiting'
        WHEN clock_timestamp() >= r.registration_opens_at AND clock_timestamp() <= r.registration_closes_at THEN 'registration_open'
        ELSE 'pending'
      END,
      'attempt', (
        SELECT jsonb_build_object(
          'id', a.id,
          'status', a.status,
          'started_at', a.started_at,
          'expires_at', a.expires_at,
          'submitted_at', a.submitted_at,
          'percentage', a.percentage,
          'english_percentage', a.english_percentage,
          'total_correct', a.total_correct,
          'raw_score', a.raw_score
        )
        FROM public.utme_challenge_attempts a
        WHERE a.round_id = r.id AND a.user_id = v_user_id
      )
    ) ORDER BY r.round_number ASC
  ), '[]'::jsonb) INTO v_rounds
  FROM public.utme_challenge_rounds r
  WHERE r.season_id = v_active_season_id
    AND r.status <> 'draft';

  RETURN jsonb_build_object(
    'has_active_season', true,
    'season', v_season,
    'registration', v_registration,
    'rounds', v_rounds
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_get_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_get_overview() TO authenticated;


-- ============================================================================
-- 5. UTME CHALLENGE START ATTEMPT (STUDENT RPC)
-- Locks:
--   1. SHARED lock on round (FOR SHARE) - allows thousands of concurrent starts.
--   2. EXCLUSIVE lock on candidate registration (FOR UPDATE) - serializes concurrent
--      starts from the same candidate without blocking other users or rounds.
-- Execution Order:
--   - Checks existing attempt FIRST. Resume and already-completed paths do NOT
--     depend on round status, is_questions_frozen, start window, or registration deadline.
--   - Only creating a NEW attempt enforces scheduling, window, and paper verification.
-- Pre-creation Verification:
--   - Verifies all 4 candidate subjects have exact question counts in round_questions
--     matching round_subjects.question_count BEFORE setting registrations.locked_at.
-- Pre-creates deterministic answer rows: English first, electives alphabetically.
-- Returns strictly sanitized question payload (correct_option & explanation stripped).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_start_attempt(p_round_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_round public.utme_challenge_rounds%ROWTYPE;
  v_reg public.utme_challenge_registrations%ROWTYPE;
  v_attempt public.utme_challenge_attempts%ROWTYPE;
  v_grace_seconds integer;
  v_subj text;
  v_expected_q integer;
  v_actual_q integer;
  v_matching_subjects_count integer;
  v_started_at timestamptz;
  v_expires_at timestamptz;
  v_total_questions integer;
  v_inserted_count integer;
  v_config_snapshot jsonb;
  v_remaining_seconds integer;
  v_questions jsonb;
  v_final_result jsonb;
BEGIN
  -- 1. Authentication check
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  -- 2. LOCK ORDER RULE: Shared lock on round first (FOR SHARE)
  SELECT * INTO v_round
  FROM public.utme_challenge_rounds
  WHERE id = p_round_id
  FOR SHARE;

  IF v_round.id IS NULL THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND';
  END IF;

  -- 3. LOCK ORDER RULE: Exclusive lock on candidate registration second (FOR UPDATE)
  SELECT * INTO v_reg
  FROM public.utme_challenge_registrations
  WHERE season_id = v_round.season_id AND user_id = v_user_id
  FOR UPDATE;

  IF v_reg.id IS NULL THEN
    RAISE EXCEPTION 'NOT_REGISTERED: Candidate has not registered for this season.';
  END IF;

  -- 4. CHECK EXISTING ATTEMPT FIRST (Resume / Completed Path)
  -- The resume path and already-completed path must NOT depend on round status,
  -- is_questions_frozen, the start window, or the registration deadline.
  SELECT * INTO v_attempt
  FROM public.utme_challenge_attempts
  WHERE round_id = p_round_id AND user_id = v_user_id;

  IF v_attempt.id IS NOT NULL THEN
    -- A. In-progress attempt within active duration: RESUME
    IF v_attempt.status = 'in_progress' AND clock_timestamp() <= v_attempt.expires_at THEN
      v_remaining_seconds := GREATEST(0, EXTRACT(EPOCH FROM (v_attempt.expires_at - clock_timestamp()))::integer);

      SELECT jsonb_agg(
        jsonb_build_object(
          'candidate_position', aa.candidate_position,
          'round_question_id', aa.round_question_id,
          'subject', aa.subject,
          'question_text', (rq.question_snapshot ->> 'question_text'),
          'options', (rq.question_snapshot -> 'options'),
          'selected_option', aa.selected_option,
          'client_seq', aa.client_seq,
          'server_version', aa.server_version
        ) ORDER BY aa.candidate_position ASC
      ) INTO v_questions
      FROM public.utme_challenge_attempt_answers aa
      JOIN public.utme_challenge_round_questions rq ON rq.id = aa.round_question_id
      WHERE aa.attempt_id = v_attempt.id;

      RETURN jsonb_build_object(
        'attempt_id', v_attempt.id,
        'status', 'in_progress',
        'is_resumed', true,
        'started_at', v_attempt.started_at,
        'expires_at', v_attempt.expires_at,
        'remaining_seconds', v_remaining_seconds,
        'duration_minutes', (v_attempt.configuration_snapshot ->> 'duration_minutes')::integer,
        'selected_subjects', v_attempt.selected_subjects,
        'questions', v_questions
      );
    ELSE
      -- B. In-progress past deadline OR already finalized: return completed score without reopening
      IF v_attempt.status = 'in_progress' THEN
        v_grace_seconds := COALESCE((v_attempt.configuration_snapshot ->> 'grace_period_seconds')::integer, 30);
        IF clock_timestamp() <= (v_attempt.expires_at + (v_grace_seconds || ' seconds')::interval) THEN
          v_final_result := public.utme_challenge_grade_attempt_internal(v_attempt.id, 'submitted');
        ELSE
          v_final_result := public.utme_challenge_grade_attempt_internal(v_attempt.id, 'expired');
        END IF;
      ELSE
        v_final_result := jsonb_build_object(
          'ok', true,
          'attempt_id', v_attempt.id,
          'status', v_attempt.status,
          'submitted_at', v_attempt.submitted_at,
          'percentage', v_attempt.percentage,
          'english_percentage', v_attempt.english_percentage,
          'total_correct', v_attempt.total_correct,
          'raw_score', v_attempt.raw_score,
          'subject_breakdown', v_attempt.subject_breakdown
        );
      END IF;

      RETURN jsonb_build_object(
        'attempt_id', v_attempt.id,
        'status', (v_final_result ->> 'status'),
        'is_resumed', false,
        'already_completed', true,
        'result', v_final_result
      );
    END IF;
  END IF;

  -- 5. NEW ATTEMPT CREATION PATH
  -- Enforce round lifecycle, freezing, scheduling window, and registration deadline
  IF v_round.status NOT IN ('scheduled', 'open') THEN
    RAISE EXCEPTION 'ROUND_NOT_ACTIVE: Round status is "%".', v_round.status;
  END IF;

  IF NOT v_round.is_questions_frozen THEN
    RAISE EXCEPTION 'ROUND_QUESTIONS_NOT_FROZEN: Round question paper is not finalized.';
  END IF;

  IF clock_timestamp() < v_round.start_window_opens_at OR clock_timestamp() > v_round.start_window_closes_at THEN
    RAISE EXCEPTION 'START_WINDOW_CLOSED: Testing start window is closed for this round.';
  END IF;

  IF v_reg.created_at > v_round.registration_closes_at THEN
    RAISE EXCEPTION 'REGISTERED_AFTER_DEADLINE: Candidate registered after this round registration closed.';
  END IF;

  -- 6. VERIFICATION BEFORE LOCK
  -- Verify all 4 candidate subjects are configured for this round
  SELECT count(*) INTO v_matching_subjects_count
  FROM public.utme_challenge_round_subjects rs
  WHERE rs.round_id = p_round_id
    AND rs.subject = ANY(v_reg.selected_subjects);

  IF v_matching_subjects_count <> 4 THEN
    RAISE EXCEPTION 'SUBJECTS_NOT_CONFIGURED_FOR_ROUND: One or more selected subjects are not configured for this round.';
  END IF;

  -- Verify each subject has exact question count in round_questions matching round_subjects.question_count
  FOREACH v_subj IN ARRAY v_reg.selected_subjects
  LOOP
    SELECT rs.question_count INTO v_expected_q
    FROM public.utme_challenge_round_subjects rs
    WHERE rs.round_id = p_round_id AND rs.subject = v_subj;

    SELECT count(*)::integer INTO v_actual_q
    FROM public.utme_challenge_round_questions rq
    WHERE rq.round_id = p_round_id AND rq.subject = v_subj;

    IF v_expected_q IS NULL OR v_expected_q <= 0 OR v_actual_q <> v_expected_q THEN
      RAISE EXCEPTION 'PAPER_INCOMPLETE: Subject "%" has % questions in bank but configuration expects %.', v_subj, v_actual_q, v_expected_q;
    END IF;
  END LOOP;

  -- Total questions assigned across candidate's four subjects
  SELECT COALESCE(sum(rs.question_count), 0)::integer INTO v_total_questions
  FROM public.utme_challenge_round_subjects rs
  WHERE rs.round_id = p_round_id
    AND rs.subject = ANY(v_reg.selected_subjects);

  -- 7. LOCK REGISTRATION AND CREATE ATTEMPT IN SAME TRANSACTION
  -- Lock candidate registration subjects permanently for season
  IF v_reg.locked_at IS NULL THEN
    UPDATE public.utme_challenge_registrations
    SET locked_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = v_reg.id;
  END IF;

  -- Timers: full duration guaranteed, never truncated by start_window_closes_at
  v_started_at := clock_timestamp();
  v_expires_at := v_started_at + (v_round.duration_minutes || ' minutes')::interval;

  v_config_snapshot := jsonb_build_object(
    'round_id', v_round.id,
    'season_id', v_round.season_id,
    'round_number', v_round.round_number,
    'duration_minutes', v_round.duration_minutes,
    'grace_period_seconds', v_round.grace_period_seconds,
    'start_window_opens_at', v_round.start_window_opens_at,
    'start_window_closes_at', v_round.start_window_closes_at
  );

  INSERT INTO public.utme_challenge_attempts (
    round_id,
    season_id,
    user_id,
    registration_id,
    selected_subjects,
    total_questions_assigned,
    started_at,
    expires_at,
    status,
    configuration_snapshot
  ) VALUES (
    p_round_id,
    v_round.season_id,
    v_user_id,
    v_reg.id,
    v_reg.selected_subjects,
    v_total_questions,
    v_started_at,
    v_expires_at,
    'in_progress',
    v_config_snapshot
  )
  RETURNING * INTO v_attempt;

  -- 8. PRE-CREATE DETERMINISTIC ANSWER ROWS
  -- English first, then electives alphabetically, ordered within subject by subject_position.
  WITH subject_ordering AS (
    SELECT s.subject,
           CASE WHEN s.subject = 'English' THEN 0 ELSE 1 END AS sort_priority,
           s.subject AS subject_alpha
    FROM unnest(v_reg.selected_subjects) AS s(subject)
  ),
  sorted_round_questions AS (
    SELECT
      rq.id AS round_question_id,
      rq.subject,
      ROW_NUMBER() OVER (
        ORDER BY so.sort_priority ASC, so.subject_alpha ASC, rq.subject_position ASC
      ) AS assigned_position
    FROM public.utme_challenge_round_questions rq
    JOIN subject_ordering so ON so.subject = rq.subject
    WHERE rq.round_id = p_round_id
  ),
  inserted_answers AS (
    INSERT INTO public.utme_challenge_attempt_answers (
      attempt_id,
      round_id,
      round_question_id,
      subject,
      candidate_position,
      client_seq,
      server_version
    )
    SELECT
      v_attempt.id,
      p_round_id,
      srq.round_question_id,
      srq.subject,
      srq.assigned_position,
      0,
      1
    FROM sorted_round_questions srq
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_inserted_count FROM inserted_answers;

  IF v_inserted_count <> v_total_questions THEN
    RAISE EXCEPTION 'ANSWER_INITIALIZATION_MISMATCH: Initialized % answer rows but expected %.', v_inserted_count, v_total_questions;
  END IF;

  -- 9. BUILD STRICTLY SANITIZED QUESTIONS PAYLOAD
  -- correct_option and explanation are stripped entirely from candidate response
  SELECT jsonb_agg(
    jsonb_build_object(
      'candidate_position', aa.candidate_position,
      'round_question_id', aa.round_question_id,
      'subject', aa.subject,
      'question_text', (rq.question_snapshot ->> 'question_text'),
      'options', (rq.question_snapshot -> 'options'),
      'selected_option', null,
      'client_seq', 0,
      'server_version', 1
    ) ORDER BY aa.candidate_position ASC
  ) INTO v_questions
  FROM public.utme_challenge_attempt_answers aa
  JOIN public.utme_challenge_round_questions rq ON rq.id = aa.round_question_id
  WHERE aa.attempt_id = v_attempt.id;

  v_remaining_seconds := (v_round.duration_minutes * 60);

  RETURN jsonb_build_object(
    'attempt_id', v_attempt.id,
    'status', 'in_progress',
    'is_resumed', false,
    'started_at', v_started_at,
    'expires_at', v_expires_at,
    'remaining_seconds', v_remaining_seconds,
    'duration_minutes', v_round.duration_minutes,
    'selected_subjects', v_reg.selected_subjects,
    'questions', v_questions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_start_attempt(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_start_attempt(uuid) TO authenticated;


-- ============================================================================
-- 6. UTME CHALLENGE SAVE ANSWERS (STUDENT RPC)
-- Locks: Takes SHARE lock on attempt row alone (prevents column mismatch and
-- concurrent finalization FOR UPDATE).
-- Enforces: caller ownership, in_progress status, deadline + grace period check.
-- Race-Free Idempotency: Inserts first with ON CONFLICT DO NOTHING. If conflict
-- occurs (NOT FOUND), re-reads stored payload hash: matching hash returns stored
-- replay; differing hash raises REQUEST_ID_CONFLICT.
-- Concurrency: Atomic update-only where client_seq > current client_seq.
-- Returns per-question applied status only after commit.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_save_answers(
  p_attempt_id uuid,
  p_request_id uuid,
  p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_attempt public.utme_challenge_attempts%ROWTYPE;
  v_grace_seconds integer;
  v_hash text;
  v_existing_hash text;
  v_item jsonb;
  v_rq_id uuid;
  v_choice text;
  v_client_seq integer;
  v_updated boolean;
  v_results jsonb := '[]'::jsonb;
  v_current_ans public.utme_challenge_attempt_answers%ROWTYPE;
BEGIN
  -- 1. Authentication check
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  -- 2. Validate parameters
  IF p_attempt_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAMETERS: attempt_id and request_id are required.';
  END IF;

  IF jsonb_typeof(p_answers) <> 'array' OR jsonb_array_length(p_answers) > 20 THEN
    RAISE EXCEPTION 'INVALID_ANSWERS_PAYLOAD: Answers must be a JSON array with at most 20 items.';
  END IF;

  -- 3. Lock attempt row with FOR SHARE to prevent concurrent finalization FOR UPDATE
  -- Query attempt row alone into v_attempt (avoids ROWTYPE column mismatch)
  SELECT * INTO v_attempt
  FROM public.utme_challenge_attempts
  WHERE id = p_attempt_id AND user_id = v_user_id
  FOR SHARE;

  IF v_attempt.id IS NULL THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND_OR_UNAUTHORIZED';
  END IF;

  IF v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_IN_PROGRESS: Attempt status is "%".', v_attempt.status;
  END IF;

  -- Check deadline including configured grace period
  v_grace_seconds := COALESCE(
    (v_attempt.configuration_snapshot ->> 'grace_period_seconds')::integer,
    (SELECT r.grace_period_seconds FROM public.utme_challenge_rounds r WHERE r.id = v_attempt.round_id),
    30
  );

  IF clock_timestamp() > (v_attempt.expires_at + (v_grace_seconds || ' seconds')::interval) THEN
    RAISE EXCEPTION 'ATTEMPT_EXPIRED: Attempt time has expired.';
  END IF;

  -- 4. Race-Free Idempotency Insertion: INSERT first with ON CONFLICT DO NOTHING
  v_hash := md5(p_answers::text);

  INSERT INTO public.utme_challenge_answer_idempotency (attempt_id, request_id, payload_hash)
  VALUES (p_attempt_id, p_request_id, v_hash)
  ON CONFLICT (attempt_id, request_id) DO NOTHING;

  IF NOT FOUND THEN
    -- A row for (attempt_id, request_id) was previously inserted. Read stored hash.
    SELECT payload_hash INTO v_existing_hash
    FROM public.utme_challenge_answer_idempotency
    WHERE attempt_id = p_attempt_id AND request_id = p_request_id;

    IF v_existing_hash = v_hash THEN
      -- Identical retry: return current stored state
      SELECT jsonb_agg(
        jsonb_build_object(
          'round_question_id', aa.round_question_id,
          'selected_option', aa.selected_option,
          'client_seq', aa.client_seq,
          'server_version', aa.server_version,
          'applied', false,
          'replayed', true
        )
      ) INTO v_results
      FROM public.utme_challenge_attempt_answers aa
      WHERE aa.attempt_id = p_attempt_id
        AND aa.round_question_id IN (
          SELECT (elem ->> 'round_question_id')::uuid FROM jsonb_array_elements(p_answers) elem
        );

      RETURN jsonb_build_object(
        'success', true,
        'idempotent_replay', true,
        'results', COALESCE(v_results, '[]'::jsonb)
      );
    ELSE
      RAISE EXCEPTION 'REQUEST_ID_CONFLICT: request_id was previously submitted with a different payload.';
    END IF;
  END IF;

  -- 5. Process atomic UPDATE-ONLY on pre-created answer rows
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_answers)
  LOOP
    v_rq_id := (v_item ->> 'round_question_id')::uuid;
    v_choice := v_item ->> 'choice';
    v_client_seq := COALESCE((v_item ->> 'client_seq')::integer, 0);

    -- Validate choice
    IF v_choice IS NOT NULL AND v_choice NOT IN ('A', 'B', 'C', 'D') THEN
      RAISE EXCEPTION 'INVALID_CHOICE: Choice must be A, B, C, D, or null.';
    END IF;

    -- Verify question belongs to attempt
    SELECT * INTO v_current_ans
    FROM public.utme_challenge_attempt_answers
    WHERE attempt_id = p_attempt_id AND round_question_id = v_rq_id;

    IF v_current_ans.attempt_id IS NULL THEN
      RAISE EXCEPTION 'QUESTION_NOT_ASSIGNED_TO_ATTEMPT: Round question % does not belong to attempt.', v_rq_id;
    END IF;

    -- Atomic sequence check: only update if client_seq > stored client_seq
    UPDATE public.utme_challenge_attempt_answers aa
    SET selected_option = v_choice,
        client_seq = v_client_seq,
        server_version = aa.server_version + 1,
        answered_at = clock_timestamp()
    WHERE aa.attempt_id = p_attempt_id
      AND aa.round_question_id = v_rq_id
      AND v_client_seq > aa.client_seq;

    v_updated := FOUND;

    -- Read current state for response payload
    SELECT * INTO v_current_ans
    FROM public.utme_challenge_attempt_answers
    WHERE attempt_id = p_attempt_id AND round_question_id = v_rq_id;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'round_question_id', v_rq_id,
        'selected_option', v_current_ans.selected_option,
        'client_seq', v_current_ans.client_seq,
        'server_version', v_current_ans.server_version,
        'applied', v_updated
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'results', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_save_answers(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_save_answers(uuid, uuid, jsonb) TO authenticated;


-- ============================================================================
-- 7. UTME CHALLENGE SUBMIT ATTEMPT (STUDENT RPC)
-- Locks attempt FOR UPDATE. If already final, returns stored score idempotently.
-- Submits as 'submitted' if within deadline + grace, or 'expired' if late.
-- Surviving Failure Telemetry: If grading fails due to configuration error, the
-- failure counter and last error are persisted, and a failure response is returned
-- without rolling back the transaction.
-- Returns caller's own final score breakdown only. Zero answer keys returned.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_submit_attempt(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_attempt public.utme_challenge_attempts%ROWTYPE;
  v_grace_seconds integer;
  v_target_status text;
  v_grade_result jsonb;
BEGIN
  -- 1. Authentication check
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  -- 2. Lock attempt FOR UPDATE
  SELECT * INTO v_attempt
  FROM public.utme_challenge_attempts
  WHERE id = p_attempt_id AND user_id = v_user_id
  FOR UPDATE;

  IF v_attempt.id IS NULL THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND_OR_UNAUTHORIZED';
  END IF;

  -- 3. Idempotent return if already finalized
  IF v_attempt.status IN ('submitted', 'expired') THEN
    RETURN jsonb_build_object(
      'attempt_id', v_attempt.id,
      'status', v_attempt.status,
      'submitted_at', v_attempt.submitted_at,
      'percentage', v_attempt.percentage,
      'english_percentage', v_attempt.english_percentage,
      'total_correct', v_attempt.total_correct,
      'raw_score', v_attempt.raw_score,
      'subject_breakdown', v_attempt.subject_breakdown,
      'already_finalized', true
    );
  END IF;

  -- 4. Unified expiry: submitted if within grace period, otherwise expired
  v_grace_seconds := COALESCE((v_attempt.configuration_snapshot ->> 'grace_period_seconds')::integer, 30);
  IF clock_timestamp() <= (v_attempt.expires_at + (v_grace_seconds || ' seconds')::interval) THEN
    v_target_status := 'submitted';
  ELSE
    v_target_status := 'expired';
  END IF;

  -- 5. Invoke internal grader
  v_grade_result := public.utme_challenge_grade_attempt_internal(p_attempt_id, v_target_status);

  -- 6. Check if internal grader reported surviving telemetry failure
  IF (v_grade_result ->> 'ok') = 'false' THEN
    RETURN jsonb_build_object(
      'attempt_id', p_attempt_id,
      'success', false,
      'error', (v_grade_result ->> 'error'),
      'message', (v_grade_result ->> 'message'),
      'finalize_fail_count', (v_grade_result -> 'finalize_fail_count'),
      'status', 'in_progress'
    );
  END IF;

  RETURN jsonb_build_object(
    'attempt_id', p_attempt_id,
    'status', v_target_status,
    'submitted_at', (v_grade_result ->> 'submitted_at'),
    'percentage', (v_grade_result -> 'percentage'),
    'english_percentage', (v_grade_result -> 'english_percentage'),
    'total_correct', (v_grade_result -> 'total_correct'),
    'raw_score', (v_grade_result -> 'raw_score'),
    'subject_breakdown', (v_grade_result -> 'subject_breakdown'),
    'already_finalized', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_submit_attempt(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_submit_attempt(uuid) TO authenticated;


-- ============================================================================
-- 8. UTME CHALLENGE GET LEADERBOARD (STUDENT RPC)
-- Available only when round status = 'finalized'.
-- Scoped strictly to caller's 4-subject combination_key (never ranks across combinations).
-- Free students receive Top 10 + self rank.
-- Premium students receive full combination leaderboard + personal rank history.
-- Rank order: final_percentage DESC, english_percentage DESC, total_correct DESC.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_get_leaderboard(p_round_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_round public.utme_challenge_rounds%ROWTYPE;
  v_combo_key text;
  v_is_premium boolean;
  v_my_entry jsonb;
  v_top_10 jsonb;
  v_full_list jsonb := null;
  v_rank_history jsonb := null;
BEGIN
  -- 1. Authentication check
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  -- 2. Fetch round and verify status
  SELECT * INTO v_round
  FROM public.utme_challenge_rounds
  WHERE id = p_round_id;

  IF v_round.id IS NULL THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND';
  END IF;

  IF v_round.status <> 'finalized' THEN
    RETURN jsonb_build_object(
      'available', false,
      'status', v_round.status,
      'message', 'Leaderboard is not available yet. Results are released once the round is finalized.'
    );
  END IF;

  -- 3. Resolve caller's registration & combination_key for this season
  SELECT reg.combination_key INTO v_combo_key
  FROM public.utme_challenge_registrations reg
  WHERE reg.season_id = v_round.season_id AND reg.user_id = v_user_id;

  IF v_combo_key IS NULL THEN
    RAISE EXCEPTION 'NOT_REGISTERED_FOR_SEASON';
  END IF;

  -- 4. Evaluate Premium entitlement via internal helper
  v_is_premium := public.utme_challenge_is_premium_internal(v_user_id);

  -- 5. Fetch caller's own rank entry
  SELECT jsonb_build_object(
    'rank', l.rank,
    'display_name', l.display_name,
    'final_percentage', l.final_percentage,
    'english_percentage', l.english_percentage,
    'total_correct', l.total_correct
  ) INTO v_my_entry
  FROM public.utme_challenge_leaderboard_entries l
  WHERE l.round_id = p_round_id
    AND l.combination_key = v_combo_key
    AND l.user_id = v_user_id;

  -- 6. Fetch Top 10 for caller's exact combination
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'rank', t.rank,
      'display_name', t.display_name,
      'final_percentage', t.final_percentage,
      'english_percentage', t.english_percentage,
      'total_correct', t.total_correct,
      'is_self', (t.user_id = v_user_id)
    ) ORDER BY t.rank ASC
  ), '[]'::jsonb) INTO v_top_10
  FROM (
    SELECT l.*
    FROM public.utme_challenge_leaderboard_entries l
    WHERE l.round_id = p_round_id AND l.combination_key = v_combo_key
    ORDER BY l.rank ASC
    LIMIT 10
  ) t;

  -- 7. Premium tier unlocks: full combination list & season rank history
  IF v_is_premium THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'rank', l.rank,
        'display_name', l.display_name,
        'final_percentage', l.final_percentage,
        'english_percentage', l.english_percentage,
        'total_correct', l.total_correct,
        'is_self', (l.user_id = v_user_id)
      ) ORDER BY l.rank ASC
    ), '[]'::jsonb) INTO v_full_list
    FROM public.utme_challenge_leaderboard_entries l
    WHERE l.round_id = p_round_id AND l.combination_key = v_combo_key;

    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'round_id', r.id,
        'round_number', r.round_number,
        'round_title', r.title,
        'rank', l.rank,
        'final_percentage', l.final_percentage,
        'english_percentage', l.english_percentage,
        'total_correct', l.total_correct
      ) ORDER BY r.round_number ASC
    ), '[]'::jsonb) INTO v_rank_history
    FROM public.utme_challenge_leaderboard_entries l
    JOIN public.utme_challenge_rounds r ON r.id = l.round_id
    WHERE l.user_id = v_user_id AND r.season_id = v_round.season_id;
  END IF;

  RETURN jsonb_build_object(
    'available', true,
    'round_id', p_round_id,
    'combination_key', v_combo_key,
    'is_premium', v_is_premium,
    'my_rank', v_my_entry,
    'top_10', v_top_10,
    'full_leaderboard', v_full_list,
    'rank_history', v_rank_history
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_get_leaderboard(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_get_leaderboard(uuid) TO authenticated;

COMMIT;

-- ============================================================================
-- 9. POST-RUN VERIFICATION CHECKLIST (MANUAL VALIDATION ONLY - DO NOT EXECUTE)
-- ============================================================================
/*
POST-RUN TEST CHECKLIST FOR PHASE 2A:
Execute the following verification steps in the Supabase SQL Editor or psql to confirm runtime behavior.

To simulate an authenticated student session in the Supabase SQL Editor or psql, run:
  BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claims" = '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}';
  -- auth.uid() now resolves to '00000000-0000-0000-0000-000000000001'::uuid
  -- Run student RPC queries here...
  ROLLBACK;

1. Anonymous and Unprivileged Student Calls:
   - Call utme_challenge_register(...) as anon -> FAILS with 'AUTHENTICATION_REQUIRED'.
   - Call utme_challenge_get_overview() as anon -> FAILS with 'AUTHENTICATION_REQUIRED'.
   - Call utme_challenge_start_attempt(...) as anon -> FAILS with 'AUTHENTICATION_REQUIRED'.
   - Call utme_challenge_save_answers(...) as anon -> FAILS with 'AUTHENTICATION_REQUIRED'.
   - Call utme_challenge_submit_attempt(...) as anon -> FAILS with 'AUTHENTICATION_REQUIRED'.
   - Call utme_challenge_get_leaderboard(...) as anon -> FAILS with 'AUTHENTICATION_REQUIRED'.
   - Call internal helpers (grade_attempt_internal, is_premium_internal) as authenticated student -> FAILS with 42501 permission denied (no grant).

2. Two Simultaneous Start Calls from One User:
   - Issue two concurrent calls to utme_challenge_start_attempt(round_id) for the same user.
   - The FOR UPDATE lock on public.utme_challenge_registrations serializes both transactions.
   - The first transaction creates the attempt, sets registrations.locked_at, pre-creates answers, and returns is_resumed = false.
   - The second transaction acquires the registration lock, looks up the attempt FIRST, sees status = 'in_progress', and returns the identical attempt with is_resumed = true and remaining_seconds.
   - Confirms no duplicate attempt or deadlock occurs.

3. Resume After Start Window Closed:
   - Candidate starts an attempt 5 minutes before start_window_closes_at.
   - Wait until clock_timestamp() > start_window_closes_at, while clock_timestamp() < attempt.expires_at.
   - Candidate reconnects and calls utme_challenge_start_attempt(round_id).
   - Verify call succeeds, returns is_resumed = true, remaining_seconds > 0, and preserved candidate choices.
   - Confirms resume does NOT depend on the round start window being open.

4. Resume After Round Status is Closed:
   - Candidate has an active in_progress attempt.
   - Admin or background job updates round.status = 'closed'.
   - While clock_timestamp() < attempt.expires_at, candidate reconnects and calls utme_challenge_start_attempt(round_id).
   - Verify call succeeds, returns is_resumed = true, and does NOT throw 'ROUND_NOT_ACTIVE'.
   - Confirms in-progress attempts are isolated from round closure.

5. Paper with Missing Question (Fails Before Locking Registration):
   - In a test environment, delete one question from round_questions for subject 'Physics' (e.g. 39 questions instead of 40).
   - Candidate with registration.locked_at IS NULL calls utme_challenge_start_attempt(round_id).
   - Verify call raises 'PAPER_INCOMPLETE: Subject "Physics" has 39 questions in bank but configuration expects 40.'
   - Verify registration.locked_at remains NULL. Candidate's registration was NOT locked and no partial attempt was created.

6. Parallel Answer Saves:
   - Issue two concurrent calls to utme_challenge_save_answers for the same attempt with different request_ids and non-overlapping questions.
   - Both acquire FOR SHARE on attempt alone; verify neither deadlocks and both return applied = true.

7. Stale Retry Rejection:
   - Save answer for question 1 with client_seq = 5 (applied = true, server_version increments to 2).
   - Re-send answer for question 1 with client_seq = 3 (simulating stale network packet arriving out-of-order).
   - Verify call succeeds, but response for question 1 has applied = false; server retains client_seq = 5 value.

8. Race-Free Idempotency & Reused Request ID with Different Payload:
   - Call utme_challenge_save_answers with request_id = R1 and payload P1 -> succeeds with idempotent_replay = false.
   - Call utme_challenge_save_answers with request_id = R1 and payload P1 (identical retry) -> succeeds with idempotent_replay = true.
   - Call utme_challenge_save_answers with request_id = R1 and payload P2 (different choices) -> FAILS with 'REQUEST_ID_CONFLICT'.

9. Save After Expiry:
   - For an attempt where clock_timestamp() > expires_at + grace_period_seconds, call utme_challenge_save_answers.
   - Verify call FAILS with 'ATTEMPT_EXPIRED'. No answers are updated.

10. Unanswered Question Scoring:
   - In a 40-question round, answer only 20 questions (all correct) and leave 20 unanswered (selected_option IS NULL).
   - Submit attempt.
   - Verify unweighted average treats unanswered questions as 0 correct against the full round_subjects denominator.
   - Confirms score reflects 50% rather than 100% of answered questions.

11. Failed Grade Retry (Surviving Telemetry):
   - Temporarily set a round_subject.question_count = 0 in test environment.
   - Call utme_challenge_submit_attempt.
   - Verify response has success = false, error = 'CONFIGURATION_ERROR', and finalize_fail_count = 1.
   - Inspect utme_challenge_attempts in database: attempt remains in_progress, finalize_fail_count = 1, and last_finalize_error = 'MISSING_OR_ZERO_QUESTION_COUNT...'.
   - Telemetry survived because the function committed rather than raising an unhandled exception.
   - Correct question_count = 10 and retry submission.
   - Attempt finalizes successfully with status 'submitted' and accurate scores.
*/
