-- Cancelamento de pedido por estágio + estorno de pagamento via Mercado Pago.
--
-- Contexto: hoje o gate de cancelamento conversacional (funil.ts,
-- CHAVE_GATE_CANCELAMENTO_GLOBAL e gates irmãos) só reseta o estado da
-- conversa em memória e diz ao cliente "pedido cancelado, sem custo nenhum"
-- — nunca grava nada em `pedidos`. Quando o pedido já existe no banco (o que
-- acontece assim que o frete é aprovado, antes da fase virar
-- aguardando_pagamento), a Flora afirma um cancelamento que não aconteceu.
-- Esta migration só prepara o schema pra fechar essa lacuna; nenhum estorno
-- real é disparado por causa dela.
--
-- Aditiva apenas: nenhuma coluna/constraint/valor existente é removido.

-- pedidos.status já inclui 'cancelado' e 'reembolsado' desde
-- 202607180001_mercadopago_pagamento.sql — não precisa de novo valor, só das
-- colunas de auditoria abaixo pra saber COMO/POR QUE/QUEM cancelou.
alter table public.pedidos add column if not exists cancelado_em timestamptz;
alter table public.pedidos add column if not exists cancelado_motivo text;
alter table public.pedidos add column if not exists cancelado_por text;
alter table public.pedidos drop constraint if exists pedidos_cancelado_por_check;
alter table public.pedidos add constraint pedidos_cancelado_por_check
  check (cancelado_por is null or cancelado_por in ('cliente_flora', 'admin_painel', 'sistema_mp'));

-- Cache denormalizado do último evento de estorno — a fonte de verdade é
-- pedidos_estorno_eventos (abaixo); esta coluna só existe pra telas/consultas
-- rápidas não precisarem de join.
alter table public.pedidos add column if not exists estorno_status text;
alter table public.pedidos drop constraint if exists pedidos_estorno_status_check;
alter table public.pedidos add constraint pedidos_estorno_status_check
  check (estorno_status is null or estorno_status in (
    'pendente_autorizacao', 'processando', 'concluido', 'pendente_mp', 'recusado', 'erro'
  ));

-- Histórico/idempotência de estorno — mesmo padrão de mercadopago_eventos
-- (auditoria + trava de concorrência), mas para o lado ATIVO (estorno
-- disparado pelo nosso sistema, nunca automaticamente a partir da conversa —
-- ver _shared/estorno-decisao.ts e supabase/functions/pagamento-estornar,
-- ainda a implementar). O webhook já reconhece passivamente um estorno feito
-- fora do sistema (mapearStatusPagamento em webhook-mercadopago/logica.ts);
-- esta tabela cobre o caminho iniciado por nós.
create table if not exists public.pedidos_estorno_eventos (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid not null references public.pedidos(id),
  mp_payment_id   text not null,
  mp_refund_id    text,
  valor           numeric not null,
  tipo            text not null default 'total' check (tipo in ('total', 'parcial')),
  motivo          text,
  -- Quem autorizou o estorno (e-mail/identificador do painel administrativo)
  -- — nunca nulo, pra nunca existir um estorno sem responsável identificado.
  responsavel     text not null,
  status          text not null default 'pendente_autorizacao' check (status in (
    'pendente_autorizacao', 'autorizado', 'processando', 'concluido',
    'pendente_mp', 'recusado', 'erro'
  )),
  erro_sanitizado text,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

comment on table public.pedidos_estorno_eventos is 'Histórico e trava de concorrência de estornos iniciados pelo nosso sistema — nunca mais de um evento ativo por pedido (ver índice único abaixo). Execução real do estorno só acontece com confirmação humana explícita no painel administrativo.';

-- Nunca mais de um estorno "em andamento" pro mesmo pedido — um evento
-- recusado/com erro anterior não bloqueia uma nova tentativa (não está na
-- lista de status "ativos" abaixo).
create unique index if not exists pedidos_estorno_eventos_ativo_por_pedido
  on public.pedidos_estorno_eventos (pedido_id)
  where status in ('pendente_autorizacao', 'autorizado', 'processando', 'concluido');

-- Flora agora pode escalar cancelamento/estorno pra atendimento humano
-- quando não puder resolver sozinha (ex.: corrida já coletada, ou qualquer
-- estorno — que nunca é automático, ver D2 do plano).
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
    'whatsapp_sdr',
    'cancelamento',
    'estorno'
  ));
