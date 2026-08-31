drop policy if exists "Permitir leitura publica" on public.leads;

alter table public."Platform" enable row level security;
alter table public."Module" enable row level security;
alter table public."PlatformModule" enable row level security;

alter function app.current_user_id() set search_path = '';
alter function app.current_organization_id() set search_path = '';
alter function app.current_company_ids() set search_path = '';
alter function app.current_business_unit_id() set search_path = '';
alter function app.business_unit_matches(text) set search_path = '';
alter function app.reject_immutable_change() set search_path = '';

revoke execute on function app.reject_immutable_change() from public, anon, authenticated;

drop policy if exists tenant_isolation on public.usuarios;

create policy usuarios_select_tenant
on public.usuarios
for select
to authenticated
using (
  (select public.auth_nivel()) = 'superadmin'
  or cliente_id = (select public.auth_cliente_id())
);

create policy usuarios_insert_admin
on public.usuarios
for insert
to authenticated
with check (
  (select public.auth_nivel()) = 'superadmin'
  or (
    (select public.auth_nivel()) = 'admin'
    and cliente_id = (select public.auth_cliente_id())
    and nivel <> 'superadmin'
  )
);

create policy usuarios_update_admin
on public.usuarios
for update
to authenticated
using (
  (select public.auth_nivel()) = 'superadmin'
  or (
    (select public.auth_nivel()) = 'admin'
    and cliente_id = (select public.auth_cliente_id())
    and nivel <> 'superadmin'
  )
)
with check (
  (select public.auth_nivel()) = 'superadmin'
  or (
    (select public.auth_nivel()) = 'admin'
    and cliente_id = (select public.auth_cliente_id())
    and nivel <> 'superadmin'
  )
);

create policy usuarios_delete_admin
on public.usuarios
for delete
to authenticated
using (
  (select public.auth_nivel()) = 'superadmin'
  or (
    (select public.auth_nivel()) = 'admin'
    and cliente_id = (select public.auth_cliente_id())
    and nivel <> 'superadmin'
  )
);

alter table public.usuarios
  add constraint usuarios_nivel_valido
  check (nivel in ('operador', 'gerente', 'admin', 'superadmin'));

alter table public.usuarios
  add constraint usuarios_escopo_valido
  check (
    (nivel = 'superadmin' and cliente_id is null)
    or (nivel <> 'superadmin' and cliente_id is not null)
  );

