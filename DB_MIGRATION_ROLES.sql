-- Ejecutar en Supabase SQL Editor
-- Objetivo:
-- 1) Habilitar roles por usuario
-- 2) Permitir gestión de equipo por owner/admin

alter table public.profiles
  add column if not exists role text;

update public.profiles
set role = coalesce(role, 'owner')
where role is null;

alter table public.profiles
  alter column role set default 'operator';

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('owner', 'admin', 'supervisor', 'operator'));

-- Recomendado: primer usuario de cada tenant queda owner; resto operator
with first_by_tenant as (
  select tenant_id, min(created_at) as first_created
  from public.profiles
  where tenant_id is not null
  group by tenant_id
)
update public.profiles p
set role = case
  when p.created_at = f.first_created then 'owner'
  else coalesce(p.role, 'operator')
end
from first_by_tenant f
where p.tenant_id = f.tenant_id;

-- IMPORTANTE:
-- Si tenés RLS activa en profiles, agregá políticas que permitan
-- a owner/admin actualizar role de usuarios del mismo tenant.
