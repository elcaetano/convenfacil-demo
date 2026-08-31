-- As colunas antigas eram timestamp sem fuso, mas os valores foram gravados
-- pelo banco em UTC. Converte os registros preservando o instante real para
-- que recibos e relatorios sejam exibidos no horario local do estabelecimento.
alter table public.vendas
  alter column criado_em type timestamptz
  using criado_em at time zone 'UTC';

alter table public.reposicoes_estoque
  alter column criado_em type timestamptz
  using criado_em at time zone 'UTC';

comment on column public.vendas.criado_em is
  'Instante da venda armazenado com fuso; a interface exibe no horario local do estabelecimento.';

comment on column public.reposicoes_estoque.criado_em is
  'Instante da reposicao armazenado com fuso; a interface exibe no horario local do estabelecimento.';
