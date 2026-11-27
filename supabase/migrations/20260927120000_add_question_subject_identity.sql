-- Phase 8 Step 3: add canonical exam-scoped subject identity to questions.
-- Existing text values remain unchanged for runtime compatibility.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.syllabus_subjects'::regclass
      AND conname = 'syllabus_subjects_id_exam_id_unique'
  ) THEN
    ALTER TABLE public.syllabus_subjects
      ADD CONSTRAINT syllabus_subjects_id_exam_id_unique
      UNIQUE (id, exam_id);
  END IF;
END
$$;

ALTER TABLE public."Questions"
  ADD COLUMN IF NOT EXISTS subject_id uuid;

-- Backfill all-or-none using exact Subject text within the question's exam.
-- A mismatch or missing syllabus subject leaves every JAMB subject_id NULL.
DO $$
DECLARE
  jamb_exam_id uuid;
  pending_count bigint;
  exact_match_count bigint;
BEGIN
  SELECT exam.id
  INTO jamb_exam_id
  FROM public.exams AS exam
  WHERE exam.code = 'JAMB';

  IF jamb_exam_id IS NULL THEN
    RAISE EXCEPTION 'Cannot resolve JAMB subject identity without the JAMB exam record.';
  END IF;

  SELECT count(*)
  INTO pending_count
  FROM public."Questions" AS question
  WHERE question.exam_id = jamb_exam_id
    AND question.subject_id IS NULL;

  SELECT count(*)
  INTO exact_match_count
  FROM public."Questions" AS question
  WHERE question.exam_id = jamb_exam_id
    AND question.subject_id IS NULL
    AND (
      SELECT count(*)
      FROM public.syllabus_subjects AS subject
      WHERE subject.exam_id = question.exam_id
        AND subject.name = question."Subject"
    ) = 1;

  IF pending_count = exact_match_count THEN
    UPDATE public."Questions" AS question
    SET subject_id = subject.id
    FROM public.syllabus_subjects AS subject
    WHERE question.exam_id = jamb_exam_id
      AND question.subject_id IS NULL
      AND subject.exam_id = question.exam_id
      AND subject.name = question."Subject";

    RAISE NOTICE 'Backfilled subject_id for % JAMB questions using exact, exam-scoped subject names.', pending_count;
  ELSE
    RAISE NOTICE 'Skipped JAMB subject_id backfill: only % of % questions have one exact exam-scoped syllabus subject match.', exact_match_count, pending_count;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."Questions"'::regclass
      AND conname = 'questions_subject_exam_fkey'
  ) THEN
    ALTER TABLE public."Questions"
      ADD CONSTRAINT questions_subject_exam_fkey
      FOREIGN KEY (subject_id, exam_id)
      REFERENCES public.syllabus_subjects (id, exam_id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS questions_exam_subject_id_type_active_idx
  ON public."Questions" (exam_id, subject_id, test_type, is_active);

CREATE OR REPLACE FUNCTION public.enforce_question_subject_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  jamb_exam_id uuid;
  matched_subject_id uuid;
BEGIN
  SELECT exam.id
  INTO jamb_exam_id
  FROM public.exams AS exam
  WHERE exam.code = 'JAMB';

  IF NEW.subject_id IS NULL THEN
    IF NEW.exam_id IS DISTINCT FROM jamb_exam_id THEN
      RAISE EXCEPTION 'subject_id is required for non-JAMB questions.';
    END IF;

    -- Preserve the legacy JAMB writer while resolving exact matches where possible.
    SELECT subject.id
    INTO matched_subject_id
    FROM public.syllabus_subjects AS subject
    WHERE subject.exam_id = NEW.exam_id
      AND subject.name = NEW."Subject";

    IF FOUND THEN
      NEW.subject_id := matched_subject_id;
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.syllabus_subjects AS subject
    WHERE subject.id = NEW.subject_id
      AND subject.exam_id = NEW.exam_id
  ) THEN
    RAISE EXCEPTION 'subject_id must identify a syllabus subject belonging to exam_id.';
  END IF;

  IF NEW.exam_id IS DISTINCT FROM jamb_exam_id
    AND (NEW.test_type IS NULL OR btrim(NEW.test_type) = '') THEN
    RAISE EXCEPTION 'test_type is required for non-JAMB questions.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS questions_subject_identity_contract
  ON public."Questions";
CREATE TRIGGER questions_subject_identity_contract
  BEFORE INSERT OR UPDATE
  ON public."Questions"
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_question_subject_identity();

ALTER TABLE public."Questions"
  VALIDATE CONSTRAINT questions_subject_exam_fkey;

COMMIT;