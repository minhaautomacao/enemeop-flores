-- Aditiva apenas: nenhuma coluna/constraint existente é removida. Parte 2 da
-- correção "fechar bloqueios do agendamento" — agendar a corrida real pela
-- DATA PROMETIDA ao cliente (não pelo horário em que o pagamento foi
-- aprovado). Campos tipados, nunca texto livre, pra decisão operacional.

-- Data/período solicitados pelo cliente, já reconhecidos e validados
-- deterministicamente (ver normalizarDataEntregaTexto/normalizarPeriodoEntregaTexto
-- em funil.ts) antes do pedido ser criado — nunca texto livre tipo "amanhã".
alter table pedidos add column if not exists data_entrega_solicitada date;
alter table pedidos add column if not exists periodo_entrega text;
alter table pedidos drop constraint if exists pedidos_periodo_entrega_check;
alter table pedidos add constraint pedidos_periodo_entrega_check
  check (periodo_entrega is null or periodo_entrega in ('manha', 'tarde', 'noite'));

-- Início real da janela prometida ao cliente (já calculado e clampado pro
-- horário de funcionamento do dia solicitado) — guardado separado da hora
-- técnica de despacho (logistica_executar_em, Parte 5) pra nunca confundir
-- "o que foi prometido" com "quando o sistema decidiu chamar o motorista".
alter table pedidos add column if not exists entrega_prometida_em timestamptz;
