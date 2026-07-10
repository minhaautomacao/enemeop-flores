-- ============================================================================
-- PROPOSTA DE SEGURANCA — NAO APLICADA
-- ============================================================================
-- Este arquivo e uma PROPOSTA. Nao foi executada em nenhum ambiente.
-- Depende de revisao humana antes de qualquer aplicacao.
-- NAO ESTA PRONTA PARA PRODUCAO SEM VALIDACAO.
--
-- Contexto completo: docs/RLS_SECURITY_PLAN.md e docs/SECURITY_INCIDENTS.md
-- (Incidente 7 — RLS desabilitado em workspace_credentials, conversas,
-- qr_temp, funcao_configs no projeto Supabase gftnjvdvzgjkhwxnxnwl).
--
-- Para aplicar (depois de revisar e testar em ambiente de staging, se
-- houver um; caso contrario, aplicar fora de horario de pico e monitorar
-- logs das Edge Functions imediatamente depois):
--   supabase db push   (ou colar no SQL Editor do painel Supabase)
--
-- Ordem segura de aplicacao: as 4 tabelas sao independentes entre si,
-- podem ser aplicadas em qualquer ordem ou todas juntas nesta transacao.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. workspace_credentials
-- ----------------------------------------------------------------------------
-- Objetivo: bloquear anon e usuario comum; permitir somente backend com
-- service_role. Nenhum consumidor de frontend/cliente final encontrado no
-- codigo (confirmado: unico consumidor e supabase/functions/_shared/credentials.ts,
-- que ja usa a service_role_key). service_role sempre ignora RLS no Supabase,
-- entao nao precisa de policy explicita para funcionar.

alter table public.workspace_credentials enable row level security;

-- Nenhuma policy para anon/authenticated de proposito — nega tudo por
-- padrao a esses dois roles. Se no futuro um caso de uso legitimo de
-- frontend precisar ler workspace_credentials (nao deveria — blobs
-- criptografados nao tem uso para o cliente final), criar policy
-- especifica e explicita, nunca abrir para authenticated em geral.

-- Query de validacao (rodar com a anon key, deve retornar 0 linhas ou erro):
--   select * from workspace_credentials limit 1;


-- ----------------------------------------------------------------------------
-- 2. conversas
-- ----------------------------------------------------------------------------
-- Objetivo pedido: bloquear anon; permitir service_role; permitir usuario
-- autenticado somente quando houver vinculo valido com o workspace da
-- conversa.
--
-- DEPENDENCIA NAO SATISFEITA: nao existe hoje um modelo de
-- usuario-por-workspace (sem tabela user_workspaces/workspace_members,
-- sem claim de workspace no JWT do Supabase Auth — confirmado por busca
-- no codigo dos dois repositorios). Por isso a policy de "authenticated
-- com vinculo" abaixo fica COMENTADA. Ate esse modelo existir, conversas
-- fica restrita a service_role, igual workspace_credentials — mais
-- restritivo que o pedido original, mas seguro.
--
-- O dashboard (app/(dashboard)/dashboard/conversas/page.tsx) le via a
-- Edge Function `conversas-enemeop`, que roda com service_role — nao
-- deveria ser afetado por esta mudanca. Testar antes de aplicar em
-- producao (ver docs/RLS_SECURITY_PLAN.md, secao de testes).

alter table public.conversas enable row level security;

-- Policy futura, DEPENDE do modelo de usuario-por-workspace existir.
-- Deixada comentada de proposito — nao criar workspace_members aqui,
-- isso e fora do escopo desta migration.
--
-- create table if not exists public.workspace_members (
--   user_id uuid references auth.users(id),
--   workspace_id text references public.workspaces(id),
--   primary key (user_id, workspace_id)
-- );
--
-- create policy "Usuarios autenticados leem conversas do proprio workspace"
--   on public.conversas for select
--   using (
--     exists (
--       select 1 from public.workspace_members wm
--       where wm.user_id = auth.uid()
--         and wm.workspace_id = conversas.workspace_id
--     )
--   );

-- Query de validacao (anon key, deve retornar 0 linhas ou erro):
--   select * from conversas limit 1;


-- ----------------------------------------------------------------------------
-- 3. qr_temp
-- ----------------------------------------------------------------------------
-- Objetivo: nenhuma referencia a esta tabela foi encontrada em nenhum dos
-- dois repositorios Git. Provavel consumidor: Edge Function `captura-qr`,
-- cujo codigo-fonte NAO esta versionado em nenhum lugar (ver
-- docs/INFRASTRUCTURE_MAP.md). Proposta: service_role only, por ser dado
-- de sessao tecnica sem caso de uso legitimo de acesso direto por usuario
-- final ou frontend.
--
-- RISCO REGISTRADO: se `captura-qr` (ou outro consumidor nao identificado)
-- usar a anon key internamente em vez de service_role, esta policy quebra
-- esse fluxo. Recomendacao: recuperar o codigo-fonte de `captura-qr`
-- (supabase functions download ou copia do painel) ANTES de aplicar esta
-- parte em producao.

alter table public.qr_temp enable row level security;

-- Nenhuma policy para anon/authenticated — mesma logica das tabelas acima.

-- Query de validacao (anon key, deve retornar 0 linhas ou erro):
--   select * from qr_temp limit 1;


-- ----------------------------------------------------------------------------
-- 4. funcao_configs
-- ----------------------------------------------------------------------------
-- Confirmado no codigo: leitura somente, somente via service_role, em
-- supabase/functions/_shared/instagram.ts, _shared/anthropic.ts,
-- webhook-whatsapp/index.ts, webhook-meta/index.ts. Nenhuma escrita
-- encontrada no codigo (insercao parece manual via Supabase Studio).
-- Proposta: service_role only para leitura e escrita.

alter table public.funcao_configs enable row level security;

-- Nenhuma policy para anon/authenticated.

-- Query de validacao (anon key, deve retornar 0 linhas ou erro):
--   select * from funcao_configs limit 1;


commit;

-- ============================================================================
-- ROLLBACK (reverter esta migration inteira)
-- ============================================================================
-- begin;
-- alter table public.workspace_credentials disable row level security;
-- alter table public.conversas disable row level security;
-- alter table public.qr_temp disable row level security;
-- alter table public.funcao_configs disable row level security;
-- commit;

-- ============================================================================
-- RISCOS DESTA MIGRATION
-- ============================================================================
-- 1. Se qualquer Edge Function consultar uma destas 4 tabelas usando a
--    anon key (client Supabase criado com NEXT_PUBLIC_SUPABASE_ANON_KEY em
--    vez de SUPABASE_SERVICE_ROLE_KEY), essa chamada passa a falhar apos
--    esta migration. Confirmado no codigo atual que isso NAO acontece para
--    workspace_credentials, conversas e funcao_configs. NAO confirmado
--    para qr_temp (codigo-fonte do consumidor provavel nao encontrado).
-- 2. Nenhum dado e apagado ou alterado por esta migration — apenas a
--    politica de acesso muda.
-- 3. Esta migration NAO cria a tabela/modelo de workspace_members — a
--    policy de "authenticated com vinculo a workspace" para `conversas`
--    fica pendente de um projeto separado.
