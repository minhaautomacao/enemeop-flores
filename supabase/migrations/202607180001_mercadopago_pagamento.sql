-- Suporte a Checkout Pro do Mercado Pago no fluxo real de pedidos da Flora.
--
-- Contexto: o funil da Flora (avancarFunil -> etapaConfirmacao ->
-- gerarPagamentoComPedido) chamava Cielo, mas não existe nenhuma credencial
-- tipo='cielo' em workspace_credentials — só existe tipo='financeiro' com
-- mp_access_token/mp_client_id/mp_client_secret (Mercado Pago). Migração
-- incremental: nenhuma coluna/tabela existente é removida ou renomeada.

-- Colunas novas em pedidos para rastrear a preferência/pagamento real.
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS provedor_pagamento text,
  ADD COLUMN IF NOT EXISTS mp_preference_id text,
  ADD COLUMN IF NOT EXISTS mp_payment_id text,
  ADD COLUMN IF NOT EXISTS external_reference text,
  ADD COLUMN IF NOT EXISTS valor_frete numeric,
  ADD COLUMN IF NOT EXISTS pago_em timestamptz;

COMMENT ON COLUMN public.pedidos.external_reference IS 'Identificador externo único enviado ao Mercado Pago (external_reference da preference) — usado pelo webhook pra localizar o pedido, nunca reaproveitado entre pedidos diferentes.';
COMMENT ON COLUMN public.pedidos.mp_preference_id IS 'id da preference criada no Mercado Pago para este pedido — uma preference por pedido, nunca recriada se já existir.';
COMMENT ON COLUMN public.pedidos.mp_payment_id IS 'id do pagamento aprovado (preenchido só depois de confirmação real via GET /v1/payments/{id}).';

-- external_reference precisa ser único quando presente — garante que nunca
-- existam duas preferences/pedidos com a mesma referência externa (nunca
-- duas cobranças pro mesmo pedido).
CREATE UNIQUE INDEX IF NOT EXISTS pedidos_external_reference_key
  ON public.pedidos (external_reference)
  WHERE external_reference IS NOT NULL;

-- Amplia o status permitido pra cobrir o ciclo de pagamento real, sem
-- remover nenhum dos status operacionais já existentes.
ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_status_check;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_status_check CHECK (
  status = ANY (ARRAY[
    'novo', 'pendente', 'confirmado', 'preparando', 'em_preparo', 'saiu',
    'saiu_para_entrega', 'entregue', 'cancelado',
    'aguardando_pagamento', 'pago', 'pagamento_recusado', 'reembolsado'
  ])
);

-- Idempotência das notificações do webhook do Mercado Pago: dedupe por
-- (payment_id, status) — a mesma notificação repetida (retry do MP) pra um
-- status já processado é ignorada; uma transição real de status (ex.:
-- pending -> approved) é um evento novo e processado normalmente.
CREATE TABLE IF NOT EXISTS public.mercadopago_eventos (
  payment_id          text NOT NULL,
  status               text NOT NULL,
  external_reference   text,
  valor                numeric,
  processado_em        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_id, status)
);

COMMENT ON TABLE public.mercadopago_eventos IS 'Registro de notificações de pagamento já processadas — garante que o webhook nunca processe a mesma transição de status duas vezes.';
