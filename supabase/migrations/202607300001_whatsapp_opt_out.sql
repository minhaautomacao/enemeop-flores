-- Aditiva apenas: nenhuma coluna/constraint existente é removida. Preparação
-- do WhatsApp para reconexão (2026-07-30) — o número anterior usado nos
-- testes foi banido; canal Z-API/Evolution (não-oficial), sujeito a
-- banimento por comportamento de bot. Registra o pedido explícito do
-- cliente de não receber mais mensagens automáticas (ver
-- _shared/whatsapp-guard.ts, canSendWhatsAppMessage) — nunca reaproveita
-- modo_atendimento/status_atendimento (esses controlam handoff humano, um
-- conceito diferente).
alter table conversas add column if not exists whatsapp_opt_out boolean not null default false;
alter table conversas add column if not exists whatsapp_opt_out_em timestamptz;
