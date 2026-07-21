// Rodar: npx tsx --test supabase/functions/_shared/logistica-decisao.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirAcaoLogistica, statusLogisticaReivindicavel, LIMITE_PENDENTE_AMBIGUO_MS } from './logistica-decisao.ts';

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

test('pedido agendado (pagamento fora do horario) permite a tentativa do job agendado', () => {
  const d = decidirAcaoLogistica({ status: 'pago', status_logistica: 'agendada', lalamove_order_id: null }, true);
  assert.deepEqual(d, { acao: 'criar' });
});

test('statusLogisticaReivindicavel: pendente, criada e revisao_logistica nunca sao reivindicaveis (evita corrida concorrente/ambigua duplicada)', () => {
  assert.equal(statusLogisticaReivindicavel('pendente'), false);
  assert.equal(statusLogisticaReivindicavel('criada'), false);
  assert.equal(statusLogisticaReivindicavel('revisao_logistica'), false);
});
