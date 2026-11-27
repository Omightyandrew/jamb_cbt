-- ExamPilot Phase 5 Stage 4: Secure Immutable XP Ledger Foundation
-- Implements public.user_xp_ledger, public.get_my_xp(), and integrates XP awards
-- for Daily Challenge (+10 XP) and Mock Exam (+25 XP).

BEGIN;

-- 1. Create public.user_xp_ledger
CREATE TABLE IF NOT EXISTS public.user_xp_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  xp_amount integer NOT NULL CHECK (xp_amount > 0),
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_xp_ledger_source_unique UNIQUE (source_type, source_id, user_id)
);

-- Index user_id for fast student aggregate / balance queries
CREATE INDEX IF NOT EXISTS user_xp_ledger_user_id_idx
  ON public.user_xp_ledger (user_id);

-- 2. Configure Row Level Security on user_xp_ledger
ALTER TABLE public.user_xp_ledger ENABLE ROW LEVEL SECURITY;

-- Allow students to SELECT only their own XP ledger entries
DROP POLICY IF EXISTS "user_xp_ledger_student_select" ON public.user_xp_ledger;
CREATE POLICY "user_xp_ledger_student_select"
  ON public.user_xp_ledger
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Block all direct student INSERT, UPDATE, and DELETE operations.
-- XP is strictly server-authoritative and awarded only by trusted functions.
DROP POLICY IF EXISTS "user_xp_ledger_student_insert" ON public.user_xp_ledger;
DROP POLICY IF EXISTS "user_xp_ledger_student_update" ON public.user_xp_ledger;
DROP POLICY IF EXISTS "user_xp_ledger_student_delete" ON public.user_xp_ledger;

-- 3. Secure XP aggregation function for the authenticated student
CREATE OR REPLACE FUNCTION public.get_my_xp()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_total_xp integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(sum(xp_amount), 0)::integer
  INTO v_total_xp
  FROM public.user_xp_ledger
  WHERE user_id = v_user_id;

  RETURN v_total_xp;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_xp() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_xp() TO authenticated, service_role;

-- 4. Update submit_daily_challenge to award +10 XP on first successful completion
CREATE OR REPLACE FUNCTION public.submit_daily_challenge(
  p_answers jsonb,
  p_challenge_date date DEFAULT (now() AT TIME ZONE 'Africa/Lagos')::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_challenge_date date;
  v_existing_id uuid;
  v_existing_score integer;
  v_existing_total integer;
  v_is_premium boolean := false;
  v_max_questions integer := 5;
  v_score integer := 0;
  v_total integer := 0;
  v_display_name text := 'Student';
  v_attempt_id uuid;
  v_submitted_count integer := 0;
BEGIN
  -- 1. Enforce authentication
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to submit challenge';
  END IF;

  -- 2. Determine authoritative challenge date (Africa/Lagos)
  v_challenge_date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  IF p_challenge_date IS NOT NULL AND p_challenge_date <> v_challenge_date THEN
    RAISE EXCEPTION 'Challenge date mismatch: daily challenges can only be submitted for today (Africa/Lagos)'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Idempotency: check if student has already completed today's challenge
  SELECT id, score, total INTO v_existing_id, v_existing_score, v_existing_total
  FROM public.challenge_attempts
  WHERE user_id = v_user_id AND challenge_date = v_challenge_date;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_completed', true,
      'score', v_existing_score,
      'total', v_existing_total,
      'xp_awarded', 0,
      'message', 'Challenge for today has already been recorded.'
    );
  END IF;

  -- 4. Subscription quota check (Free = 5, Premium = 15)
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = v_user_id
      AND status IN ('active', 'paid', 'premium', 'subscribed', 'success', 'successful', 'succeeded', 'completed')
      AND (expires_at IS NULL OR expires_at > now())
  ) INTO v_is_premium;

  v_max_questions := CASE WHEN v_is_premium THEN 15 ELSE 5 END;

  -- 5. Count submitted items (supports JSON array or object)
  SELECT count(*) INTO v_submitted_count
  FROM (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_answers) = 'array' THEN p_answers ELSE '[]'::jsonb END)
    UNION ALL
    SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(p_answers) = 'object' THEN p_answers ELSE '{}'::jsonb END)
  ) cnt;

  IF v_submitted_count = 0 THEN
    RAISE EXCEPTION 'No answers submitted' USING ERRCODE = '22023';
  END IF;

  IF v_submitted_count > v_max_questions THEN
    RAISE EXCEPTION 'Submitted question count (%) exceeds allowed limit of % questions', v_submitted_count, v_max_questions
      USING ERRCODE = '22023';
  END IF;

  -- 6. Reject duplicate or malformed question IDs in submission payload
  DECLARE
    v_distinct_qid_count integer := 0;
  BEGIN
    SELECT count(DISTINCT qid) INTO v_distinct_qid_count
    FROM (
      SELECT
        CASE
          WHEN jsonb_typeof(p_answers) = 'array' THEN
            CASE
              WHEN (elem->>'question_id') ~ '^[0-9]+$' THEN (elem->>'question_id')::bigint
              ELSE NULL
            END
          ELSE
            CASE
              WHEN key ~ '^[0-9]+$' THEN key::bigint
              ELSE NULL
            END
        END AS qid
      FROM (
        SELECT elem, NULL::text AS key
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(p_answers) = 'array' THEN p_answers ELSE '[]'::jsonb END
        ) AS elem
        UNION ALL
        SELECT NULL::jsonb AS elem, key
        FROM jsonb_each(
          CASE WHEN jsonb_typeof(p_answers) = 'object' THEN p_answers ELSE '{}'::jsonb END
        )
      ) sub
    ) q_extract
    WHERE qid IS NOT NULL;

    IF v_distinct_qid_count <> v_submitted_count THEN
      RAISE EXCEPTION 'Duplicate, missing, or non-numeric question IDs are not permitted in challenge submission'
        USING ERRCODE = '22023';
    END IF;
  END;

  -- 7. Parse answers and authoritatively calculate score against public."Questions"
  WITH raw_answers AS (
    SELECT
      CASE
        WHEN jsonb_typeof(p_answers) = 'array' THEN (elem->>'question_id')::bigint
        ELSE key::bigint
      END AS question_id,
      CASE
        WHEN jsonb_typeof(p_answers) = 'array' THEN UPPER(TRIM(COALESCE(elem->>'answer', '')))
        ELSE UPPER(TRIM(COALESCE(value#>>'{}', '')))
      END AS submitted_answer
    FROM (
      SELECT elem, NULL::text AS key, NULL::jsonb AS value
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p_answers) = 'array' THEN p_answers ELSE '[]'::jsonb END
      ) AS elem
      UNION ALL
      SELECT NULL::jsonb AS elem, key, value
      FROM jsonb_each(
        CASE WHEN jsonb_typeof(p_answers) = 'object' THEN p_answers ELSE '{}'::jsonb END
      )
    ) sub
    WHERE (elem IS NOT NULL OR key IS NOT NULL)
  ),
  scored AS (
    SELECT
      ra.question_id,
      ra.submitted_answer,
      q."Correct_Answer" AS correct_answer,
      CASE
        WHEN ra.submitted_answer <> '' AND ra.submitted_answer = UPPER(TRIM(q."Correct_Answer")) THEN 1
        ELSE 0
      END AS is_correct
    FROM raw_answers ra
    JOIN public."Questions" q ON q.id = ra.question_id
  )
  SELECT
    count(*),
    COALESCE(sum(is_correct), 0)
  INTO v_total, v_score
  FROM scored;

  IF v_total <> v_submitted_count THEN
    RAISE EXCEPTION 'One or more submitted question IDs are invalid';
  END IF;

  -- 8. Resolve privacy-respecting display name from public."Student_profiles"
  SELECT
    CASE
      WHEN COALESCE(TRIM(sp."Username"), '') <> '' THEN
        '@' || regexp_replace(TRIM(sp."Username"), '^@+', '')
      WHEN COALESCE(TRIM(sp."Full_name"), '') <> '' THEN
        split_part(TRIM(sp."Full_name"), ' ', 1)
      ELSE 'Student'
    END INTO v_display_name
  FROM public."Student_profiles" sp
  WHERE sp.id = v_user_id;

  IF v_display_name IS NULL OR TRIM(v_display_name) = '' THEN
    v_display_name := 'Student';
  END IF;

  -- 9. Insert authoritative attempt record
  INSERT INTO public.challenge_attempts (
    user_id,
    display_name,
    challenge_date,
    score,
    total,
    completed_at
  )
  VALUES (
    v_user_id,
    v_display_name,
    v_challenge_date,
    v_score,
    v_total,
    now()
  )
  ON CONFLICT (user_id, challenge_date) DO NOTHING
  RETURNING id INTO v_attempt_id;

  IF v_attempt_id IS NULL THEN
    SELECT score, total INTO v_score, v_total
    FROM public.challenge_attempts
    WHERE user_id = v_user_id AND challenge_date = v_challenge_date;

    RETURN jsonb_build_object(
      'success', true,
      'already_completed', true,
      'score', v_score,
      'total', v_total,
      'xp_awarded', 0,
      'message', 'Challenge for today has already been recorded.'
    );
  END IF;

  -- 10. Award +10 XP into public.user_xp_ledger for newly completed challenge
  INSERT INTO public.user_xp_ledger (
    user_id,
    source_type,
    source_id,
    xp_amount,
    metadata
  )
  VALUES (
    v_user_id,
    'daily_challenge',
    v_attempt_id::text,
    10,
    jsonb_build_object(
      'challenge_date', v_challenge_date,
      'score', v_score,
      'total', v_total
    )
  )
  ON CONFLICT (source_type, source_id, user_id) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'already_completed', false,
    'score', v_score,
    'total', v_total,
    'xp_awarded', 10,
    'display_name', v_display_name,
    'percentage', ROUND((v_score::numeric / NULLIF(v_total, 0)::numeric) * 100),
    'message', 'Daily challenge submitted successfully.'
  );
END;
$$;

-- 5. Update finalize_mock_attempt to award +25 XP upon completion
CREATE OR REPLACE FUNCTION public.finalize_mock_attempt(
  p_attempt_id uuid,
  p_completion_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  attempt_row public.mock_attempts%ROWTYPE;
  scoring_row public.mock_attempt_private_policies%ROWTYPE;
  final_reason text;
  finalized_at timestamptz;
  question_count integer;
  key_count integer;
  correct_count integer;
  wrong_count integer;
  unanswered_count integer;
  score_value numeric(10, 2);
  max_score_value numeric(10, 2);
  percentage_value numeric(5, 2);
  subject_summary jsonb;
BEGIN
  SELECT attempt.*
  INTO attempt_row
  FROM public.mock_attempts attempt
  WHERE attempt.id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mock attempt not found.' USING ERRCODE = 'P0002';
  END IF;

  IF attempt_row.status = 'submitted' THEN
    RETURN public.mock_attempt_payload(attempt_row.id, attempt_row.user_id);
  END IF;

  IF attempt_row.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Mock attempt is not in progress.' USING ERRCODE = '55000';
  END IF;

  IF p_completion_reason NOT IN ('manual', 'deadline') THEN
    RAISE EXCEPTION 'Invalid Mock completion reason.' USING ERRCODE = '22023';
  END IF;

  finalized_at := pg_catalog.clock_timestamp();
  final_reason := p_completion_reason;
  IF finalized_at >= attempt_row.expires_at THEN
    final_reason := 'deadline';
  ELSIF final_reason = 'deadline' THEN
    RAISE EXCEPTION 'Mock deadline has not elapsed.' USING ERRCODE = '55000';
  END IF;

  PERFORM 1
  FROM public.mock_attempt_questions question
  WHERE question.attempt_id = attempt_row.id
  ORDER BY question.position
  FOR UPDATE;

  PERFORM 1
  FROM public.mock_attempt_answer_keys answer_key
  WHERE answer_key.attempt_id = attempt_row.id
  ORDER BY answer_key.position
  FOR UPDATE;

  SELECT count(*)::integer
  INTO question_count
  FROM public.mock_attempt_questions question
  WHERE question.attempt_id = attempt_row.id;

  SELECT count(*)::integer
  INTO key_count
  FROM public.mock_attempt_answer_keys answer_key
  WHERE answer_key.attempt_id = attempt_row.id;

  IF question_count <> 180 OR key_count <> question_count THEN
    RAISE EXCEPTION 'Mock attempt question/key set is incomplete.' USING ERRCODE = '23514';
  END IF;

  SELECT private_policy.*
  INTO scoring_row
  FROM public.mock_attempt_private_policies private_policy
  WHERE private_policy.attempt_id = attempt_row.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mock scoring snapshot is unavailable.' USING ERRCODE = '23514';
  END IF;

  SELECT
    count(*) FILTER (
      WHERE question.selected_answer = answer_key.correct_answer
    )::integer,
    count(*) FILTER (
      WHERE question.selected_answer IS NOT NULL
        AND question.selected_answer <> answer_key.correct_answer
    )::integer,
    count(*) FILTER (WHERE question.selected_answer IS NULL)::integer
  INTO correct_count, wrong_count, unanswered_count
  FROM public.mock_attempt_questions question
  JOIN public.mock_attempt_answer_keys answer_key
    ON answer_key.attempt_id = question.attempt_id
   AND answer_key.position = question.position
  WHERE question.attempt_id = attempt_row.id;

  score_value :=
    correct_count * scoring_row.marks_per_correct
    - wrong_count * scoring_row.negative_mark;
  max_score_value := question_count * scoring_row.marks_per_correct;
  percentage_value := CASE
    WHEN max_score_value <= 0 THEN 0
    ELSE LEAST(
      100::numeric,
      GREATEST(
        0::numeric,
        pg_catalog.round((score_value / max_score_value) * 100, 2)
      )
    )::numeric(5, 2)
  END;

  SELECT pg_catalog.jsonb_object_agg(
    subject_result.subject_snapshot,
    pg_catalog.jsonb_build_object(
      'correct', subject_result.correct_count,
      'wrong', subject_result.wrong_count,
      'unanswered', subject_result.unanswered_count,
      'score', subject_result.score_value,
      'max_score', subject_result.max_score_value,
      'percentage', subject_result.percentage_value
    )
  )
  INTO subject_summary
  FROM (
    SELECT
      question.subject_snapshot,
      count(*) FILTER (
        WHERE question.selected_answer = answer_key.correct_answer
      )::integer AS correct_count,
      count(*) FILTER (
        WHERE question.selected_answer IS NOT NULL
          AND question.selected_answer <> answer_key.correct_answer
      )::integer AS wrong_count,
      count(*) FILTER (WHERE question.selected_answer IS NULL)::integer AS unanswered_count,
      (
        count(*) FILTER (
          WHERE question.selected_answer = answer_key.correct_answer
        ) * scoring_row.marks_per_correct
        - count(*) FILTER (
          WHERE question.selected_answer IS NOT NULL
            AND question.selected_answer <> answer_key.correct_answer
        ) * scoring_row.negative_mark
      )::numeric(10, 2) AS score_value,
      (count(*) * scoring_row.marks_per_correct)::numeric(10, 2) AS max_score_value,
      CASE
        WHEN count(*) * scoring_row.marks_per_correct <= 0 THEN 0::numeric
        ELSE LEAST(
          100::numeric,
          GREATEST(
            0::numeric,
            pg_catalog.round(
              (
                (
                  count(*) FILTER (
                    WHERE question.selected_answer = answer_key.correct_answer
                  ) * scoring_row.marks_per_correct
                  - count(*) FILTER (
                    WHERE question.selected_answer IS NOT NULL
                      AND question.selected_answer <> answer_key.correct_answer
                    ) * scoring_row.negative_mark
                ) / (count(*) * scoring_row.marks_per_correct)
              ) * 100,
              2
            )
          )
        )
      END::numeric(5, 2) AS percentage_value
    FROM public.mock_attempt_questions question
    JOIN public.mock_attempt_answer_keys answer_key
      ON answer_key.attempt_id = question.attempt_id
     AND answer_key.position = question.position
    WHERE question.attempt_id = attempt_row.id
    GROUP BY question.subject_snapshot
  ) AS subject_result;

  UPDATE public.mock_attempts attempt
  SET status = 'submitted',
      submitted_at = finalized_at,
      completion_reason = final_reason,
      score = score_value,
      max_score = max_score_value,
      correct = correct_count,
      wrong = wrong_count,
      unanswered = unanswered_count,
      percentage = percentage_value,
      per_subject_summary = COALESCE(subject_summary, '{}'::jsonb),
      retention_expires_at = finalized_at + pg_catalog.make_interval(
        secs => scoring_row.retention_seconds
      )
  WHERE attempt.id = attempt_row.id;

  -- Award +25 XP into public.user_xp_ledger for completed mock exam
  INSERT INTO public.user_xp_ledger (
    user_id,
    source_type,
    source_id,
    xp_amount,
    metadata
  )
  VALUES (
    attempt_row.user_id,
    'mock_exam',
    attempt_row.id::text,
    25,
    pg_catalog.jsonb_build_object(
      'score', score_value,
      'max_score', max_score_value,
      'percentage', percentage_value
    )
  )
  ON CONFLICT (source_type, source_id, user_id) DO NOTHING;

  RETURN public.mock_attempt_payload(attempt_row.id, attempt_row.user_id);
END;
$$;

COMMIT;
