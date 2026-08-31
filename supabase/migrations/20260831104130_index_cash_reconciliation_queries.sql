create index if not exists movimentos_caixa_turno_id_idx
  on public.movimentos_caixa (turno_id);

create index if not exists turnos_caixa_cliente_status_aberto_em_idx
  on public.turnos_caixa (cliente_id, status, aberto_em desc);
