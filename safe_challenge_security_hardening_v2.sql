-- Safe challenge security hardening v2
-- Fixes the migration error caused by treating public.challenge_leaderboard as a table.
-- public.challenge_leaderboard is an existing VIEW, not a TABLE.
-- PostgreSQL does not support CREATE POLICY on a VIEW; instead we refresh the view and
-- keep the owner-only RLS on challenge_attempts.

-- Ensure the leaderboard view is present and preserves only the columns used by the app.
do $$
begin
  if not exists (
    select 1
    from pg_views
    where schemaname = 'public'
      and viewname = 'challenge_leaderboard'
  ) then
    create view public.challenge_leaderboard as
    select
      user_id,
      display_name,
      challenge_date,
      score,
      total,
      completed_at
    from public.challenge_attempts;
  else
    create or replace view public.challenge_leaderboard as
    select
      user_id,
      display_name,
      challenge_date,
      score,
      total,
      completed_at
    from public.challenge_attempts;
  end if;
end $$;

-- Keep direct challenge rows private to each student.
drop policy if exists "challenge_attempts_student_read" on public.challenge_attempts;
create policy "challenge_attempts_student_read"
on public.challenge_attempts for select to authenticated
using (auth.uid() = user_id);

-- Do not create a table policy on public.challenge_leaderboard.
-- The view is the intended public leaderboard surface and should remain a narrow projection.
grant select on public.challenge_leaderboard to authenticated;

-- Optional: keep any insert/update/delete policies as already defined for the owner-owned table.
-- This migration intentionally does not broaden access or delete data.
