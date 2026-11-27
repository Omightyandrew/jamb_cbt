-- ============================================================================
-- ExamPilot UTME Challenge 2027: Phase 2B-2 Maintenance & Leaderboard Migration
-- File: supabase/migrations/20261125010000_utme_challenge_phase2b2_maintenance_and_leaderboard.sql
--
-- STRICTLY ADDITIVE: Does NOT alter or drop any existing ExamPilot tables,
-- views, functions, or Daily Challenge objects (public.challenge_attempts).
--
-- Implements:
--   1. Safe background batch expiry and grading of abandoned attempts via FOR UPDATE SKIP LOCKED.
--   2. Authoritative leaderboard generation partitioned by combination_key using DENSE_RANK().
--   3. Safe round lifecycle management (scheduled -> open -> closed -> finalized).
--   4. Timing preflight preventing premature finalization before latest allowed attempt deadline.
--   5. Periodic maintenance worker with pg_cron registration where available.
--   6. Admin RPC fallback (utme_challenge_admin_finalize_round, utme_challenge_admin_run_maintenance).
--   7. Deterministic leaderboard ordering with tie-break stability.
--   8. Durable telemetry logging in public.utme_challenge_cron_logs.
--
-- All functions are SECURITY DEFINER with SET search_path = pg_catalog, public.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. BATCH ATTEMPT EXPIRY WORKER (INTERNAL)
-- Sweeps in_progress attempts past deadline + grace period in bounded batches.
-- Concurrency-safe: uses FOR UPDATE SKIP LOCKED to prevent deadlocks or
-- blocking concurrent candidate submissions.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_sweep_expired_attempts_internal(
  p_round_id uuid DEFAULT NULL,
  p_batch_size integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batch_limit integer;
  v_rec record;
  v_attempts_found integer := 0;
  v_attempts_finalized integer := 0;
  v_attempts_failed integer := 0;
  v_grade_res jsonb;
  v_start_time timestamptz := clock_timestamp();
  v_duration_ms integer;
  v_status text;
  v_error_log text;
BEGIN
  v_batch_limit := LEAST(GREATEST(COALESCE(p_batch_size, 100), 1), 500);

  FOR v_rec IN
    SELECT
      a.id,
      a.round_id,
      a.user_id,
      a.expires_at,
      CASE
        WHEN (a.configuration_snapshot ->> 'grace_period_seconds') ~ '^[0-9]{1,4}$'
          AND (a.configuration_snapshot ->> 'grace_period_seconds')::integer BETWEEN 0 AND 3600
        THEN (a.configuration_snapshot ->> 'grace_period_seconds')::integer
        ELSE 30
      END AS grace_seconds
    FROM public.utme_challenge_attempts a
    WHERE a.status = 'in_progress'
      AND (p_round_id IS NULL OR a.round_id = p_round_id)
      AND clock_timestamp() > (a.expires_at + ((
        CASE
          WHEN (a.configuration_snapshot ->> 'grace_period_seconds') ~ '^[0-9]{1,4}$'
            AND (a.configuration_snapshot ->> 'grace_period_seconds')::integer BETWEEN 0 AND 3600
          THEN (a.configuration_snapshot ->> 'grace_period_seconds')::integer
          ELSE 30
        END
      ) || ' seconds')::interval)
    ORDER BY a.expires_at ASC
    LIMIT v_batch_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_attempts_found := v_attempts_found + 1;

    BEGIN
      -- Grade as expired using authoritative internal grader
      v_grade_res := public.utme_challenge_grade_attempt_internal(v_rec.id, 'expired');

      IF COALESCE((v_grade_res ->> 'ok')::boolean, false) = true THEN
        v_attempts_finalized := v_attempts_finalized + 1;
      ELSE
        v_attempts_failed := v_attempts_failed + 1;
        v_error_log := COALESCE(v_error_log || E'\n', '') || format('Attempt %s grading error: %s', v_rec.id, v_grade_res ->> 'error');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_attempts_failed := v_attempts_failed + 1;
      v_error_log := COALESCE(v_error_log || E'\n', '') || format('Attempt %s exception: %s', v_rec.id, SQLERRM);
    END;
  END LOOP;

  v_duration_ms := GREATEST(0, (EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time)) * 1000)::integer);

  IF v_attempts_failed > 0 AND v_attempts_finalized > 0 THEN
    v_status := 'partial';
  ELSIF v_attempts_failed > 0 THEN
    v_status := 'failed';
  ELSE
    v_status := 'success';
  END IF;

  -- Only record telemetry when work was performed or failures occurred
  IF v_attempts_found > 0 OR v_attempts_failed > 0 THEN
    INSERT INTO public.utme_challenge_cron_logs (
      job_name,
      status,
      attempts_found,
      attempts_finalized,
      attempts_failed,
      duration_ms,
      error_details,
      executed_at
    ) VALUES (
      'sweep_expired_attempts',
      v_status,
      v_attempts_found,
      v_attempts_finalized,
      v_attempts_failed,
      v_duration_ms,
      v_error_log,
      clock_timestamp()
    );
  END IF;

  RETURN jsonb_build_object(
    'attempts_found', v_attempts_found,
    'attempts_finalized', v_attempts_finalized,
    'attempts_failed', v_attempts_failed,
    'duration_ms', v_duration_ms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_sweep_expired_attempts_internal(uuid, integer) FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 2. LEADERBOARD GENERATION (INTERNAL)
-- Calculates deterministic ranks using DENSE_RANK() partitioned strictly by
-- four-subject combination_key.
-- Tie-break hierarchy:
--   1. percentage DESC (Overall average score)
--   2. english_percentage DESC (English compulsory mastery)
--   3. total_correct DESC (Raw questions correct)
-- Fastest completion time is intentionally EXCLUDED.
-- Idempotent: completely regenerates entries cleanly for the given round.
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
  v_inserted_count integer := 0;
  v_combinations_count integer := 0;
BEGIN
  IF p_round_id IS NULL THEN
    RAISE EXCEPTION 'ROUND_ID_REQUIRED';
  END IF;

  -- 1. Clear existing entries for this round to support idempotent regeneration
  DELETE FROM public.utme_challenge_leaderboard_entries
  WHERE round_id = p_round_id;

  -- 2. Populate leaderboard entries with DENSE_RANK() partitioned by combination_key
  WITH ranked_attempts AS (
    SELECT
      p_round_id AS round_id,
      reg.combination_key,
      a.user_id,
      reg.display_name,
      a.percentage,
      a.english_percentage,
      a.total_correct,
      DENSE_RANK() OVER (
        PARTITION BY reg.combination_key
        ORDER BY a.percentage DESC, a.english_percentage DESC, a.total_correct DESC
      ) AS computed_rank
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
      computed_rank,
      clock_timestamp()
    FROM ranked_attempts
    ORDER BY combination_key ASC, computed_rank ASC, display_name ASC, user_id ASC
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
-- 3. SAFE ROUND FINALIZATION (INTERNAL)
-- Validates timing preflights, flushes remaining expired attempts, verifies zero
-- in_progress attempts remain, generates leaderboards, and marks status = 'finalized'.
-- Candidates who never started an attempt have no attempt row and do not block.
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

  -- 1. Lock round exclusively FOR UPDATE
  SELECT * INTO v_round
  FROM public.utme_challenge_rounds
  WHERE id = p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND'
      USING HINT = 'No round matches the provided ID.';
  END IF;

  -- Draft rounds cannot be finalized
  IF v_round.status = 'draft' THEN
    RAISE EXCEPTION 'ROUND_IS_DRAFT'
      USING HINT = 'Draft rounds cannot be finalized. Freeze and schedule the round first.';
  END IF;

  -- If already finalized, return stored leaderboard summary WITHOUT deleting or regenerating
  IF v_round.status = 'finalized' THEN
    SELECT
      count(*)::integer,
      count(DISTINCT combination_key)::integer
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

  IF NOT v_round.is_questions_frozen THEN
    RAISE EXCEPTION 'ROUND_NOT_FROZEN'
      USING HINT = 'Round questions are not frozen.';
  END IF;

  -- 2. Timing preflight: testing start window must be closed (STRICT: CANNOT BE BYPASSED)
  IF clock_timestamp() < v_round.start_window_closes_at THEN
    RAISE EXCEPTION 'START_WINDOW_NOT_CLOSED'
      USING HINT = format('Testing start window is still open until %s.', v_round.start_window_closes_at);
  END IF;

  -- 3. Timing preflight: latest possible attempt deadline must have passed (STRICT: CANNOT BE BYPASSED)
  -- Any candidate who started at the final second is entitled to their full duration + grace.
  v_final_deadline := v_round.start_window_closes_at
    + (v_round.duration_minutes || ' minutes')::interval
    + (COALESCE(v_round.grace_period_seconds, 30) || ' seconds')::interval;

  IF clock_timestamp() < v_final_deadline THEN
    RAISE EXCEPTION 'CANNOT_FINALIZE_BEFORE_DEADLINE'
      USING HINT = format('Attempt window remains active until %s.', v_final_deadline);
  END IF;

  -- 4. Flush all remaining expired attempts for this round
  v_sweep_res := public.utme_challenge_sweep_expired_attempts_internal(p_round_id, 500);

  -- 5. Verify zero in_progress attempts remain
  SELECT count(*) INTO v_active_count
  FROM public.utme_challenge_attempts
  WHERE round_id = p_round_id AND status = 'in_progress';

  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'ACTIVE_ATTEMPTS_REMAIN'
      USING HINT = format('Cannot finalize round: %s in-progress attempt(s) have not expired.', v_active_count);
  END IF;

  -- 6. Generate leaderboard entries
  v_leaderboard_res := public.utme_challenge_generate_leaderboard_internal(p_round_id);

  -- 7. Transition round status to 'finalized'
  UPDATE public.utme_challenge_rounds
  SET status = 'finalized',
      updated_at = clock_timestamp()
  WHERE id = p_round_id
  RETURNING * INTO v_round;

  -- 8. Record telemetry in cron logs
  INSERT INTO public.utme_challenge_cron_logs (
    job_name,
    status,
    attempts_found,
    attempts_finalized,
    attempts_failed,
    duration_ms,
    error_details,
    executed_at
  ) VALUES (
    'finalize_round',
    'success',
    COALESCE((v_sweep_res ->> 'attempts_found')::integer, 0),
    COALESCE((v_sweep_res ->> 'attempts_finalized')::integer, 0),
    COALESCE((v_sweep_res ->> 'attempts_failed')::integer, 0),
    COALESCE((v_sweep_res ->> 'duration_ms')::integer, 0),
    format('Round %s finalized. Leaderboard entries: %s across %s combinations.',
           p_round_id,
           v_leaderboard_res ->> 'entries_generated',
           v_leaderboard_res ->> 'combinations_ranked'),
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
-- 4. AUTONOMOUS MAINTENANCE WORKER (INTERNAL)
-- Orchestrates lifecycle maintenance across all rounds:
--   - Sweeps expired in_progress attempts.
--   - Advances 'scheduled' rounds to 'open' when start window opens.
--   - Advances 'open' rounds to 'closed' when start window closes.
--   - Auto-finalizes 'closed' rounds when latest allowed attempt deadline passes.
-- Callable by pg_cron or admin trigger.
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
  v_final_deadline timestamptz;
BEGIN
  -- 1. Sweep expired attempts across all rounds
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

  -- 4. Auto-finalize closed rounds whose final deadline has passed
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
      PERFORM public.utme_challenge_finalize_round_internal(v_closed_round.id, false);
      v_finalized_count := v_finalized_count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Record failure in cron logs and continue loop
      INSERT INTO public.utme_challenge_cron_logs (
        job_name,
        status,
        attempts_found,
        attempts_finalized,
        attempts_failed,
        duration_ms,
        error_details,
        executed_at
      ) VALUES (
        'auto_finalize_round',
        'failed',
        0, 0, 1, 0,
        format('Round %s auto-finalization failed: %s', v_closed_round.id, SQLERRM),
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
-- 5. ADMIN FINALIZATION RPC
-- Secure administrative endpoint allowing authorized administrators to trigger
-- finalization of eligible rounds.
-- Candidate exam time, start-window closures, and attempt deadlines are STRICTLY
-- preserved and cannot be bypassed by any administrator.
-- Enforces: utme_challenge_require_admin_internal() claim verification.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_finalize_round(
  p_round_id uuid,
  p_force boolean DEFAULT false -- Neutralized: timing deadlines and candidate rights cannot be bypassed
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_res jsonb;
BEGIN
  -- Strict administrative authorization check
  v_admin_uid := public.utme_challenge_require_admin_internal();

  -- Execute finalization (deadlines and candidate exam time strictly preserved)
  v_res := public.utme_challenge_finalize_round_internal(p_round_id, false);

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_finalize_round(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_finalize_round(uuid, boolean) TO authenticated;


-- ============================================================================
-- 6. ADMIN RUN MAINTENANCE RPC
-- Secure administrative endpoint allowing authorized administrators to execute
-- the maintenance worker on demand from the admin dashboard.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_run_maintenance()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_res jsonb;
BEGIN
  v_admin_uid := public.utme_challenge_require_admin_internal();

  v_res := public.utme_challenge_maintenance_worker();

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_run_maintenance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_run_maintenance() TO authenticated;


-- ============================================================================
-- 7. DETERMINISTIC LEADERBOARD READ RPC (STUDENT)
-- Hardens public.utme_challenge_get_leaderboard with secondary sorting
-- (ORDER BY rank ASC, display_name ASC, user_id ASC) for deterministic display.
-- Available strictly when round status = 'finalized'.
-- Scoped strictly to caller's 4-subject combination_key.
-- Free tier: Top 10 + self rank.
-- Premium tier: Full combination leaderboard + personal rank history.
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

  -- 6. Fetch Top 10 for caller's exact combination with deterministic secondary sorting
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'rank', t.rank,
      'display_name', t.display_name,
      'final_percentage', t.final_percentage,
      'english_percentage', t.english_percentage,
      'total_correct', t.total_correct,
      'is_self', (t.user_id = v_user_id)
    ) ORDER BY t.rank ASC, t.display_name ASC, t.user_id ASC
  ), '[]'::jsonb) INTO v_top_10
  FROM (
    SELECT l.*
    FROM public.utme_challenge_leaderboard_entries l
    WHERE l.round_id = p_round_id AND l.combination_key = v_combo_key
    ORDER BY l.rank ASC, l.display_name ASC, l.user_id ASC
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
      ) ORDER BY l.rank ASC, l.display_name ASC, l.user_id ASC
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


-- ============================================================================
-- 8. SCHEDULED MAINTENANCE REGISTRATION (PG_CRON)
-- Registers the maintenance worker to run every 5 minutes when pg_cron extension
-- is present. Safe for environments where pg_cron is disabled.
-- Safely inspects cron.job: corrects outdated schedules/commands, preserves
-- correct existing jobs, and handles missing extensions gracefully.
-- ============================================================================
DO $$
DECLARE
  v_job_id bigint;
  v_current_schedule text;
  v_current_command text;
  v_target_schedule constant text := '*/5 * * * *';
  v_target_command constant text := 'SELECT public.utme_challenge_maintenance_worker();';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Check if utme-challenge-maintenance job already exists
    SELECT jobid, schedule, command
    INTO v_job_id, v_current_schedule, v_current_command
    FROM cron.job
    WHERE jobname = 'utme-challenge-maintenance';

    IF v_job_id IS NULL THEN
      -- Job does not exist: schedule fresh
      PERFORM cron.schedule(
        'utme-challenge-maintenance',
        v_target_schedule,
        v_target_command
      );
    ELSIF v_current_schedule IS DISTINCT FROM v_target_schedule OR v_current_command IS DISTINCT FROM v_target_command THEN
      -- Job exists but has outdated schedule or command: unschedule by jobid and reschedule
      PERFORM cron.unschedule(v_job_id);
      PERFORM cron.schedule(
        'utme-challenge-maintenance',
        v_target_schedule,
        v_target_command
      );
    END IF;
    -- If job already exists with matching schedule and command: leave unchanged!
  END IF;
END;
$$;

COMMIT;
