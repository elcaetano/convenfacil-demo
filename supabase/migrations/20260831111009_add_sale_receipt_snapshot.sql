alter table public.vendas
  add column if not exists cpf_consumidor text,
  add column if not exists usuario_nome text,
  add column if not exists valor_recebido numeric,
  add column if not exists troco numeric;

alter table public.itens_venda
  add column if not exists produto_nome text,
  add column if not exists preco_original numeric;

comment on column public.vendas.cpf_consumidor is
  'CPF opcional informado pelo consumidor para exibicao no recibo.';
comment on column public.vendas.usuario_nome is
  'Nome do operador no momento da venda, preservado para auditoria e reimpressao.';
comment on column public.vendas.valor_recebido is
  'Valor entregue pelo consumidor em pagamentos em dinheiro.';
comment on column public.vendas.troco is
  'Troco calculado no momento da venda em dinheiro.';
comment on column public.itens_venda.produto_nome is
  'Nome do produto no momento da venda, preservado para reimpressao.';
comment on column public.itens_venda.preco_original is
  'Preco unitario antes de descontos ou promocoes no momento da venda.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vendas_valor_recebido_nonnegative'
      and conrelid = 'public.vendas'::regclass
  ) then
    alter table public.vendas
      add constraint vendas_valor_recebido_nonnegative
      check (valor_recebido is null or valor_recebido >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'vendas_troco_nonnegative'
      and conrelid = 'public.vendas'::regclass
  ) then
    alter table public.vendas
      add constraint vendas_troco_nonnegative
      check (troco is null or troco >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'itens_venda_preco_original_nonnegative'
      and conrelid = 'public.itens_venda'::regclass
  ) then
    alter table public.itens_venda
      add constraint itens_venda_preco_original_nonnegative
      check (preco_original is null or preco_original >= 0);
  end if;
end
$$;

create index if not exists itens_venda_venda_id_idx
  on public.itens_venda (venda_id);
