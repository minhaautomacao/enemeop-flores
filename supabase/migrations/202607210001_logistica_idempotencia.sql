-- P0 CURTA — recuperação de logística após pagamento aprovado, sem risco
-- de corrida duplicada.
--
-- Aditiva apenas: nenhuma coluna/constraint existente é removida.

-- 1) mercadopago_eventos ganha rastreio de processamento — antes, o INSERT
--    (payment_id, status) sozinho era a única trava, então uma notificação
--    repetida nunca tinha como recuperar um pedido que ficou pago mas com a
--    logística em erro (a linha de auditoria já existia, então a segunda
--    tentativa parava ali, sem nunca chegar perto do pedido de novo).
alter table mercadopago_eventos add column if not exists processamento_status text not null default 'processando';
alter table mercadopago_eventos drop constraint if exists mercadopago_eventos_processamento_status_check;
alter table mercadopago_eventos add constraint mercadopago_eventos_processamento_status_check
  check (processamento_status in ('processando', 'ok', 'erro'));
alter table mercadopago_eventos add column if not exists tentativas integer not null default 1;
alter table mercadopago_eventos add column if not exists erro_sanitizado text;

-- 2) pedidos: novo estado 'revisao_logistica' — usado quando não dá pra
--    provar que uma corrida NÃO foi criada do lado da Lalamove (timeout
--    depois de enviar POST /v3/orders, ou resposta 2xx sem orderId
--    reconhecível). Esse estado nunca é retriável automaticamente — só
--    revisão humana (ver _shared/logistica-decisao.ts).
alter table pedidos drop constraint if exists pedidos_status_logistica_check;
alter table pedidos add constraint pedidos_status_logistica_check
  check (status_logistica is null or status_logistica in ('pendente', 'criada', 'erro_logistica', 'revisao_logistica'));

-- logistica_pendente_desde: quando o claim atômico 'pendente' foi feito —
-- usado pra distinguir "outra execução provavelmente ainda rodando agora"
-- (claim recente) de "essa execução travou/crashou e nunca resolveu"
-- (claim velho, tratado como ambíguo e nunca reivindicado de novo às
-- cegas).
alter table pedidos add column if not exists logistica_pendente_desde timestamptz;
