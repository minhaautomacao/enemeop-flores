// Rodar: npx tsx --test supabase/functions/_shared/logistica-decisao.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirAcaoLogistica, statusLogisticaReivindicavel, agendamentoVencido, LIMITE_PENDENTE_AMBIGUO_MS } from './logistica-decisao.ts';

test('pedido nao pago nunca aciona criacao de entrega', () => {
  const d = decidirAcaoLogistica({ status: 'aguardando_pagamento', status_logistica: null, lalamove_order_id: null }, true);
  assert.deepEqual(d, { acao: 'pular', motivo: 'nao_pago' });
});

test('pedido pago sem entrega e com telefone da loja configurado -> cria', () => {
  const d = decidirAcaoLogistica({ status: 'pago', status_logistica: null, lalamove_order_id: null }, true);
  assert.deepEqual(d, { acao: 'criar' });
});

test('pedido pago sem STORE_PHONE configurado -> bloqueia, nunca inventa telefone', () => {
  const d = decidirAcaoLogistica({ status: 'pago', status_logistica: null, lalamove_order_id: null }, false);
  assert.deepEqual(d, { acao: 'bloquear', motivo: 'telefone_loja_ausente' });
});

test('entrega ja criada (lalamove_order_id presente) -> nunca cria de novo, mesmo com evento de pagamento repetido', () => {
  const d = decidirAcaoLogistica({ status: 'pago', status_logistica: 'criada', lalamove_order_id: 'abc123' }, true);
  assert.deepEqual(d, { acao: 'pular', motivo: 'entrega_ja_criada' });
});

test('status_logistica=criada sem lalamove_order_id (estado inconsistente) ainda assim pula — nunca duplica', () => {
  const d = decidirAcaoLogistica({ status: 'pago', status_logistica: 'criada', lalamove_order_id: null }, true);
  assert.deepEqual(d, { acao: 'pular', motivo: 'entrega_ja_criada' });
});

test('falha anterior (erro_logistica) permite nova tentativa', () => {
  const d = decidirAcaoLogistica({ status: 'pago', status_logistica: 'erro_logistica', lalamove_order_id: null }, true);
  assert.deepEqual(d, { acao: 'criar' });
});

test('em revisao_logistica nunca tenta de novo automaticamente — so revisao humana', () => {
  const d = decidirAcaoLogistica({ status: 'pago', status_logistica: 'revisao_logistica', lalamove_order_id: null }, true);
  assert.deepEqual(d, { acao: 'pular', motivo: 'em_revisao' });
});

test('pendente reivindicado ha pouco tempo -> outra execucao provavelmente ainda em andamento, nunca reivindica de novo', () => {
  const agora = new Date('2026-07-21T12:00:00Z');
  const pendenteDesde = new Date(agora.getTime() - 10_000).toISOString(); // 10s atras
  const d = decidirAcaoLogistica({ status: 'pago', status_logistica: 'pendente', lalamove_order_id: null, logistica_pendente_desde: pendenteDesde }, true, agora);
  assert.deepEqual(d, { acao: 'pular', motivo: 'claim_em_andamento' });
});

test('pendente ha mais tempo que o limite -> estado ambiguo, nunca retry cego', () => {
  const agora = new Date('2026-07-21T12:00:00Z');
  const pendenteDesde = new Date(agora.getTime() - (LIMITE_PENDENTE_AMBIGUO_MS + 1000)).toISOString();
  const d = decidirAcaoLogistica({ status: 'pago', status_logistica: 'pendente', lalamove_order_id: null, logistica_pendente_desde: pendenteDesde }, true, agora);
  assert.deepEqual(d, { acao: 'marcar_ambiguo_por_timeout' });
});

test('pendente sem timestamp de claim (dado corrompido/antigo) e tratado como ambiguo, nunca como recente', () => {
  const d = decidirAcaoLogistica({ status: 'pago', status_logistica: 'pendente', lalamove_order_id: null, logistica_pendente_desde: null }, true);
  assert.deepEqual(d, { acao: 'marcar_ambiguo_por_timeout' });
});

test('statusLogisticaReivindicavel: null, erro_logistica e agendada sao reivindicaveis', () => {
  assert.equal(statusLogisticaReivindicavel(null), true);
  assert.equal(statusLogisticaReivindicavel('erro_logistica'), true);
  assert.equal(statusLogisticaReivindicavel('agendada'), true);
});

test('pedido agendado cujo logistica_executar_em ja chegou permite a tentativa (job agendado)', () => {
  const agora = new Date('2026-07-21T12:00:00Z');
  const executarEm = new Date(agora.getTime() - 1000).toISOString(); // 1s atras
  const d = decidirAcaoLogistica({ status: 'pago', status_logistica: 'agendada', lalamove_order_id: null, logistica_executar_em: executarEm }, true, agora);
  assert.deepEqual(d, { acao: 'criar' });
});

test('pedido agendado cujo logistica_executar_em ainda nao chegou -> nunca reivindica, mesmo por retry administrativo', () => {
  const agora = new Date('2026-07-21T12:00:00Z');
  const executarEm = new Date(agora.getTime() + 3_600_000).toISOString(); // 1h no futuro
  const d = decidirAcaoLogistica({ status: 'pago', status_logistica: 'agendada', lalamove_order_id: null, logistica_executar_em: executarEm }, true, agora);
  assert.deepEqual(d, { acao: 'pular', motivo: 'agendada_nao_vencida' });
});

test('pedido agendado exatamente no instante de logistica_executar_em ja pode ser reivindicado (<=, nao <)', () => {
  const agora = new Date('2026-07-21T12:00:00.000Z');
  const d = decidirAcaoLogistica({ status: 'pago', status_logistica: 'agendada', lalamove_order_id: null, logistica_executar_em: agora.toISOString() }, true, agora);
  assert.deepEqual(d, { acao: 'criar' });
});

test('pedido agendado sem logistica_executar_em (estado inconsistente) nunca e tratado como vencido', () => {
  const d = decidirAcaoLogistica({ status: 'pago', status_logistica: 'agendada', lalamove_order_id: null, logistica_executar_em: null }, true);
  assert.deepEqual(d, { acao: 'pular', motivo: 'agendada_nao_vencida' });
});

test('agendamentoVencido: status diferente de agendada sempre e considerado "vencido" (condicao nao se aplica)', () => {
  assert.equal(agendamentoVencido({ status_logistica: null, logistica_executar_em: null }), true);
  assert.equal(agendamentoVencido({ status_logistica: 'erro_logistica', logistica_executar_em: null }), true);
});

test('agendamentoVencido: agendada respeita logistica_executar_em (passado vence, futuro nao)', () => {
  const agora = new Date('2026-07-21T12:00:00Z');
  const passado = new Date(agora.getTime() - 1000).toISOString();
  const futuro = new Date(agora.getTime() + 1000).toISOString();
  assert.equal(agendamentoVencido({ status_logistica: 'agendada', logistica_executar_em: passado }, agora), true);
  assert.equal(agendamentoVencido({ status_logistica: 'agendada', logistica_executar_em: futuro }, agora), false);
});

test('cron e retry concorrentes: quem chega primeiro reivindica (pendente), a segunda leitura do mesmo pedido nunca tenta criar de novo', () => {
  const agora = new Date('2026-07-21T12:00:00Z');
  const executarEm = new Date(agora.getTime() - 1000).toISOString();
  const pedidoAgendadoVencido = { status: 'pago', status_logistica: 'agendada', lalamove_order_id: null, logistica_executar_em: executarEm };

  // Primeira execução (ex.: o job agendado) le o pedido e decide criar —
  // o claim atomico real (UPDATE ... WHERE status_logistica in (...)) e
  // quem de fato flipa o status pra 'pendente' no banco.
  const primeira = decidirAcaoLogistica(pedidoAgendadoVencido, true, agora);
  assert.deepEqual(primeira, { acao: 'criar' });

  // Segunda execução concorrente (ex.: logistica-retry chamado quase ao
  // mesmo tempo) le o pedido DEPOIS do claim da primeira ja ter sido
  // persistido — nunca tenta criar uma segunda corrida.
  const pedidoJaReivindicado = { ...pedidoAgendadoVencido, status_logistica: 'pendente', logistica_pendente_desde: agora.toISOString() };
  const segunda = decidirAcaoLogistica(pedidoJaReivindicado, true, agora);
  assert.deepEqual(segunda, { acao: 'pular', motivo: 'claim_em_andamento' });
});

test('statusLogisticaReivindicavel: pendente, criada e revisao_logistica nunca sao reivindicaveis (evita corrida concorrente/ambigua duplicada)', () => {
  assert.equal(statusLogisticaReivindicavel('pendente'), false);
  assert.equal(statusLogisticaReivindicavel('criada'), false);
  assert.equal(statusLogisticaReivindicavel('revisao_logistica'), false);
});
