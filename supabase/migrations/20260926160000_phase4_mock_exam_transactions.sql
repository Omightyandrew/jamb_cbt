-- Phase 4 Mock transactions.
-- Draft only: this migration creates no Mock configuration and seeds no questions.
-- A trusted Edge Function must verify the JWT and pass auth.getUser(token).id as
-- p_user_id. These database functions are not callable by browser roles.
-- Existing CBT code retrieves Correct_Answer from the source question pool;
-- that separate answer-key exposure must be resolved before Mock production use.
--
-- Configuration blockers are intentionally data-driven and have no defaults:
-- Premium statuses, allowed subject combinations, source test types, negative
-- mark, and retention duration must be approved before a policy row can be added.
-- The production scheduler is a separate deployment decision; no cron job is
-- registered here.

BEGIN;

CREATE OR REPLACE FUNCTION public.mock_subject_combinations_are_valid(
  p_combinations jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  combination jsonb;
  subject_value jsonb;
  subject_name text;
  seen_subjects text[];
  contains_english boolean;
BEGIN
  IF pg_catalog.jsonb_typeof(p_combinations) IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(p_combinations) = 0 THEN
    RETURN false;
  END IF;

  FOR combination IN
    SELECT value FROM pg_catalog.jsonb_array_elements(p_combinations)
  LOOP
    IF pg_catalog.jsonb_typeof(combination) IS DISTINCT FROM 'array'
      OR pg_catalog.jsonb_array_length(combination) <> 4 THEN
      RETURN false;
    END IF;

    seen_subjects := ARRAY[]::text[];
    contains_english := false;

    FOR subject_value IN
      SELECT value FROM pg_catalog.jsonb_array_elements(combination)
    LOOP
      IF pg_catalog.jsonb_typeof(subject_value) IS DISTINCT FROM 'string' THEN
        RETURN false;
      END IF;

      subject_name := subject_value #>> '{}';
      IF pg_catalog.btrim(subject_name) = ''
        OR pg_catalog.lower(pg_catalog.btrim(subject_name)) = ANY(seen_subjects) THEN
        RETURN false;
      END IF;

      seen_subjects := pg_catalog.array_append(
        seen_subjects,
        pg_catalog.lower(pg_catalog.btrim(subject_name))
      );

      IF subject_name = 'English' THEN
        contains_english := true;
      END IF;
    END LOOP;

    IF NOT contains_english THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.mock_text_array_is_valid(
  p_values text[],
  p_allowed_values text[],
  p_require_lowercase boolean
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  value_text text;
  normalized_value text;
  seen_values text[] := ARRAY[]::text[];
BEGIN
  IF p_values IS NULL
    OR pg_catalog.cardinality(p_values) = 0
    OR pg_catalog.array_position(p_values, NULL) IS NOT NULL THEN
    RETURN false;
  END IF;

  FOREACH value_text IN ARRAY p_values
  LOOP
    normalized_value := pg_catalog.lower(pg_catalog.btrim(value_text));
    IF normalized_value = ''
      OR value_text <> pg_catalog.btrim(value_text)
      OR (p_require_lowercase AND value_text <> normalized_value)
      OR normalized_value = ANY(seen_values)
      OR (
        p_allowed_values IS NOT NULL
        AND NOT (normalized_value = ANY(p_allowed_values))
      ) THEN
      RETURN false;
    END IF;

    seen_values := pg_catalog.array_append(seen_values, normalized_value);
  END LOOP;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.mock_expiry_is_valid(
  p_expiry_text text,
  p_as_of timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  expiry_value timestamptz;
BEGIN
  IF p_expiry_text IS NULL THEN
    RETURN true;
  END IF;

  BEGIN
    expiry_value := p_expiry_text::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  RETURN expiry_value > p_as_of;
END;
$$;

CREATE OR REPLACE FUNCTION public.mock_policy_requires_mock_configuration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.exam_configurations configuration
    WHERE configuration.id = NEW.configuration_id
      AND configuration.test_type = 'mock'
  ) THEN
    RAISE EXCEPTION 'A Mock policy must reference a Mock exam configuration.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE public.exam_configurations
  ADD CONSTRAINT exam_configurations_mock_structure_check
  CHECK (
    test_type <> 'mock'
    OR (
      question_count = 180
      AND duration_seconds = 7200
      AND subject_selection_configuration ->> 'required_subject_count' = '4'
      AND subject_selection_configuration ->> 'minimum_subjects' = '4'
      AND subject_selection_configuration ->> 'maximum_subjects' = '4'
      AND subject_selection_configuration ->> 'additional_subject_count' = '3'
      AND subject_selection_configuration -> 'compulsory_subjects' = '["English"]'::jsonb
      AND subject_selection_configuration -> 'question_counts'
        = '{"English":60,"other":40}'::jsonb
      AND scoring_configuration = '{}'::jsonb
      AND grading_configuration = '{}'::jsonb
    )
  );

CREATE TABLE public.mock_configuration_policies (
  configuration_id uuid PRIMARY KEY
    REFERENCES public.exam_configurations(id) ON DELETE CASCADE,
  allowed_subject_combinations jsonb NOT NULL,
  source_test_types text[] NOT NULL,
  premium_status_allowlist text[] NOT NULL,
  retention_seconds integer NOT NULL,
  marks_per_correct numeric(10, 2) NOT NULL,
  negative_mark numeric(10, 2) NOT NULL,
  percentage_mode text NOT NULL,
  CONSTRAINT mock_configuration_policies_combinations_valid
    CHECK (public.mock_subject_combinations_are_valid(allowed_subject_combinations)),
  CONSTRAINT mock_configuration_policies_source_types_valid
    CHECK (
      public.mock_text_array_is_valid(
        source_test_types,
        ARRAY['practice', 'past']::text[],
        true
      )
    ),
  CONSTRAINT mock_configuration_policies_premium_statuses_valid
    CHECK (public.mock_text_array_is_valid(premium_status_allowlist, NULL, true)),
  CONSTRAINT mock_configuration_policies_retention_positive
    CHECK (retention_seconds > 0),
  CONSTRAINT mock_configuration_policies_marks_valid
    CHECK (marks_per_correct > 0 AND negative_mark >= 0),
  CONSTRAINT mock_configuration_policies_percentage_mode_valid
    CHECK (percentage_mode = 'clamp_0_100')
);

CREATE TRIGGER mock_configuration_policy_type_guard
  BEFORE INSERT OR UPDATE OF configuration_id
  ON public.mock_configuration_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.mock_policy_requires_mock_configuration();

ALTER TABLE public.mock_attempts
  ADD COLUMN start_idempotency_key uuid,
  ADD COLUMN start_request_fingerprint text,
  ADD COLUMN completion_reason text;

ALTER TABLE public.mock_attempts
  ADD CONSTRAINT mock_attempts_start_idempotency_pair_check
    CHECK (
      (start_idempotency_key IS NULL AND start_request_fingerprint IS NULL)
      OR (
        start_idempotency_key IS NOT NULL
        AND start_request_fingerprint IS NOT NULL
        AND pg_catalog.btrim(start_request_fingerprint) <> ''
      )
    ),
  ADD CONSTRAINT mock_attempts_completion_reason_check
    CHECK (completion_reason IS NULL OR completion_reason IN ('manual', 'deadline'));

CREATE UNIQUE INDEX mock_attempts_user_start_idempotency_uidx
  ON public.mock_attempts (user_id, start_idempotency_key)
  WHERE start_idempotency_key IS NOT NULL;
CREATE INDEX mock_attempts_due_in_progress_idx
  ON public.mock_attempts (expires_at, id)
  WHERE status = 'in_progress';
CREATE INDEX mock_attempts_terminal_retention_idx
  ON public.mock_attempts (retention_expires_at, id)
  WHERE status IN ('submitted', 'expired', 'abandoned');

ALTER TABLE public.mock_attempt_questions
  ADD COLUMN answer_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN last_answer_request_id uuid;

ALTER TABLE public.mock_attempt_questions
  ADD CONSTRAINT mock_attempt_questions_answer_choice_check
    CHECK (selected_answer IS NULL OR selected_answer IN ('A', 'B', 'C', 'D')),
  ADD CONSTRAINT mock_attempt_questions_answer_revision_check
    CHECK (answer_revision >= 0),
  ADD CONSTRAINT mock_attempt_questions_revision_state_check
    CHECK (
      (answer_revision = 0 AND selected_answer IS NULL AND last_answer_request_id IS NULL)
      OR (answer_revision > 0 AND selected_answer IS NOT NULL AND last_answer_request_id IS NOT NULL)
    );

CREATE TABLE public.mock_attempt_answer_keys (
  attempt_id uuid NOT NULL,
  position integer NOT NULL,
  correct_answer text NOT NULL,
  CONSTRAINT mock_attempt_answer_keys_pkey PRIMARY KEY (attempt_id, position),
  CONSTRAINT mock_attempt_answer_keys_attempt_question_fkey
    FOREIGN KEY (attempt_id, position)
    REFERENCES public.mock_attempt_questions(attempt_id, position)
    ON DELETE CASCADE,
  CONSTRAINT mock_attempt_answer_keys_choice_check
    CHECK (correct_answer IN ('A', 'B', 'C', 'D'))
);

CREATE TABLE public.mock_attempt_private_policies (
  attempt_id uuid PRIMARY KEY
    REFERENCES public.mock_attempts(id) ON DELETE CASCADE,
  marks_per_correct numeric(10, 2) NOT NULL,
  negative_mark numeric(10, 2) NOT NULL,
  retention_seconds integer NOT NULL,
  percentage_mode text NOT NULL,
  CONSTRAINT mock_attempt_private_policies_values_check
    CHECK (
      marks_per_correct > 0
      AND negative_mark >= 0
      AND retention_seconds > 0
      AND percentage_mode = 'clamp_0_100'
    )
);

CREATE INDEX mock_attempt_answer_keys_attempt_idx
  ON public.mock_attempt_answer_keys (attempt_id);

CREATE OR REPLACE FUNCTION public.mock_reject_question_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
    OR NEW.position IS DISTINCT FROM OLD.position
    OR NEW.question_id IS DISTINCT FROM OLD.question_id
    OR NEW.subject_snapshot IS DISTINCT FROM OLD.subject_snapshot
    OR NEW.question_snapshot IS DISTINCT FROM OLD.question_snapshot THEN
    RAISE EXCEPTION 'Mock question identity and display snapshots are immutable.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER mock_attempt_questions_snapshot_immutable
  BEFORE UPDATE OF attempt_id, position, question_id, subject_snapshot, question_snapshot
  ON public.mock_attempt_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.mock_reject_question_snapshot_mutation();

CREATE OR REPLACE FUNCTION public.mock_attempt_payload(
  p_attempt_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  attempt_row public.mock_attempts%ROWTYPE;
  question_payload jsonb;
  result_payload jsonb;
BEGIN
  SELECT attempt.*
  INTO attempt_row
  FROM public.mock_attempts attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mock attempt not found.' USING ERRCODE = '42501';
  END IF;

  IF attempt_row.retention_expires_at <= pg_catalog.statement_timestamp() THEN
    RAISE EXCEPTION 'Mock attempt retention period has expired.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'position', question.position,
        'subject', question.subject_snapshot,
        'question', question.question_snapshot -> 'question',
        'options', question.question_snapshot -> 'options',
        'selected_answer', question.selected_answer,
        'answer_revision', question.answer_revision
      ) ORDER BY question.position
    ),
    '[]'::jsonb
  )
  INTO question_payload
  FROM public.mock_attempt_questions question
  WHERE question.attempt_id = attempt_row.id;

  result_payload := NULL;
  IF attempt_row.status = 'submitted' THEN
    result_payload := pg_catalog.jsonb_build_object(
      'score', attempt_row.score,
      'max_score', attempt_row.max_score,
      'correct', attempt_row.correct,
      'wrong', attempt_row.wrong,
      'unanswered', attempt_row.unanswered,
      'percentage', attempt_row.percentage,
      'per_subject_summary', attempt_row.per_subject_summary,
      'submitted_at', attempt_row.submitted_at,
      'completion_reason', attempt_row.completion_reason
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'attempt_id', attempt_row.id,
    'status', attempt_row.status,
    'started_at', attempt_row.started_at,
    'expires_at', attempt_row.expires_at,
    'submitted_at', attempt_row.submitted_at,
    'questions', question_payload,
    'result', result_payload
  );
END;
$$;

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
    ELSE pg_catalog.least(
      100::numeric,
      pg_catalog.greatest(
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
        ELSE pg_catalog.least(
          100::numeric,
          pg_catalog.greatest(
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

  RETURN public.mock_attempt_payload(attempt_row.id, attempt_row.user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_mock_attempt(
  p_user_id uuid,
  p_start_idempotency_key uuid,
  p_selected_subjects text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  exam_id_value uuid;
  config_row record;
  existing_attempt public.mock_attempts%ROWTYPE;
  selected_subjects text[];
  selected_combination jsonb;
  request_fingerprint text;
  now_value timestamptz;
  deadline_value timestamptz;
  attempt_id_value uuid;
  inserted_key_count integer;
  is_premium boolean;
BEGIN
  IF p_user_id IS NULL OR p_start_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Verified user identity and start idempotency key are required.'
      USING ERRCODE = '22023';
  END IF;

  IF p_selected_subjects IS NULL
    OR pg_catalog.cardinality(p_selected_subjects) <> 4
    OR pg_catalog.array_position(p_selected_subjects, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Exactly four distinct subjects are required.' USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.array_agg(pg_catalog.btrim(subject_name) ORDER BY pg_catalog.btrim(subject_name) COLLATE "C")
  INTO selected_subjects
  FROM pg_catalog.unnest(p_selected_subjects) AS subject_name;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(selected_subjects) AS subject_name
    WHERE subject_name = ''
  ) OR (
    SELECT count(DISTINCT pg_catalog.lower(subject_name))
    FROM pg_catalog.unnest(selected_subjects) AS subject_name
  ) <> 4 THEN
    RAISE EXCEPTION 'Selected subjects must be four distinct nonblank values.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT ('English' = ANY(selected_subjects)) THEN
    RAISE EXCEPTION 'English is compulsory for the JAMB Mock.' USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.jsonb_agg(subject_name ORDER BY subject_name COLLATE "C")
  INTO selected_combination
  FROM pg_catalog.unnest(selected_subjects) AS subject_name;
  request_fingerprint := selected_combination::text;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_user_id::text || ':' || p_start_idempotency_key::text,
      0
    )
  );

  SELECT attempt.*
  INTO existing_attempt
  FROM public.mock_attempts attempt
  WHERE attempt.user_id = p_user_id
    AND attempt.start_idempotency_key = p_start_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF existing_attempt.start_request_fingerprint IS DISTINCT FROM request_fingerprint THEN
      RAISE EXCEPTION 'Start idempotency key was reused with different subjects.'
        USING ERRCODE = '23505';
    END IF;

    IF existing_attempt.status = 'in_progress'
      AND existing_attempt.expires_at <= pg_catalog.clock_timestamp() THEN
      RETURN public.finalize_mock_attempt(existing_attempt.id, 'deadline');
    END IF;

    RETURN public.mock_attempt_payload(existing_attempt.id, p_user_id);
  END IF;

  SELECT exam.id
  INTO exam_id_value
  FROM public.exams exam
  WHERE exam.code = 'JAMB'
    AND exam.is_active = true;

  IF exam_id_value IS NULL THEN
    RAISE EXCEPTION 'Active JAMB exam is unavailable.' USING ERRCODE = '55000';
  END IF;

  SELECT
    configuration.id AS configuration_id,
    configuration.exam_id,
    configuration.academic_year,
    configuration.version,
    configuration.duration_seconds,
    configuration.question_count,
    configuration.subject_selection_configuration,
    policy.allowed_subject_combinations,
    policy.source_test_types,
    policy.premium_status_allowlist,
    policy.retention_seconds,
    policy.marks_per_correct,
    policy.negative_mark,
    policy.percentage_mode
  INTO config_row
  FROM public.exam_configurations configuration
  JOIN public.mock_configuration_policies policy
    ON policy.configuration_id = configuration.id
  WHERE configuration.exam_id = exam_id_value
    AND configuration.test_type = 'mock'
    AND configuration.is_active = true
  FOR SHARE OF configuration, policy;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active, fully configured JAMB Mock is unavailable.'
      USING ERRCODE = '55000';
  END IF;

  IF config_row.question_count <> 180 OR config_row.duration_seconds <> 7200 THEN
    RAISE EXCEPTION 'Mock configuration does not match the approved JAMB structure.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(config_row.allowed_subject_combinations) AS combination(value)
    WHERE (
      SELECT pg_catalog.jsonb_agg(subject_name ORDER BY subject_name COLLATE "C")
      FROM pg_catalog.jsonb_array_elements_text(combination.value) AS subject_name
    ) = selected_combination
  ) THEN
    RAISE EXCEPTION 'Selected subject combination is not permitted.' USING ERRCODE = '22023';
  END IF;

  now_value := pg_catalog.clock_timestamp();
  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions subscription
    WHERE subscription.user_id = p_user_id
      AND pg_catalog.lower(pg_catalog.btrim(subscription.status::text))
        = ANY(config_row.premium_status_allowlist)
      AND public.mock_expiry_is_valid(subscription.expires_at::text, now_value)
  )
  INTO is_premium;

  IF NOT COALESCE(is_premium, false) THEN
    RAISE EXCEPTION 'An active Premium subscription is required.' USING ERRCODE = '42501';
  END IF;

  now_value := pg_catalog.clock_timestamp();
  deadline_value := now_value + pg_catalog.make_interval(
    secs => config_row.duration_seconds
  );

  INSERT INTO public.mock_attempts (
    user_id,
    exam_id,
    configuration_id,
    configuration_snapshot,
    status,
    started_at,
    expires_at,
    retention_expires_at,
    start_idempotency_key,
    start_request_fingerprint
  )
  VALUES (
    p_user_id,
    config_row.exam_id,
    config_row.configuration_id,
    pg_catalog.jsonb_build_object(
      'academic_year', config_row.academic_year,
      'version', config_row.version,
      'test_type', 'mock',
      'duration_seconds', config_row.duration_seconds,
      'question_count', config_row.question_count
    ),
    'in_progress',
    now_value,
    deadline_value,
    deadline_value + pg_catalog.make_interval(secs => config_row.retention_seconds),
    p_start_idempotency_key,
    request_fingerprint
  )
  RETURNING id INTO attempt_id_value;

  INSERT INTO public.mock_attempt_private_policies (
    attempt_id,
    marks_per_correct,
    negative_mark,
    retention_seconds,
    percentage_mode
  )
  VALUES (
    attempt_id_value,
    config_row.marks_per_correct,
    config_row.negative_mark,
    config_row.retention_seconds,
    config_row.percentage_mode
  );

  WITH ranked_pool AS MATERIALIZED (
    SELECT
      source.id AS source_question_id,
      source."Subject" AS subject_name,
      COALESCE(source."Question"::text, '') AS question_text,
      COALESCE(source."Option_a"::text, '') AS option_a,
      COALESCE(source."Option_b"::text, '') AS option_b,
      COALESCE(source."Option_c"::text, '') AS option_c,
      COALESCE(source."Option_d"::text, '') AS option_d,
      pg_catalog.upper(pg_catalog.btrim(source."Correct_Answer"::text)) AS correct_answer,
      pg_catalog.row_number() OVER (
        PARTITION BY source."Subject"
        ORDER BY pg_catalog.random()
      ) AS subject_rank
    FROM public."Questions" source
    WHERE source.exam_id = config_row.exam_id
      AND source."Subject" = ANY(selected_subjects)
      AND source.test_type = ANY(config_row.source_test_types)
      AND source.is_active = true
      AND pg_catalog.upper(pg_catalog.btrim(source."Correct_Answer"::text))
        IN ('A', 'B', 'C', 'D')
  ),
  chosen_pool AS MATERIALIZED (
    SELECT ranked.*
    FROM ranked_pool ranked
    WHERE ranked.subject_rank <= CASE
      WHEN ranked.subject_name = 'English' THEN 60
      ELSE 40
    END
  ),
  numbered_pool AS MATERIALIZED (
    SELECT
      chosen.*,
      pg_catalog.row_number() OVER (ORDER BY pg_catalog.random())::integer AS position
    FROM chosen_pool chosen
  ),
  inserted_questions AS (
    INSERT INTO public.mock_attempt_questions (
      attempt_id,
      position,
      question_id,
      subject_snapshot,
      question_snapshot
    )
    SELECT
      attempt_id_value,
      numbered.position,
      numbered.source_question_id,
      numbered.subject_name,
      pg_catalog.jsonb_build_object(
        'question', numbered.question_text,
        'options', pg_catalog.jsonb_build_array(
          numbered.option_a,
          numbered.option_b,
          numbered.option_c,
          numbered.option_d
        )
      )
    FROM numbered_pool numbered
    RETURNING attempt_id, position, question_id
  )
  INSERT INTO public.mock_attempt_answer_keys (
    attempt_id,
    position,
    correct_answer
  )
  SELECT
    inserted.attempt_id,
    inserted.position,
    numbered.correct_answer
  FROM inserted_questions inserted
  JOIN numbered_pool numbered
    ON numbered.source_question_id = inserted.question_id;

  GET DIAGNOSTICS inserted_key_count = ROW_COUNT;
  IF inserted_key_count <> 180 THEN
    RAISE EXCEPTION 'Eligible question pool is insufficient for the required 60/40 allocation.'
      USING ERRCODE = '23514';
  END IF;

  RETURN public.mock_attempt_payload(attempt_id_value, p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.resume_mock_attempt(
  p_user_id uuid,
  p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  attempt_row public.mock_attempts%ROWTYPE;
BEGIN
  SELECT attempt.*
  INTO attempt_row
  FROM public.mock_attempts attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mock attempt not found.' USING ERRCODE = '42501';
  END IF;

  IF attempt_row.status = 'in_progress'
    AND attempt_row.expires_at <= pg_catalog.clock_timestamp() THEN
    RETURN public.finalize_mock_attempt(attempt_row.id, 'deadline');
  END IF;

  RETURN public.mock_attempt_payload(attempt_row.id, p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_mock_answer(
  p_user_id uuid,
  p_attempt_id uuid,
  p_position integer,
  p_choice text,
  p_request_id uuid,
  p_expected_revision integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  attempt_row public.mock_attempts%ROWTYPE;
  question_row public.mock_attempt_questions%ROWTYPE;
  now_value timestamptz;
  response_payload jsonb;
BEGIN
  IF p_choice NOT IN ('A', 'B', 'C', 'D')
    OR p_request_id IS NULL
    OR p_expected_revision IS NULL
    OR p_expected_revision < 0
    OR p_position IS NULL
    OR p_position <= 0 THEN
    RAISE EXCEPTION 'Valid position, A-D choice, request ID, and revision are required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT attempt.*
  INTO attempt_row
  FROM public.mock_attempts attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mock attempt not found.' USING ERRCODE = '42501';
  END IF;

  IF attempt_row.status = 'submitted' THEN
    RETURN pg_catalog.jsonb_build_object(
      'accepted', false,
      'reason', 'already_finalized',
      'attempt', public.mock_attempt_payload(attempt_row.id, p_user_id)
    );
  END IF;

  IF attempt_row.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Mock attempt is not in progress.' USING ERRCODE = '55000';
  END IF;

  SELECT question.*
  INTO question_row
  FROM public.mock_attempt_questions question
  WHERE question.attempt_id = attempt_row.id
    AND question.position = p_position
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question position does not belong to this attempt.'
      USING ERRCODE = '22023';
  END IF;

  now_value := pg_catalog.clock_timestamp();
  IF now_value >= attempt_row.expires_at THEN
    response_payload := public.finalize_mock_attempt(attempt_row.id, 'deadline');
    RETURN pg_catalog.jsonb_build_object(
      'accepted', false,
      'reason', 'deadline_passed',
      'attempt', response_payload
    );
  END IF;

  IF question_row.last_answer_request_id = p_request_id THEN
    IF question_row.selected_answer IS DISTINCT FROM p_choice THEN
      RAISE EXCEPTION 'Answer request ID was reused with a different choice.'
        USING ERRCODE = '23505';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'accepted', true,
      'idempotent_retry', true,
      'answer_revision', question_row.answer_revision,
      'attempt', public.mock_attempt_payload(attempt_row.id, p_user_id)
    );
  END IF;

  IF question_row.answer_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Mock answer revision is stale.' USING ERRCODE = '40001';
  END IF;

  UPDATE public.mock_attempt_questions question
  SET selected_answer = p_choice,
      answered_at = now_value,
      answer_revision = question.answer_revision + 1,
      last_answer_request_id = p_request_id
  WHERE question.attempt_id = attempt_row.id
    AND question.position = p_position;

  RETURN pg_catalog.jsonb_build_object(
    'accepted', true,
    'idempotent_retry', false,
    'answer_revision', p_expected_revision + 1,
    'attempt', public.mock_attempt_payload(attempt_row.id, p_user_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_mock_attempt(
  p_user_id uuid,
  p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  attempt_row public.mock_attempts%ROWTYPE;
  completion_reason_value text;
BEGIN
  SELECT attempt.*
  INTO attempt_row
  FROM public.mock_attempts attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mock attempt not found.' USING ERRCODE = '42501';
  END IF;

  IF attempt_row.status = 'submitted' THEN
    RETURN public.mock_attempt_payload(attempt_row.id, p_user_id);
  END IF;

  IF attempt_row.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Mock attempt is not in progress.' USING ERRCODE = '55000';
  END IF;

  completion_reason_value := CASE
    WHEN pg_catalog.clock_timestamp() >= attempt_row.expires_at THEN 'deadline'
    ELSE 'manual'
  END;

  RETURN public.finalize_mock_attempt(attempt_row.id, completion_reason_value);
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_mock_attempts(
  p_batch_size integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  attempt_id_value uuid;
  processed_count integer := 0;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 1000 THEN
    RAISE EXCEPTION 'Batch size must be between 1 and 1000.' USING ERRCODE = '22023';
  END IF;

  FOR attempt_id_value IN
    SELECT attempt.id
    FROM public.mock_attempts attempt
    WHERE attempt.status = 'in_progress'
      AND attempt.expires_at <= pg_catalog.clock_timestamp()
    ORDER BY attempt.expires_at, attempt.id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.finalize_mock_attempt(attempt_id_value, 'deadline');
    processed_count := processed_count + 1;
  END LOOP;

  RETURN processed_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_mock_attempts(
  p_batch_size integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 1000 THEN
    RAISE EXCEPTION 'Batch size must be between 1 and 1000.' USING ERRCODE = '22023';
  END IF;

  WITH purge_batch AS (
    SELECT attempt.id
    FROM public.mock_attempts attempt
    WHERE attempt.status IN ('submitted', 'expired', 'abandoned')
      AND attempt.retention_expires_at <= pg_catalog.clock_timestamp()
    ORDER BY attempt.retention_expires_at, attempt.id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.mock_attempts attempt
  USING purge_batch
  WHERE attempt.id = purge_batch.id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON TABLE public.mock_configuration_policies IS
  'Private, configuration-driven Mock policy. No row is seeded by this migration; all policy inputs are required and unresolved until approved.';
COMMENT ON TABLE public.mock_attempt_answer_keys IS
  'Private server-only answer keys. Never expose through Mock API responses.';
COMMENT ON TABLE public.mock_attempt_private_policies IS
  'Per-attempt scoring and retention snapshot used to keep finalization stable if configuration changes.';
COMMENT ON COLUMN public.mock_attempts.start_idempotency_key IS
  'Required for all attempts created by start_mock_attempt; nullable only to preserve compatibility with pre-existing rows.';
COMMENT ON COLUMN public.mock_attempts.completion_reason IS
  'Set by trusted finalization to manual or deadline; deadline completion uses the submitted terminal status.';

ALTER TABLE public.mock_configuration_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_attempt_answer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_attempt_private_policies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mock_attempts
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.mock_attempt_questions
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.mock_configuration_policies
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.mock_attempt_answer_keys
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.mock_attempt_private_policies
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.mock_subject_combinations_are_valid(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mock_text_array_is_valid(text[], text[], boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mock_expiry_is_valid(text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mock_policy_requires_mock_configuration()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mock_reject_question_snapshot_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mock_attempt_payload(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_mock_attempt(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.start_mock_attempt(uuid, uuid, text[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resume_mock_attempt(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_mock_answer(uuid, uuid, integer, text, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_mock_attempt(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.expire_mock_attempts(integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purge_mock_attempts(integer)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.start_mock_attempt(uuid, uuid, text[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.resume_mock_attempt(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.save_mock_answer(uuid, uuid, integer, text, uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_mock_attempt(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_mock_attempts(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_mock_attempts(integer)
  TO service_role;

COMMIT;