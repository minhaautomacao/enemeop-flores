// Rodar: npx tsx --test supabase/functions/_shared/agendamento-entrega.test.ts
//
// 2026-07-21 é terça-feira; 2026-07-24 é sexta; 2026-07-25/26 são fim de
// semana (sáb/dom).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularAgendamentoEntrega, type DataCalendario } from './agendamento-entrega.ts';

function utc(iso: string): Date {
  return new Date(iso);
}

const HOJE: DataCalendario = { ano: 2026, mes: 6, dia: 21 }; // terça
const SEXTA_QUE_VEM: DataCalendario = { ano: 2026, mes: 6, dia: 24 };
const SABADO_QUE_VEM: DataCalendario = { ano: 2026, mes: 6, dia: 25 };

test('pedido para hoje, dentro do horário, com lead time exatamente satisfeito -> despacho imediato, promessa original mantida', () => {
  const agora = utc('2026-07-21T15:00:00Z'); // terça 12h00 BRT — exatamente 60min antes das 13h
  const r = calcularAgendamentoEntrega(HOJE, 'tarde', agora, { leadTimeMinutos: 60 });
  assert.equal(r.imediato, true);
  assert.equal(r.despachoEm.getTime(), agora.getTime());
  assert.equal(r.entregaPrometidaEm.toISOString(), '2026-07-21T16:00:00.000Z'); // terça 13h BRT — cumprível, mantida
});

test('GO-LIVE Parte 4 — pedido futuro (sexta que vem) pago hoje dentro do horário -> nunca cria corrida antes da data planejada, e a promessa "9h" (impossível: loja abre 9h, lead time 60min) é corrigida pra 10h antes da aprovação', () => {
  const agora = utc('2026-07-21T15:00:00Z'); // terça 12h BRT, dentro do horário
  const r = calcularAgendamentoEntrega(SEXTA_QUE_VEM, null, agora, { leadTimeMinutos: 60 });
  assert.equal(r.imediato, false);
  assert.equal(r.despachoEm.toISOString(), '2026-07-24T12:00:00.000Z'); // sexta 09h BRT (abertura — lead time não cabe antes disso)
  assert.ok(r.despachoEm.getTime() > agora.getTime(), 'despacho nunca antes de agora, mas aqui também nunca antes da janela planejada');
  // A promessa original (09h, default sem período) é impossível de cumprir
  // com 60min de lead time a partir da abertura — nunca fica "09h" (bug
  // real reportado); desloca pra 10h, a primeira hora em que o despacho às
  // 09h (abertura) + 60min de preparo/coleta realmente entrega.
  assert.equal(r.entregaPrometidaEm.toISOString(), '2026-07-24T13:00:00.000Z'); // sexta 10h BRT
});

test('GO-LIVE Parte 4 — janela "09h" pedida com loja abrindo às 09h e lead time de 60min nunca fica 09h (impossível); desloca pro primeiro horário viável (10h)', () => {
  const agora = utc('2026-07-21T02:00:00Z'); // terça 23h BRT da véspera — bem antes de qualquer horário comercial
  const r = calcularAgendamentoEntrega(HOJE, 'manha', agora, { leadTimeMinutos: 60 });
  assert.equal(r.despachoEm.toISOString(), '2026-07-21T12:00:00.000Z'); // 09h BRT (abertura — despacho não pode ser antes disso)
  assert.equal(r.entregaPrometidaEm.toISOString(), '2026-07-21T13:00:00.000Z'); // 10h BRT — nunca 09h
  assert.equal(r.imediato, false);
});

test('GO-LIVE Parte 4 — sábado abrindo às 10h, "manhã" pedida com lead time de 60min: promessa desloca de 10h (impossível) pra 11h', () => {
  const agora = utc('2026-07-21T15:00:00Z'); // terça 12h BRT
  const r = calcularAgendamentoEntrega(SABADO_QUE_VEM, 'manha', agora, { leadTimeMinutos: 60 });
  assert.equal(r.despachoEm.toISOString(), '2026-07-25T13:00:00.000Z'); // sábado 10h BRT (abertura de fim de semana)
  assert.equal(r.entregaPrometidaEm.toISOString(), '2026-07-25T14:00:00.000Z'); // sábado 11h BRT — nunca 10h
});

test('GO-LIVE Parte 4 — pagamento atrasado próximo da janela: promessa recalculada continua cumprível, nunca finge que o horário original ainda vale', () => {
  // Janela pedida: hoje às 13h (tarde), lead time 60min -> precisaria pagar
  // até 12h. Pagamento chega quase em cima da hora (12h50) -> a janela
  // original (13h) não cabe mais; a promessa se ajusta pra refletir a
  // realidade (12h50 + 60min), nunca mantém 13h silenciosamente.
  const agora = utc('2026-07-21T15:50:00Z'); // terça 12h50 BRT
  const r = calcularAgendamentoEntrega(HOJE, 'tarde', agora, { leadTimeMinutos: 60 });
  assert.equal(r.despachoEm.getTime(), agora.getTime());
  assert.equal(r.imediato, true);
  assert.equal(r.entregaPrometidaEm.toISOString(), '2026-07-21T16:50:00.000Z'); // 13h50 BRT, nunca 13h00
});

test('data prometida ao cliente é armazenada separada da hora técnica de despacho (podem ser o mesmo instante só quando o lead time é zero)', () => {
  const agora = utc('2026-07-21T13:00:00Z'); // terça 10h BRT
  const r = calcularAgendamentoEntrega(HOJE, 'tarde', agora, { leadTimeMinutos: 45 });
  assert.equal(r.entregaPrometidaEm.toISOString(), '2026-07-21T16:00:00.000Z'); // 13h BRT prometido ao cliente
  assert.notEqual(r.despachoEm.getTime(), r.entregaPrometidaEm.getTime(), 'despacho (hora técnica) é diferente da janela prometida quando há lead time');
});

test('período sem hora exata usa o início configurado do período (manhã=9h, tarde=13h, noite=18h)', () => {
  const agora = utc('2026-07-21T10:00:00Z'); // terça 07h BRT, antes de abrir
  const manha = calcularAgendamentoEntrega(HOJE, 'manha', agora, { leadTimeMinutos: 0 });
  const tarde = calcularAgendamentoEntrega(HOJE, 'tarde', agora, { leadTimeMinutos: 0 });
  const noite = calcularAgendamentoEntrega(HOJE, 'noite', agora, { leadTimeMinutos: 0 });
  assert.equal(manha.entregaPrometidaEm.toISOString(), '2026-07-21T12:00:00.000Z'); // 09h BRT
  assert.equal(tarde.entregaPrometidaEm.toISOString(), '2026-07-21T16:00:00.000Z'); // 13h BRT
  assert.equal(noite.entregaPrometidaEm.toISOString(), '2026-07-21T21:00:00.000Z'); // 18h BRT
});

test('sem período informado usa o horário operacional seguro configurado, nunca inventa um período', () => {
  const agora = utc('2026-07-21T10:00:00Z'); // terça 07h BRT
  const r = calcularAgendamentoEntrega(HOJE, null, agora, { leadTimeMinutos: 0 });
  assert.equal(r.entregaPrometidaEm.toISOString(), '2026-07-21T12:00:00.000Z'); // 09h BRT, mesmo padrão configurado
});

test('janela prometida nunca cai fora do horário de funcionamento do dia solicitado — clampa pro expediente real (ex.: "manhã" num sábado abre só às 10h)', () => {
  const agora = utc('2026-07-21T15:00:00Z');
  const r = calcularAgendamentoEntrega(SABADO_QUE_VEM, 'manha', agora, { leadTimeMinutos: 0 });
  // sábado abre 10h, "manhã" pediria 09h -> clampado pra 10h (não pode prometer horário fechado)
  assert.equal(r.entregaPrometidaEm.toISOString(), '2026-07-25T13:00:00.000Z');
});

test('janela prometida "noite" num fim de semana nunca cai exatamente no fechamento (18h) — clampa 1 minuto antes', () => {
  const agora = utc('2026-07-21T15:00:00Z');
  const r = calcularAgendamentoEntrega(SABADO_QUE_VEM, 'noite', agora, { leadTimeMinutos: 0 });
  assert.equal(r.entregaPrometidaEm.toISOString(), '2026-07-25T20:59:00.000Z'); // 17h59 BRT, nunca 18h00 (fechamento)
});

test('despacho nunca cai fora do horário comercial mesmo quando o lead time sozinho apontaria pra um horário fechado', () => {
  const agora = utc('2026-07-21T15:00:00Z'); // terça 12h BRT
  // pedido pra hoje às 13h, lead time de 5h -> despacho bruto seria 08h (antes de abrir)
  const r = calcularAgendamentoEntrega(HOJE, 'tarde', agora, { leadTimeMinutos: 5 * 60 });
  assert.ok(r.despachoEm.getTime() >= agora.getTime(), 'despacho nunca antes de agora nem antes do horario de funcionamento');
});

test('pedido fora do horário agora, mas para hoje mais tarde -> despacho agendado pro horário calculado, não imediato', () => {
  const agora = utc('2026-07-21T10:00:00Z'); // terça 07h BRT, loja ainda fechada
  const r = calcularAgendamentoEntrega(HOJE, 'manha', agora, { leadTimeMinutos: 30 });
  assert.equal(r.imediato, false);
  assert.equal(r.despachoEm.toISOString(), '2026-07-21T12:00:00.000Z'); // 09h BRT, abertura do dia
});
