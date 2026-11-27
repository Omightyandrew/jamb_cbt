-- ============================================================================
-- ExamPilot UTME Challenge 2027: Phase 2B-1 Admin Database Functions
-- Migration: 20261124040000_utme_challenge_phase2b1_admin_functions.sql
--
-- STRICTLY ADDITIVE: Does NOT alter or drop any existing ExamPilot tables,
-- views, functions, or Daily Challenge objects (public.challenge_attempts).
-- Enforces:
--   - Administrator configurability for all permitted settings with sensible defaults.
--   - 45-minute default attempt duration; 30-second grace period.
--   - Shared question sets per subject per round matching configured counts.
--   - Sequential IF/ELSIF guards preventing non-array jsonb_array_length calls.
--   - Overflow-safe integer validations.
--   - Shared transaction-level advisory locks for usage-history concurrency.
--   - Comprehensive pre-freeze snapshot integrity and approval validation.
--   - Complete historical usage_count and last_used_round_id recalculation.
--   - Lossless paper previews with missing-record integrity flags.
-- All functions are SECURITY DEFINER with SET search_path = pg_catalog, public.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. FOUNDATION HARDENING: PARTIAL UNIQUE INDEX ON ACTIVE SEASONS
-- Guarantees at database level that at most ONE season can have is_active = true.
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS utme_challenge_seasons_one_active_idx
  ON public.utme_challenge_seasons (is_active)
  WHERE is_active = true;


-- ============================================================================
-- 2. ADMIN IDENTIFICATION GATEWAY (INTERNAL)
-- Strictly verifies administrative claims via server-controlled JWT app_metadata:
--   auth.jwt() -> 'app_metadata' ->> 'role' IN ('admin', 'super_admin')
--   auth.jwt() -> 'app_metadata' ->> 'admin_role' IN ('admin', 'super_admin')
-- NEVER trusts user-editable user_metadata, Student_profiles, or private.is_admin_user().
-- Revoked from PUBLIC, anon, and authenticated. Internal helper only.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_require_admin_internal()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid;
  v_jwt jsonb;
  v_role text;
  v_admin_role text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED'
      USING HINT = 'Authentication required to access admin operations.';
  END IF;

  v_jwt := auth.jwt();
  IF v_jwt IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_ADMIN'
      USING HINT = 'Caller does not possess a valid JWT session.';
  END IF;

  -- Only inspect server-controlled app_metadata (cannot be modified by client)
  v_role := lower(COALESCE(v_jwt -> 'app_metadata' ->> 'role', ''));
  v_admin_role := lower(COALESCE(v_jwt -> 'app_metadata' ->> 'admin_role', ''));

  IF v_role NOT IN ('admin', 'super_admin') AND v_admin_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_ADMIN'
      USING HINT = 'Caller lacks required administrative privileges in app_metadata claims.';
  END IF;

  RETURN v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_require_admin_internal() FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 3. SEASON MANAGEMENT
-- ============================================================================

-- Function 1: utme_challenge_admin_upsert_season
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_upsert_season(
  p_id uuid DEFAULT NULL,
  p_year integer DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_is_active boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_title text;
  v_year integer;
  v_season public.utme_challenge_seasons%ROWTYPE;
  v_target_active boolean;
  v_constraint_name text;
BEGIN
  v_admin_uid := public.utme_challenge_require_admin_internal();

  -- Prevent concurrent active-season race conditions
  PERFORM pg_advisory_xact_lock(hashtext('utme_challenge_seasons_lock'));

  IF p_id IS NULL THEN
    -- INSERT PATH
    v_title := btrim(COALESCE(p_title, ''));
    IF length(v_title) < 2 OR length(v_title) > 100 THEN
      RAISE EXCEPTION 'INVALID_TITLE_LENGTH'
        USING HINT = 'Season title must be between 2 and 100 characters.';
    END IF;

    v_year := p_year;
    IF v_year IS NULL OR v_year < 2026 OR v_year > 2099 THEN
      RAISE EXCEPTION 'INVALID_YEAR'
        USING HINT = 'Season year must be between 2026 and 2099.';
    END IF;

    v_target_active := COALESCE(p_is_active, false);

    IF v_target_active THEN
      UPDATE public.utme_challenge_seasons
      SET is_active = false
      WHERE is_active = true;
    END IF;

    BEGIN
      INSERT INTO public.utme_challenge_seasons (
        year,
        title,
        is_active
      ) VALUES (
        v_year,
        v_title,
        v_target_active
      )
      RETURNING * INTO v_season;
    EXCEPTION
      WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
        IF v_constraint_name = 'utme_challenge_seasons_year_key' THEN
          RAISE EXCEPTION 'SEASON_YEAR_ALREADY_EXISTS'
            USING HINT = 'A season for this calendar year already exists.';
        ELSIF v_constraint_name = 'utme_challenge_seasons_one_active_idx' THEN
          RAISE EXCEPTION 'ACTIVE_SEASON_ALREADY_EXISTS'
            USING HINT = 'Another active season exists in the database.';
        ELSE
          RAISE;
        END IF;
    END;

  ELSE
    -- UPDATE PATH
    SELECT * INTO v_season
    FROM public.utme_challenge_seasons
    WHERE id = p_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SEASON_NOT_FOUND'
        USING HINT = 'No season matches the provided ID.';
    END IF;

    IF p_title IS NOT NULL THEN
      v_title := btrim(p_title);
      IF length(v_title) < 2 OR length(v_title) > 100 THEN
        RAISE EXCEPTION 'INVALID_TITLE_LENGTH'
          USING HINT = 'Season title must be between 2 and 100 characters.';
      END IF;
    ELSE
      v_title := v_season.title;
    END IF;

    IF p_year IS NOT NULL THEN
      v_year := p_year;
      IF v_year < 2026 OR v_year > 2099 THEN
        RAISE EXCEPTION 'INVALID_YEAR'
          USING HINT = 'Season year must be between 2026 and 2099.';
      END IF;
    ELSE
      v_year := v_season.year;
    END IF;

    v_target_active := COALESCE(p_is_active, v_season.is_active);

    IF v_target_active AND NOT v_season.is_active THEN
      UPDATE public.utme_challenge_seasons
      SET is_active = false
      WHERE is_active = true AND id <> p_id;
    END IF;

    BEGIN
      UPDATE public.utme_challenge_seasons
      SET
        year = v_year,
        title = v_title,
        is_active = v_target_active,
        updated_at = clock_timestamp()
      WHERE id = p_id
      RETURNING * INTO v_season;
    EXCEPTION
      WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
        IF v_constraint_name = 'utme_challenge_seasons_year_key' THEN
          RAISE EXCEPTION 'SEASON_YEAR_ALREADY_EXISTS'
            USING HINT = 'A season for this calendar year already exists.';
        ELSIF v_constraint_name = 'utme_challenge_seasons_one_active_idx' THEN
          RAISE EXCEPTION 'ACTIVE_SEASON_ALREADY_EXISTS'
            USING HINT = 'Another active season exists in the database.';
        ELSE
          RAISE;
        END IF;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'season', jsonb_build_object(
      'id', v_season.id,
      'year', v_season.year,
      'title', v_season.title,
      'is_active', v_season.is_active,
      'created_at', v_season.created_at,
      'updated_at', v_season.updated_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_upsert_season(uuid, integer, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_upsert_season(uuid, integer, text, boolean) TO authenticated;


-- ============================================================================
-- 4. ROUND CONFIGURATION & MANAGEMENT
-- ============================================================================

-- Function 2: utme_challenge_admin_create_round
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_create_round(
  p_season_id uuid,
  p_round_number integer,
  p_title text,
  p_registration_opens_at timestamptz,
  p_registration_closes_at timestamptz,
  p_start_window_opens_at timestamptz,
  p_start_window_closes_at timestamptz,
  p_duration_minutes integer DEFAULT 45,
  p_grace_period_seconds integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_season public.utme_challenge_seasons%ROWTYPE;
  v_round public.utme_challenge_rounds%ROWTYPE;
  v_title text;
  v_constraint_name text;
BEGIN
  v_admin_uid := public.utme_challenge_require_admin_internal();

  -- Verify season exists
  SELECT * INTO v_season
  FROM public.utme_challenge_seasons
  WHERE id = p_season_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SEASON_NOT_FOUND'
      USING HINT = 'The referenced season does not exist.';
  END IF;

  v_title := btrim(COALESCE(p_title, ''));
  IF length(v_title) < 2 OR length(v_title) > 100 THEN
    RAISE EXCEPTION 'INVALID_TITLE_LENGTH'
      USING HINT = 'Round title must be between 2 and 100 characters.';
  END IF;

  IF p_round_number IS NULL OR p_round_number < 1 THEN
    RAISE EXCEPTION 'INVALID_ROUND_NUMBER'
      USING HINT = 'Round number must be a positive integer.';
  END IF;

  -- Duration validation (matches foundation CHECK: 10 to 180 minutes, default 45)
  IF p_duration_minutes IS NULL OR p_duration_minutes < 10 OR p_duration_minutes > 180 THEN
    RAISE EXCEPTION 'INVALID_DURATION'
      USING HINT = 'Duration must be between 10 and 180 minutes.';
  END IF;

  -- Grace period validation (matches foundation CHECK: 0 to 300 seconds, default 30)
  IF p_grace_period_seconds IS NULL OR p_grace_period_seconds < 0 OR p_grace_period_seconds > 300 THEN
    RAISE EXCEPTION 'INVALID_GRACE_PERIOD'
      USING HINT = 'Grace period must be between 0 and 300 seconds.';
  END IF;

  -- Timestamps validation
  IF p_registration_opens_at IS NULL OR p_registration_closes_at IS NULL OR
     p_start_window_opens_at IS NULL OR p_start_window_closes_at IS NULL THEN
    RAISE EXCEPTION 'TIMESTAMPS_REQUIRED'
      USING HINT = 'All four scheduling timestamps are required.';
  END IF;

  IF p_registration_closes_at <= p_registration_opens_at THEN
    RAISE EXCEPTION 'INVALID_REGISTRATION_WINDOW'
      USING HINT = 'Registration close time must be strictly after registration open time.';
  END IF;

  IF p_start_window_closes_at < p_start_window_opens_at THEN
    RAISE EXCEPTION 'INVALID_START_WINDOW'
      USING HINT = 'Start window close time must be greater than or equal to start window open time.';
  END IF;

  IF p_registration_closes_at > p_start_window_opens_at THEN
    RAISE EXCEPTION 'REGISTRATION_OVERLAPS_TEST'
      USING HINT = 'Registration close time must be less than or equal to start window open time.';
  END IF;

  BEGIN
    INSERT INTO public.utme_challenge_rounds (
      season_id,
      round_number,
      title,
      status,
      registration_opens_at,
      registration_closes_at,
      start_window_opens_at,
      start_window_closes_at,
      duration_minutes,
      grace_period_seconds,
      is_questions_frozen
    ) VALUES (
      p_season_id,
      p_round_number,
      v_title,
      'draft',
      p_registration_opens_at,
      p_registration_closes_at,
      p_start_window_opens_at,
      p_start_window_closes_at,
      p_duration_minutes,
      p_grace_period_seconds,
      false
    )
    RETURNING * INTO v_round;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
      IF v_constraint_name = 'utme_challenge_round_season_num_unique' THEN
        RAISE EXCEPTION 'ROUND_NUMBER_ALREADY_EXISTS'
          USING HINT = 'A round with this number already exists for this season.';
      ELSE
        RAISE;
      END IF;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'round', jsonb_build_object(
      'id', v_round.id,
      'season_id', v_round.season_id,
      'round_number', v_round.round_number,
      'title', v_round.title,
      'status', v_round.status,
      'registration_opens_at', v_round.registration_opens_at,
      'registration_closes_at', v_round.registration_closes_at,
      'start_window_opens_at', v_round.start_window_opens_at,
      'start_window_closes_at', v_round.start_window_closes_at,
      'duration_minutes', v_round.duration_minutes,
      'grace_period_seconds', v_round.grace_period_seconds,
      'is_questions_frozen', v_round.is_questions_frozen,
      'created_at', v_round.created_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_create_round(uuid, integer, text, timestamptz, timestamptz, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_create_round(uuid, integer, text, timestamptz, timestamptz, timestamptz, timestamptz, integer, integer) TO authenticated;


-- Function 3: utme_challenge_admin_update_round
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_update_round(
  p_round_id uuid,
  p_title text DEFAULT NULL,
  p_registration_opens_at timestamptz DEFAULT NULL,
  p_registration_closes_at timestamptz DEFAULT NULL,
  p_start_window_opens_at timestamptz DEFAULT NULL,
  p_start_window_closes_at timestamptz DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL,
  p_grace_period_seconds integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_round public.utme_challenge_rounds%ROWTYPE;
  v_title text;
  v_reg_opens timestamptz;
  v_reg_closes timestamptz;
  v_win_opens timestamptz;
  v_win_closes timestamptz;
  v_duration integer;
  v_grace integer;
BEGIN
  v_admin_uid := public.utme_challenge_require_admin_internal();

  SELECT * INTO v_round
  FROM public.utme_challenge_rounds
  WHERE id = p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND'
      USING HINT = 'No round matches the provided ID.';
  END IF;

  IF v_round.status NOT IN ('draft', 'scheduled') THEN
    RAISE EXCEPTION 'ROUND_NOT_EDITABLE'
      USING HINT = 'Rounds can only be updated while in draft or scheduled status.';
  END IF;

  IF v_round.is_questions_frozen THEN
    -- Immutability trigger utme_challenge_protect_round_config blocks schedule/duration edits once frozen
    IF p_registration_opens_at IS NOT NULL OR p_registration_closes_at IS NOT NULL OR
       p_start_window_opens_at IS NOT NULL OR p_start_window_closes_at IS NOT NULL OR
       p_duration_minutes IS NOT NULL OR p_grace_period_seconds IS NOT NULL THEN
      RAISE EXCEPTION 'FROZEN_ROUND_SCHEDULE_LOCKED'
        USING HINT = 'Cannot modify schedule or durations while questions are frozen. Unschedule the round first.';
    END IF;
  END IF;

  IF p_title IS NOT NULL THEN
    v_title := btrim(p_title);
    IF length(v_title) < 2 OR length(v_title) > 100 THEN
      RAISE EXCEPTION 'INVALID_TITLE_LENGTH'
        USING HINT = 'Round title must be between 2 and 100 characters.';
    END IF;
  ELSE
    v_title := v_round.title;
  END IF;

  IF p_duration_minutes IS NOT NULL THEN
    IF p_duration_minutes < 10 OR p_duration_minutes > 180 THEN
      RAISE EXCEPTION 'INVALID_DURATION'
        USING HINT = 'Duration must be between 10 and 180 minutes.';
    END IF;
    v_duration := p_duration_minutes;
  ELSE
    v_duration := v_round.duration_minutes;
  END IF;

  IF p_grace_period_seconds IS NOT NULL THEN
    IF p_grace_period_seconds < 0 OR p_grace_period_seconds > 300 THEN
      RAISE EXCEPTION 'INVALID_GRACE_PERIOD'
        USING HINT = 'Grace period must be between 0 and 300 seconds.';
    END IF;
    v_grace := p_grace_period_seconds;
  ELSE
    v_grace := v_round.grace_period_seconds;
  END IF;

  v_reg_opens := COALESCE(p_registration_opens_at, v_round.registration_opens_at);
  v_reg_closes := COALESCE(p_registration_closes_at, v_round.registration_closes_at);
  v_win_opens := COALESCE(p_start_window_opens_at, v_round.start_window_opens_at);
  v_win_closes := COALESCE(p_start_window_closes_at, v_round.start_window_closes_at);

  IF v_reg_closes <= v_reg_opens THEN
    RAISE EXCEPTION 'INVALID_REGISTRATION_WINDOW'
      USING HINT = 'Registration close time must be strictly after registration open time.';
  END IF;

  IF v_win_closes < v_win_opens THEN
    RAISE EXCEPTION 'INVALID_START_WINDOW'
      USING HINT = 'Start window close time must be greater than or equal to start window open time.';
  END IF;

  IF v_reg_closes > v_win_opens THEN
    RAISE EXCEPTION 'REGISTRATION_OVERLAPS_TEST'
      USING HINT = 'Registration close time must be less than or equal to start window open time.';
  END IF;

  UPDATE public.utme_challenge_rounds
  SET
    title = v_title,
    registration_opens_at = v_reg_opens,
    registration_closes_at = v_reg_closes,
    start_window_opens_at = v_win_opens,
    start_window_closes_at = v_win_closes,
    duration_minutes = v_duration,
    grace_period_seconds = v_grace,
    updated_at = clock_timestamp()
  WHERE id = p_round_id
  RETURNING * INTO v_round;

  RETURN jsonb_build_object(
    'success', true,
    'round', jsonb_build_object(
      'id', v_round.id,
      'season_id', v_round.season_id,
      'round_number', v_round.round_number,
      'title', v_round.title,
      'status', v_round.status,
      'registration_opens_at', v_round.registration_opens_at,
      'registration_closes_at', v_round.registration_closes_at,
      'start_window_opens_at', v_round.start_window_opens_at,
      'start_window_closes_at', v_round.start_window_closes_at,
      'duration_minutes', v_round.duration_minutes,
      'grace_period_seconds', v_round.grace_period_seconds,
      'is_questions_frozen', v_round.is_questions_frozen,
      'updated_at', v_round.updated_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_update_round(uuid, text, timestamptz, timestamptz, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_update_round(uuid, text, timestamptz, timestamptz, timestamptz, timestamptz, integer, integer) TO authenticated;


-- Function 4: utme_challenge_admin_set_round_subjects
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_set_round_subjects(
  p_round_id uuid,
  p_subjects jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_round public.utme_challenge_rounds%ROWTYPE;
  v_elem jsonb;
  v_subject text;
  v_count_raw text;
  v_order_raw text;
  v_count integer;
  v_order integer;
  v_seen text[] := '{}';
  -- 13 accredited UTME Challenge subjects matching Phase 1 CHECK constraints
  v_valid_subjects text[] := ARRAY[
    'English', 'Mathematics', 'Physics', 'Chemistry', 'Biology',
    'Government', 'Literature in English', 'Economics', 'Commerce',
    'Accounting', 'Geography', 'CRS', 'History'
  ];
  v_count_questions integer;
  v_total_questions_configured integer := 0;
  v_inserted_subjects jsonb := '[]'::jsonb;
BEGIN
  v_admin_uid := public.utme_challenge_require_admin_internal();

  SELECT * INTO v_round
  FROM public.utme_challenge_rounds
  WHERE id = p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND'
      USING HINT = 'No round matches the provided ID.';
  END IF;

  IF v_round.status <> 'draft' THEN
    RAISE EXCEPTION 'ROUND_NOT_DRAFT'
      USING HINT = 'Round subjects can only be configured while the round is in draft status.';
  END IF;

  IF v_round.is_questions_frozen THEN
    RAISE EXCEPTION 'ROUND_FROZEN'
      USING HINT = 'Round subjects cannot be modified because questions are frozen.';
  END IF;

  -- Guarded sequential validation for subjects payload
  IF p_subjects IS NULL THEN
    RAISE EXCEPTION 'INVALID_SUBJECTS_PAYLOAD'
      USING HINT = 'p_subjects must be a non-empty JSON array of subject configuration objects.';
  ELSIF jsonb_typeof(p_subjects) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_SUBJECTS_PAYLOAD'
      USING HINT = 'p_subjects must be a non-empty JSON array of subject configuration objects.';
  ELSIF jsonb_array_length(p_subjects) = 0 THEN
    RAISE EXCEPTION 'INVALID_SUBJECTS_PAYLOAD'
      USING HINT = 'p_subjects must be a non-empty JSON array of subject configuration objects.';
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_subjects)
  LOOP
    IF jsonb_typeof(v_elem) <> 'object' THEN
      RAISE EXCEPTION 'MALFORMED_SUBJECT_OBJECT'
        USING HINT = 'Each element of p_subjects must be a JSON object.';
    END IF;

    IF NOT (v_elem ? 'subject') OR jsonb_typeof(v_elem -> 'subject') <> 'string' THEN
      RAISE EXCEPTION 'INVALID_SUBJECT_TYPE'
        USING HINT = 'Each subject object must contain a string property named "subject".';
    END IF;
    v_subject := btrim(v_elem ->> 'subject');

    IF v_subject = '' THEN
      RAISE EXCEPTION 'INVALID_SUBJECT_NAME'
        USING HINT = 'Subject name cannot be blank.';
    END IF;

    IF NOT (v_subject = ANY(v_valid_subjects)) THEN
      RAISE EXCEPTION 'UNKNOWN_SUBJECT'
        USING HINT = format('Subject "%s" is not in the recognized 13 UTME subjects list.', v_subject);
    END IF;

    IF v_subject = ANY(v_seen) THEN
      RAISE EXCEPTION 'DUPLICATE_SUBJECT_IN_PAYLOAD'
        USING HINT = format('Subject "%s" appears more than once in configuration payload.', v_subject);
    END IF;
    v_seen := array_append(v_seen, v_subject);

    -- Overflow-safe question_count validation
    IF v_elem ? 'question_count' THEN
      IF jsonb_typeof(v_elem -> 'question_count') <> 'number' THEN
        RAISE EXCEPTION 'INVALID_QUESTION_COUNT_FORMAT'
          USING HINT = format('Subject "%s" question_count must be a positive integer number.', v_subject);
      END IF;
      v_count_raw := v_elem ->> 'question_count';
      IF NOT (v_count_raw ~ '^[0-9]+$') OR length(v_count_raw) > 4 THEN
        RAISE EXCEPTION 'INVALID_QUESTION_COUNT_FORMAT'
          USING HINT = format('Subject "%s" question_count must be an integer between 1 and 50.', v_subject);
      END IF;
      v_count := v_count_raw::integer;
      IF v_count < 1 OR v_count > 50 THEN
        RAISE EXCEPTION 'INVALID_QUESTION_COUNT'
          USING HINT = format('Subject "%s" question count must be between 1 and 50.', v_subject);
      END IF;
    ELSE
      v_count := 10;
    END IF;

    -- Overflow-safe display_order validation
    IF v_elem ? 'display_order' THEN
      IF jsonb_typeof(v_elem -> 'display_order') <> 'number' THEN
        RAISE EXCEPTION 'INVALID_DISPLAY_ORDER_FORMAT'
          USING HINT = format('Subject "%s" display_order must be a non-negative integer number.', v_subject);
      END IF;
      v_order_raw := v_elem ->> 'display_order';
      IF NOT (v_order_raw ~ '^[0-9]+$') OR length(v_order_raw) > 6 THEN
        RAISE EXCEPTION 'INVALID_DISPLAY_ORDER_FORMAT'
          USING HINT = format('Subject "%s" display_order must be a valid non-negative integer.', v_subject);
      END IF;
      v_order := v_order_raw::integer;
    ELSE
      v_order := 0;
    END IF;

    v_total_questions_configured := v_total_questions_configured + v_count;
  END LOOP;

  IF cardinality(v_seen) < 4 THEN
    RAISE EXCEPTION 'MINIMUM_SUBJECTS_REQUIRED'
      USING HINT = 'A round must configure at least 4 distinct accredited subjects.';
  END IF;

  SELECT count(*) INTO v_count_questions
  FROM public.utme_challenge_round_questions
  WHERE round_id = p_round_id;

  IF v_count_questions > 0 THEN
    RAISE EXCEPTION 'PAPER_ALREADY_BUILT'
      USING HINT = 'Cannot modify round subjects while questions are assigned. Clear or rebuild paper first.';
  END IF;

  DELETE FROM public.utme_challenge_round_subjects
  WHERE round_id = p_round_id;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_subjects)
  LOOP
    v_subject := btrim(v_elem ->> 'subject');
    v_count := COALESCE((v_elem ->> 'question_count')::integer, 10);
    v_order := COALESCE((v_elem ->> 'display_order')::integer, 0);

    INSERT INTO public.utme_challenge_round_subjects (
      round_id,
      subject,
      question_count,
      display_order
    ) VALUES (
      p_round_id,
      v_subject,
      v_count,
      v_order
    );

    v_inserted_subjects := v_inserted_subjects || jsonb_build_object(
      'subject', v_subject,
      'question_count', v_count,
      'display_order', v_order
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'round_id', p_round_id,
    'configured_subjects_count', jsonb_array_length(v_inserted_subjects),
    'total_round_questions', v_total_questions_configured,
    'subjects', v_inserted_subjects
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_set_round_subjects(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_set_round_subjects(uuid, jsonb) TO authenticated;


-- ============================================================================
-- 5. QUESTION BANK MANAGEMENT
-- ============================================================================

-- Function 5: utme_challenge_admin_add_question
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_add_question(
  p_subject text,
  p_topic text,
  p_question_text text,
  p_options jsonb,
  p_correct_option text,
  p_explanation text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_subject text;
  v_topic text;
  v_qtext text;
  v_correct text;
  v_explanation text;
  v_clean_opts jsonb := '[]'::jsonb;
  v_opt_val text;
  v_lower_opt text;
  v_seen_opts text[] := '{}';
  v_valid_subjects text[] := ARRAY[
    'English', 'Mathematics', 'Physics', 'Chemistry', 'Biology',
    'Government', 'Literature in English', 'Economics', 'Commerce',
    'Accounting', 'Geography', 'CRS', 'History'
  ];
  v_new_q public.utme_challenge_question_bank%ROWTYPE;
BEGIN
  v_admin_uid := public.utme_challenge_require_admin_internal();

  v_subject := btrim(COALESCE(p_subject, ''));
  IF NOT (v_subject = ANY(v_valid_subjects)) THEN
    RAISE EXCEPTION 'UNKNOWN_SUBJECT'
      USING HINT = format('Subject "%s" is not in the recognized 13 UTME subjects list.', v_subject);
  END IF;

  v_topic := btrim(COALESCE(p_topic, ''));
  IF length(v_topic) < 2 OR length(v_topic) > 100 THEN
    RAISE EXCEPTION 'INVALID_TOPIC_LENGTH'
      USING HINT = 'Topic must be between 2 and 100 characters.';
  END IF;

  v_qtext := btrim(COALESCE(p_question_text, ''));
  IF length(v_qtext) < 10 THEN
    RAISE EXCEPTION 'INVALID_QUESTION_TEXT'
      USING HINT = 'Question text must be at least 10 characters.';
  END IF;

  -- Guarded sequential validation for question options
  IF p_options IS NULL THEN
    RAISE EXCEPTION 'INVALID_OPTIONS_COUNT'
      USING HINT = 'p_options must be a JSON array containing exactly 4 options.';
  ELSIF jsonb_typeof(p_options) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_OPTIONS_COUNT'
      USING HINT = 'p_options must be a JSON array containing exactly 4 options.';
  ELSIF jsonb_array_length(p_options) <> 4 THEN
    RAISE EXCEPTION 'INVALID_OPTIONS_COUNT'
      USING HINT = 'p_options must be a JSON array containing exactly 4 options.';
  END IF;

  FOR i IN 0..3 LOOP
    IF jsonb_typeof(p_options -> i) <> 'string' THEN
      RAISE EXCEPTION 'INVALID_OPTION_TYPE'
        USING HINT = format('Option at index %s must be a JSON string.', i);
    END IF;

    v_opt_val := btrim(p_options ->> i);
    IF length(v_opt_val) = 0 THEN
      RAISE EXCEPTION 'EMPTY_OPTION'
        USING HINT = format('Option at index %s cannot be blank or whitespace-only.', i);
    END IF;

    v_lower_opt := lower(v_opt_val);
    IF v_lower_opt = ANY(v_seen_opts) THEN
      RAISE EXCEPTION 'DUPLICATE_OPTIONS'
        USING HINT = format('Option "%s" appears multiple times (case-insensitive check).', v_opt_val);
    END IF;
    v_seen_opts := array_append(v_seen_opts, v_lower_opt);
    v_clean_opts := v_clean_opts || to_jsonb(v_opt_val);
  END LOOP;

  v_correct := upper(btrim(COALESCE(p_correct_option, '')));
  IF v_correct NOT IN ('A', 'B', 'C', 'D') THEN
    RAISE EXCEPTION 'INVALID_CORRECT_OPTION'
      USING HINT = 'Correct option must be one of "A", "B", "C", or "D".';
  END IF;

  v_explanation := NULLIF(btrim(COALESCE(p_explanation, '')), '');

  INSERT INTO public.utme_challenge_question_bank (
    subject,
    topic,
    question_text,
    options,
    correct_option,
    explanation,
    status,
    usage_count,
    last_used_round_id,
    created_by
  ) VALUES (
    v_subject,
    v_topic,
    v_qtext,
    v_clean_opts,
    v_correct,
    v_explanation,
    'draft',
    0,
    NULL,
    v_admin_uid
  )
  RETURNING * INTO v_new_q;

  RETURN jsonb_build_object(
    'success', true,
    'question', jsonb_build_object(
      'id', v_new_q.id,
      'subject', v_new_q.subject,
      'topic', v_new_q.topic,
      'question_text', v_new_q.question_text,
      'options', v_new_q.options,
      'correct_option', v_new_q.correct_option,
      'explanation', v_new_q.explanation,
      'status', v_new_q.status,
      'usage_count', v_new_q.usage_count,
      'created_at', v_new_q.created_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_add_question(text, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_add_question(text, text, text, jsonb, text, text) TO authenticated;


-- Function 6: utme_challenge_admin_update_question
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_update_question(
  p_question_id uuid,
  p_topic text DEFAULT NULL,
  p_question_text text DEFAULT NULL,
  p_options jsonb DEFAULT NULL,
  p_correct_option text DEFAULT NULL,
  p_explanation text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_q public.utme_challenge_question_bank%ROWTYPE;
  v_topic text;
  v_qtext text;
  v_correct text;
  v_explanation text;
  v_clean_opts jsonb := '[]'::jsonb;
  v_opt_val text;
  v_lower_opt text;
  v_seen_opts text[] := '{}';
  v_frozen_in_rounds boolean;
BEGIN
  v_admin_uid := public.utme_challenge_require_admin_internal();

  SELECT * INTO v_q
  FROM public.utme_challenge_question_bank
  WHERE id = p_question_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUESTION_NOT_FOUND'
      USING HINT = 'No question matches the provided ID.';
  END IF;

  -- Block editing if this question is locked in any frozen round
  SELECT EXISTS (
    SELECT 1
    FROM public.utme_challenge_round_questions rq
    JOIN public.utme_challenge_rounds r ON r.id = rq.round_id
    WHERE rq.question_id = p_question_id
      AND r.is_questions_frozen = true
  ) INTO v_frozen_in_rounds;

  IF v_frozen_in_rounds THEN
    RAISE EXCEPTION 'QUESTION_LOCKED_IN_FROZEN_ROUND'
      USING HINT = 'This question is currently locked in an active frozen round paper and cannot be edited.';
  END IF;

  IF p_topic IS NOT NULL THEN
    v_topic := btrim(p_topic);
    IF length(v_topic) < 2 OR length(v_topic) > 100 THEN
      RAISE EXCEPTION 'INVALID_TOPIC_LENGTH'
        USING HINT = 'Topic must be between 2 and 100 characters.';
    END IF;
  ELSE
    v_topic := v_q.topic;
  END IF;

  IF p_question_text IS NOT NULL THEN
    v_qtext := btrim(p_question_text);
    IF length(v_qtext) < 10 THEN
      RAISE EXCEPTION 'INVALID_QUESTION_TEXT'
        USING HINT = 'Question text must be at least 10 characters.';
    END IF;
  ELSE
    v_qtext := v_q.question_text;
  END IF;

  -- Guarded sequential validation for updated options
  IF p_options IS NOT NULL THEN
    IF jsonb_typeof(p_options) <> 'array' THEN
      RAISE EXCEPTION 'INVALID_OPTIONS_COUNT'
        USING HINT = 'p_options must be a JSON array containing exactly 4 options.';
    ELSIF jsonb_array_length(p_options) <> 4 THEN
      RAISE EXCEPTION 'INVALID_OPTIONS_COUNT'
        USING HINT = 'p_options must be a JSON array containing exactly 4 options.';
    END IF;

    FOR i IN 0..3 LOOP
      IF jsonb_typeof(p_options -> i) <> 'string' THEN
        RAISE EXCEPTION 'INVALID_OPTION_TYPE'
          USING HINT = format('Option at index %s must be a JSON string.', i);
      END IF;

      v_opt_val := btrim(p_options ->> i);
      IF length(v_opt_val) = 0 THEN
        RAISE EXCEPTION 'EMPTY_OPTION'
          USING HINT = format('Option at index %s cannot be blank or whitespace-only.', i);
      END IF;

      v_lower_opt := lower(v_opt_val);
      IF v_lower_opt = ANY(v_seen_opts) THEN
        RAISE EXCEPTION 'DUPLICATE_OPTIONS'
          USING HINT = format('Option "%s" appears multiple times (case-insensitive check).', v_opt_val);
      END IF;
      v_seen_opts := array_append(v_seen_opts, v_lower_opt);
      v_clean_opts := v_clean_opts || to_jsonb(v_opt_val);
    END LOOP;
  ELSE
    v_clean_opts := v_q.options;
  END IF;

  IF p_correct_option IS NOT NULL THEN
    v_correct := upper(btrim(p_correct_option));
    IF v_correct NOT IN ('A', 'B', 'C', 'D') THEN
      RAISE EXCEPTION 'INVALID_CORRECT_OPTION'
        USING HINT = 'Correct option must be one of "A", "B", "C", or "D".';
    END IF;
  ELSE
    v_correct := v_q.correct_option;
  END IF;

  IF p_explanation IS NOT NULL THEN
    v_explanation := NULLIF(btrim(p_explanation), '');
  ELSE
    v_explanation := v_q.explanation;
  END IF;

  UPDATE public.utme_challenge_question_bank
  SET
    topic = v_topic,
    question_text = v_qtext,
    options = v_clean_opts,
    correct_option = v_correct,
    explanation = v_explanation,
    updated_at = clock_timestamp()
  WHERE id = p_question_id
  RETURNING * INTO v_q;

  RETURN jsonb_build_object(
    'success', true,
    'question', jsonb_build_object(
      'id', v_q.id,
      'subject', v_q.subject,
      'topic', v_q.topic,
      'question_text', v_q.question_text,
      'options', v_q.options,
      'correct_option', v_q.correct_option,
      'explanation', v_q.explanation,
      'status', v_q.status,
      'usage_count', v_q.usage_count,
      'last_used_round_id', v_q.last_used_round_id,
      'updated_at', v_q.updated_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_update_question(uuid, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_update_question(uuid, text, text, jsonb, text, text) TO authenticated;


-- Function 7: utme_challenge_admin_set_question_status
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_set_question_status(
  p_question_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_q public.utme_challenge_question_bank%ROWTYPE;
  v_status text;
  v_old_status text;
  v_approved_at timestamptz;
  v_approved_by uuid;
BEGIN
  v_admin_uid := public.utme_challenge_require_admin_internal();

  v_status := lower(btrim(COALESCE(p_status, '')));
  IF v_status NOT IN ('draft', 'approved', 'rejected', 'archived') THEN
    RAISE EXCEPTION 'INVALID_QUESTION_STATUS'
      USING HINT = 'Question status must be "draft", "approved", "rejected", or "archived".';
  END IF;

  SELECT * INTO v_q
  FROM public.utme_challenge_question_bank
  WHERE id = p_question_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUESTION_NOT_FOUND'
      USING HINT = 'No question matches the provided ID.';
  END IF;

  v_old_status := v_q.status;

  IF v_status <> 'approved' AND v_old_status = 'approved' THEN
    IF EXISTS (
      SELECT 1
      FROM public.utme_challenge_round_questions rq
      JOIN public.utme_challenge_rounds r ON r.id = rq.round_id
      WHERE rq.question_id = p_question_id
        AND r.is_questions_frozen = true
    ) THEN
      RAISE EXCEPTION 'QUESTION_LOCKED_IN_FROZEN_ROUND'
        USING HINT = 'Cannot change status of a question currently locked in a frozen round paper.';
    END IF;
  END IF;

  IF v_status = 'approved' THEN
    IF v_old_status <> 'approved' OR v_q.approved_at IS NULL THEN
      v_approved_at := clock_timestamp();
      v_approved_by := v_admin_uid;
    ELSE
      v_approved_at := v_q.approved_at;
      v_approved_by := v_q.approved_by;
    END IF;
  ELSE
    v_approved_at := v_q.approved_at;
    v_approved_by := v_q.approved_by;
  END IF;

  UPDATE public.utme_challenge_question_bank
  SET
    status = v_status,
    approved_at = v_approved_at,
    approved_by = v_approved_by,
    updated_at = clock_timestamp()
  WHERE id = p_question_id
  RETURNING * INTO v_q;

  RETURN jsonb_build_object(
    'success', true,
    'question_id', v_q.id,
    'previous_status', v_old_status,
    'new_status', v_status,
    'approved_at', v_q.approved_at,
    'approved_by', v_q.approved_by
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_set_question_status(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_set_question_status(uuid, text) TO authenticated;


-- ============================================================================
-- 6. ROUND LIFECYCLE & PAPER MANAGEMENT
-- ============================================================================

-- Function 8: utme_challenge_admin_build_round_paper
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_build_round_paper(
  p_round_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_round public.utme_challenge_rounds%ROWTYPE;
  v_subject_config RECORD;
  v_avail_count integer;
  v_shortfalls jsonb := '[]'::jsonb;
  v_has_shortfall boolean := false;
  v_selected_q RECORD;
  v_pos integer;
  v_total_assigned integer := 0;
  v_summary jsonb := '[]'::jsonb;
  v_snapshot jsonb;
  v_actual_inserted integer;
  v_expected_total integer := 0;
  v_subject_count integer;
BEGIN
  v_admin_uid := public.utme_challenge_require_admin_internal();

  PERFORM pg_advisory_xact_lock(hashtext('utme_challenge_paper_build_lock'));

  SELECT * INTO v_round
  FROM public.utme_challenge_rounds
  WHERE id = p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND'
      USING HINT = 'No round matches the provided ID.';
  END IF;

  IF v_round.status <> 'draft' THEN
    RAISE EXCEPTION 'ROUND_NOT_DRAFT'
      USING HINT = 'Round papers can only be built while the round is in draft status.';
  END IF;

  IF v_round.is_questions_frozen THEN
    RAISE EXCEPTION 'ROUND_FROZEN'
      USING HINT = 'Round paper cannot be modified because questions are frozen.';
  END IF;

  SELECT count(*), COALESCE(sum(question_count), 0)
  INTO v_subject_count, v_expected_total
  FROM public.utme_challenge_round_subjects
  WHERE round_id = p_round_id;

  IF v_subject_count < 4 THEN
    RAISE EXCEPTION 'INSUFFICIENT_SUBJECTS_CONFIGURED'
      USING HINT = 'Round must have at least 4 configured subjects before building paper.';
  END IF;

  -- Pre-pass availability check
  FOR v_subject_config IN
    SELECT subject, question_count
    FROM public.utme_challenge_round_subjects
    WHERE round_id = p_round_id
    ORDER BY display_order, subject
  LOOP
    SELECT count(*) INTO v_avail_count
    FROM public.utme_challenge_question_bank
    WHERE subject = v_subject_config.subject
      AND status = 'approved';

    IF v_avail_count < v_subject_config.question_count THEN
      v_has_shortfall := true;
      v_shortfalls := v_shortfalls || jsonb_build_object(
        'subject', v_subject_config.subject,
        'required', v_subject_config.question_count,
        'available', v_avail_count,
        'shortfall', (v_subject_config.question_count - v_avail_count)
      );
    END IF;
  END LOOP;

  IF v_has_shortfall THEN
    RAISE EXCEPTION 'INSUFFICIENT_APPROVED_QUESTIONS'
      USING HINT = format('Cannot build paper. Shortfall detected: %s', v_shortfalls::text);
  END IF;

  DELETE FROM public.utme_challenge_round_questions
  WHERE round_id = p_round_id;

  FOR v_subject_config IN
    SELECT subject, question_count
    FROM public.utme_challenge_round_subjects
    WHERE round_id = p_round_id
    ORDER BY display_order, subject
  LOOP
    v_pos := 1;

    FOR v_selected_q IN
      SELECT
        qb.id,
        qb.subject,
        qb.topic,
        qb.question_text,
        qb.options,
        qb.correct_option,
        qb.explanation
      FROM public.utme_challenge_question_bank qb
      WHERE qb.subject = v_subject_config.subject
        AND qb.status = 'approved'
      ORDER BY
        qb.usage_count ASC,
        (qb.last_used_round_id IS NULL) DESC,
        random()
      LIMIT v_subject_config.question_count
      FOR UPDATE OF qb
    LOOP
      v_snapshot := jsonb_build_object(
        'question_text', v_selected_q.question_text,
        'options', v_selected_q.options,
        'correct_option', v_selected_q.correct_option,
        'explanation', v_selected_q.explanation
      );

      INSERT INTO public.utme_challenge_round_questions (
        round_id,
        subject,
        subject_position,
        question_id,
        question_snapshot
      ) VALUES (
        p_round_id,
        v_selected_q.subject,
        v_pos,
        v_selected_q.id,
        v_snapshot
      );

      v_pos := v_pos + 1;
      v_total_assigned := v_total_assigned + 1;
    END LOOP;

    IF (v_pos - 1) <> v_subject_config.question_count THEN
      RAISE EXCEPTION 'PAPER_INCOMPLETE'
        USING HINT = format('Subject "%s" was assigned %s questions instead of %s.', v_subject_config.subject, v_pos - 1, v_subject_config.question_count);
    END IF;

    v_summary := v_summary || jsonb_build_object(
      'subject', v_subject_config.subject,
      'assigned_count', v_pos - 1
    );
  END LOOP;

  SELECT count(*) INTO v_actual_inserted
  FROM public.utme_challenge_round_questions
  WHERE round_id = p_round_id;

  IF v_actual_inserted <> v_expected_total THEN
    RAISE EXCEPTION 'PAPER_INCOMPLETE'
      USING HINT = format('Expected %s total questions, but %s were inserted.', v_expected_total, v_actual_inserted);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'round_id', p_round_id,
    'total_questions_assigned', v_total_assigned,
    'breakdown', v_summary
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_build_round_paper(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_build_round_paper(uuid) TO authenticated;


-- Function 9: utme_challenge_admin_freeze_and_schedule_round
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_freeze_and_schedule_round(
  p_round_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_round public.utme_challenge_rounds%ROWTYPE;
  v_subject_config RECORD;
  v_assigned_count integer;
  v_integrity_errors jsonb := '[]'::jsonb;
  v_rq_row RECORD;
  v_updated_bank_count integer := 0;
  v_cfg_count integer;
  v_unapproved_count integer;
  v_locked_count integer;
BEGIN
  v_admin_uid := public.utme_challenge_require_admin_internal();

  -- 1. Shared advisory transaction lock acquired BEFORE the round row lock
  -- Guarantees usage-history updates and recalculations see fully committed preceding changes
  PERFORM pg_advisory_xact_lock(hashtext('utme_challenge_round_usage_history_lock'));

  -- 2. Lock round FOR UPDATE
  SELECT * INTO v_round
  FROM public.utme_challenge_rounds
  WHERE id = p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND'
      USING HINT = 'No round matches the provided ID.';
  END IF;

  IF v_round.status <> 'draft' THEN
    RAISE EXCEPTION 'ROUND_NOT_DRAFT'
      USING HINT = 'Only draft rounds can be frozen and scheduled.';
  END IF;

  IF v_round.is_questions_frozen THEN
    RAISE EXCEPTION 'ROUND_ALREADY_FROZEN'
      USING HINT = 'Round questions are already frozen.';
  END IF;

  SELECT count(*) INTO v_cfg_count
  FROM public.utme_challenge_round_subjects
  WHERE round_id = p_round_id;

  IF v_cfg_count IS NULL OR v_cfg_count < 4 THEN
    RAISE EXCEPTION 'MINIMUM_SUBJECTS_REQUIRED'
      USING HINT = 'Round must configure at least 4 distinct subjects before scheduling.';
  END IF;

  -- 3. Deadlock-free ordered row-locking on exact assigned question-bank records
  SELECT count(*) INTO v_locked_count
  FROM (
    SELECT qb.id
    FROM public.utme_challenge_question_bank qb
    WHERE qb.id IN (
      SELECT rq.question_id
      FROM public.utme_challenge_round_questions rq
      WHERE rq.round_id = p_round_id
    )
    ORDER BY qb.id ASC
    FOR UPDATE OF qb
  ) locked_rows;

  -- 4. Re-verify all assigned question-bank rows are present and approved
  SELECT count(*) INTO v_unapproved_count
  FROM public.utme_challenge_round_questions rq
  LEFT JOIN public.utme_challenge_question_bank qb ON qb.id = rq.question_id
  WHERE rq.round_id = p_round_id
    AND (qb.id IS NULL OR qb.status <> 'approved');

  IF v_unapproved_count > 0 THEN
    RAISE EXCEPTION 'UNAPPROVED_QUESTIONS_IN_PAPER'
      USING HINT = format('Cannot schedule: %s assigned questions are missing or unapproved in the bank.', v_unapproved_count);
  END IF;

  -- 5. Verify that each configured subject has exact question count assigned
  FOR v_subject_config IN
    SELECT subject, question_count
    FROM public.utme_challenge_round_subjects
    WHERE round_id = p_round_id
    ORDER BY display_order, subject
  LOOP
    SELECT count(*) INTO v_assigned_count
    FROM public.utme_challenge_round_questions
    WHERE round_id = p_round_id
      AND subject = v_subject_config.subject;

    IF v_assigned_count <> v_subject_config.question_count THEN
      RAISE EXCEPTION 'QUESTION_COUNT_MISMATCH'
        USING HINT = format(
          'Subject "%s" requires %s questions, but %s are currently assigned.',
          v_subject_config.subject,
          v_subject_config.question_count,
          v_assigned_count
        );
    END IF;
  END LOOP;

  -- 6. Comprehensive snapshot type, keys, values, and bank consistency verification
  FOR v_rq_row IN
    SELECT
      rq.question_id,
      rq.subject,
      rq.subject_position,
      rq.question_snapshot,
      qb.question_text AS bank_qtext,
      qb.options AS bank_options,
      qb.correct_option AS bank_correct,
      qb.explanation AS bank_explanation
    FROM public.utme_challenge_round_questions rq
    JOIN public.utme_challenge_question_bank qb ON qb.id = rq.question_id
    WHERE rq.round_id = p_round_id
  LOOP
    -- Structural check: root must be JSON object
    IF jsonb_typeof(v_rq_row.question_snapshot) <> 'object' THEN
      v_integrity_errors := v_integrity_errors || jsonb_build_object(
        'question_id', v_rq_row.question_id,
        'error', 'SNAPSHOT_NOT_JSON_OBJECT'
      );
      CONTINUE;
    END IF;

    -- Required keys existence check
    IF NOT (v_rq_row.question_snapshot ?& ARRAY['question_text', 'options', 'correct_option', 'explanation']) THEN
      v_integrity_errors := v_integrity_errors || jsonb_build_object(
        'question_id', v_rq_row.question_id,
        'error', 'MISSING_REQUIRED_KEYS'
      );
      CONTINUE;
    END IF;

    -- question_text: non-empty JSON string
    IF jsonb_typeof(v_rq_row.question_snapshot -> 'question_text') <> 'string' OR
       length(btrim(v_rq_row.question_snapshot ->> 'question_text')) = 0 THEN
      v_integrity_errors := v_integrity_errors || jsonb_build_object(
        'question_id', v_rq_row.question_id,
        'error', 'INVALID_OR_EMPTY_QUESTION_TEXT'
      );
    END IF;

    -- options: array of exactly four non-empty JSON strings (guarded evaluation)
    IF jsonb_typeof(v_rq_row.question_snapshot -> 'options') <> 'array' THEN
      v_integrity_errors := v_integrity_errors || jsonb_build_object(
        'question_id', v_rq_row.question_id,
        'error', 'OPTIONS_NOT_AN_ARRAY'
      );
    ELSIF jsonb_array_length(v_rq_row.question_snapshot -> 'options') <> 4 THEN
      v_integrity_errors := v_integrity_errors || jsonb_build_object(
        'question_id', v_rq_row.question_id,
        'error', 'OPTIONS_ARRAY_LENGTH_NOT_4'
      );
    ELSE
      FOR i IN 0..3 LOOP
        IF jsonb_typeof(v_rq_row.question_snapshot -> 'options' -> i) <> 'string' OR
           length(btrim(v_rq_row.question_snapshot -> 'options' ->> i)) = 0 THEN
          v_integrity_errors := v_integrity_errors || jsonb_build_object(
            'question_id', v_rq_row.question_id,
            'error', format('EMPTY_OR_NON_STRING_OPTION_INDEX_%s', i)
          );
        END IF;
      END LOOP;
    END IF;

    -- correct_option: JSON string containing 'A', 'B', 'C', or 'D'
    IF jsonb_typeof(v_rq_row.question_snapshot -> 'correct_option') <> 'string' OR
       (v_rq_row.question_snapshot ->> 'correct_option') NOT IN ('A', 'B', 'C', 'D') THEN
      v_integrity_errors := v_integrity_errors || jsonb_build_object(
        'question_id', v_rq_row.question_id,
        'error', 'INVALID_CORRECT_OPTION_VALUE'
      );
    END IF;

    -- explanation: JSON string or JSON null
    IF jsonb_typeof(v_rq_row.question_snapshot -> 'explanation') NOT IN ('string', 'null') THEN
      v_integrity_errors := v_integrity_errors || jsonb_build_object(
        'question_id', v_rq_row.question_id,
        'error', 'INVALID_EXPLANATION_TYPE'
      );
    END IF;

    -- Exact match against question bank record
    IF (v_rq_row.question_snapshot ->> 'question_text') IS DISTINCT FROM v_rq_row.bank_qtext OR
       (v_rq_row.question_snapshot -> 'options') IS DISTINCT FROM v_rq_row.bank_options OR
       (v_rq_row.question_snapshot ->> 'correct_option') IS DISTINCT FROM v_rq_row.bank_correct OR
       (v_rq_row.question_snapshot ->> 'explanation') IS DISTINCT FROM v_rq_row.bank_explanation THEN
      v_integrity_errors := v_integrity_errors || jsonb_build_object(
        'question_id', v_rq_row.question_id,
        'error', 'SNAPSHOT_DIFFERS_FROM_BANK_RECORD'
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_integrity_errors) > 0 THEN
    RAISE EXCEPTION 'SNAPSHOT_INTEGRITY_VIOLATION'
      USING HINT = format('Snapshot integrity check failed: %s. Rebuild paper before freezing.', v_integrity_errors::text);
  END IF;

  -- 7. Update question bank: increment usage count and set last_used_round_id
  UPDATE public.utme_challenge_question_bank qb
  SET
    usage_count = qb.usage_count + 1,
    last_used_round_id = p_round_id,
    updated_at = clock_timestamp()
  FROM public.utme_challenge_round_questions rq
  WHERE rq.round_id = p_round_id
    AND qb.id = rq.question_id;

  GET DIAGNOSTICS v_updated_bank_count = ROW_COUNT;

  -- 8. Freeze round and transition status to scheduled
  UPDATE public.utme_challenge_rounds
  SET
    is_questions_frozen = true,
    frozen_at = clock_timestamp(),
    status = 'scheduled',
    updated_at = clock_timestamp()
  WHERE id = p_round_id
  RETURNING * INTO v_round;

  RETURN jsonb_build_object(
    'success', true,
    'round_id', v_round.id,
    'status', v_round.status,
    'is_questions_frozen', v_round.is_questions_frozen,
    'frozen_at', v_round.frozen_at,
    'questions_frozen_count', v_updated_bank_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_freeze_and_schedule_round(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_freeze_and_schedule_round(uuid) TO authenticated;


-- Function 10: utme_challenge_admin_unschedule_round
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_unschedule_round(
  p_round_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_round public.utme_challenge_rounds%ROWTYPE;
  v_attempts_count integer;
  v_recalculated_bank_count integer := 0;
  v_deleted_questions_count integer := 0;
  v_locked_count integer;
BEGIN
  v_admin_uid := public.utme_challenge_require_admin_internal();

  -- 1. Shared advisory transaction lock acquired BEFORE the round row lock
  -- Guarantees usage-history updates and recalculations see fully committed preceding changes
  PERFORM pg_advisory_xact_lock(hashtext('utme_challenge_round_usage_history_lock'));

  -- 2. Lock round FOR UPDATE
  SELECT * INTO v_round
  FROM public.utme_challenge_rounds
  WHERE id = p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND'
      USING HINT = 'No round matches the provided ID.';
  END IF;

  IF v_round.status <> 'scheduled' OR NOT v_round.is_questions_frozen THEN
    RAISE EXCEPTION 'CANNOT_UNSCHEDULE_ROUND'
      USING HINT = 'Only scheduled and frozen rounds can be unscheduled back to draft status.';
  END IF;

  -- 3. Verify no student attempts exist
  SELECT count(*) INTO v_attempts_count
  FROM public.utme_challenge_attempts
  WHERE round_id = p_round_id;

  IF v_attempts_count > 0 THEN
    RAISE EXCEPTION 'CANNOT_UNSCHEDULE_ROUND_WITH_ATTEMPTS'
      USING HINT = 'Cannot unschedule a round that already has student attempts.';
  END IF;

  -- 4. Lock affected question-bank records in deterministic primary-key order
  SELECT count(*) INTO v_locked_count
  FROM (
    SELECT qb.id
    FROM public.utme_challenge_question_bank qb
    WHERE qb.id IN (
      SELECT rq.question_id
      FROM public.utme_challenge_round_questions rq
      WHERE rq.round_id = p_round_id
    )
    ORDER BY qb.id ASC
    FOR UPDATE OF qb
  ) locked_rows;

  -- 5. Authoritatively recalculate usage_count and last_used_round_id from all remaining frozen rounds
  UPDATE public.utme_challenge_question_bank qb
  SET
    usage_count = (
      SELECT count(*)
      FROM public.utme_challenge_round_questions remaining_rq
      JOIN public.utme_challenge_rounds remaining_r ON remaining_r.id = remaining_rq.round_id
      WHERE remaining_rq.question_id = qb.id
        AND remaining_r.id <> p_round_id
        AND remaining_r.is_questions_frozen = true
    ),
    last_used_round_id = (
      SELECT remaining_r.id
      FROM public.utme_challenge_round_questions remaining_rq
      JOIN public.utme_challenge_rounds remaining_r ON remaining_r.id = remaining_rq.round_id
      WHERE remaining_rq.question_id = qb.id
        AND remaining_r.id <> p_round_id
        AND remaining_r.is_questions_frozen = true
      ORDER BY remaining_r.start_window_opens_at DESC, remaining_r.frozen_at DESC NULLS LAST
      LIMIT 1
    ),
    updated_at = clock_timestamp()
  FROM public.utme_challenge_round_questions rq
  WHERE rq.round_id = p_round_id
    AND qb.id = rq.question_id;

  GET DIAGNOSTICS v_recalculated_bank_count = ROW_COUNT;

  -- 6. Revert round status to draft and unfreeze questions
  UPDATE public.utme_challenge_rounds
  SET
    status = 'draft',
    is_questions_frozen = false,
    frozen_at = NULL,
    updated_at = clock_timestamp()
  WHERE id = p_round_id
  RETURNING * INTO v_round;

  -- 7. Delete assigned round questions
  DELETE FROM public.utme_challenge_round_questions
  WHERE round_id = p_round_id;

  GET DIAGNOSTICS v_deleted_questions_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'round_id', v_round.id,
    'status', v_round.status,
    'is_questions_frozen', v_round.is_questions_frozen,
    'bank_questions_recalculated', v_recalculated_bank_count,
    'questions_deleted_from_round', v_deleted_questions_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_unschedule_round(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_unschedule_round(uuid) TO authenticated;


-- Function 11: utme_challenge_admin_preview_round_paper
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_preview_round_paper(
  p_round_id uuid,
  p_subject text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_round public.utme_challenge_rounds%ROWTYPE;
  v_questions jsonb := '[]'::jsonb;
  v_row RECORD;
  v_missing_bank_count integer := 0;
  v_unapproved_bank_count integer := 0;
BEGIN
  v_admin_uid := public.utme_challenge_require_admin_internal();

  SELECT * INTO v_round
  FROM public.utme_challenge_rounds
  WHERE id = p_round_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND'
      USING HINT = 'No round matches the provided ID.';
  END IF;

  FOR v_row IN
    SELECT
      rq.id AS round_question_id,
      rq.subject,
      rq.subject_position,
      rq.question_id,
      rq.question_snapshot ->> 'question_text' AS question_text,
      rq.question_snapshot -> 'options' AS options,
      rq.question_snapshot ->> 'correct_option' AS correct_option,
      rq.question_snapshot ->> 'explanation' AS explanation,
      qb.id AS bank_id,
      qb.topic AS bank_topic,
      qb.status AS bank_status,
      qb.usage_count AS bank_usage_count
    FROM public.utme_challenge_round_questions rq
    LEFT JOIN public.utme_challenge_question_bank qb ON qb.id = rq.question_id
    WHERE rq.round_id = p_round_id
      AND (p_subject IS NULL OR rq.subject = p_subject)
    ORDER BY rq.subject, rq.subject_position ASC
  LOOP
    IF v_row.bank_id IS NULL THEN
      v_missing_bank_count := v_missing_bank_count + 1;
    ELSIF v_row.bank_status <> 'approved' THEN
      v_unapproved_bank_count := v_unapproved_bank_count + 1;
    END IF;

    v_questions := v_questions || jsonb_build_object(
      'round_question_id', v_row.round_question_id,
      'subject', v_row.subject,
      'position', v_row.subject_position,
      'question_id', v_row.question_id,
      'bank_record_missing', (v_row.bank_id IS NULL),
      'bank_status', COALESCE(v_row.bank_status, 'RECORD_MISSING'),
      'bank_topic', v_row.bank_topic,
      'question_text', v_row.question_text,
      'options', v_row.options,
      'correct_option', v_row.correct_option,
      'explanation', v_row.explanation,
      'has_integrity_issue', (v_row.bank_id IS NULL OR v_row.bank_status <> 'approved')
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'round_id', p_round_id,
    'round_title', v_round.title,
    'is_questions_frozen', v_round.is_questions_frozen,
    'total_assigned_questions', jsonb_array_length(v_questions),
    'missing_bank_questions_count', v_missing_bank_count,
    'unapproved_bank_questions_count', v_unapproved_bank_count,
    'has_integrity_issues', (v_missing_bank_count > 0 OR v_unapproved_bank_count > 0),
    'questions', v_questions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_preview_round_paper(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_preview_round_paper(uuid, text) TO authenticated;


-- ============================================================================
-- 7. ADMIN READ & REPORTING FUNCTIONS
-- ============================================================================

-- Function 12: utme_challenge_admin_list_rounds
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_list_rounds(
  p_season_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_result jsonb := '[]'::jsonb;
  v_row RECORD;
BEGIN
  v_admin_uid := public.utme_challenge_require_admin_internal();

  FOR v_row IN
    SELECT
      r.id,
      r.season_id,
      s.year AS season_year,
      s.title AS season_title,
      r.round_number,
      r.title,
      r.status,
      r.registration_opens_at,
      r.registration_closes_at,
      r.start_window_opens_at,
      r.start_window_closes_at,
      r.duration_minutes,
      r.grace_period_seconds,
      r.is_questions_frozen,
      r.frozen_at,
      r.created_at,
      r.updated_at,
      (SELECT count(*) FROM public.utme_challenge_registrations reg WHERE reg.season_id = r.season_id) AS registration_count,
      (SELECT count(*) FROM public.utme_challenge_attempts att WHERE att.round_id = r.id) AS attempt_count,
      (SELECT count(*) FROM public.utme_challenge_round_questions rq WHERE rq.round_id = r.id) AS question_count
    FROM public.utme_challenge_rounds r
    JOIN public.utme_challenge_seasons s ON s.id = r.season_id
    WHERE (p_season_id IS NULL OR r.season_id = p_season_id)
    ORDER BY s.year DESC, r.round_number DESC
  LOOP
    v_result := v_result || jsonb_build_object(
      'id', v_row.id,
      'season_id', v_row.season_id,
      'season_year', v_row.season_year,
      'season_title', v_row.season_title,
      'round_number', v_row.round_number,
      'title', v_row.title,
      'status', v_row.status,
      'registration_opens_at', v_row.registration_opens_at,
      'registration_closes_at', v_row.registration_closes_at,
      'start_window_opens_at', v_row.start_window_opens_at,
      'start_window_closes_at', v_row.start_window_closes_at,
      'duration_minutes', v_row.duration_minutes,
      'grace_period_seconds', v_row.grace_period_seconds,
      'is_questions_frozen', v_row.is_questions_frozen,
      'frozen_at', v_row.frozen_at,
      'created_at', v_row.created_at,
      'registration_count', v_row.registration_count,
      'attempt_count', v_row.attempt_count,
      'question_count', v_row.question_count
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'rounds', v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_list_rounds(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_list_rounds(uuid) TO authenticated;


-- Function 13: utme_challenge_admin_round_overview
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_round_overview(
  p_round_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_round RECORD;
  v_subjects jsonb := '[]'::jsonb;
  v_sub_row RECORD;
  v_attempt_stats RECORD;
  v_reg_count integer;
BEGIN
  v_admin_uid := public.utme_challenge_require_admin_internal();

  SELECT
    r.*,
    s.year AS season_year,
    s.title AS season_title
  INTO v_round
  FROM public.utme_challenge_rounds r
  JOIN public.utme_challenge_seasons s ON s.id = r.season_id
  WHERE r.id = p_round_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND'
      USING HINT = 'No round matches the provided ID.';
  END IF;

  FOR v_sub_row IN
    SELECT
      rs.subject,
      rs.question_count AS configured_count,
      rs.display_order,
      (SELECT count(*) FROM public.utme_challenge_round_questions rq
       WHERE rq.round_id = p_round_id AND rq.subject = rs.subject) AS assigned_count,
      (SELECT count(*) FROM public.utme_challenge_question_bank qb
       WHERE qb.subject = rs.subject AND qb.status = 'approved') AS available_approved_pool
    FROM public.utme_challenge_round_subjects rs
    WHERE rs.round_id = p_round_id
    ORDER BY rs.display_order, rs.subject
  LOOP
    v_subjects := v_subjects || jsonb_build_object(
      'subject', v_sub_row.subject,
      'configured_count', v_sub_row.configured_count,
      'assigned_count', v_sub_row.assigned_count,
      'available_approved_pool', v_sub_row.available_approved_pool,
      'display_order', v_sub_row.display_order
    );
  END LOOP;

  SELECT count(*) INTO v_reg_count
  FROM public.utme_challenge_registrations
  WHERE season_id = v_round.season_id;

  SELECT
    count(*) AS total_attempts,
    count(*) FILTER (WHERE status = 'in_progress') AS in_progress_count,
    count(*) FILTER (WHERE status = 'submitted') AS submitted_count,
    count(*) FILTER (WHERE status = 'expired') AS expired_count,
    coalesce(round(avg(percentage) FILTER (WHERE status IN ('submitted', 'expired')), 2), 0) AS avg_percentage,
    coalesce(max(percentage) FILTER (WHERE status IN ('submitted', 'expired')), 0) AS max_percentage,
    coalesce(min(percentage) FILTER (WHERE status IN ('submitted', 'expired')), 0) AS min_percentage
  INTO v_attempt_stats
  FROM public.utme_challenge_attempts
  WHERE round_id = p_round_id;

  RETURN jsonb_build_object(
    'success', true,
    'round', jsonb_build_object(
      'id', v_round.id,
      'season_id', v_round.season_id,
      'season_year', v_round.season_year,
      'season_title', v_round.season_title,
      'round_number', v_round.round_number,
      'title', v_round.title,
      'status', v_round.status,
      'registration_opens_at', v_round.registration_opens_at,
      'registration_closes_at', v_round.registration_closes_at,
      'start_window_opens_at', v_round.start_window_opens_at,
      'start_window_closes_at', v_round.start_window_closes_at,
      'duration_minutes', v_round.duration_minutes,
      'grace_period_seconds', v_round.grace_period_seconds,
      'is_questions_frozen', v_round.is_questions_frozen,
      'frozen_at', v_round.frozen_at,
      'created_at', v_round.created_at,
      'updated_at', v_round.updated_at
    ),
    'subjects', v_subjects,
    'season_registrations_count', v_reg_count,
    'attempts_summary', jsonb_build_object(
      'total', v_attempt_stats.total_attempts,
      'in_progress', v_attempt_stats.in_progress_count,
      'submitted', v_attempt_stats.submitted_count,
      'expired', v_attempt_stats.expired_count,
      'average_score', v_attempt_stats.avg_percentage,
      'highest_score', v_attempt_stats.max_percentage,
      'lowest_score', v_attempt_stats.min_percentage
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_round_overview(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_round_overview(uuid) TO authenticated;


-- Function 14: utme_challenge_admin_list_questions
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_list_questions(
  p_subject text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_limit integer;
  v_offset integer;
  v_total integer;
  v_questions jsonb := '[]'::jsonb;
  v_row RECORD;
BEGIN
  v_admin_uid := public.utme_challenge_require_admin_internal();

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  SELECT count(*) INTO v_total
  FROM public.utme_challenge_question_bank
  WHERE (p_subject IS NULL OR subject = p_subject)
    AND (p_status IS NULL OR status = p_status);

  FOR v_row IN
    SELECT
      id,
      subject,
      topic,
      question_text,
      options,
      correct_option,
      explanation,
      status,
      usage_count,
      last_used_round_id,
      created_at,
      updated_at
    FROM public.utme_challenge_question_bank
    WHERE (p_subject IS NULL OR subject = p_subject)
      AND (p_status IS NULL OR status = p_status)
    ORDER BY created_at DESC
    LIMIT v_limit
    OFFSET v_offset
  LOOP
    v_questions := v_questions || jsonb_build_object(
      'id', v_row.id,
      'subject', v_row.subject,
      'topic', v_row.topic,
      'question_text', v_row.question_text,
      'options', v_row.options,
      'correct_option', v_row.correct_option,
      'explanation', v_row.explanation,
      'status', v_row.status,
      'usage_count', v_row.usage_count,
      'last_used_round_id', v_row.last_used_round_id,
      'created_at', v_row.created_at,
      'updated_at', v_row.updated_at
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'questions', v_questions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_list_questions(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_list_questions(text, text, integer, integer) TO authenticated;


-- Function 15: utme_challenge_admin_question_pool_summary
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_question_pool_summary(
  p_questions_per_subject integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_summary jsonb := '[]'::jsonb;
  v_row RECORD;
  v_total_bank integer := 0;
  v_total_approved integer := 0;
  v_total_draft integer := 0;
  v_total_rejected integer := 0;
  v_total_archived integer := 0;
  v_qps integer;
BEGIN
  v_admin_uid := public.utme_challenge_require_admin_internal();

  v_qps := COALESCE(p_questions_per_subject, 10);
  IF v_qps < 1 OR v_qps > 50 THEN
    RAISE EXCEPTION 'INVALID_QUESTIONS_PER_SUBJECT'
      USING HINT = 'p_questions_per_subject benchmark must be between 1 and 50.';
  END IF;

  FOR v_row IN
    SELECT
      subject,
      count(*) AS total_count,
      count(*) FILTER (WHERE status = 'approved') AS approved_count,
      count(*) FILTER (WHERE status = 'draft') AS draft_count,
      count(*) FILTER (WHERE status = 'rejected') AS rejected_count,
      count(*) FILTER (WHERE status = 'archived') AS archived_count,
      count(*) FILTER (WHERE status = 'approved' AND usage_count = 0) AS fresh_approved_count,
      coalesce(max(usage_count), 0) AS max_usage_count
    FROM public.utme_challenge_question_bank
    GROUP BY subject
    ORDER BY subject
  LOOP
    v_total_bank := v_total_bank + v_row.total_count;
    v_total_approved := v_total_approved + v_row.approved_count;
    v_total_draft := v_total_draft + v_row.draft_count;
    v_total_rejected := v_total_rejected + v_row.rejected_count;
    v_total_archived := v_total_archived + v_row.archived_count;

    v_summary := v_summary || jsonb_build_object(
      'subject', v_row.subject,
      'total_questions', v_row.total_count,
      'approved', v_row.approved_count,
      'draft', v_row.draft_count,
      'rejected', v_row.rejected_count,
      'archived', v_row.archived_count,
      'fresh_approved', v_row.fresh_approved_count,
      'max_usage_count', v_row.max_usage_count,
      'estimated_supportable_rounds_fresh', floor(v_row.fresh_approved_count::numeric / v_qps)::integer,
      'estimated_supportable_rounds_total', floor(v_row.approved_count::numeric / v_qps)::integer
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'questions_per_subject_benchmark', v_qps,
    'metric_notes', 'Supportable round projections are mathematical estimates and do not guarantee future question freshness or topic coverage across subsequent rounds.',
    'overall', jsonb_build_object(
      'total_questions', v_total_bank,
      'total_approved', v_total_approved,
      'total_draft', v_total_draft,
      'total_rejected', v_total_rejected,
      'total_archived', v_total_archived
    ),
    'subjects', v_summary
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_question_pool_summary(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_question_pool_summary(integer) TO authenticated;

COMMIT;
