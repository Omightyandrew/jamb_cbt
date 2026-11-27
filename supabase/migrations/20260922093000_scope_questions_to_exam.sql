-- ExamPilot V2 Phase 1, Step 2: associate the existing question bank with exams.
-- This migration preserves the legacy "exam" column and all question content.

ALTER TABLE public."Questions"
  ADD COLUMN IF NOT EXISTS exam_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.exams
    WHERE code = 'JAMB'
  ) THEN
    RAISE EXCEPTION 'Cannot scope Questions to an exam: required JAMB exam is missing from public.exams.';
  END IF;
END
$$;

-- The Step 1 migration seeds JAMB. Existing question rows are retained exactly;
-- only the new association column is populated.
UPDATE public."Questions" q
SET exam_id = e.id
FROM public.exams e
WHERE e.code = 'JAMB'
  AND q.exam_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public."Questions"
    WHERE exam_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot enforce Questions.exam_id: one or more rows were not mapped to JAMB.';
  END IF;
END
$$;

-- Preserve the existing V1 admin insert contract until the admin surface is
-- updated to send an explicit exam_id. Future multi-exam writers can provide
-- exam_id directly and bypass this JAMB compatibility default.
CREATE OR REPLACE FUNCTION public.default_questions_exam_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.exam_id IS NULL THEN
    SELECT e.id
    INTO NEW.exam_id
    FROM public.exams e
    WHERE e.code = 'JAMB'
      AND e.is_active = true
    LIMIT 1;

    IF NEW.exam_id IS NULL THEN
      RAISE EXCEPTION 'Cannot insert question without exam_id: the required active JAMB exam is unavailable.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.default_questions_exam_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.default_questions_exam_id() TO authenticated;

DROP TRIGGER IF EXISTS questions_default_exam_id
  ON public."Questions";
CREATE TRIGGER questions_default_exam_id
  BEFORE INSERT ON public."Questions"
  FOR EACH ROW
  EXECUTE FUNCTION public.default_questions_exam_id();

ALTER TABLE public."Questions"
  ALTER COLUMN exam_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."Questions"'::regclass
      AND conname = 'questions_exam_id_fkey'
  ) THEN
    ALTER TABLE public."Questions"
      ADD CONSTRAINT questions_exam_id_fkey
      FOREIGN KEY (exam_id)
      REFERENCES public.exams(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS questions_exam_subject_type_active_idx
  ON public."Questions" (exam_id, "Subject", test_type, is_active);

CREATE INDEX IF NOT EXISTS questions_exam_topic_idx
  ON public."Questions" (exam_id, "Topic");

-- Existing question RLS policies remain in place. These policies ensure that
-- administrator-created or updated rows always carry a valid exam association.
DROP POLICY IF EXISTS questions_exam_association_insert_for_admin
  ON public."Questions";
CREATE POLICY questions_exam_association_insert_for_admin
  ON public."Questions"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin_user()
    AND exam_id IS NOT NULL
  );

DROP POLICY IF EXISTS questions_exam_association_update_for_admin
  ON public."Questions";
CREATE POLICY questions_exam_association_update_for_admin
  ON public."Questions"
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (
    public.is_admin_user()
    AND exam_id IS NOT NULL
  );
