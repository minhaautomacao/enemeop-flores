// Rodar: npx tsx --test supabase/functions/_shared/logistica-decisao.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirAcaoLogistica, statusLogisticaReivindicavel } from './logistica-decisao.ts';

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

test('statusLogisticaReivindicavel: null e erro_logistica sao reivindicaveis', () => {
  assert.equal(statusLogisticaReivindicavel(null), true);
  assert.equal(statusLogisticaReivindicavel('erro_logistica'), true);
});

test('statusLogisticaReivindicavel: pendente e criada nunca sao reivindicaveis (evita corrida concorrente duplicada)', () => {
  assert.equal(statusLogisticaReivindicavel('pendente'), false);
  assert.equal(statusLogisticaReivindicavel('criada'), false);
});
