-- Habilita RLS nas 5 tabelas que o advisor de segurança do Supabase
-- reportava como ERROR (rls_disabled_in_public): workspace_credentials,
-- funcao_configs, qr_temp, mercadopago_eventos, pedidos_estorno_eventos.
--
-- Levantamento feito antes desta migration (agente Explore, varredura
-- completa de supabase/functions/**, app/**, components/**, lib/**,
-- orchestrator/src/**): NENHUMA dessas 5 tabelas é acessada em nenhum
-- lugar por um cliente Supabase com a chave anon/pública — todo acesso
-- (em 100% dos call sites encontrados) usa SUPABASE_SERVICE_ROLE_KEY,
-- direto ou via getSupabaseAdmin()/getDb() nas Edge Functions, ou via
-- orchestrator/src/lib/supabase.ts. A service role sempre ignora RLS,
-- então habilitar RLS SEM nenhuma política é suficiente pra bloquear
-- qualquer leitura/escrita via anon/authenticated (PostgREST) sem
-- quebrar nenhum caminho real hoje em produção.
--
-- Mesmo padrão já usado com sucesso (e validado pelo próprio advisor,
-- nível INFO em vez de ERROR) em atendimento_mensagens_enviadas e
-- funil_interpretacao_eventos — este é o modelo replicado aqui.
--
-- Aditiva apenas: não cria política nenhuma, não altera dado nenhum.

alter table public.workspace_credentials enable row level security;
alter table public.funcao_configs enable row level security;
alter table public.qr_temp enable row level security;
alter table public.mercadopago_eventos enable row level security;
alter table public.pedidos_estorno_eventos enable row level security;
