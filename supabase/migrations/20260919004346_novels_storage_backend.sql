-- Migration: novels_storage_backend
-- Timestamp: 2026-09-19 00:43:46+01:00
-- Purpose:  Add Supabase Storage reference columns to public.Novels so that
--           novel content can be served from a Storage bucket rather than
--           stored as JSONB in the database.
--           Insert Othello metadata record (content served from Storage).
--
-- IMPORTANT:
--   * The existing `chapters` JSONB column is NOT dropped.
--     Storage-backed novels use `chapters = '[]'` with content_storage_path set.
--     Chapter-based novels continue to use the `chapters` column as before.
--   * The Othello PDF is already uploaded to the `study-materials` bucket at
--     path: novels/ExamPilot_Othello_Complete_Edition.pdf
--     Do NOT re-upload or replace it.
--
-- READING PRIVACY:
--   This migration does NOT create reading_progress, history, analytics, or any
--   per-user reading data columns. None are added here or elsewhere.
--   Reading position remains localStorage-only in the frontend.

-- 1. Add Storage reference columns (idempotent)
ALTER TABLE public.Novels
  ADD COLUMN IF NOT EXISTS content_storage_path text,
  ADD COLUMN IF NOT EXISTS storage_bucket       text;

-- 2. Insert Othello metadata
--    content is served from Storage; chapters is empty array intentionally.
INSERT INTO public.Novels (
  title,
  author,
  category,
  description,
  icon,
  premium,
  is_active,
  chapters,
  content_storage_path,
  storage_bucket
)
VALUES (
  'Othello',
  'William Shakespeare',
  'JAMB Novel',
  'The tragedy of Othello, the Moor of Venice. A prescribed text for JAMB Literature in English. Read the complete play in PDF format.',
  '📗',
  true,
  true,
  '[]'::jsonb,
  'novels/ExamPilot_Othello_Complete_Edition.pdf',
  'study-materials'
)
ON CONFLICT DO NOTHING;


-- ===========================================================================
-- SUPABASE STORAGE POLICY — APPLY MANUALLY IN SUPABASE DASHBOARD SQL EDITOR
-- ===========================================================================
-- The `study-materials` bucket is private. For authenticated students to
-- generate signed URLs (required for the PDF reader), a Storage SELECT policy
-- must permit this.
--
-- RECOMMENDED policy (defense-in-depth — premium subscribers only):
-- This restricts Storage access to authenticated users who have a valid,
-- active, non-expired subscription row in public.subscriptions.
--
-- Run the following in Supabase Dashboard → SQL Editor:
-- ---------------------------------------------------------------------------
--
-- DROP POLICY IF EXISTS "novels_premium_subscribers_read" ON storage.objects;
-- CREATE POLICY "novels_premium_subscribers_read"
-- ON storage.objects
-- FOR SELECT
-- TO authenticated
-- USING (
--   bucket_id = 'study-materials'
--   AND name LIKE 'novels/%'
--   AND EXISTS (
--     SELECT 1
--     FROM public.subscriptions s
--     WHERE s.user_id = auth.uid()
--       AND lower(coalesce(s.status, s.subscription_status, s.plan_status, s.payment_status, ''))
--           IN ('active','paid','premium','subscribed','success','successful','succeeded','completed')
--       AND (
--         s.expires_at IS NULL
--         OR s.expires_at > now()
--       )
--   )
-- );
--
-- ---------------------------------------------------------------------------
-- ALTERNATIVE (simpler — any authenticated user, premium enforced by app layer only):
--
-- DROP POLICY IF EXISTS "novels_authenticated_read" ON storage.objects;
-- CREATE POLICY "novels_authenticated_read"
-- ON storage.objects
-- FOR SELECT
-- TO authenticated
-- USING (
--   bucket_id = 'study-materials'
--   AND name LIKE 'novels/%'
-- );
--
-- ---------------------------------------------------------------------------
-- NOTE: Do NOT run these as part of this migration automatically.
--       They affect Storage RLS on an existing bucket and must be applied
--       deliberately via the Dashboard after you verify the bucket name.
-- ===========================================================================

