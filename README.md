# ConvenFácil App

Sistema PDV publicado em `https://app.convenfacil.com.br`.

## Estrutura

- `index.html`: estrutura das telas e componentes.
- `styles.css`: estilos globais e responsivos.
- `app.js`: autenticação, regras de interface e integração com Supabase.

O sistema é uma aplicação web estática publicada pela Vercel. Os dados, a autenticação e a Edge Function administrativa são fornecidos pelo Supabase.

## Serviços relacionados

- Landing page: `https://www.convenfacil.com.br`
- Sistema: `https://app.convenfacil.com.br`
- Projeto Vercel do sistema: `convenfacil-demo`
- Repositório da landing page: `elcaetano/convenfacil`
- Repositório do sistema: `elcaetano/convenfacil-demo`
- Supabase: projeto identificado no cliente web como `jkantpfxudbqzrtrctgp`
- Edge Function administrativa: `admin-users`

## Executar localmente

Use um servidor HTTP local na raiz do projeto. Exemplo com Python:

```powershell
python -m http.server 4173
```

Depois acesse `http://localhost:4173`.

## Segurança

- A chave presente no navegador deve ser somente publicável.
- Nunca incluir chave `service_role`, senha ou token administrativo no repositório.
- O filtro de `cliente_id` no JavaScript não é uma barreira de segurança.
- Todas as tabelas expostas precisam de RLS e políticas que validem o usuário autenticado e sua empresa.
- A Edge Function `admin-users` deve validar o JWT e a permissão no servidor.
- A sessão do navegador é encerrada após 30 minutos de inatividade.

Consulte `SECURITY.md` antes de alterar autenticação, usuários ou banco de dados.

## Publicação

Antes de publicar:

1. Revisar `git diff` e garantir que não há credenciais secretas.
2. Testar login, logout, inatividade e isolamento entre empresas.
3. Verificar as larguras de 360, 768, 1024 e 1440 pixels.
4. Confirmar que o domínio de produção continua ligado ao projeto correto da Vercel.
5. Publicar primeiro como Preview e validar o fluxo completo.

