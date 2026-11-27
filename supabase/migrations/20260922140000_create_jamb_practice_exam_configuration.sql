-- ExamPilot V2 Phase 1, Step 7B-2: inactive JAMB V1 Practice configuration.
-- This migration does not activate or otherwise modify the existing official
-- configuration and does not create any other test-mode configuration.

BEGIN;

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
  e.id,
  'practice',
  '2026',
  '1',
  1800,
  80,
  '{
    "mode": "fixed_required_subject_count",
    "required_subject_count": 4,
    "minimum_subjects": 4,
    "maximum_subjects": 4,
    "allocation_mode": "per_selected_subject",
    "questions_per_selected_subject": 20
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
  false
FROM public.exams e
WHERE e.code = 'JAMB'
  AND NOT EXISTS (
    SELECT 1
    FROM public.exam_configurations c
    WHERE c.exam_id = e.id
      AND c.test_type = 'practice'
      AND c.academic_year = '2026'
      AND c.version = '1'
  );

COMMIT;
