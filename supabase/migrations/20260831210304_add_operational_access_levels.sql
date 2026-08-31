alter table public.usuarios
  drop constraint if exists usuarios_nivel_valido;

alter table public.usuarios
  add constraint usuarios_nivel_valido
  check (nivel in ('operador', 'garcom', 'cozinha', 'bar', 'gerente', 'admin', 'superadmin'));

alter table public.usuarios
  add column if not exists comissao_percentual numeric(5,2) not null default 0
  check (comissao_percentual between 0 and 100);

alter table public.comandas
  add column if not exists garcom_abertura_usuario_id uuid references public.usuarios(id) on delete set null;

alter table public.comandas
  add column if not exists couvert_por_pessoa numeric(12,2) not null default 0 check (couvert_por_pessoa >= 0),
  add column if not exists couvert_total numeric(12,2) not null default 0 check (couvert_total >= 0),
  add column if not exists valor_consumo numeric(12,2) not null default 0 check (valor_consumo >= 0);

update public.comandas
set valor_consumo = greatest(coalesce(valor_total, 0) - couvert_total, 0)
where status = 'fechada'
  and valor_consumo = 0
  and coalesce(valor_total, 0) > 0;

alter table public.itens_comanda
  add column if not exists lancado_por_usuario_id uuid references public.usuarios(id) on delete set null;

alter table public.itens_comanda
  add column if not exists comissao_percentual numeric(5,2) not null default 0
  check (comissao_percentual between 0 and 100);

create table if not exists public.comissoes_garcom (
  id uuid primary key default gen_random_uuid(),
  comanda_id uuid not null references public.comandas(id) on delete restrict,
  usuario_id uuid references public.usuarios(id) on delete set null,
  garcom_nome text not null,
  base_calculo numeric(12,2) not null default 0 check (base_calculo >= 0),
  percentual numeric(5,2) not null default 0 check (percentual between 0 and 100),
  valor numeric(12,2) not null default 0 check (valor >= 0),
  cliente_id uuid,
  criado_em timestamptz not null default now(),
  unique (comanda_id, usuario_id)
);

alter table public.comissoes_garcom enable row level security;
grant select, insert, update on public.comissoes_garcom to authenticated;

create index if not exists comandas_garcom_abertura_usuario_idx
  on public.comandas (garcom_abertura_usuario_id);

create index if not exists itens_comanda_lancado_por_usuario_idx
  on public.itens_comanda (lancado_por_usuario_id);

create index if not exists comissoes_garcom_cliente_criado_idx
  on public.comissoes_garcom (cliente_id, criado_em desc);

comment on column public.comandas.garcom_abertura_usuario_id is
  'Usuario que abriu a mesa; o nome em garcom_abertura permanece como historico legivel.';

comment on column public.itens_comanda.lancado_por_usuario_id is
  'Usuario que enviou o item; o nome em lancado_por permanece como historico legivel.';

-- Os perfis operacionais enxergam somente o necessario para executar seu trabalho.
-- Os perfis administrativos e de caixa preservam o comportamento atual.
do $$
declare
  tabela text;
begin
  foreach tabela in array array[
    'categorias','clientes_fiado','comandas','contas_pagar','contas_receber','excecoes',
    'comissoes_garcom','funcionalidades','itens_comanda','itens_venda','mesas','movimentos_caixa','produtos',
    'promocoes','reposicoes_estoque','turnos_caixa','vendas'
  ] loop
    execute format('drop policy if exists tenant_isolation on public.%I', tabela);
    execute format(
      'create policy tenant_isolation on public.%I for all using (((select public.auth_nivel()) = ''superadmin'') or (cliente_id = (select public.auth_cliente_id()) and (select public.auth_nivel()) not in (''garcom'',''cozinha'',''bar''))) with check (((select public.auth_nivel()) = ''superadmin'') or (cliente_id = (select public.auth_cliente_id()) and (select public.auth_nivel()) not in (''garcom'',''cozinha'',''bar'')))',
      tabela
    );
  end loop;
end
$$;

create policy funcionalidades_operacionais_leitura
on public.funcionalidades for select to authenticated
using (
  cliente_id = (select public.auth_cliente_id())
  and (select public.auth_nivel()) in ('garcom','cozinha','bar')
);

create policy catalogo_garcom_leitura
on public.produtos for select to authenticated
using (
  cliente_id = (select public.auth_cliente_id())
  and (select public.auth_nivel()) = 'garcom'
);

create policy categorias_garcom_leitura
on public.categorias for select to authenticated
using (
  cliente_id = (select public.auth_cliente_id())
  and (select public.auth_nivel()) = 'garcom'
);

create policy promocoes_garcom_leitura
on public.promocoes for select to authenticated
using (
  cliente_id = (select public.auth_cliente_id())
  and (select public.auth_nivel()) = 'garcom'
);

create policy mesas_garcom_leitura
on public.mesas for select to authenticated
using (
  cliente_id = (select public.auth_cliente_id())
  and (select public.auth_nivel()) = 'garcom'
);

create policy mesas_garcom_atualizacao
on public.mesas for update to authenticated
using (
  cliente_id = (select public.auth_cliente_id())
  and (select public.auth_nivel()) = 'garcom'
)
with check (
  cliente_id = (select public.auth_cliente_id())
  and (select public.auth_nivel()) = 'garcom'
);

create policy comandas_garcom_leitura
on public.comandas for select to authenticated
using (
  cliente_id = (select public.auth_cliente_id())
  and (select public.auth_nivel()) = 'garcom'
);

create policy comandas_garcom_inclusao
on public.comandas for insert to authenticated
with check (
  cliente_id = (select public.auth_cliente_id())
  and (select public.auth_nivel()) = 'garcom'
  and garcom_abertura_usuario_id = (select auth.uid())
);

create policy comandas_preparo_leitura
on public.comandas for select to authenticated
using (
  cliente_id = (select public.auth_cliente_id())
  and status = 'aberta'
  and (select public.auth_nivel()) in ('cozinha','bar')
);

create policy itens_garcom_leitura
on public.itens_comanda for select to authenticated
using (
  cliente_id = (select public.auth_cliente_id())
  and (select public.auth_nivel()) = 'garcom'
);

create policy itens_garcom_inclusao
on public.itens_comanda for insert to authenticated
with check (
  cliente_id = (select public.auth_cliente_id())
  and (select public.auth_nivel()) = 'garcom'
  and lancado_por_usuario_id = (select auth.uid())
);

create policy itens_garcom_atualizacao
on public.itens_comanda for update to authenticated
using (
  cliente_id = (select public.auth_cliente_id())
  and (select public.auth_nivel()) = 'garcom'
)
with check (
  cliente_id = (select public.auth_cliente_id())
  and (select public.auth_nivel()) = 'garcom'
);

create policy itens_preparo_leitura
on public.itens_comanda for select to authenticated
using (
  cliente_id = (select public.auth_cliente_id())
  and destino_preparo = (select public.auth_nivel())
  and (select public.auth_nivel()) in ('cozinha','bar')
);

create policy itens_preparo_atualizacao
on public.itens_comanda for update to authenticated
using (
  cliente_id = (select public.auth_cliente_id())
  and destino_preparo = (select public.auth_nivel())
  and (select public.auth_nivel()) in ('cozinha','bar')
)
with check (
  cliente_id = (select public.auth_cliente_id())
  and destino_preparo = (select public.auth_nivel())
  and (select public.auth_nivel()) in ('cozinha','bar')
);

create or replace function public.proteger_item_em_preparo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  nivel text := public.auth_nivel();
begin
  if nivel in ('cozinha','bar') then
    if old.destino_preparo <> nivel or new.destino_preparo <> nivel then
      raise exception 'Item fora do setor de preparo';
    end if;
    if (to_jsonb(new) - 'status') <> (to_jsonb(old) - 'status') then
      raise exception 'O setor de preparo pode alterar somente o status do item';
    end if;
    if not (
      (old.status = 'em_preparo' and new.status in ('em_preparo','pronto'))
      or (old.status = 'pronto' and new.status in ('pronto','entregue'))
    ) then
      raise exception 'Mudanca de status nao permitida';
    end if;
  elsif nivel = 'garcom' then
    if (to_jsonb(new) - array['status','cancelado_motivo','cancelado_por','cancelado_em','impresso'])
       <> (to_jsonb(old) - array['status','cancelado_motivo','cancelado_por','cancelado_em','impresso']) then
      raise exception 'O garcom nao pode alterar os dados originais do item';
    end if;
    if new.status <> old.status and new.status <> 'cancelado' then
      raise exception 'O garcom pode somente cancelar o item';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists proteger_item_em_preparo_trigger on public.itens_comanda;
create trigger proteger_item_em_preparo_trigger
before update on public.itens_comanda
for each row execute function public.proteger_item_em_preparo();

create or replace function public.preencher_identidade_lancamento_garcom()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  perfil record;
begin
  if public.auth_nivel() = 'garcom' then
    select nome, comissao_percentual
      into perfil
      from public.usuarios
     where id = auth.uid()
       and ativo is true;
    if not found then raise exception 'Perfil de garcom invalido'; end if;
    new.lancado_por_usuario_id := auth.uid();
    new.lancado_por := perfil.nome;
    new.comissao_percentual := perfil.comissao_percentual;
    new.origem := 'garcom';
  end if;
  return new;
end
$$;

drop trigger if exists preencher_identidade_lancamento_garcom_trigger on public.itens_comanda;
create trigger preencher_identidade_lancamento_garcom_trigger
before insert on public.itens_comanda
for each row execute function public.preencher_identidade_lancamento_garcom();

create or replace function public.preencher_identidade_abertura_garcom()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  nome_garcom text;
begin
  new.pessoas := greatest(coalesce(new.pessoas, 1), 1);
  new.couvert_por_pessoa := greatest(coalesce(new.couvert_por_pessoa, 0), 0);
  new.couvert_total := round(new.couvert_por_pessoa * new.pessoas, 2);
  if public.auth_nivel() = 'garcom' then
    select nome into nome_garcom
      from public.usuarios
     where id = auth.uid()
       and ativo is true;
    if not found then raise exception 'Perfil de garcom invalido'; end if;
    new.garcom_abertura_usuario_id := auth.uid();
    new.garcom_abertura := nome_garcom;
  end if;
  return new;
end
$$;

drop trigger if exists preencher_identidade_abertura_garcom_trigger on public.comandas;
create trigger preencher_identidade_abertura_garcom_trigger
before insert on public.comandas
for each row execute function public.preencher_identidade_abertura_garcom();

create or replace function public.proteger_mesa_garcom()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.auth_nivel() = 'garcom' then
    if (to_jsonb(new) - array['status','garcom_nome','comanda_atual_id','aberta_em'])
       <> (to_jsonb(old) - array['status','garcom_nome','comanda_atual_id','aberta_em']) then
      raise exception 'O garcom nao pode alterar o cadastro da mesa';
    end if;
    if old.status = 'livre' then
      if new.status <> 'ocupada' or new.comanda_atual_id is null then
        raise exception 'A mesa deve ser aberta com uma comanda';
      end if;
    elsif new.status not in ('ocupada','conta_solicitada')
       or new.comanda_atual_id is distinct from old.comanda_atual_id then
      raise exception 'Mudanca de mesa nao permitida para o garcom';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists proteger_mesa_garcom_trigger on public.mesas;
create trigger proteger_mesa_garcom_trigger
before update on public.mesas
for each row execute function public.proteger_mesa_garcom();

drop policy if exists usuarios_select_tenant on public.usuarios;
create policy usuarios_select_tenant
on public.usuarios for select to authenticated
using (
  (select public.auth_nivel()) = 'superadmin'
  or (
    cliente_id = (select public.auth_cliente_id())
    and (
      (select public.auth_nivel()) in ('admin','gerente')
      or id = (select auth.uid())
    )
  )
);
