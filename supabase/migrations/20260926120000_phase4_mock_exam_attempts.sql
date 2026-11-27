-- ExamPilot Phase 4: mock exam attempt storage.
-- Attempts and question snapshots are created/scored by trusted backend code.

BEGIN;

-- Student-readable JSON is a deliberately small projection of backend data.
CREATE OR REPLACE FUNCTION public.mock_question_snapshot_is_valid(p_snapshot jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
DECLARE
  option_value jsonb;
BEGIN
  IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
    OR NOT (p_snapshot ?& ARRAY['question', 'options'])
    OR p_snapshot - ARRAY['question', 'options'] <> '{}'::jsonb
    OR jsonb_typeof(p_snapshot -> 'question') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_snapshot -> 'options') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;

  IF jsonb_array_length(p_snapshot -> 'options') <> 4 THEN
    RETURN false;
  END IF;

  FOR option_value IN
    SELECT value FROM jsonb_array_elements(p_snapshot -> 'options')
  LOOP
    IF jsonb_typeof(option_value) IS DISTINCT FROM 'string' THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.mock_configuration_snapshot_is_valid(p_snapshot jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
DECLARE
  allowed_keys constant text[] := ARRAY[
    'academic_year', 'version', 'test_type', 'duration_seconds', 'question_count'
  ];
BEGIN
  IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
    OR NOT (p_snapshot ?& allowed_keys)
    OR p_snapshot - allowed_keys <> '{}'::jsonb THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_snapshot -> 'academic_year') IS DISTINCT FROM 'string'
    OR btrim(p_snapshot ->> 'academic_year') = ''
    OR jsonb_typeof(p_snapshot -> 'version') IS DISTINCT FROM 'string'
    OR btrim(p_snapshot ->> 'version') = ''
    OR jsonb_typeof(p_snapshot -> 'test_type') IS DISTINCT FROM 'string'
    OR btrim(p_snapshot ->> 'test_type') = ''
    OR jsonb_typeof(p_snapshot -> 'duration_seconds') IS DISTINCT FROM 'number'
    OR (p_snapshot ->> 'duration_seconds') !~ '^[1-9][0-9]*$'
    OR jsonb_typeof(p_snapshot -> 'question_count') IS DISTINCT FROM 'number'
    OR (p_snapshot ->> 'question_count') !~ '^[1-9][0-9]*$' THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.mock_subject_summary_is_valid(p_summary jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
DECLARE
  subject_key text;
  subject_summary jsonb;
  metric_value jsonb;
  allowed_metrics constant text[] := ARRAY[
    'correct', 'wrong', 'unanswered', 'score', 'max_score', 'percentage'
  ];
BEGIN
  IF jsonb_typeof(p_summary) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;

  FOR subject_key, subject_summary IN
    SELECT key, value FROM jsonb_each(p_summary)
  LOOP
    IF btrim(subject_key) = ''
      OR jsonb_typeof(subject_summary) IS DISTINCT FROM 'object'
      OR NOT (subject_summary ?& ARRAY['correct', 'wrong', 'unanswered'])
      OR subject_summary - allowed_metrics <> '{}'::jsonb THEN
      RETURN false;
    END IF;

    FOR metric_value IN
      SELECT value FROM jsonb_each(subject_summary)
    LOOP
      IF jsonb_typeof(metric_value) IS DISTINCT FROM 'number' THEN
        RETURN false;
      END IF;
    END LOOP;
  END LOOP;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.mock_question_snapshot_is_valid(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mock_configuration_snapshot_is_valid(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mock_subject_summary_is_valid(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mock_question_snapshot_is_valid(jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mock_configuration_snapshot_is_valid(jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mock_subject_summary_is_valid(jsonb)
  TO service_role;

ALTER TABLE public.exam_configurations
  ADD CONSTRAINT exam_configurations_id_exam_id_unique
  UNIQUE (id, exam_id);

CREATE TABLE public.mock_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE RESTRICT,
  configuration_id uuid NOT NULL,
  configuration_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'in_progress',
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  submitted_at timestamptz,
  score numeric(10, 2),
  max_score numeric(10, 2),
  correct integer NOT NULL DEFAULT 0,
  wrong integer NOT NULL DEFAULT 0,
  unanswered integer NOT NULL DEFAULT 0,
  percentage numeric(5, 2),
  per_subject_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  retention_expires_at timestamptz NOT NULL,
  CONSTRAINT mock_attempts_status_valid
    CHECK (status IN ('in_progress', 'submitted', 'expired', 'abandoned')),
  CONSTRAINT mock_attempts_submitted_at_matches_status
    CHECK ((status = 'submitted') = (submitted_at IS NOT NULL)),
  CONSTRAINT mock_attempts_configuration_snapshot_object
    CHECK (public.mock_configuration_snapshot_is_valid(configuration_snapshot)),
  CONSTRAINT mock_attempts_subject_summary_object
    CHECK (public.mock_subject_summary_is_valid(per_subject_summary)),
  CONSTRAINT mock_attempts_score_counts_nonnegative
    CHECK (correct >= 0 AND wrong >= 0 AND unanswered >= 0),
  CONSTRAINT mock_attempts_max_score_nonnegative
    CHECK (max_score IS NULL OR max_score >= 0),
  CONSTRAINT mock_attempts_percentage_range
    CHECK (percentage IS NULL OR percentage BETWEEN 0 AND 100),
  CONSTRAINT mock_attempts_expiry_order
    CHECK (expires_at >= started_at AND retention_expires_at >= started_at),
  CONSTRAINT mock_attempts_configuration_exam_fkey
    FOREIGN KEY (configuration_id, exam_id)
    REFERENCES public.exam_configurations(id, exam_id)
    ON DELETE RESTRICT
);

CREATE TABLE public.mock_attempt_questions (
  attempt_id uuid NOT NULL
    REFERENCES public.mock_attempts(id) ON DELETE CASCADE,
  position integer NOT NULL,
  question_id bigint NOT NULL
    REFERENCES public."Questions"(id) ON DELETE RESTRICT,
  subject_snapshot text NOT NULL,
  question_snapshot jsonb NOT NULL,
  selected_answer text,
  answered_at timestamptz,
  CONSTRAINT mock_attempt_questions_pkey PRIMARY KEY (attempt_id, position),
  CONSTRAINT mock_attempt_questions_attempt_question_unique
    UNIQUE (attempt_id, question_id),
  CONSTRAINT mock_attempt_questions_position_positive CHECK (position > 0),
  CONSTRAINT mock_attempt_questions_subject_not_blank
    CHECK (btrim(subject_snapshot) <> ''),
  CONSTRAINT mock_attempt_questions_snapshot_object
    CHECK (public.mock_question_snapshot_is_valid(question_snapshot)),
  CONSTRAINT mock_attempt_questions_answer_timestamp_matches
    CHECK ((selected_answer IS NULL) = (answered_at IS NULL))
);

CREATE INDEX mock_attempts_user_started_idx
  ON public.mock_attempts (user_id, started_at DESC);
CREATE INDEX mock_attempts_user_retention_expiry_idx
  ON public.mock_attempts (user_id, retention_expires_at);
CREATE INDEX mock_attempts_retention_expires_at_idx
  ON public.mock_attempts (retention_expires_at);
CREATE INDEX mock_attempts_configuration_id_idx
  ON public.mock_attempts (configuration_id);
CREATE INDEX mock_attempts_exam_id_idx
  ON public.mock_attempts (exam_id);
CREATE INDEX mock_attempt_questions_question_id_idx
  ON public.mock_attempt_questions (question_id);

COMMENT ON COLUMN public.mock_attempts.configuration_snapshot IS
  'Student-safe configuration projection: academic_year, version, test_type, duration_seconds, question_count only.';
COMMENT ON COLUMN public.mock_attempts.per_subject_summary IS
  'Student-safe per-subject aggregates: correct, wrong, unanswered, score, max_score, percentage only.';
COMMENT ON COLUMN public.mock_attempts.retention_expires_at IS
  'RLS hides expired attempt data; a trusted backend cleanup job must purge attempts at or after this timestamp. Deleting an attempt cascades its question rows.';
COMMENT ON COLUMN public.mock_attempt_questions.question_snapshot IS
  'Student-visible projection only: question text and four option strings; no answer or explanation fields.';

ALTER TABLE public.mock_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_attempt_questions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mock_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.mock_attempt_questions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mock_attempts TO authenticated;
GRANT SELECT ON public.mock_attempt_questions TO authenticated;

CREATE POLICY mock_attempts_select_own
  ON public.mock_attempts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id AND retention_expires_at > statement_timestamp());

CREATE POLICY mock_attempt_questions_select_own
  ON public.mock_attempt_questions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.mock_attempts attempt
      WHERE attempt.id = mock_attempt_questions.attempt_id
        AND attempt.user_id = auth.uid()
        AND attempt.retention_expires_at > statement_timestamp()
    )
  );

COMMIT;