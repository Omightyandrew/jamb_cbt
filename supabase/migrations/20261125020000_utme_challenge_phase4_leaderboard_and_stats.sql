-- ============================================================================
-- ExamPilot UTME Challenge 2027: Phase 4 Leaderboard & Statistics Migration
-- File: supabase/migrations/20261125020000_utme_challenge_phase4_leaderboard_and_stats.sql
--
-- STRICTLY ADDITIVE: Does NOT alter or drop any existing core ExamPilot tables,
-- views, functions, or Daily Challenge objects.
--
-- Implements:
--   1. Schema additions on public.utme_challenge_leaderboard_entries (overall_rank, subject_breakdown).
--   2. Non-destructive leaderboard generation (replaces DELETE with existence guard).
--   3. Safe bounded attempt sweeping in finalization and maintenance worker.
--   4. Drop legacy single-argument public.utme_challenge_get_leaderboard(uuid) to prevent
--      overload ambiguity in PostgREST and eliminate legacy Premium restrictions.
--   5. Universal candidate-facing leaderboard RPC with overall nationwide rankings,
--      combination rankings, individual subject rankings, competition statistics,
--      overflow-safe JSON validation, personal performance, and display-name privacy.
--   6. Controlled, non-destructive backfill for existing finalized rounds.
--
-- All functions are SECURITY DEFINER with SET search_path = pg_catalog, public.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. SCHEMA ADDITIONS ON LEADERBOARD ENTRIES
-- ============================================================================

ALTER TABLE public.utme_challenge_leaderboard_entries
  ADD COLUMN IF NOT EXISTS overall_rank integer CHECK (overall_rank >= 1),
  ADD COLUMN IF NOT EXISTS subject_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS utme_challenge_ldb_round_overall_idx
  ON public.utme_challenge_leaderboard_entries (round_id, overall_rank ASC, display_name ASC, user_id ASC);

CREATE INDEX IF NOT EXISTS utme_challenge_ldb_round_combo_v2_idx
  ON public.utme_challenge_leaderboard_entries (round_id, combination_key, rank ASC, display_name ASC, user_id ASC);

CREATE INDEX IF NOT EXISTS utme_challenge_ldb_subjects_gin_idx
  ON public.utme_challenge_leaderboard_entries USING gin (subject_breakdown);


-- ============================================================================
-- 2. NON-DESTRUCTIVE LEADERBOARD GENERATION (INTERNAL)
-- Generates deterministic DENSE_RANK() rankings for both overall nationwide rank
-- and combination rank. Refuses to overwrite or delete existing entries.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.utme_challenge_generate_leaderboard_internal(
  p_round_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_round public.utme_challenge_rounds%ROWTYPE;
  v_inserted_count integer := 0;
  v_combinations_count integer := 0;
BEGIN
  IF p_round_id IS NULL THEN
    RAISE EXCEPTION 'ROUND_ID_REQUIRED';
  END IF;

  -- 1. Verify round state and lock FOR UPDATE
  SELECT * INTO v_round
  FROM public.utme_challenge_rounds
  WHERE id = p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND';
  END IF;

  -- 2. Immutability Guard: Never mutate an already finalized round
  IF v_round.status = 'finalized' THEN
    RAISE EXCEPTION 'ROUND_ALREADY_FINALIZED: Published leaderboards are permanently immutable.'
      USING HINT = 'Leaderboards for finalized rounds cannot be regenerated, deleted, or altered.';
  END IF;

  -- 3. Lifecycle Guard: Round must be in 'closed' status and questions frozen
  IF v_round.status <> 'closed' OR NOT v_round.is_questions_frozen THEN
    RAISE EXCEPTION 'ROUND_NOT_ELIGIBLE: Leaderboard can only be generated for closed, frozen rounds.'
      USING HINT = 'Verify that the testing window has closed and all candidate attempt deadlines have passed.';
  END IF;

  -- 4. Non-Destructive Guard: Do NOT delete existing entries. Halt if entries exist.
  IF EXISTS (
    SELECT 1 FROM public.utme_challenge_leaderboard_entries
    WHERE round_id = p_round_id
  ) THEN
    RAISE EXCEPTION 'LEADERBOARD_ENTRIES_ALREADY_EXIST: Entries already exist for round %.', p_round_id
      USING HINT = 'Entries cannot be replaced or regenerated. Investigate existing entries before finalizing.';
  END IF;

  -- 5. Calculate and insert deterministic rankings
  WITH ranked_attempts AS (
    SELECT
      p_round_id AS round_id,
      reg.combination_key,
      a.user_id,
      reg.display_name,
      a.percentage,
      a.english_percentage,
      a.total_correct,
      a.subject_breakdown,
      DENSE_RANK() OVER (
        PARTITION BY reg.combination_key
        ORDER BY a.percentage DESC, a.english_percentage DESC, a.total_correct DESC
      ) AS computed_combination_rank,
      DENSE_RANK() OVER (
        ORDER BY a.percentage DESC, a.english_percentage DESC, a.total_correct DESC
      ) AS computed_overall_rank
    FROM public.utme_challenge_attempts a
    JOIN public.utme_challenge_registrations reg ON reg.id = a.registration_id
    WHERE a.round_id = p_round_id
      AND a.status IN ('submitted', 'expired')
  ),
  inserted_rows AS (
    INSERT INTO public.utme_challenge_leaderboard_entries (
      round_id,
      combination_key,
      user_id,
      display_name,
      final_percentage,
      english_percentage,
      total_correct,
      rank,
      overall_rank,
      subject_breakdown,
      generated_at
    )
    SELECT
      round_id,
      combination_key,
      user_id,
      display_name,
      percentage,
      english_percentage,
      total_correct,
      computed_combination_rank,
      computed_overall_rank,
      COALESCE(subject_breakdown, '{}'::jsonb),
      clock_timestamp()
    FROM ranked_attempts
    ORDER BY computed_overall_rank ASC, display_name ASC, user_id ASC
    RETURNING combination_key
  )
  SELECT
    count(*)::integer,
    count(DISTINCT combination_key)::integer
  INTO v_inserted_count, v_combinations_count
  FROM inserted_rows;

  RETURN jsonb_build_object(
    'success', true,
    'round_id', p_round_id,
    'entries_generated', v_inserted_count,
    'combinations_ranked', v_combinations_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_generate_leaderboard_internal(uuid) FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 3. SAFE BOUNDED ROUND FINALIZATION (INTERNAL)
-- Preserves candidate rights, executes bounded attempt sweeps, and finalizes
-- only when zero in-progress attempts remain.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.utme_challenge_finalize_round_internal(
  p_round_id uuid,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_round public.utme_challenge_rounds%ROWTYPE;
  v_final_deadline timestamptz;
  v_active_count integer;
  v_existing_entries integer := 0;
  v_existing_combos integer := 0;
  v_sweep_res jsonb;
  v_leaderboard_res jsonb;
BEGIN
  IF p_round_id IS NULL THEN
    RAISE EXCEPTION 'ROUND_ID_REQUIRED';
  END IF;

  -- 1. Exclusively lock the round row
  SELECT * INTO v_round
  FROM public.utme_challenge_rounds
  WHERE id = p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND';
  END IF;

  -- 2. Idempotency Guard: If already finalized, return immutable published summary
  IF v_round.status = 'finalized' THEN
    SELECT count(*)::integer, count(DISTINCT combination_key)::integer
    INTO v_existing_entries, v_existing_combos
    FROM public.utme_challenge_leaderboard_entries
    WHERE round_id = p_round_id;

    RETURN jsonb_build_object(
      'success', true,
      'round_id', v_round.id,
      'status', 'finalized',
      'already_finalized', true,
      'leaderboard', jsonb_build_object(
        'entries_count', v_existing_entries,
        'combinations_count', v_existing_combos
      )
    );
  END IF;

  -- 3. Strict Preflights: Questions must be frozen, window closed, attempt deadline passed
  IF NOT v_round.is_questions_frozen THEN
    RAISE EXCEPTION 'ROUND_NOT_FROZEN';
  END IF;

  IF clock_timestamp() < v_round.start_window_closes_at THEN
    RAISE EXCEPTION 'START_WINDOW_NOT_CLOSED';
  END IF;

  v_final_deadline := v_round.start_window_closes_at
    + (v_round.duration_minutes || ' minutes')::interval
    + (COALESCE(v_round.grace_period_seconds, 30) || ' seconds')::interval;

  IF clock_timestamp() < v_final_deadline THEN
    RAISE EXCEPTION 'CANNOT_FINALIZE_BEFORE_DEADLINE: Attempt window active until %', v_final_deadline;
  END IF;

  -- 4. Execute bounded sweep batch (up to 500 attempts)
  v_sweep_res := public.utme_challenge_sweep_expired_attempts_internal(p_round_id, 500);

  -- 5. Check remaining in-progress attempts
  SELECT count(*)::integer INTO v_active_count
  FROM public.utme_challenge_attempts
  WHERE round_id = p_round_id AND status = 'in_progress';

  -- If more in-progress attempts remain beyond this 500-batch, commit this batch cleanly
  -- and notify the caller to continue sweeping without rolling back the 500 graded attempts.
  IF v_active_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'round_id', v_round.id,
      'status', 'sweeping_in_progress',
      'message', format('Swept %s attempts. %s active attempt(s) remain to be processed in subsequent batches.',
                        v_sweep_res ->> 'attempts_finalized', v_active_count),
      'sweep_summary', v_sweep_res,
      'active_attempts_remaining', v_active_count
    );
  END IF;

  -- 6. Zero active attempts remain: generate immutable leaderboard within this transaction
  v_leaderboard_res := public.utme_challenge_generate_leaderboard_internal(p_round_id);

  -- 7. Transition round status to 'finalized'
  UPDATE public.utme_challenge_rounds
  SET status = 'finalized',
      updated_at = clock_timestamp()
  WHERE id = p_round_id
  RETURNING * INTO v_round;

  -- 8. Durable telemetry
  INSERT INTO public.utme_challenge_cron_logs (
    job_name, status, attempts_found, attempts_finalized, attempts_failed,
    duration_ms, error_details, executed_at
  ) VALUES (
    'finalize_round', 'success',
    COALESCE((v_sweep_res ->> 'attempts_found')::integer, 0),
    COALESCE((v_sweep_res ->> 'attempts_finalized')::integer, 0),
    COALESCE((v_sweep_res ->> 'attempts_failed')::integer, 0),
    COALESCE((v_sweep_res ->> 'duration_ms')::integer, 0),
    format('Round %s finalized. Leaderboard: %s entries across %s combinations.',
           p_round_id, v_leaderboard_res ->> 'entries_generated', v_leaderboard_res ->> 'combinations_ranked'),
    clock_timestamp()
  );

  RETURN jsonb_build_object(
    'success', true,
    'round_id', v_round.id,
    'status', 'finalized',
    'already_finalized', false,
    'sweep_summary', v_sweep_res,
    'leaderboard_summary', v_leaderboard_res
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_finalize_round_internal(uuid, boolean) FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 4. BOUNDED AUTONOMOUS MAINTENANCE WORKER (INTERNAL)
-- Performs bounded batch operations across lifecycle phases.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.utme_challenge_maintenance_worker()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sweep_summary jsonb;
  v_opened_count integer := 0;
  v_closed_count integer := 0;
  v_finalized_count integer := 0;
  v_closed_round record;
  v_finalize_res jsonb;
BEGIN
  -- 1. General sweep across all rounds in bounded batch of 200
  v_sweep_summary := public.utme_challenge_sweep_expired_attempts_internal(NULL, 200);

  -- 2. Advance scheduled rounds to open when start window opens
  UPDATE public.utme_challenge_rounds
  SET status = 'open',
      updated_at = clock_timestamp()
  WHERE status = 'scheduled'
    AND is_questions_frozen = true
    AND clock_timestamp() >= start_window_opens_at
    AND clock_timestamp() <= start_window_closes_at;

  GET DIAGNOSTICS v_opened_count = ROW_COUNT;

  -- 3. Advance open rounds to closed when start window closes
  UPDATE public.utme_challenge_rounds
  SET status = 'closed',
      updated_at = clock_timestamp()
  WHERE status IN ('scheduled', 'open')
    AND is_questions_frozen = true
    AND clock_timestamp() > start_window_closes_at;

  GET DIAGNOSTICS v_closed_count = ROW_COUNT;

  -- 4. Process closed rounds eligible for finalization
  FOR v_closed_round IN
    SELECT r.id, r.start_window_closes_at, r.duration_minutes, r.grace_period_seconds
    FROM public.utme_challenge_rounds r
    WHERE r.status = 'closed'
      AND r.is_questions_frozen = true
      AND clock_timestamp() >= (r.start_window_closes_at
        + (r.duration_minutes || ' minutes')::interval
        + (r.grace_period_seconds || ' seconds')::interval)
    ORDER BY r.round_number ASC
  LOOP
    BEGIN
      v_finalize_res := public.utme_challenge_finalize_round_internal(v_closed_round.id, false);
      IF COALESCE((v_finalize_res ->> 'success')::boolean, false) = true AND (v_finalize_res ->> 'status') = 'finalized' THEN
        v_finalized_count := v_finalized_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.utme_challenge_cron_logs (
        job_name, status, attempts_found, attempts_finalized, attempts_failed,
        duration_ms, error_details, executed_at
      ) VALUES (
        'auto_finalize_round', 'failed',
        0, 0, 1, 0,
        format('Round %s auto-finalization exception: %s', v_closed_round.id, SQLERRM),
        clock_timestamp()
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'sweep_summary', v_sweep_summary,
    'rounds_opened', v_opened_count,
    'rounds_closed', v_closed_count,
    'rounds_finalized', v_finalized_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_maintenance_worker() FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 5. RPC SIGNATURE MIGRATION: DROP LEGACY 1-ARGUMENT FUNCTION
-- Drop legacy function explicitly without CASCADE to preserve database objects
-- while eliminating PostgREST overload ambiguity and legacy Premium restrictions.
-- ============================================================================

DROP FUNCTION IF EXISTS public.utme_challenge_get_leaderboard(uuid);


-- ============================================================================
-- 6. MULTI-SCOPE PUBLIC LEADERBOARD RPC (STUDENT)
-- Universal access to overall, combination, and subject rankings for all registered
-- candidates with overflow-safe JSON validation and distinct statistics.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.utme_challenge_get_leaderboard(
  p_round_id uuid,
  p_scope text DEFAULT 'overall',               -- 'overall' | 'combination' | 'subject'
  p_combination_key text DEFAULT NULL,          -- NULL defaults to caller's registered combination
  p_subject text DEFAULT NULL,                  -- Validated against round subject config
  p_limit integer DEFAULT 50,                   -- Bounded 1 to 100
  p_offset integer DEFAULT 0                    -- >= 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_round public.utme_challenge_rounds%ROWTYPE;
  v_caller_reg public.utme_challenge_registrations%ROWTYPE;
  v_caller_entry public.utme_challenge_leaderboard_entries%ROWTYPE;
  v_target_combo text;
  v_target_subject text;
  v_configured_count integer;
  v_limit integer;
  v_offset integer;
  v_total_entries integer := 0;
  v_entries jsonb := '[]'::jsonb;
  v_my_performance jsonb := NULL;
  v_season_stats jsonb := '{}'::jsonb;
  v_round_stats jsonb := '{}'::jsonb;
  v_subject_ranks jsonb := '{}'::jsonb;
  v_subj text;
  v_caller_subj_rank integer;
  v_sub_total integer;
BEGIN
  -- 1. Authentication check
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  -- 2. Validate round exists
  SELECT * INTO v_round
  FROM public.utme_challenge_rounds
  WHERE id = p_round_id;

  IF v_round.id IS NULL THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND';
  END IF;

  -- 3. Strict finalization gate: Never expose results before round is finalized
  IF v_round.status <> 'finalized' THEN
    RETURN jsonb_build_object(
      'available', false,
      'status', v_round.status,
      'message', 'Leaderboard is not available yet. Official results are published once the round is finalized.'
    );
  END IF;

  -- 4. Validate caller is registered for this season
  SELECT * INTO v_caller_reg
  FROM public.utme_challenge_registrations reg
  WHERE reg.season_id = v_round.season_id AND reg.user_id = v_user_id;

  IF v_caller_reg.id IS NULL THEN
    RAISE EXCEPTION 'NOT_REGISTERED_FOR_SEASON';
  END IF;

  -- 5. Scope validation
  IF p_scope NOT IN ('overall', 'combination', 'subject') THEN
    RAISE EXCEPTION 'INVALID_SCOPE: Scope must be overall, combination, or subject.';
  END IF;

  -- 6. Subject-specific configuration & question count validation
  IF p_scope = 'subject' THEN
    v_target_subject := NULLIF(btrim(p_subject), '');
    IF v_target_subject IS NULL THEN
      RAISE EXCEPTION 'SUBJECT_REQUIRED: A subject name must be provided when scope is subject.';
    END IF;

    -- Look up configured question count for this subject in this round
    SELECT rs.question_count INTO v_configured_count
    FROM public.utme_challenge_round_subjects rs
    WHERE rs.round_id = p_round_id AND rs.subject = v_target_subject;

    IF v_configured_count IS NULL OR v_configured_count <= 0 THEN
      RAISE EXCEPTION 'SUBJECT_NOT_CONFIGURED_FOR_ROUND: Subject "%" is not configured for this examination round.', v_target_subject
        USING HINT = 'Select an accredited subject included in this specific round paper.';
    END IF;
  END IF;

  -- Sanitize pagination bounds
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  -- 7. Fetch caller's own leaderboard entry
  SELECT * INTO v_caller_entry
  FROM public.utme_challenge_leaderboard_entries l
  WHERE l.round_id = p_round_id AND l.user_id = v_user_id;

  -- 8. Compute caller's subject ranks across their own valid subjects
  IF v_caller_entry.id IS NOT NULL AND v_caller_entry.subject_breakdown <> '{}'::jsonb THEN
    FOREACH v_subj IN ARRAY v_caller_reg.selected_subjects
    LOOP
      SELECT rs.question_count INTO v_sub_total
      FROM public.utme_challenge_round_subjects rs
      WHERE rs.round_id = p_round_id AND rs.subject = v_subj;

      -- Validate caller's own JSON fields with overflow-safe checks
      IF v_sub_total IS NOT NULL AND v_caller_entry.subject_breakdown ? v_subj THEN
        DECLARE
          v_obj jsonb := v_caller_entry.subject_breakdown -> v_subj;
          v_pct text := v_obj ->> 'percentage';
          v_cor text := v_obj ->> 'correct';
          v_tot text := v_obj ->> 'total';
        BEGIN
          IF length(v_pct) <= 6 AND v_pct ~ '^([0-9]{1,2}(\.[0-9]{1,2})?|100(\.00?)?)$'
             AND length(v_cor) <= 5 AND v_cor ~ '^[0-9]{1,5}$'
             AND length(v_tot) <= 5 AND v_tot ~ '^[0-9]{1,5}$'
             AND (v_tot::integer = v_sub_total)
             AND (v_cor::integer <= v_tot::integer)
          THEN
            SELECT sub.computed_rank INTO v_caller_subj_rank
            FROM (
              SELECT
                l.user_id,
                DENSE_RANK() OVER (
                  ORDER BY
                    (l.subject_breakdown -> v_subj ->> 'percentage')::numeric DESC,
                    (l.subject_breakdown -> v_subj ->> 'correct')::integer DESC,
                    l.final_percentage DESC,
                    l.english_percentage DESC
                ) AS computed_rank
              FROM public.utme_challenge_leaderboard_entries l
              WHERE l.round_id = p_round_id
                AND l.subject_breakdown ? v_subj
                AND length(l.subject_breakdown -> v_subj ->> 'percentage') <= 6
                AND (l.subject_breakdown -> v_subj ->> 'percentage') ~ '^([0-9]{1,2}(\.[0-9]{1,2})?|100(\.00?)?)$'
                AND length(l.subject_breakdown -> v_subj ->> 'correct') <= 5
                AND (l.subject_breakdown -> v_subj ->> 'correct') ~ '^[0-9]{1,5}$'
                AND length(l.subject_breakdown -> v_subj ->> 'total') <= 5
                AND (l.subject_breakdown -> v_subj ->> 'total') ~ '^[0-9]{1,5}$'
                AND ((l.subject_breakdown -> v_subj ->> 'total')::integer = v_sub_total)
                AND ((l.subject_breakdown -> v_subj ->> 'correct')::integer <= (l.subject_breakdown -> v_subj ->> 'total')::integer)
            ) sub
            WHERE sub.user_id = v_user_id;

            v_subject_ranks := v_subject_ranks || jsonb_build_object(
              v_subj, jsonb_build_object(
                'rank', v_caller_subj_rank,
                'percentage', v_pct::numeric,
                'correct', v_cor::integer,
                'total', v_tot::integer
              )
            );
          END IF;
        END;
      END IF;
    END LOOP;
  END IF;

  -- 9. Construct personal performance object
  IF v_caller_entry.id IS NOT NULL THEN
    v_my_performance := jsonb_build_object(
      'has_attempt', true,
      'display_name', v_caller_entry.display_name,
      'combination_key', v_caller_entry.combination_key,
      'overall_rank', v_caller_entry.overall_rank,
      'combination_rank', v_caller_entry.rank,
      'subject_ranks', v_subject_ranks,
      'final_percentage', v_caller_entry.final_percentage,
      'english_percentage', v_caller_entry.english_percentage,
      'total_correct', v_caller_entry.total_correct,
      'subject_breakdown', v_caller_entry.subject_breakdown
    );
  ELSE
    v_my_performance := jsonb_build_object(
      'has_attempt', false,
      'display_name', v_caller_reg.display_name,
      'combination_key', v_caller_reg.combination_key,
      'overall_rank', NULL,
      'combination_rank', NULL,
      'subject_ranks', '{}'::jsonb
    );
  END IF;

  -- 10. Distinct Season Statistics
  SELECT jsonb_build_object(
    'season_id', v_round.season_id,
    'total_registered_candidates', (
      SELECT count(*)::integer
      FROM public.utme_challenge_registrations
      WHERE season_id = v_round.season_id
    ),
    'combination_registrations', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'combination_key', r_stat.combination_key,
          'registered_candidates', r_stat.reg_count
        ) ORDER BY r_stat.reg_count DESC, r_stat.combination_key ASC
      )
      FROM (
        SELECT combination_key, count(*)::integer AS reg_count
        FROM public.utme_challenge_registrations
        WHERE season_id = v_round.season_id
        GROUP BY combination_key
      ) r_stat
    ), '[]'::jsonb)
  ) INTO v_season_stats;

  -- 11. Distinct Round Completion Statistics
  SELECT jsonb_build_object(
    'round_id', p_round_id,
    'round_number', v_round.round_number,
    'total_completed_attempts', (
      SELECT count(*)::integer
      FROM public.utme_challenge_attempts
      WHERE round_id = p_round_id AND status IN ('submitted', 'expired')
    ),
    'combination_completions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'combination_key', c_stat.combination_key,
          'completed_attempts', c_stat.attempt_count,
          'average_percentage', round(c_stat.avg_pct, 2),
          'highest_percentage', c_stat.max_pct
        ) ORDER BY c_stat.attempt_count DESC, c_stat.combination_key ASC
      )
      FROM (
        SELECT
          l.combination_key,
          count(*)::integer AS attempt_count,
          avg(l.final_percentage)::numeric AS avg_pct,
          max(l.final_percentage)::numeric AS max_pct
        FROM public.utme_challenge_leaderboard_entries l
        WHERE l.round_id = p_round_id
        GROUP BY l.combination_key
      ) c_stat
    ), '[]'::jsonb)
  ) INTO v_round_stats;

  -- 12. Paginated Rankings Query with Overflow-Safe JSON Predicates
  IF p_scope = 'overall' THEN
    SELECT count(*)::integer INTO v_total_entries
    FROM public.utme_challenge_leaderboard_entries l
    WHERE l.round_id = p_round_id;

    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'rank', l.overall_rank,
        'display_name', l.display_name,
        'combination_key', l.combination_key,
        'final_percentage', l.final_percentage,
        'english_percentage', l.english_percentage,
        'total_correct', l.total_correct,
        'is_self', (l.user_id = v_user_id)
      ) ORDER BY l.overall_rank ASC, l.display_name ASC, l.user_id ASC
    ), '[]'::jsonb) INTO v_entries
    FROM (
      SELECT l.*
      FROM public.utme_challenge_leaderboard_entries l
      WHERE l.round_id = p_round_id
      ORDER BY l.overall_rank ASC, l.display_name ASC, l.user_id ASC
      LIMIT v_limit OFFSET v_offset
    ) l;

  ELSIF p_scope = 'combination' THEN
    v_target_combo := COALESCE(NULLIF(btrim(p_combination_key), ''), v_caller_reg.combination_key);

    SELECT count(*)::integer INTO v_total_entries
    FROM public.utme_challenge_leaderboard_entries l
    WHERE l.round_id = p_round_id AND l.combination_key = v_target_combo;

    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'rank', l.rank,
        'display_name', l.display_name,
        'combination_key', l.combination_key,
        'final_percentage', l.final_percentage,
        'english_percentage', l.english_percentage,
        'total_correct', l.total_correct,
        'is_self', (l.user_id = v_user_id)
      ) ORDER BY l.rank ASC, l.display_name ASC, l.user_id ASC
    ), '[]'::jsonb) INTO v_entries
    FROM (
      SELECT l.*
      FROM public.utme_challenge_leaderboard_entries l
      WHERE l.round_id = p_round_id AND l.combination_key = v_target_combo
      ORDER BY l.rank ASC, l.display_name ASC, l.user_id ASC
      LIMIT v_limit OFFSET v_offset
    ) l;

  ELSIF p_scope = 'subject' THEN
    -- Overflow-safe length and regex checks before casting
    SELECT count(*)::integer INTO v_total_entries
    FROM public.utme_challenge_leaderboard_entries l
    WHERE l.round_id = p_round_id
      AND l.subject_breakdown ? v_target_subject
      AND length(l.subject_breakdown -> v_target_subject ->> 'percentage') <= 6
      AND (l.subject_breakdown -> v_target_subject ->> 'percentage') ~ '^([0-9]{1,2}(\.[0-9]{1,2})?|100(\.00?)?)$'
      AND length(l.subject_breakdown -> v_target_subject ->> 'correct') <= 5
      AND (l.subject_breakdown -> v_target_subject ->> 'correct') ~ '^[0-9]{1,5}$'
      AND length(l.subject_breakdown -> v_target_subject ->> 'total') <= 5
      AND (l.subject_breakdown -> v_target_subject ->> 'total') ~ '^[0-9]{1,5}$'
      AND ((l.subject_breakdown -> v_target_subject ->> 'total')::integer = v_configured_count)
      AND ((l.subject_breakdown -> v_target_subject ->> 'correct')::integer <= (l.subject_breakdown -> v_target_subject ->> 'total')::integer);

    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'rank', s.subject_rank,
        'display_name', s.display_name,
        'combination_key', s.combination_key,
        'subject', v_target_subject,
        'subject_percentage', (s.subject_breakdown -> v_target_subject ->> 'percentage')::numeric(5, 2),
        'subject_correct', (s.subject_breakdown -> v_target_subject ->> 'correct')::integer,
        'subject_total', (s.subject_breakdown -> v_target_subject ->> 'total')::integer,
        'final_percentage', s.final_percentage,
        'english_percentage', s.english_percentage,
        'total_correct', s.total_correct,
        'is_self', (s.user_id = v_user_id)
      ) ORDER BY s.subject_rank ASC, s.display_name ASC, s.user_id ASC
    ), '[]'::jsonb) INTO v_entries
    FROM (
      SELECT
        l.*,
        DENSE_RANK() OVER (
          ORDER BY
            (l.subject_breakdown -> v_target_subject ->> 'percentage')::numeric DESC,
            (l.subject_breakdown -> v_target_subject ->> 'correct')::integer DESC,
            l.final_percentage DESC,
            l.english_percentage DESC
        ) AS subject_rank
      FROM public.utme_challenge_leaderboard_entries l
      WHERE l.round_id = p_round_id
        AND l.subject_breakdown ? v_target_subject
        AND length(l.subject_breakdown -> v_target_subject ->> 'percentage') <= 6
        AND (l.subject_breakdown -> v_target_subject ->> 'percentage') ~ '^([0-9]{1,2}(\.[0-9]{1,2})?|100(\.00?)?)$'
        AND length(l.subject_breakdown -> v_target_subject ->> 'correct') <= 5
        AND (l.subject_breakdown -> v_target_subject ->> 'correct') ~ '^[0-9]{1,5}$'
        AND length(l.subject_breakdown -> v_target_subject ->> 'total') <= 5
        AND (l.subject_breakdown -> v_target_subject ->> 'total') ~ '^[0-9]{1,5}$'
        AND ((l.subject_breakdown -> v_target_subject ->> 'total')::integer = v_configured_count)
        AND ((l.subject_breakdown -> v_target_subject ->> 'correct')::integer <= (l.subject_breakdown -> v_target_subject ->> 'total')::integer)
      ORDER BY subject_rank ASC, l.display_name ASC, l.user_id ASC
      LIMIT v_limit OFFSET v_offset
    ) s;
  END IF;

  RETURN jsonb_build_object(
    'available', true,
    'round_id', p_round_id,
    'round_number', v_round.round_number,
    'round_title', v_round.title,
    'scope', p_scope,
    'combination_filter', CASE WHEN p_scope = 'combination' THEN v_target_combo ELSE NULL END,
    'subject_filter', CASE WHEN p_scope = 'subject' THEN v_target_subject ELSE NULL END,
    'my_performance', v_my_performance,
    'season_statistics', v_season_stats,
    'round_statistics', v_round_stats,
    'pagination', jsonb_build_object(
      'total_entries', v_total_entries,
      'limit', v_limit,
      'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total_entries
    ),
    'entries', v_entries
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_get_leaderboard(uuid, text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_get_leaderboard(uuid, text, text, text, integer, integer) TO authenticated;


-- ============================================================================
-- 7. CONTROLLED NON-DESTRUCTIVE BACKFILL
-- Backfills overall_rank and subject_breakdown strictly for existing finalized rounds.
-- ============================================================================

DO $$
DECLARE
  v_round RECORD;
BEGIN
  FOR v_round IN
    SELECT id
    FROM public.utme_challenge_rounds
    WHERE status = 'finalized'
  LOOP
    -- Backfill overall_rank based on frozen final scores
    WITH calculated_overall AS (
      SELECT
        l.id,
        DENSE_RANK() OVER (
          ORDER BY l.final_percentage DESC, l.english_percentage DESC, l.total_correct DESC
        ) AS new_overall_rank
      FROM public.utme_challenge_leaderboard_entries l
      WHERE l.round_id = v_round.id
    )
    UPDATE public.utme_challenge_leaderboard_entries l
    SET overall_rank = c.new_overall_rank
    FROM calculated_overall c
    WHERE l.id = c.id AND l.overall_rank IS NULL;

    -- Backfill subject_breakdown from attempts without modifying scores
    UPDATE public.utme_challenge_leaderboard_entries l
    SET subject_breakdown = a.subject_breakdown
    FROM public.utme_challenge_attempts a
    WHERE a.round_id = l.round_id
      AND a.user_id = l.user_id
      AND (l.subject_breakdown = '{}'::jsonb OR l.subject_breakdown IS NULL)
      AND a.subject_breakdown IS NOT NULL
      AND a.subject_breakdown <> '{}'::jsonb;
  END LOOP;
END;
$$;

COMMIT;
