-- Ejecutar en Supabase SQL Editor
-- Permite alta previa de operadores por email para cada empresa (tenant).

create table if not exists public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  email text not null,
  role text not null default 'operator'
    check (role in ('owner', 'admin', 'supervisor', 'operator')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null
);

create unique index if not exists team_memberships_tenant_email_uniq
  on public.team_memberships (tenant_id, email);

-- Normaliza emails existentes a lowercase
update public.team_memberships
set email = lower(email)
where email <> lower(email);

alter table public.team_memberships enable row level security;

drop policy if exists team_memberships_select_owner_admin on public.team_memberships;
drop policy if exists team_memberships_insert_owner_admin on public.team_memberships;
drop policy if exists team_memberships_update_owner_admin on public.team_memberships;

create policy team_memberships_select_owner_admin
on public.team_memberships
for select
to authenticated
using (
  tenant_id = public.app_current_tenant_id()
  and public.app_current_role() in ('owner', 'admin')
);

create policy team_memberships_insert_owner_admin
on public.team_memberships
for insert
to authenticated
with check (
  tenant_id = public.app_current_tenant_id()
  and public.app_current_role() in ('owner', 'admin')
);

create policy team_memberships_update_owner_admin
on public.team_memberships
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

-- Para permitir reclamo automático por email desde cliente:
-- un usuario autenticado sin tenant puede leer solo su email en team_memberships.
drop policy if exists team_memberships_select_self_email on public.team_memberships;
create policy team_memberships_select_self_email
on public.team_memberships
for select
to authenticated
using (lower(email) = lower(coalesce(auth.email(), '')));

-- Permitir que el usuario actual complete su propio profile (tenant/role) una sola vez
-- cuando aún no tiene tenant asignado.
drop policy if exists profiles_self_claim_tenant on public.profiles;
create policy profiles_self_claim_tenant
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());
