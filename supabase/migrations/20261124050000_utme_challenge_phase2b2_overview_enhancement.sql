-- ExamPilot UTME Challenge 2027: Phase 2B-2 Overview RPC Enhancement
-- Migration: 20261124050000_utme_challenge_phase2b2_overview_enhancement.sql
-- Strictly additive update to public.utme_challenge_get_overview().
-- Enhances weekly round records with:
--   1. grace_period_seconds from public.utme_challenge_rounds
--   2. round_subjects: Configured subject question counts from public.utme_challenge_round_subjects
--   3. total_questions: Reliable total question count derived from configured round subjects
--   4. candidate_total_questions: Total question count matching candidate's registered 4-subject combination
-- Preserves existing signature, SECURITY DEFINER status, search_path, permissions,
-- registration data, computed lifecycle phases, and attempt evaluations.
--
-- DO NOT EXECUTE THIS MIGRATION AUTOMATICALLY. PREPARED FOR MIGRATION APPLICATION ONLY.

BEGIN;

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
  v_reg_subjects text[];
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
  ), reg.selected_subjects INTO v_registration, v_reg_subjects
  FROM public.utme_challenge_registrations reg
  WHERE reg.season_id = v_active_season_id AND reg.user_id = v_user_id;

  -- 4. Fetch non-draft rounds with dynamic configuration and computed phases
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'round_number', r.round_number,
      'title', r.title,
      'duration_minutes', r.duration_minutes,
      'grace_period_seconds', r.grace_period_seconds,
      'round_subjects', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'subject', rs.subject,
            'question_count', rs.question_count,
            'display_order', rs.display_order
          ) ORDER BY rs.display_order ASC, rs.subject ASC
        )
        FROM public.utme_challenge_round_subjects rs
        WHERE rs.round_id = r.id
      ), '[]'::jsonb),
      'total_questions', COALESCE((
        SELECT SUM(rs.question_count)::integer
        FROM public.utme_challenge_round_subjects rs
        WHERE rs.round_id = r.id
      ), 0),
      'candidate_total_questions', CASE
        WHEN v_reg_subjects IS NOT NULL AND cardinality(v_reg_subjects) > 0 THEN (
          SELECT COALESCE(SUM(rs.question_count)::integer, 0)
          FROM public.utme_challenge_round_subjects rs
          WHERE rs.round_id = r.id AND rs.subject = ANY(v_reg_subjects)
        )
        ELSE NULL
      END,
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

COMMIT;
