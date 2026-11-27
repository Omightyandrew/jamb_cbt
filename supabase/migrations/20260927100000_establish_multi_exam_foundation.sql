-- Phase 8 Step 2: establish exam identities and unpublished mode drafts.
-- No question, subject, or syllabus content is inserted or modified.

BEGIN;

-- Draft configurations must be representable without inventing exam rules.
-- Active configurations remain required to contain concrete runtime values.
ALTER TABLE public.exam_configurations
  ALTER COLUMN academic_year DROP NOT NULL,
  ALTER COLUMN duration_seconds DROP NOT NULL,
  ALTER COLUMN question_count DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.exam_configurations'::regclass
      AND conname = 'exam_configurations_active_rules_complete'
  ) THEN
    ALTER TABLE public.exam_configurations
      ADD CONSTRAINT exam_configurations_active_rules_complete
      CHECK (
        NOT is_active
        OR (
          academic_year IS NOT NULL
          AND btrim(academic_year) <> ''
          AND duration_seconds IS NOT NULL
          AND duration_seconds > 0
          AND question_count IS NOT NULL
          AND question_count > 0
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.exam_configurations'::regclass
      AND conname = 'exam_configurations_null_rules_draft_only'
  ) THEN
    ALTER TABLE public.exam_configurations
      ADD CONSTRAINT exam_configurations_null_rules_draft_only
      CHECK (
        (
          academic_year IS NOT NULL
          AND duration_seconds IS NOT NULL
          AND question_count IS NOT NULL
        )
        OR (
          NOT is_active
          AND version = 'draft-1'
        )
      );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS exam_configurations_one_unpublished_draft_per_mode_idx
  ON public.exam_configurations (exam_id, test_type, version)
  WHERE academic_year IS NULL
    AND is_active = false;

-- Preserve all existing registry rows, including JAMB, exactly as found.
INSERT INTO public.exams (
  code,
  name,
  slug,
  display_order,
  is_active
)
VALUES
  ('WAEC', 'West African Examinations Council', 'waec', 2, false),
  ('NECO', 'National Examinations Council', 'neco', 3, false),
  ('NABTEB', 'National Business and Technical Examinations Board', 'nabteb', 4, false)
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.exams
    WHERE code IN ('JAMB', 'WAEC', 'NECO', 'NABTEB')
  ) <> 4 THEN
    RAISE EXCEPTION 'The Phase 8 exam registry requires distinct JAMB, WAEC, NECO, and NABTEB records.';
  END IF;
END
$$;

-- These rows establish mode identity only. NULL rule fields and is_active=false
-- make it impossible to mistake an unverified mode for a launch-ready exam.
INSERT INTO public.exam_configurations (
  exam_id,
  test_type,
  academic_year,
  version,
  duration_seconds,
  question_count,
  subject_selection_configuration,
  scoring_configuration,
  grading_configuration,
  is_active
)
SELECT
  exam.id,
  modes.test_type,
  NULL,
  'draft-1',
  NULL,
  NULL,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  false
FROM public.exams AS exam
CROSS JOIN (VALUES ('practice'::text), ('past'::text)) AS modes(test_type)
WHERE exam.code IN ('WAEC', 'NECO', 'NABTEB')
  AND NOT EXISTS (
    SELECT 1
    FROM public.exam_configurations AS existing
    WHERE existing.exam_id = exam.id
      AND existing.test_type = modes.test_type
  );

COMMIT;