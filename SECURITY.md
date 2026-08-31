# Segurança e isolamento de dados

## Modelo esperado

O usuário entra com e-mail e senha pelo Supabase Auth. O registro correspondente em `public.usuarios` define nome, nível e `cliente_id`.

O isolamento entre lojas deve ser aplicado no banco de dados. O JavaScript pode filtrar consultas para melhorar a experiência, mas um usuário não pode ganhar acesso apenas retirando esse filtro no navegador.

## Itens que precisam ser confirmados no Supabase

- RLS habilitada em todas as tabelas expostas.
- Políticas de leitura e alteração vinculadas ao usuário autenticado e ao `cliente_id` autorizado.
- Políticas de atualização com `USING` e `WITH CHECK`.
- Registro de `usuarios.id` vinculado a `auth.users.id`.
- Nível administrativo protegido no banco, sem depender de metadados editáveis pelo usuário.
- Funções e views revisadas quanto a `SECURITY DEFINER` e `security_invoker`.
- Edge Function `admin-users` validando JWT, nível e empresa antes de usar privilégios administrativos.
- Chave `service_role` disponível apenas nos segredos da Edge Function.
- Prazo máximo de sessão definido e compatível com o encerramento por inatividade no cliente.

## Auditoria de 31/08/2026

Confirmado no projeto Supabase NinjAI Core:

- RLS ativa nas tabelas operacionais do ConvenFácil.
- Isolamento das tabelas operacionais baseado em cliente_id presente.
- Leitura anônima de leads removida; o envio anônimo permanece permitido.
- Políticas de usuarios separadas por operação e limitadas a administrador ou Master.
- Restrições de nível e vínculo de loja adicionadas à tabela usuarios.
- Funções apontadas pelo auditor receberam search_path fixo.
- Platform, Module e PlatformModule receberam RLS como defesa adicional.
- Edge Function admin-users publicada na versão 3 com JWT obrigatório.
- Criação de superadmin por administrador de loja bloqueada no servidor.

Pendências conhecidas:

- _prisma_migrations continua sem RLS porque pertence a outro papel do banco. Ela não concede acesso a anon ou authenticated.
- Proteção contra senhas vazadas precisa ser habilitada nas configurações do Supabase Auth.
- As autorizações das demais tabelas operacionais ainda precisam ser refinadas por nível. Hoje o banco garante isolamento por loja, mas várias permissões funcionais continuam amplas dentro da mesma loja.

## Teste obrigatório de isolamento

1. Criar ou selecionar duas empresas de teste, A e B.
2. Entrar como usuário comum da empresa A.
3. Tentar consultar, alterar e excluir registros da empresa B por requisição direta.
4. Repetir os testes para todas as tabelas operacionais.
5. Confirmar que as operações retornam nenhum registro ou erro de autorização.
6. Repetir com operador, gerente e administrador.

Não testar com dados reais de clientes quando registros de demonstração forem suficientes.
