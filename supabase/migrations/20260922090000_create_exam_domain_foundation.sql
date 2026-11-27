-- ExamPilot V2 Phase 1, Step 1: exam domain database foundation.
-- This migration is additive and does not modify existing V1 tables.

-- 1) Exam catalogue
CREATE TABLE IF NOT EXISTS public.exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exams_code_unique UNIQUE (code),
  CONSTRAINT exams_slug_unique UNIQUE (slug),
  CONSTRAINT exams_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT exams_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT exams_slug_not_blank CHECK (btrim(slug) <> '')
);

-- 2) Versioned, exam-specific CBT configuration
CREATE TABLE IF NOT EXISTS public.exam_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  academic_year text NOT NULL,
  version text NOT NULL,
  duration_seconds integer NOT NULL,
  question_count integer NOT NULL,
  subject_selection_configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  scoring_configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  grading_configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_configurations_exam_year_version_unique
    UNIQUE (exam_id, academic_year, version),
  CONSTRAINT exam_configurations_academic_year_not_blank
    CHECK (btrim(academic_year) <> ''),
  CONSTRAINT exam_configurations_version_not_blank
    CHECK (btrim(version) <> ''),
  CONSTRAINT exam_configurations_duration_positive
    CHECK (duration_seconds > 0),
  CONSTRAINT exam_configurations_question_count_positive
    CHECK (question_count > 0),
  CONSTRAINT exam_configurations_subject_selection_object
    CHECK (jsonb_typeof(subject_selection_configuration) = 'object'),
  CONSTRAINT exam_configurations_scoring_object
    CHECK (jsonb_typeof(scoring_configuration) = 'object'),
  CONSTRAINT exam_configurations_grading_object
    CHECK (jsonb_typeof(grading_configuration) = 'object')
);

CREATE INDEX IF NOT EXISTS exams_active_display_order_idx
  ON public.exams (is_active, display_order, name);

CREATE INDEX IF NOT EXISTS exam_configurations_exam_active_idx
  ON public.exam_configurations (exam_id, is_active);

CREATE INDEX IF NOT EXISTS exam_configurations_active_idx
  ON public.exam_configurations (is_active);

CREATE UNIQUE INDEX IF NOT EXISTS exam_configurations_one_active_per_exam_idx
  ON public.exam_configurations (exam_id)
  WHERE is_active = true;

-- Keep the catalogue usable by the current authenticated application while
-- reserving writes for administrators.
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_configurations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exams_select_active_for_authenticated
  ON public.exams;
CREATE POLICY exams_select_active_for_authenticated
  ON public.exams
  FOR SELECT
  TO authenticated
  USING (is_active = true OR public.is_admin_user());

DROP POLICY IF EXISTS exams_insert_for_admin
  ON public.exams;
CREATE POLICY exams_insert_for_admin
  ON public.exams
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS exams_update_for_admin
  ON public.exams;
CREATE POLICY exams_update_for_admin
  ON public.exams
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS exams_delete_for_admin
  ON public.exams;
CREATE POLICY exams_delete_for_admin
  ON public.exams
  FOR DELETE
  TO authenticated
  USING (public.is_admin_user());

DROP POLICY IF EXISTS exam_configurations_select_active_for_authenticated
  ON public.exam_configurations;
CREATE POLICY exam_configurations_select_active_for_authenticated
  ON public.exam_configurations
  FOR SELECT
  TO authenticated
  USING (
    (
      is_active = true
      AND EXISTS (
        SELECT 1
        FROM public.exams e
        WHERE e.id = exam_id
          AND e.is_active = true
      )
    )
    OR public.is_admin_user()
  );

DROP POLICY IF EXISTS exam_configurations_insert_for_admin
  ON public.exam_configurations;
CREATE POLICY exam_configurations_insert_for_admin
  ON public.exam_configurations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS exam_configurations_update_for_admin
  ON public.exam_configurations;
CREATE POLICY exam_configurations_update_for_admin
  ON public.exam_configurations
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS exam_configurations_delete_for_admin
  ON public.exam_configurations;
CREATE POLICY exam_configurations_delete_for_admin
  ON public.exam_configurations
  FOR DELETE
  TO authenticated
  USING (public.is_admin_user());

-- Initial seed only. Future examinations must be added explicitly.
INSERT INTO public.exams (
  code,
  name,
  slug,
  description,
  display_order,
  is_active
)
VALUES (
  'JAMB',
  'Joint Admissions and Matriculation Board',
  'jamb',
  'JAMB examination content and configuration.',
  1,
  true
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.exam_configurations (
  exam_id,
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
  e.id,
  '2026',
  '1',
  7200,
  180,
  '{
    "minimum_subjects": 4,
    "maximum_subjects": 4,
    "required_subject_count": 4
  }'::jsonb,
  '{
    "method": "correct_count",
    "marks_per_question": 1,
    "negative_mark": 0
  }'::jsonb,
  '{
    "method": "percentage",
    "bands": []
  }'::jsonb,
  true
FROM public.exams e
WHERE e.code = 'JAMB'
  AND NOT EXISTS (
    SELECT 1
    FROM public.exam_configurations c
    WHERE c.exam_id = e.id
      AND c.academic_year = '2026'
      AND c.version = '1'
  );
