-- JAMB CBT Daily Challenge statistics
create table if not exists public.challenge_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'Student',
  challenge_date date not null,
  score integer not null default 0,
  total integer not null default 0,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint challenge_attempts_user_date_unique unique (user_id, challenge_date),
  constraint challenge_attempts_score_valid check (score >= 0),
  constraint challenge_attempts_total_valid check (total >= 0)
);
create index if not exists challenge_attempts_score_idx on public.challenge_attempts(score desc);
create index if not exists challenge_attempts_date_idx on public.challenge_attempts(challenge_date desc);

create or replace view public.challenge_leaderboard as
select
  user_id,
  display_name,
  challenge_date,
  score,
  total,
  completed_at
from public.challenge_attempts;

alter table public.challenge_attempts enable row level security;

drop policy if exists "challenge_attempts_student_insert" on public.challenge_attempts;
drop policy if exists "challenge_attempts_student_update" on public.challenge_attempts;
drop policy if exists "challenge_attempts_student_read" on public.challenge_attempts;

create policy "challenge_attempts_student_insert" on public.challenge_attempts for insert to authenticated with check (auth.uid() = user_id);
create policy "challenge_attempts_student_update" on public.challenge_attempts for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "challenge_attempts_student_read" on public.challenge_attempts for select to authenticated using (auth.uid() = user_id);

-- public.challenge_leaderboard is a VIEW, not a TABLE.
-- PostgreSQL does not allow RLS policies on views; keep the public leaderboard as a narrow read-only projection.
grant select on public.challenge_leaderboard to authenticated;
