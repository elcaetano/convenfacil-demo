create table public.whatsapp_contatos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text not null unique,
  categoria text not null default 'prospect',
  cliente_id uuid references public.clientes(id) on delete set null,
  notas text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.whatsapp_pendencias (
  id uuid primary key default gen_random_uuid(),
  contato_id uuid not null references public.whatsapp_contatos(id) on delete cascade,
  descricao text not null,
  prazo date,
  status text not null default 'aberta',
  criado_em timestamptz not null default now()
);

create table public.whatsapp_mensagens (
  id uuid primary key default gen_random_uuid(),
  contato_id uuid references public.whatsapp_contatos(id) on delete set null,
  telefone text not null,
  direcao text not null,
  conteudo text,
  tipo text not null default 'texto',
  wa_message_id text,
  status text not null default 'recebida',
  criado_em timestamptz not null default now()
);

create index whatsapp_pendencias_contato_idx on public.whatsapp_pendencias(contato_id);
create index whatsapp_pendencias_prazo_idx on public.whatsapp_pendencias(prazo) where status = 'aberta';
create index whatsapp_mensagens_contato_idx on public.whatsapp_mensagens(contato_id);
create index whatsapp_mensagens_telefone_idx on public.whatsapp_mensagens(telefone);

alter table public.whatsapp_contatos enable row level security;
alter table public.whatsapp_pendencias enable row level security;
alter table public.whatsapp_mensagens enable row level security;

create policy whatsapp_contatos_platform_admin on public.whatsapp_contatos
  for all
  using (coalesce((auth.jwt() -> 'app_metadata' ->> 'nivel'), '') = 'superadmin')
  with check (coalesce((auth.jwt() -> 'app_metadata' ->> 'nivel'), '') = 'superadmin');

create policy whatsapp_pendencias_platform_admin on public.whatsapp_pendencias
  for all
  using (coalesce((auth.jwt() -> 'app_metadata' ->> 'nivel'), '') = 'superadmin')
  with check (coalesce((auth.jwt() -> 'app_metadata' ->> 'nivel'), '') = 'superadmin');

create policy whatsapp_mensagens_platform_admin on public.whatsapp_mensagens
  for all
  using (coalesce((auth.jwt() -> 'app_metadata' ->> 'nivel'), '') = 'superadmin')
  with check (coalesce((auth.jwt() -> 'app_metadata' ->> 'nivel'), '') = 'superadmin');
