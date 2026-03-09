-- Ejecutar en Supabase SQL Editor
-- Objetivo: que cada empresa (tenant) se administre sola.
-- Regla: el primer usuario de un tenant queda owner automáticamente.

create or replace function public.assign_initial_owner_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tenant_id is null then
    new.role := coalesce(new.role, 'operator');
    return new;
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.tenant_id = new.tenant_id
      and p.id <> new.id
  ) then
    new.role := coalesce(new.role, 'operator');
  else
    new.role := 'owner';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_assign_initial_owner_role on public.profiles;
create trigger trg_assign_initial_owner_role
before insert on public.profiles
for each row
execute function public.assign_initial_owner_role();

-- Reparación única para tenants existentes:
-- si un tenant no tiene owner, promover al primer usuario creado.
with tenant_first_user as (
  select p.tenant_id, min(p.created_at) as first_created
  from public.profiles p
  where p.tenant_id is not null
  group by p.tenant_id
),
tenants_without_owner as (
  select t.tenant_id, t.first_created
  from tenant_first_user t
  where not exists (
    select 1 from public.profiles p2
    where p2.tenant_id = t.tenant_id
      and p2.role = 'owner'
  )
)
update public.profiles p
set role = 'owner'
from tenants_without_owner tw
where p.tenant_id = tw.tenant_id
  and p.created_at = tw.first_created;
