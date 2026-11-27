-- Migration: create syllabus tables and RLS
-- Timestamp: 2026-09-15 18:31:10+01:00
-- Creates: syllabus_subjects, syllabus_sections, syllabus_topics
-- NOTE: This migration creates RLS policies that allow authenticated students to SELECT active rows
-- and allows admins (per Student_profiles.is_admin OR JWT role claim) to SELECT/INSERT/UPDATE/DELETE.

-- Create schema objects

-- 1) syllabus_subjects
CREATE TABLE IF NOT EXISTS public.syllabus_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  subtitle text,
  icon text,
  overview text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) syllabus_sections
CREATE TABLE IF NOT EXISTS public.syllabus_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.syllabus_subjects(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3) syllabus_topics
CREATE TABLE IF NOT EXISTS public.syllabus_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES public.syllabus_sections(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  content jsonb,
  display_order integer NOT NULL DEFAULT 0,
  import_key text UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_syllabus_sections_subject_display_order ON public.syllabus_sections (subject_id, display_order);
CREATE INDEX IF NOT EXISTS idx_syllabus_topics_section_display_order ON public.syllabus_topics (section_id, display_order);
CREATE INDEX IF NOT EXISTS idx_syllabus_topics_is_active ON public.syllabus_topics (is_active);
CREATE INDEX IF NOT EXISTS idx_syllabus_topics_import_key ON public.syllabus_topics (import_key);

-- Row Level Security (RLS)
-- Enable RLS on all tables
ALTER TABLE public.syllabus_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.syllabus_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.syllabus_topics ENABLE ROW LEVEL SECURITY;

-- Helper function to determine admin status for the current authenticated user.
-- SECURITY DEFINER lets the profile lookup work independently of Student_profiles RLS.
-- The function has no caller-supplied user id, so it cannot be used as an admin-status oracle.
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    COALESCE((
      SELECT sp.is_admin
      FROM public.Student_profiles AS sp
      WHERE sp.id = auth.uid()
      LIMIT 1
    ), false)
    OR COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
    OR COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin');
$$;

REVOKE ALL ON FUNCTION public.is_admin_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated;

-- Policies for syllabus_subjects
-- Allow authenticated students to SELECT only active subjects
CREATE POLICY syllabus_subjects_select_active_for_authenticated
  ON public.syllabus_subjects
  FOR SELECT
  TO authenticated
  USING ( (
    auth.role() = 'authenticated' AND is_active = true
  ) OR public.is_admin_user() );

-- Allow admins to INSERT
CREATE POLICY syllabus_subjects_insert_for_admin
  ON public.syllabus_subjects
  FOR INSERT
  TO authenticated
  WITH CHECK ( public.is_admin_user() );

-- Allow admins to UPDATE
CREATE POLICY syllabus_subjects_update_for_admin
  ON public.syllabus_subjects
  FOR UPDATE
  TO authenticated
  USING ( public.is_admin_user() )
  WITH CHECK ( public.is_admin_user() );

-- Allow admins to DELETE
CREATE POLICY syllabus_subjects_delete_for_admin
  ON public.syllabus_subjects
  FOR DELETE
  TO authenticated
  USING ( public.is_admin_user() );

-- Policies for syllabus_sections
-- Students may SELECT sections that are active and whose parent subject is active
CREATE POLICY syllabus_sections_select_active_for_authenticated
  ON public.syllabus_sections
  FOR SELECT
  TO authenticated
  USING ( (
    auth.role() = 'authenticated' AND is_active = true AND (
      EXISTS (
        SELECT 1 FROM public.syllabus_subjects s WHERE s.id = subject_id AND s.is_active = true
      )
    )
  ) OR public.is_admin_user() );

-- Admin insert/update/delete on sections
CREATE POLICY syllabus_sections_insert_for_admin
  ON public.syllabus_sections
  FOR INSERT
  TO authenticated
  WITH CHECK ( public.is_admin_user() );

CREATE POLICY syllabus_sections_update_for_admin
  ON public.syllabus_sections
  FOR UPDATE
  TO authenticated
  USING ( public.is_admin_user() )
  WITH CHECK ( public.is_admin_user() );

CREATE POLICY syllabus_sections_delete_for_admin
  ON public.syllabus_sections
  FOR DELETE
  TO authenticated
  USING ( public.is_admin_user() );

-- Policies for syllabus_topics
-- Students may SELECT topics that are active and whose parent section and subject are active
CREATE POLICY syllabus_topics_select_active_for_authenticated
  ON public.syllabus_topics
  FOR SELECT
  TO authenticated
  USING ( (
    auth.role() = 'authenticated' AND is_active = true AND (
      EXISTS (
        SELECT 1 FROM public.syllabus_sections sec JOIN public.syllabus_subjects subj ON sec.subject_id = subj.id
        WHERE sec.id = section_id AND sec.is_active = true AND subj.is_active = true
      )
    )
  ) OR public.is_admin_user() );

-- Admin insert/update/delete on topics
CREATE POLICY syllabus_topics_insert_for_admin
  ON public.syllabus_topics
  FOR INSERT
  TO authenticated
  WITH CHECK ( public.is_admin_user() );

CREATE POLICY syllabus_topics_update_for_admin
  ON public.syllabus_topics
  FOR UPDATE
  TO authenticated
  USING ( public.is_admin_user() )
  WITH CHECK ( public.is_admin_user() );

CREATE POLICY syllabus_topics_delete_for_admin
  ON public.syllabus_topics
  FOR DELETE
  TO authenticated
  USING ( public.is_admin_user() );

-- Safety checks / final notes
-- No policy uses USING (true) or WITH CHECK (true) unconditionally.
-- The select policies require either an authenticated user selecting active rows, or an admin as determined by the helper function.

-- End of migration
