-- Novel / Library content management
create table if not exists public.Novels (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  category text not null default 'JAMB Novel',
  description text,
  icon text default '📘',
  premium boolean not null default true,
  chapters jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists novels_active_idx on public.Novels(is_active);
create index if not exists novels_category_idx on public.Novels(category);

alter table public.Novels enable row level security;

drop policy if exists "novels_public_read_active" on public.Novels;
create policy "novels_public_read_active" on public.Novels
for select using (is_active = true);

drop policy if exists "novels_admin_all" on public.Novels;
create policy "novels_admin_all" on public.Novels
for all using (
  (
    coalesce(auth.jwt() -> 'app_metadata' ->> 'role','') in ('admin','super_admin')
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role','') in ('admin','super_admin')
  )
) with check (
  (
    coalesce(auth.jwt() -> 'app_metadata' ->> 'role','') in ('admin','super_admin')
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role','') in ('admin','super_admin')
  )
);

create or replace function public.set_novels_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists novels_updated_at on public.Novels;
create trigger novels_updated_at before update on public.Novels
for each row execute function public.set_novels_updated_at();
