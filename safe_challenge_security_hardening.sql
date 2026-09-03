-- Safe challenge security hardening
-- Purpose: restrict direct challenge_attempts reads to the owning user while preserving a public leaderboard view.
-- This file is intentionally non-destructive and safe to review before running in Supabase SQL Editor.
-- IMPORTANT: public.challenge_leaderboard already exists as a VIEW, not a TABLE.
-- PostgreSQL does not support row-level security policies on views, so we only recreate/refresh the view
-- and keep the private table policies on challenge_attempts.

-- Ensure the leaderboard view still exists with the columns the app expects.
create or replace view public.challenge_leaderboard as
select
  user_id,
  display_name,
  challenge_date,
  score,
  total,
  completed_at
from public.challenge_attempts;

-- Keep challenge results private to each student by default.
drop policy if exists "challenge_attempts_student_read" on public.challenge_attempts;
create policy "challenge_attempts_student_read"
on public.challenge_attempts for select to authenticated
using (auth.uid() = user_id);

-- No policy is created on public.challenge_leaderboard because it is a VIEW.
-- The view is intentionally a narrow public projection of leaderboard data only.
grant select on public.challenge_leaderboard to authenticated;

-- Leave insert/update/delete rules unchanged for challenge submissions.
-- The app still writes rows to challenge_attempts through the authenticated student-owned user_id flow.
