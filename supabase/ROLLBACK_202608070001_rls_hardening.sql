-- Rollback de 202608070001_rls_hardening.sql
--
-- ATENÇÃO: reverter isto volta a expor workspace_credentials (guarda
-- credenciais reais de MP/Lalamove/Z-API), funcao_configs, qr_temp,
-- mercadopago_eventos e pedidos_estorno_eventos publicamente via
-- PostgREST para qualquer requisição anon. Só reverter se uma dessas
-- tabelas passar a precisar de acesso legítimo via anon/authenticated
-- e a política correta ainda não estiver pronta — nunca como forma de
-- "destravar" um erro sem investigar a causa raiz primeiro.
--
-- Antes de reverter, confirmar que não há nenhuma política dependente
-- destas tabelas que ficaria órfã (não deveria haver, já que a
-- migration original não criou nenhuma):
--   select schemaname, tablename, policyname
--   from pg_policies
--   where tablename in ('workspace_credentials', 'funcao_configs', 'qr_temp',
--                        'mercadopago_eventos', 'pedidos_estorno_eventos');

alter table public.workspace_credentials disable row level security;
alter table public.funcao_configs disable row level security;
alter table public.qr_temp disable row level security;
alter table public.mercadopago_eventos disable row level security;
alter table public.pedidos_estorno_eventos disable row level security;
