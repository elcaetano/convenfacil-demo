alter table public.movimentos_caixa
  add column if not exists recebedor_nome text;

comment on column public.movimentos_caixa.recebedor_nome is
  'Nome de quem recebeu o dinheiro retirado em uma sangria.';

alter table public.turnos_caixa
  add column if not exists total_vendas_dinheiro numeric not null default 0,
  add column if not exists total_mesas_dinheiro numeric not null default 0,
  add column if not exists total_suprimentos numeric not null default 0,
  add column if not exists total_sangrias numeric not null default 0;

comment on column public.turnos_caixa.total_vendas_dinheiro is
  'Total das vendas do PDV recebidas em dinheiro durante o turno.';
comment on column public.turnos_caixa.total_mesas_dinheiro is
  'Total das mesas recebidas em dinheiro durante o turno.';
comment on column public.turnos_caixa.total_suprimentos is
  'Total de entradas manuais de dinheiro durante o turno.';
comment on column public.turnos_caixa.total_sangrias is
  'Total de retiradas manuais de dinheiro durante o turno.';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'movimentos_caixa_sangria_recebedor_check'
       and conrelid = 'public.movimentos_caixa'::regclass
  ) then
    alter table public.movimentos_caixa
      add constraint movimentos_caixa_sangria_recebedor_check
      check (
        tipo <> 'sangria'
        or nullif(btrim(recebedor_nome), '') is not null
      ) not valid;
  end if;
end
$$;
