-- ExamPilot V2 Phase 1, Step 5: question-to-syllabus topic relationship foundation.
-- This migration intentionally creates an empty relationship table. Existing
-- Questions.Subject and Questions.Topic values are not modified or mapped.

BEGIN;

CREATE TABLE public.question_syllabus_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id bigint NOT NULL
    REFERENCES public."Questions"(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL
    REFERENCES public.syllabus_topics(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_syllabus_topics_question_topic_unique
    UNIQUE (question_id, topic_id)
);

CREATE INDEX idx_question_syllabus_topics_question_id
  ON public.question_syllabus_topics (question_id);

CREATE INDEX idx_question_syllabus_topics_topic_id
  ON public.question_syllabus_topics (topic_id);

ALTER TABLE public.question_syllabus_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY question_syllabus_topics_select_active_for_authenticated
  ON public.question_syllabus_topics
  FOR SELECT
  TO authenticated
  USING (
    (
      auth.role() = 'authenticated'
      AND EXISTS (
        SELECT 1
        FROM public."Questions" question
        JOIN public.syllabus_topics topic
          ON topic.id = question_syllabus_topics.topic_id
        JOIN public.syllabus_sections section
          ON section.id = topic.section_id
        JOIN public.syllabus_subjects subject
          ON subject.id = section.subject_id
        JOIN public.exams exam
          ON exam.id = subject.exam_id
        WHERE question.id = question_syllabus_topics.question_id
          AND question.is_active = true
          AND topic.is_active = true
          AND section.is_active = true
          AND subject.is_active = true
          AND exam.is_active = true
      )
    )
    OR public.is_admin_user()
  );

CREATE POLICY question_syllabus_topics_insert_for_admin
  ON public.question_syllabus_topics
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_user());

CREATE POLICY question_syllabus_topics_update_for_admin
  ON public.question_syllabus_topics
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

CREATE POLICY question_syllabus_topics_delete_for_admin
  ON public.question_syllabus_topics
  FOR DELETE
  TO authenticated
  USING (public.is_admin_user());

COMMIT;
