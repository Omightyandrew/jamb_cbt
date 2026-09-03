-- Subscription authorization hardening.
-- Run after reviewing the current subscriptions policies in Supabase.
-- This preserves student read access while removing client-side write paths.

begin;

alter table public.subscriptions enable row level security;

-- Remove only policies that grant INSERT, UPDATE, DELETE, or ALL on subscriptions.
-- Existing SELECT policies are preserved and reviewed below.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'subscriptions'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy if exists %I on public.subscriptions', policy_record.policyname);
  end loop;
end
$$;

drop policy if exists "subscriptions_student_read_own" on public.subscriptions;
create policy "subscriptions_student_read_own"
on public.subscriptions
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "subscriptions_admin_all" on public.subscriptions;
create policy "subscriptions_admin_all"
on public.subscriptions
for all
to authenticated
using (
  coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin', 'super_admin')
  or coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') in ('admin', 'super_admin')
)
with check (
  coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin', 'super_admin')
  or coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') in ('admin', 'super_admin')
);

commit;
