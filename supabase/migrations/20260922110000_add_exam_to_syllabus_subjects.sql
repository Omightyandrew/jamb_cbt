-- ExamPilot V2 Phase 1, Step 3: syllabus database foundation.
-- This migration is additive and preserves existing V1 syllabus data and IDs.
BEGIN;

DO $$
DECLARE
  v_jamb_exam_id uuid;
  v_null_subject_count integer;
  v_duplicate_name_count integer;
BEGIN
  -- Precondition: the JAMB exam must already exist in the exam catalog.
  SELECT e.id INTO v_jamb_exam_id
  FROM public.exams e
  WHERE e.code = 'JAMB'
    AND e.is_active = true
  ORDER BY e.created_at ASC
  LIMIT 1;

  IF v_jamb_exam_id IS NULL THEN
    RAISE EXCEPTION 'Precondition failed: active JAMB exam record is required in public.exams before syllabus subjects can be backfilled.';
  END IF;

  -- Add the exam association without destroying the existing schema.
  ALTER TABLE public.syllabus_subjects
    ADD COLUMN IF NOT EXISTS exam_id uuid;

  UPDATE public.syllabus_subjects
  SET exam_id = v_jamb_exam_id
  WHERE exam_id IS NULL;

  SELECT COUNT(*) INTO v_null_subject_count
  FROM public.syllabus_subjects
  WHERE exam_id IS NULL;

  IF v_null_subject_count > 0 THEN
    RAISE EXCEPTION 'Backfill failed: % syllabus_subjects row(s) still have NULL exam_id.', v_null_subject_count;
  END IF;

  -- Verify that the current JAMB syllabus has no duplicate subject names before enforcing
  -- the new exam-scoped uniqueness.
  SELECT COUNT(*) INTO v_duplicate_name_count
  FROM (
    SELECT name
    FROM public.syllabus_subjects
    GROUP BY name
    HAVING COUNT(*) > 1
  ) dup;

  IF v_duplicate_name_count > 0 THEN
    RAISE EXCEPTION 'Backfill failed: syllabus_subjects contains duplicate names that would violate UNIQUE(exam_id, name).';
  END IF;
END $$;

-- Replace the global subject-name uniqueness with an exam-scoped uniqueness.
-- This preserves the current JAMB subject rows while preventing cross-exam duplicates.
ALTER TABLE public.syllabus_subjects
  DROP CONSTRAINT IF EXISTS syllabus_subjects_name_key;

ALTER TABLE public.syllabus_subjects
  ALTER COLUMN exam_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.syllabus_subjects'::regclass
      AND conname = 'syllabus_subjects_exam_name_unique'
  ) THEN
    ALTER TABLE public.syllabus_subjects
      ADD CONSTRAINT syllabus_subjects_exam_name_unique UNIQUE (exam_id, name);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.syllabus_subjects'::regclass
      AND conname = 'syllabus_subjects_exam_id_fkey'
  ) THEN
    ALTER TABLE public.syllabus_subjects
      ADD CONSTRAINT syllabus_subjects_exam_id_fkey
      FOREIGN KEY (exam_id)
      REFERENCES public.exams(id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_syllabus_subjects_exam_active_display_order
  ON public.syllabus_subjects (exam_id, is_active, display_order);

-- Optional subtopics table to support a future topic -> subtopic hierarchy.
CREATE TABLE IF NOT EXISTS public.syllabus_subtopics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.syllabus_topics(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  content jsonb,
  display_order integer NOT NULL DEFAULT 0,
  import_key text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT syllabus_subtopics_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT syllabus_subtopics_content_object CHECK (content IS NULL OR jsonb_typeof(content) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_syllabus_subtopics_topic_active_display_order
  ON public.syllabus_subtopics (topic_id, is_active, display_order);

CREATE INDEX IF NOT EXISTS idx_syllabus_subtopics_import_key
  ON public.syllabus_subtopics (import_key)
  WHERE import_key IS NOT NULL;

ALTER TABLE public.syllabus_subtopics ENABLE ROW LEVEL SECURITY;

-- Preserve existing subject RLS and keep JAMB access working while requiring exam context.
DROP POLICY IF EXISTS syllabus_subjects_select_active_for_authenticated ON public.syllabus_subjects;
CREATE POLICY syllabus_subjects_select_active_for_authenticated
  ON public.syllabus_subjects
  FOR SELECT
  TO authenticated
  USING (
    (
      auth.role() = 'authenticated'
      AND is_active = true
      AND EXISTS (
        SELECT 1
        FROM public.exams e
        WHERE e.id = exam_id
          AND e.is_active = true
      )
    )
    OR public.is_admin_user()
  );

-- Existing admin insert/update/delete policies remain intact and continue to apply.
-- The select policy is intentionally minimal and exam-aware for authenticated students.

-- Create subtopic access policies consistent with the existing syllabus security model.
DROP POLICY IF EXISTS syllabus_subtopics_select_active_for_authenticated ON public.syllabus_subtopics;
CREATE POLICY syllabus_subtopics_select_active_for_authenticated
  ON public.syllabus_subtopics
  FOR SELECT
  TO authenticated
  USING (
    (
      auth.role() = 'authenticated'
      AND is_active = true
      AND EXISTS (
        SELECT 1
        FROM public.syllabus_topics topic
        JOIN public.syllabus_sections section ON section.id = topic.section_id
        JOIN public.syllabus_subjects subject ON subject.id = section.subject_id
        JOIN public.exams exam ON exam.id = subject.exam_id
        WHERE topic.id = syllabus_subtopics.topic_id
          AND topic.is_active = true
          AND section.is_active = true
          AND subject.is_active = true
          AND exam.is_active = true
      )
    )
    OR public.is_admin_user()
  );

DROP POLICY IF EXISTS syllabus_subtopics_insert_for_admin ON public.syllabus_subtopics;
CREATE POLICY syllabus_subtopics_insert_for_admin
  ON public.syllabus_subtopics
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS syllabus_subtopics_update_for_admin ON public.syllabus_subtopics;
CREATE POLICY syllabus_subtopics_update_for_admin
  ON public.syllabus_subtopics
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS syllabus_subtopics_delete_for_admin ON public.syllabus_subtopics;
CREATE POLICY syllabus_subtopics_delete_for_admin
  ON public.syllabus_subtopics
  FOR DELETE
  TO authenticated
  USING (public.is_admin_user());

-- Final validation for the migration state.
DO $$
DECLARE
  v_total_subjects integer;
  v_null_exam_subjects integer;
  v_total_sections integer;
  v_total_topics integer;
BEGIN
  SELECT COUNT(*) INTO v_total_subjects FROM public.syllabus_subjects;
  SELECT COUNT(*) INTO v_null_exam_subjects FROM public.syllabus_subjects WHERE exam_id IS NULL;
  SELECT COUNT(*) INTO v_total_sections FROM public.syllabus_sections;
  SELECT COUNT(*) INTO v_total_topics FROM public.syllabus_topics;

  IF v_total_subjects <> 13 THEN
    RAISE EXCEPTION 'Expected 13 syllabus subjects after migration, found %.', v_total_subjects;
  END IF;

  IF v_null_exam_subjects <> 0 THEN
    RAISE EXCEPTION 'Expected 0 NULL exam_id values in syllabus_subjects, found %.', v_null_exam_subjects;
  END IF;

  IF v_total_sections <> 155 THEN
    RAISE EXCEPTION 'Expected 155 syllabus sections after migration, found %.', v_total_sections;
  END IF;

  IF v_total_topics <> 357 THEN
    RAISE EXCEPTION 'Expected 357 syllabus topics after migration, found %.', v_total_topics;
  END IF;
END $$;

COMMIT;
