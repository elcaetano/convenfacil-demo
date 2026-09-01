alter table public.clientes
  add column if not exists tipo_negocio text not null default 'conveniencia',
  add column if not exists valor_mensal numeric(12,2) not null default 149.00,
  add column if not exists dia_vencimento smallint not null default 10,
  add column if not exists ultimo_pagamento_em timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clientes'::regclass
      and conname = 'clientes_valor_mensal_nonnegative'
  ) then
    alter table public.clientes
      add constraint clientes_valor_mensal_nonnegative check (valor_mensal >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clientes'::regclass
      and conname = 'clientes_dia_vencimento_range'
  ) then
    alter table public.clientes
      add constraint clientes_dia_vencimento_range check (dia_vencimento between 1 and 28);
  end if;
end
$$;

create table if not exists public.cobrancas_clientes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  competencia date not null,
  vencimento date not null,
  valor numeric(12,2) not null check (valor >= 0),
  valor_pago numeric(12,2) check (valor_pago >= 0),
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'cancelado')),
  pago_em timestamptz,
  forma_pagamento text,
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (cliente_id, competencia)
);

create index if not exists cobrancas_clientes_cliente_vencimento_idx
  on public.cobrancas_clientes (cliente_id, vencimento desc);

create index if not exists cobrancas_clientes_status_vencimento_idx
  on public.cobrancas_clientes (status, vencimento);

alter table public.cobrancas_clientes enable row level security;

drop policy if exists cobrancas_clientes_master_only on public.cobrancas_clientes;
create policy cobrancas_clientes_master_only
  on public.cobrancas_clientes
  for all
  to authenticated
  using ((select public.auth_nivel()) = 'superadmin')
  with check ((select public.auth_nivel()) = 'superadmin');

grant select, insert, update, delete on public.cobrancas_clientes to authenticated;
revoke all on public.cobrancas_clientes from anon;
