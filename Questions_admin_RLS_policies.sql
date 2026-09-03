-- JAMB CBT: Questions table admin CRUD policies
-- Run this in Supabase Dashboard -> SQL Editor.
-- Your Admin user already uses app_metadata.role = admin/super_admin.

ALTER TABLE public."Questions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can insert questions" ON public."Questions";
DROP POLICY IF EXISTS "Admins can update questions" ON public."Questions";
DROP POLICY IF EXISTS "Admins can delete questions" ON public."Questions";

CREATE POLICY "Admins can insert questions"
ON public."Questions"
FOR INSERT
TO authenticated
WITH CHECK (
  COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
  OR COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
);

CREATE POLICY "Admins can update questions"
ON public."Questions"
FOR UPDATE
TO authenticated
USING (
  COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
  OR COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
)
WITH CHECK (
  COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
  OR COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
);

CREATE POLICY "Admins can delete questions"
ON public."Questions"
FOR DELETE
TO authenticated
USING (
  COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
  OR COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
);
