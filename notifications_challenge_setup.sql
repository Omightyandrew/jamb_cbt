-- Notifications + Daily Challenge setup
-- Notifications table used by the current JAMB CBT dashboard/admin.
-- Run once in Supabase SQL Editor if the table does not already exist.
-- This script does NOT modify the Questions table/question bank.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  target_type text not null default 'all',
  target_user_id uuid null,
  created_by uuid null,
  created_at timestamptz not null default now()
);

create index if not exists notifications_created_at_idx on public.notifications(created_at desc);
create index if not exists notifications_target_user_id_idx on public.notifications(target_user_id);
create index if not exists notifications_target_type_idx on public.notifications(target_type);

alter table public.notifications enable row level security;

drop policy if exists "notifications_admin_read" on public.notifications;
drop policy if exists "notifications_admin_insert" on public.notifications;
drop policy if exists "notifications_admin_update" on public.notifications;
drop policy if exists "notifications_student_read" on public.notifications;

create policy "notifications_admin_read"
on public.notifications for select to authenticated
using (
  coalesce(auth.jwt() -> 'app_metadata' ->> 'role','') in ('admin','super_admin')
  or coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role','') in ('admin','super_admin')
);

create policy "notifications_admin_insert"
on public.notifications for insert to authenticated
with check (
  coalesce(auth.jwt() -> 'app_metadata' ->> 'role','') in ('admin','super_admin')
  or coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role','') in ('admin','super_admin')
);

create policy "notifications_admin_update"
on public.notifications for update to authenticated
using (
  coalesce(auth.jwt() -> 'app_metadata' ->> 'role','') in ('admin','super_admin')
  or coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role','') in ('admin','super_admin')
)
with check (
  coalesce(auth.jwt() -> 'app_metadata' ->> 'role','') in ('admin','super_admin')
  or coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role','') in ('admin','super_admin')
);

-- Students can read broadcasts and messages addressed to their own user ID.
-- Premium/free targeting is filtered in dashboard.html using the student's plan.
create policy "notifications_student_read"
on public.notifications for select to authenticated
using (
  target_type in ('all','premium','free')
  or (target_type = 'specific' and target_user_id = auth.uid())
  or target_user_id = auth.uid()
);
