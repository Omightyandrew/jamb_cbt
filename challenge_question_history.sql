create table if not exists public.challenge_question_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_date date not null,
  question_id bigint not null,
  created_at timestamptz not null default now(),
  unique (user_id, challenge_date, question_id)
);

create index if not exists challenge_question_history_user_date_idx
  on public.challenge_question_history (user_id, challenge_date);

create index if not exists challenge_question_history_user_question_idx
  on public.challenge_question_history (user_id, question_id);

alter table public.challenge_question_history enable row level security;

drop policy if exists "challenge_question_history_select_own" on public.challenge_question_history;
drop policy if exists "challenge_question_history_insert_own" on public.challenge_question_history;
drop policy if exists "challenge_question_history_upsert_own" on public.challenge_question_history;

create policy "challenge_question_history_select_own"
on public.challenge_question_history
for select
to authenticated
using (auth.uid() = user_id);

create policy "challenge_question_history_insert_own"
on public.challenge_question_history
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "challenge_question_history_upsert_own"
on public.challenge_question_history
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
