alter table public.itens_comanda
  add column if not exists destino_preparo text not null default 'balcao';

alter table public.categorias
  add column if not exists destino_preparo text not null default 'balcao';

comment on column public.itens_comanda.destino_preparo is
  'Destino operacional congelado no lancamento: cozinha, bar ou balcao.';

comment on column public.categorias.destino_preparo is
  'Setor que recebe os produtos desta categoria: cozinha, bar ou balcao.';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'itens_comanda_destino_preparo_check'
       and conrelid = 'public.itens_comanda'::regclass
  ) then
    alter table public.itens_comanda
      add constraint itens_comanda_destino_preparo_check
      check (destino_preparo in ('cozinha', 'bar', 'balcao')) not valid;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'categorias_destino_preparo_check'
       and conrelid = 'public.categorias'::regclass
  ) then
    alter table public.categorias
      add constraint categorias_destino_preparo_check
      check (destino_preparo in ('cozinha', 'bar', 'balcao')) not valid;
  end if;
end
$$;

-- Disponibiliza as duas categorias operacionais para cada loja que ja possui produtos.
with lojas as (
  select distinct cliente_id from public.produtos
), destinos(nome) as (
  values ('Cozinha'), ('Bar')
)
insert into public.categorias (nome, destino_preparo, cliente_id)
select destinos.nome, lower(destinos.nome), lojas.cliente_id
from lojas
cross join destinos
where not exists (
  select 1
  from public.categorias categoria
  where lower(categoria.nome) = lower(destinos.nome)
    and categoria.cliente_id is not distinct from lojas.cliente_id
);

-- Jantinhas vao para a categoria Cozinha. Categorias de bebidas vao para o Bar.
update public.produtos
set categoria = 'Cozinha'
where nome ilike '%jantinha%';

update public.categorias
set destino_preparo = case
  when lower(nome) = 'cozinha' then 'cozinha'
  when lower(nome) in ('bebidas', 'energeticos', 'energéticos', 'refrigerante', 'refrigerantes', 'bar') then 'bar'
  else destino_preparo
end;

-- Preserva o destino nos itens antigos com base no cadastro atual do produto.
update public.itens_comanda item
set destino_preparo = coalesce(categoria.destino_preparo, 'balcao')
from public.produtos produto
left join public.categorias categoria
  on lower(categoria.nome) = lower(produto.categoria)
 and categoria.cliente_id is not distinct from produto.cliente_id
where produto.id = item.produto_id;

-- Itens de mesas ja fechadas e itens de balcao nao devem continuar nos paineis.
update public.itens_comanda item
set status = 'entregue'
where item.status in ('em_preparo', 'pronto')
  and (
    item.destino_preparo = 'balcao'
    or not exists (
      select 1
      from public.comandas comanda
      where comanda.id = item.comanda_id
        and comanda.status = 'aberta'
    )
  );

create index if not exists itens_comanda_destino_status_lancado_idx
  on public.itens_comanda (cliente_id, destino_preparo, status, lancado_em);

create or replace function public.direcionar_item_comanda()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  destino text;
begin
  select categoria.destino_preparo
    into destino
    from public.produtos produto
    left join public.categorias categoria
      on lower(categoria.nome) = lower(produto.categoria)
     and categoria.cliente_id is not distinct from produto.cliente_id
   where produto.id = new.produto_id;

  new.destino_preparo := coalesce(destino, 'balcao');
  new.status := case when new.destino_preparo = 'balcao' then 'entregue' else 'em_preparo' end;
  new.impresso := new.destino_preparo <> 'cozinha';
  return new;
end
$$;

drop trigger if exists direcionar_item_comanda_trigger on public.itens_comanda;
create trigger direcionar_item_comanda_trigger
before insert on public.itens_comanda
for each row execute function public.direcionar_item_comanda();

alter table public.itens_comanda
  validate constraint itens_comanda_destino_preparo_check;

alter table public.categorias
  validate constraint categorias_destino_preparo_check;
