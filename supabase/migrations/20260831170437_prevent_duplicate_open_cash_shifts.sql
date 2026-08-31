-- Mantem o primeiro turno aberto de cada loja e encerra apenas as aberturas
-- duplicadas criadas pelo erro de restauracao do navegador.
with turnos_duplicados as (
  select
    id,
    row_number() over (
      partition by coalesce(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid)
      order by aberto_em asc, id asc
    ) as ordem
  from public.turnos_caixa
  where status = 'aberto'
)
update public.turnos_caixa as turno
set
  status = 'cancelado',
  fechado_em = coalesce(turno.fechado_em, now()),
  usuario_fechamento = coalesce(turno.usuario_fechamento, 'Sistema'),
  observacao = concat_ws(
    ' ',
    nullif(btrim(turno.observacao), ''),
    'Abertura duplicada encerrada automaticamente na correcao de continuidade do caixa.'
  )
from turnos_duplicados as duplicado
where turno.id = duplicado.id
  and duplicado.ordem > 1;

-- O modelo atual possui um caixa por loja. A restricao tambem cobre o caixa de
-- demonstracao do Master, cujo cliente_id e nulo.
create unique index if not exists turnos_caixa_um_aberto_por_cliente_idx
  on public.turnos_caixa (
    coalesce(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'aberto';
