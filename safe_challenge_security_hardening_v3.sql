-- Safe challenge security hardening v3
-- Fixes the privacy issue in the leaderboard design.
-- public.challenge_attempts remains private. Direct reads are restricted to the owning student.
-- public.challenge_leaderboard is a narrow, public projection that exposes only the fields
-- the existing Leaderboard UI actually needs for ranking and display.

-- Ensure the base table remains private to each student.
drop policy if exists "challenge_attempts_student_read" on public.challenge_attempts;
create policy "challenge_attempts_student_read"
on public.challenge_attempts for select to authenticated
using (auth.uid() = user_id);

-- Keep the leaderboard as a narrow, intentionally public view.
-- Exposed columns are limited to those used by the current app UI:
-- user_id for current-user rank detection, display_name for display, challenge_date for streak logic,
-- score and total for ranking.
-- completed_at and other private metadata are intentionally not exposed.
create or replace view public.challenge_leaderboard as
select
  user_id,
  display_name,
  challenge_date,
  score,
  total
from public.challenge_attempts;

-- Authenticated users may read the leaderboard view, but they do not receive raw challenge_attempts rows.
grant select on public.challenge_leaderboard to authenticated;

-- No policy is created on public.challenge_leaderboard because PostgreSQL does not support
-- RLS policies on views. The safety boundary is the narrow column projection above.
-- This design preserves leaderboard functionality without exposing private challenge attempt details.
