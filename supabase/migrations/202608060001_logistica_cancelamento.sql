-- Cancelamento de logística (entrega real na Lalamove) — hoje o sistema só
-- sabe CRIAR uma corrida real após o pagamento (_shared/logistica-processamento.ts),
-- não existe nenhuma forma de desfazer isso. Esta migration só prepara o
-- schema; nenhuma chamada de cancelamento real é feita por causa dela.
--
-- Aditiva apenas: nenhuma coluna/constraint existente é removida, todos os
-- valores já aceitos de status_logistica continuam aceitos.

-- Novos estados de status_logistica:
--   'cancelamento_solicitado' — claim atômico em andamento (espelha 'pendente'
--     na criação), evita duas tentativas de cancelamento concorrentes pro
--     mesmo pedido.
--   'cancelada' — a Lalamove confirmou o cancelamento da corrida.
--   'cancelamento_negado' — a Lalamove recusou (corrida já coletada/avançada
--     demais) — nunca retriável automaticamente, sempre vira revisão humana
--     (ver _shared/logistica-cancelamento.ts, ainda a implementar).
alter table public.pedidos drop constraint if exists pedidos_status_logistica_check;
alter table public.pedidos add constraint pedidos_status_logistica_check
  check (status_logistica is null or status_logistica in (
    'pendente', 'criada', 'erro_logistica', 'revisao_logistica', 'agendada',
    'cancelamento_solicitado', 'cancelada', 'cancelamento_negado'
  ));

-- Auditoria do cancelamento de logística — mesmo padrão já usado pra criação
-- da corrida (logistica_pendente_desde/logistica_tentativas/logistica_resposta),
-- só que para o lado do cancelamento.
alter table public.pedidos add column if not exists logistica_cancelamento_pendente_desde timestamptz;
alter table public.pedidos add column if not exists logistica_cancelamento_tentativas integer not null default 0;
alter table public.pedidos add column if not exists logistica_cancelado_em timestamptz;
alter table public.pedidos add column if not exists logistica_cancelamento_motivo text;
-- Taxa de cancelamento cobrada pela transportadora, quando existir — nunca
-- inventada, só preenchida se a resposta real da Lalamove trouxer um valor.
alter table public.pedidos add column if not exists logistica_cancelamento_taxa numeric;
alter table public.pedidos add column if not exists logistica_cancelamento_resposta jsonb;
