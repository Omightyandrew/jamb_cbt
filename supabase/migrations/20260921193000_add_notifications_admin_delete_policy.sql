-- Allow the same JWT-authorized admins who can manage notifications to delete them.
drop policy if exists "notifications_admin_delete" on public.notifications;

create policy "notifications_admin_delete"
on public.notifications for delete to authenticated
using (
  coalesce(auth.jwt() -> 'app_metadata' ->> 'role','') in ('admin','super_admin')
  or coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role','') in ('admin','super_admin')
);
