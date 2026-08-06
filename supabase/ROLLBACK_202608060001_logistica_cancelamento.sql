-- ROLLBACK de 202608060001_logistica_cancelamento.sql
--
-- NÃO fica em supabase/migrations/ de propósito: um `supabase db push`
-- futuro só aplica arquivos dentro de migrations/, então este rollback
-- nunca é executado automaticamente por engano — só manualmente, se e
-- quando alguém decidir reverter.
--
-- Efeitos: (1) restaura pedidos_status_logistica_check para o conjunto de
-- valores anterior a esta migration (202607210003_logistica_agendada_e_
-- preco_operacional.sql); (2) remove as 6 colunas de auditoria de
-- cancelamento de logística adicionadas.
--
-- SEGURO SÓ SE nenhuma linha em produção já tiver status_logistica em
-- ('cancelamento_solicitado', 'cancelada', 'cancelamento_negado') — do
-- contrário, restaurar a constraint antiga vai falhar (linha violaria o
-- CHECK). Rode a query abaixo antes de aplicar este rollback:
--
--   select count(*) from public.pedidos
--   where status_logistica in ('cancelamento_solicitado', 'cancelada', 'cancelamento_negado');
--
-- Se o resultado for > 0, este rollback não pode ser aplicado sem antes
-- decidir o que fazer com essas linhas (não há truncamento automático aqui
-- de propósito — dado real nunca é apagado silenciosamente por um rollback).

alter table public.pedidos drop constraint if exists pedidos_status_logistica_check;
alter table public.pedidos add constraint pedidos_status_logistica_check
  check (status_logistica is null or status_logistica in (
    'pendente', 'criada', 'erro_logistica', 'revisao_logistica', 'agendada'
  ));

alter table public.pedidos drop column if exists logistica_cancelamento_pendente_desde;
alter table public.pedidos drop column if exists logistica_cancelamento_tentativas;
alter table public.pedidos drop column if exists logistica_cancelado_em;
alter table public.pedidos drop column if exists logistica_cancelamento_motivo;
alter table public.pedidos drop column if exists logistica_cancelamento_taxa;
alter table public.pedidos drop column if exists logistica_cancelamento_resposta;
