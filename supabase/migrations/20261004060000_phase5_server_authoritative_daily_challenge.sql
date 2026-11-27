-- ExamPilot Phase 5 Stage 1: Server-Authoritative Daily Challenge Submission
-- Replaces client-authoritative scoring with server-side validation against public."Questions".
-- Drops direct INSERT and UPDATE policies for authenticated users on public.challenge_attempts
-- to prevent arbitrary score manipulation via browser DevTools or direct Supabase client calls.

BEGIN;

-- 1. Create the server-authoritative submission function
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
      'message', 'Challenge for today has already been recorded.'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_completed', false,
    'score', v_score,
    'total', v_total,
    'display_name', v_display_name,
    'percentage', ROUND((v_score::numeric / NULLIF(v_total, 0)::numeric) * 100),
    'message', 'Daily challenge submitted successfully.'
  );
END;
$$;

-- 2. Secure execution permissions
REVOKE ALL ON FUNCTION public.submit_daily_challenge(jsonb, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_daily_challenge(jsonb, date) TO authenticated, service_role;

-- 3. Hardening RLS on challenge_attempts:
-- Disallow direct client INSERT and UPDATE by students.
-- All writes must be processed through the server-authoritative function above.
DROP POLICY IF EXISTS "challenge_attempts_student_insert" ON public.challenge_attempts;
DROP POLICY IF EXISTS "challenge_attempts_student_update" ON public.challenge_attempts;

COMMIT;
