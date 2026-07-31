-- Suporte a pagamento Pix com QR Code real (Mercado Pago Payments API,
-- distinto da preference/Checkout Pro já existente) — colunas aditivas
-- apenas, nenhuma existente é alterada/removida.
--
-- Contexto: a Flora só oferecia o link do Checkout Pro; quando o cliente
-- pede especificamente "pix"/"qr code" na fase aguardando_pagamento, agora
-- a Flora gera um pagamento Pix real (mesmo pedido, mesmo external_reference)
-- e envia o QR Code como imagem. Reaproveitado (nunca recriado) enquanto
-- ainda não tiver expirado — ver _shared/pedido-repositorio.ts.
alter table public.pedidos
  add column if not exists pix_payment_id text,
  add column if not exists pix_qr_code_url text,
  add column if not exists pix_copia_cola text,
  add column if not exists pix_expires_at timestamptz;

comment on column public.pedidos.pix_payment_id is 'id do pagamento Pix criado na API do Mercado Pago (Payments API, distinto de mp_preference_id/mp_payment_id do Checkout Pro) — nunca recriado enquanto pix_expires_at ainda não venceu.';
comment on column public.pedidos.pix_qr_code_url is 'URL pública (Supabase Storage, bucket pix-qrcodes) da imagem do QR Code Pix enviada ao cliente.';
comment on column public.pedidos.pix_copia_cola is 'Código Pix copia-e-cola retornado pelo Mercado Pago — enviado como texto junto do QR Code.';
