-- ROLLBACK de 202608060002_cancelamento_pedido_estorno.sql
--
-- NÃO fica em supabase/migrations/ de propósito: um `supabase db push`
-- futuro só aplica arquivos dentro de migrations/, então este rollback
-- nunca é executado automaticamente por engano — só manualmente, se e
-- quando alguém decidir reverter.
--
-- Efeitos: (1) restaura atendimentos_humanos_origem_handoff_check para o
-- conjunto anterior a esta migration (202607210002_atendimento_humano_
-- origem_whatsapp_sdr.sql); (2) remove a tabela pedidos_estorno_eventos
-- (e seu índice único); (3) remove as colunas de cancelamento/estorno de
-- pedidos.
--
-- SEGURO SÓ SE:
--   a) nenhuma linha em atendimentos_humanos tiver origem_handoff em
--      ('cancelamento', 'estorno') — a restauração da constraint antiga
--      falha se houver;
--   b) você aceitar perder o histórico de pedidos_estorno_eventos (DROP
--      TABLE é destrutivo por natureza, é o rollback de um CREATE TABLE).
--
-- Rode antes de aplicar:
--
--   select count(*) from public.atendimentos_humanos
--   where origem_handoff in ('cancelamento', 'estorno');
--
--   select count(*) from public.pedidos_estorno_eventos;
--
-- Se qualquer um dos dois for > 0, pare e decida manualmente o que fazer
-- com esses registros antes de reverter — este script não apaga nada
-- silenciosamente além do já esperado (a própria tabela de eventos).

alter table public.atendimentos_humanos drop constraint if exists atendimentos_humanos_origem_handoff_check;
alter table public.atendimentos_humanos add constraint atendimentos_humanos_origem_handoff_check
  check (origem_handoff in (
    'cliente_solicitou',
    'flora_sem_confianca',
    'limite_tecnico',
    'pagamento',
    'logistica',
    'administrativo',
    'manual',
    'whatsapp_sdr'
  ));

drop table if exists public.pedidos_estorno_eventos;

alter table public.pedidos drop constraint if exists pedidos_estorno_status_check;
alter table public.pedidos drop column if exists estorno_status;

alter table public.pedidos drop constraint if exists pedidos_cancelado_por_check;
alter table public.pedidos drop column if exists cancelado_por;
alter table public.pedidos drop column if exists cancelado_motivo;
alter table public.pedidos drop column if exists cancelado_em;
