-- Ejecutar en Supabase SQL Editor (entorno PRODUCTION con cuidado)
-- Objetivo:
-- 1) Aislar datos por tenant (empresa)
-- 2) Permitir gestión de equipo solo a owner/admin
-- 3) Permitir correcciones operativas (anular/reabrir) a owner/admin/supervisor

-- Helpers (evitan recursión de RLS sobre profiles)
create or replace function public.app_current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.tenant_id
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$$;

create or replace function public.app_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p.role, 'operator')
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$$;

grant execute on function public.app_current_tenant_id() to authenticated;
grant execute on function public.app_current_role() to authenticated;

-- RLS ON
alter table public.profiles enable row level security;
alter table public.branches enable row level security;
alter table public.clients enable row level security;
alter table public.daily_openings enable row level security;
alter table public.operations enable row level security;
alter table public.daily_closings enable row level security;

-- ---------
-- PROFILES
-- ---------
drop policy if exists profiles_select_same_tenant on public.profiles;
drop policy if exists profiles_update_team_roles on public.profiles;

create policy profiles_select_same_tenant
on public.profiles
for select
to authenticated
using (tenant_id = public.app_current_tenant_id());

create policy profiles_update_team_roles
on public.profiles
for update
to authenticated
using (
  tenant_id = public.app_current_tenant_id()
  and public.app_current_role() in ('owner', 'admin')
)
with check (
  tenant_id = public.app_current_tenant_id()
  and role in ('owner', 'admin', 'supervisor', 'operator')
);

-- ---------
-- BRANCHES
-- ---------
drop policy if exists branches_select_same_tenant on public.branches;
drop policy if exists branches_update_owner_admin on public.branches;

create policy branches_select_same_tenant
on public.branches
for select
to authenticated
using (tenant_id = public.app_current_tenant_id());

create policy branches_update_owner_admin
on public.branches
for update
to authenticated
using (
  tenant_id = public.app_current_tenant_id()
  and public.app_current_role() in ('owner', 'admin')
)
with check (tenant_id = public.app_current_tenant_id());

-- --------
-- CLIENTS
-- --------
drop policy if exists clients_select_same_tenant on public.clients;
drop policy if exists clients_insert_same_tenant on public.clients;
drop policy if exists clients_update_same_tenant on public.clients;

create policy clients_select_same_tenant
on public.clients
for select
to authenticated
using (tenant_id = public.app_current_tenant_id());

create policy clients_insert_same_tenant
on public.clients
for insert
to authenticated
with check (tenant_id = public.app_current_tenant_id());

create policy clients_update_same_tenant
on public.clients
for update
to authenticated
using (tenant_id = public.app_current_tenant_id())
with check (tenant_id = public.app_current_tenant_id());

-- --------------
-- DAILY_OPENINGS
-- --------------
drop policy if exists daily_openings_select_same_tenant on public.daily_openings;
drop policy if exists daily_openings_insert_same_tenant on public.daily_openings;
drop policy if exists daily_openings_update_same_tenant on public.daily_openings;

create policy daily_openings_select_same_tenant
on public.daily_openings
for select
to authenticated
using (tenant_id = public.app_current_tenant_id());

create policy daily_openings_insert_same_tenant
on public.daily_openings
for insert
to authenticated
with check (tenant_id = public.app_current_tenant_id());

create policy daily_openings_update_same_tenant
on public.daily_openings
for update
to authenticated
using (tenant_id = public.app_current_tenant_id())
with check (tenant_id = public.app_current_tenant_id());

-- -----------
-- OPERATIONS
-- -----------
drop policy if exists operations_select_same_tenant on public.operations;
drop policy if exists operations_insert_same_tenant on public.operations;
drop policy if exists operations_update_corrections_by_role on public.operations;

create policy operations_select_same_tenant
on public.operations
for select
to authenticated
using (tenant_id = public.app_current_tenant_id());

create policy operations_insert_same_tenant
on public.operations
for insert
to authenticated
with check (tenant_id = public.app_current_tenant_id());

create policy operations_update_corrections_by_role
on public.operations
for update
to authenticated
using (
  tenant_id = public.app_current_tenant_id()
  and public.app_current_role() in ('owner', 'admin', 'supervisor')
)
with check (tenant_id = public.app_current_tenant_id());

-- --------------
-- DAILY_CLOSINGS
-- --------------
drop policy if exists daily_closings_select_same_tenant on public.daily_closings;
drop policy if exists daily_closings_insert_same_tenant on public.daily_closings;
drop policy if exists daily_closings_update_same_tenant on public.daily_closings;
drop policy if exists daily_closings_delete_corrections_by_role on public.daily_closings;

create policy daily_closings_select_same_tenant
on public.daily_closings
for select
to authenticated
using (tenant_id = public.app_current_tenant_id());

create policy daily_closings_insert_same_tenant
on public.daily_closings
for insert
to authenticated
with check (tenant_id = public.app_current_tenant_id());

create policy daily_closings_update_same_tenant
on public.daily_closings
for update
to authenticated
using (tenant_id = public.app_current_tenant_id())
with check (tenant_id = public.app_current_tenant_id());

create policy daily_closings_delete_corrections_by_role
on public.daily_closings
for delete
to authenticated
using (
  tenant_id = public.app_current_tenant_id()
  and public.app_current_role() in ('owner', 'admin', 'supervisor')
);

-- Verificación sugerida:
-- select tablename, policyname, cmd, roles
-- from pg_policies
-- where schemaname='public'
--   and tablename in ('profiles','branches','clients','daily_openings','operations','daily_closings')
-- order by tablename, policyname;
