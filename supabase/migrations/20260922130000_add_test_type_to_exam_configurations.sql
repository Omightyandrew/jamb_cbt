-- ExamPilot V2 Phase 1, Step 7B-1: make configuration identity mode-aware.
-- "official" is an internal classification for the existing base JAMB row;
-- this migration does not create a student-facing Official CBT mode.

BEGIN;

ALTER TABLE public.exam_configurations
  ADD COLUMN test_type text;

UPDATE public.exam_configurations
SET test_type = 'official'
WHERE test_type IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.exam_configurations
    WHERE test_type IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot enforce exam_configurations.test_type NOT NULL: one or more rows remain NULL.';
  END IF;
END
$$;

ALTER TABLE public.exam_configurations
  ALTER COLUMN test_type SET NOT NULL;

ALTER TABLE public.exam_configurations
  ADD CONSTRAINT exam_configurations_exam_test_type_year_version_unique
  UNIQUE (exam_id, test_type, academic_year, version);

ALTER TABLE public.exam_configurations
  DROP CONSTRAINT exam_configurations_exam_year_version_unique;

CREATE UNIQUE INDEX exam_configurations_one_active_per_exam_test_type_idx
  ON public.exam_configurations (exam_id, test_type)
  WHERE is_active = true;

DROP INDEX public.exam_configurations_one_active_per_exam_idx;

COMMIT;
