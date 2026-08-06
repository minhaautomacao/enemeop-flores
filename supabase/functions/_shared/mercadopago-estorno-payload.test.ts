// Rodar: npx tsx --test supabase/functions/_shared/mercadopago-estorno-payload.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarRequisicaoEstorno } from './mercadopago-estorno-payload.ts';

test('estorno total (sem valor informado): path correto, sem body', () => {
  const r = montarRequisicaoEstorno('123456789');
  assert.deepEqual(r, { path: '/v1/payments/123456789/refunds' });
});

test('estorno parcial (com valor): body com amount em reais', () => {
  const r = montarRequisicaoEstorno('123456789', 15.5);
  assert.deepEqual(r, { path: '/v1/payments/123456789/refunds', body: { amount: 15.5 } });
});

test('payment_id com caracteres especiais é escapado na URL', () => {
  const r = montarRequisicaoEstorno('abc/123?x=1');
  assert.equal(r.path, '/v1/payments/abc%2F123%3Fx%3D1/refunds');
});

test('valor zero explicito ainda monta body (zero e um valor valido, diferente de "nao informado")', () => {
  const r = montarRequisicaoEstorno('123', 0);
  assert.deepEqual(r, { path: '/v1/payments/123/refunds', body: { amount: 0 } });
});
