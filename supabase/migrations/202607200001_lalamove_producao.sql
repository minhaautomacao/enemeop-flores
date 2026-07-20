-- P0 FINAL — Lalamove real, pagamento confirmado e pedido na produção
--
-- Aditiva apenas: nenhuma coluna existente é alterada/removida. Adiciona:
--   1) numero_pedido — número estável e sequencial, pra nunca usar índice de
--      lista como "número do pedido" no painel de produção.
--   2) status_producao — workflow de cozinha (novo/confirmado/preparando/
--      pronto/saiu/entregue), separado do `status` de pagamento (que já é
--      usado por aguardando_pagamento/pago/pagamento_recusado/cancelado/
--      reembolsado — colunas com significados diferentes não podem
--      continuar compartilhando a mesma coluna).
--   3) dados completos da cotação/entrega Lalamove, pra nunca confundir
--      preço real, markup e preço cobrado, e pra idempotência da criação da
--      entrega real (Parte H).
--   4) telefone_destinatario/mensagem_cartao — dados coletados pelo funil
--      antes do link de pagamento (Parte F).

-- 1) numero_pedido: backfill em ordem de criação, depois sequência own by.
alter table pedidos add column if not exists numero_pedido integer;

with numerado as (
  select id, row_number() over (order by criado_em asc, id asc) as rn
  from pedidos
  where numero_pedido is null
)
update pedidos p set numero_pedido = n.rn
from numerado n
where n.id = p.id;

create sequence if not exists pedidos_numero_pedido_seq;
select setval('pedidos_numero_pedido_seq', coalesce((select max(numero_pedido) from pedidos), 0));
alter table pedidos alter column numero_pedido set default nextval('pedidos_numero_pedido_seq');
alter sequence pedidos_numero_pedido_seq owned by pedidos.numero_pedido;
alter table pedidos alter column numero_pedido set not null;
create unique index if not exists pedidos_numero_pedido_key on pedidos(numero_pedido);

-- 2) status_producao: workflow de cozinha, independente do status de pagamento.
alter table pedidos add column if not exists status_producao text not null default 'novo';
alter table pedidos drop constraint if exists pedidos_status_producao_check;
alter table pedidos add constraint pedidos_status_producao_check
  check (status_producao in ('novo', 'confirmado', 'preparando', 'pronto', 'saiu', 'entregue'));

-- 3) Cotação/entrega Lalamove — nunca confunde preço real, markup e preço cobrado.
alter table pedidos add column if not exists lalamove_quotation_id text;
alter table pedidos add column if not exists lalamove_order_id text;
create unique index if not exists pedidos_lalamove_order_id_key
  on pedidos(lalamove_order_id) where lalamove_order_id is not null;

alter table pedidos add column if not exists frete_transportadora text;
alter table pedidos add column if not exists frete_servico text;
alter table pedidos add column if not exists frete_preco_real numeric;
alter table pedidos add column if not exists frete_markup numeric;
alter table pedidos add column if not exists frete_moeda text;
alter table pedidos add column if not exists frete_expires_at timestamptz;
alter table pedidos add column if not exists frete_cotado_em timestamptz;
alter table pedidos add column if not exists frete_ambiente text;
alter table pedidos add column if not exists frete_mercado text;
alter table pedidos add column if not exists frete_origem jsonb;
alter table pedidos add column if not exists frete_destino jsonb;
alter table pedidos add column if not exists lalamove_stop_id_origem text;
alter table pedidos add column if not exists lalamove_stop_id_destino text;

-- status_logistica: null até o pedido ser pago; 'pendente' é o claim atômico
-- de quem vai tentar criar a entrega (evita duas criações concorrentes sem
-- precisar de lock — ver Parte H.5); 'criada' com lalamove_order_id
-- preenchido; 'erro_logistica' permite retry controlado sem cobrar de novo.
alter table pedidos add column if not exists status_logistica text;
alter table pedidos drop constraint if exists pedidos_status_logistica_check;
alter table pedidos add constraint pedidos_status_logistica_check
  check (status_logistica is null or status_logistica in ('pendente', 'criada', 'erro_logistica'));
alter table pedidos add column if not exists logistica_criado_em timestamptz;
alter table pedidos add column if not exists logistica_resposta jsonb;
alter table pedidos add column if not exists logistica_tentativas integer not null default 0;

-- 4) Dados coletados pelo funil antes do pagamento.
alter table pedidos add column if not exists telefone_destinatario text;
alter table pedidos add column if not exists mensagem_cartao text;
