// Testa as duas peças puras do handler (sem I/O — sem Deno.serve, sem DB,
// sem chamar a API do Mercado Pago). O handler completo depende de rede/DB
// reais e é verificado na integração real, mesmo espírito dos testes de
// webhook-meta (ver primeiro-contato.test.ts).
//
// Rodar: npx tsx --test supabase/functions/webhook-mercadopago/webhook.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapearStatusPagamento, valoresDivergem } from './logica.ts';

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
