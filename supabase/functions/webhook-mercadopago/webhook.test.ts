// Testa as duas peças puras do handler (sem I/O — sem Deno.serve, sem DB,
// sem chamar a API do Mercado Pago). O handler completo depende de rede/DB
// reais e é verificado na integração real, mesmo espírito dos testes de
// webhook-meta (ver primeiro-contato.test.ts).
//
// Rodar: npx tsx --test supabase/functions/webhook-mercadopago/webhook.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapearStatusPagamento, valoresDivergem, decidirAgendamentoPagamento } from './logica.ts';
import { decidirProcessamentoEvento } from '../_shared/pagamento-evento-decisao.ts';

test('mapearStatusPagamento: approved -> pago', () => {
  assert.equal(mapearStatusPagamento('approved'), 'pago');
});

test('mapearStatusPagamento: pending/in_process/authorized -> aguardando_pagamento', () => {
  assert.equal(mapearStatusPagamento('pending'), 'aguardando_pagamento');
  assert.equal(mapearStatusPagamento('in_process'), 'aguardando_pagamento');
  assert.equal(mapearStatusPagamento('authorized'), 'aguardando_pagamento');
});

test('mapearStatusPagamento: rejected -> pagamento_recusado', () => {
  assert.equal(mapearStatusPagamento('rejected'), 'pagamento_recusado');
});

test('mapearStatusPagamento: cancelled -> cancelado', () => {
  assert.equal(mapearStatusPagamento('cancelled'), 'cancelado');
});

test('mapearStatusPagamento: refunded e charged_back -> reembolsado', () => {
  assert.equal(mapearStatusPagamento('refunded'), 'reembolsado');
  assert.equal(mapearStatusPagamento('charged_back'), 'reembolsado');
});

test('mapearStatusPagamento: status desconhecido nunca vira aprovado por omissao', () => {
  assert.equal(mapearStatusPagamento('algum_status_novo_do_mp'), null);
  assert.equal(mapearStatusPagamento(''), null);
});

test('valoresDivergem: valores iguais nao divergem', () => {
  assert.equal(valoresDivergem(150.00, 150.00), false);
});

test('valoresDivergem: diferenca de centavo por arredondamento de ponto flutuante nao diverge', () => {
  assert.equal(valoresDivergem(150.00, 150.004), false);
});

test('valoresDivergem: pagamento aprovado com valor menor que o pedido diverge (nao confirma)', () => {
  assert.equal(valoresDivergem(150.00, 50.00), true);
});

test('valoresDivergem: pagamento aprovado com valor maior que o pedido tambem diverge', () => {
  assert.equal(valoresDivergem(150.00, 300.00), true);
});

// ── decidirAgendamentoPagamento — Parte 5: pagamento fora do horário ─────
//
// 2026-07-21 é terça-feira (dia útil, 09h-19h BRT / UTC-3). Todos os
// horários abaixo em UTC (BRT + 3h).

const TERCA_12H_BRT = new Date('2026-07-21T15:00:00Z'); // dentro do horário
const TERCA_20H_BRT = new Date('2026-07-21T23:00:00Z'); // após o fechamento (19h)
const TERCA_07H_BRT = new Date('2026-07-21T10:00:00Z'); // antes da abertura (09h)

test('1. pagamento dentro do horario: mantem despacho imediato quando a janela ja chegou', () => {
  const resultado = decidirAgendamentoPagamento({
    entregaPrometidaFixadaISO: '2026-07-21T15:00:00.000Z',
    despachoFixadoISO: '2026-07-21T14:55:00.000Z', // 5 min atras, ja chegou
    dataEntregaTipada: null,
    periodoEntregaTipado: null,
    leadTimeMinutos: 30,
  }, TERCA_12H_BRT);
  assert.equal(resultado.imediato, true);
  assert.equal(resultado.despachoEm.toISOString(), '2026-07-21T14:55:00.000Z', 'despacho ja persistido nao e recalculado dentro do horario');
});

test('2. pagamento confirmado apos o fechamento: nunca despacha imediatamente, agenda pro proximo horario comercial', () => {
  const resultado = decidirAgendamentoPagamento({
    entregaPrometidaFixadaISO: '2026-07-21T17:00:00.000Z',
    // despacho persistido na cotacao (14h BRT) ja ficou no passado quando o
    // pagamento so confirma as 20h BRT — nunca reaproveita esse horario
    // vencido como "pronto pra agora".
    despachoFixadoISO: '2026-07-21T17:00:00.000Z',
    dataEntregaTipada: null,
    periodoEntregaTipado: null,
    leadTimeMinutos: 30,
  }, TERCA_20H_BRT);
  assert.equal(resultado.imediato, false, 'nunca cria corrida imediatamente fora do horario');
  assert.equal(resultado.despachoEm.toISOString(), '2026-07-22T12:00:00.000Z', 'agendado para a abertura do proximo dia util (quarta 09h BRT)');
});

test('3. pagamento confirmado antes da abertura: tambem nunca despacha imediatamente', () => {
  const resultado = decidirAgendamentoPagamento({
    entregaPrometidaFixadaISO: '2026-07-21T15:00:00.000Z',
    despachoFixadoISO: null, // caminho legado, sem despacho persistido
    dataEntregaTipada: null,
    periodoEntregaTipado: null,
    leadTimeMinutos: 30,
  }, TERCA_07H_BRT);
  assert.equal(resultado.imediato, false, 'pagamento antes da abertura nunca despacha imediatamente');
  assert.equal(resultado.despachoEm.toISOString(), '2026-07-21T12:00:00.000Z', 'agendado para a abertura do mesmo dia (09h BRT), nao pulado pro dia seguinte');
});

test('4. evento repetido: decisao nunca reprocessa notificacao/handoff, e o agendamento e deterministico (nunca duplica pedido nem corrida)', () => {
  // Evento genuinamente novo -> processa completo (unica vez que notifica).
  assert.deepEqual(decidirProcessamentoEvento(null, false), { acao: 'processar_completo' });

  // Mesmo evento chegando de novo (ja concluido 'ok') -> nunca reprocessa
  // notificacao/handoff; so tenta retomar logistica (que tem sua propria
  // idempotencia atomica via pedidos.status_logistica, ver
  // _shared/logistica-processamento.ts).
  assert.deepEqual(decidirProcessamentoEvento({ processamento_status: 'ok', tentativas: 1 }, false), { acao: 'retomar_logistica_apenas' });

  // Reentrega enquanto ainda 'processando' (execucao concorrente em andamento)
  // -> tambem nunca reprocessa por completo uma segunda vez.
  assert.deepEqual(decidirProcessamentoEvento({ processamento_status: 'processando', tentativas: 1 }, false), { acao: 'retomar_logistica_apenas' });

  // decidirAgendamentoPagamento e pura: chamada duas vezes com os MESMOS
  // dados persistidos (exatamente o que acontece numa notificacao repetida)
  // devolve sempre o mesmo agendamento — nunca "recalcula" pra um horario
  // diferente a cada retry, o que poderia levar a agendar a corrida duas
  // vezes em horarios diferentes.
  const params = {
    entregaPrometidaFixadaISO: '2026-07-21T17:00:00.000Z',
    despachoFixadoISO: '2026-07-21T17:00:00.000Z',
    dataEntregaTipada: null,
    periodoEntregaTipado: null,
    leadTimeMinutos: 30,
  };
  const primeira = decidirAgendamentoPagamento(params, TERCA_20H_BRT);
  const segunda = decidirAgendamentoPagamento(params, TERCA_20H_BRT);
  assert.deepEqual(segunda, primeira, 'evento repetido nunca produz um agendamento diferente do primeiro');
});
