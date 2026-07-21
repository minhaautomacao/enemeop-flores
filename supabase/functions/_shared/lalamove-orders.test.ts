// Testa o contrato do payload de POST /v3/orders (Parte 4) — puro, sem
// mockar fetch: monta o corpo exato que seria enviado e verifica que só
// contém campos documentados oficialmente pela Lalamove v3 (quotationId,
// sender{stopId,name,phone}, recipients[{stopId,name,phone}], metadata).
// Nunca cria uma corrida real.
// Rodar: npx tsx --test supabase/functions/_shared/lalamove-orders.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarPayloadCriarEntrega, type CriarEntregaParams } from './lalamove-orders.ts';

const PARAMS: CriarEntregaParams = {
  quotationId: 'quotation-123',
  expiresAt: '2026-07-21T23:00:00.00Z',
  remetente: { stopId: 'stop-origem-1', nome: 'Enemeop Flores', telefone: '+5511999990000' },
  destinatario: { stopId: 'stop-destino-1', nome: 'Camila', telefone: '+5511988880000' },
  pedidoId: 'pedido-abc',
};

test('payload contem exatamente os campos documentados sob data: quotationId, sender, recipients, metadata', () => {
  const payload = montarPayloadCriarEntrega(PARAMS);
  assert.deepEqual(Object.keys(payload).sort(), ['data']);
  assert.deepEqual(Object.keys(payload.data).sort(), ['metadata', 'quotationId', 'recipients', 'sender']);
});

test('sender contem exatamente stopId, name, phone — nunca campos extras', () => {
  const payload = montarPayloadCriarEntrega(PARAMS);
  assert.deepEqual(Object.keys(payload.data.sender).sort(), ['name', 'phone', 'stopId']);
  assert.equal(payload.data.sender.stopId, 'stop-origem-1');
  assert.equal(payload.data.sender.name, 'Enemeop Flores');
  assert.equal(payload.data.sender.phone, '+5511999990000');
});

test('recipients e um array com exatamente um destinatario, contendo so stopId, name, phone', () => {
  const payload = montarPayloadCriarEntrega(PARAMS);
  assert.equal(payload.data.recipients.length, 1);
  assert.deepEqual(Object.keys(payload.data.recipients[0]).sort(), ['name', 'phone', 'stopId']);
  assert.equal(payload.data.recipients[0].stopId, 'stop-destino-1');
});

test('nunca inclui isPODEnabled, partner ou qualquer campo fora do schema documentado', () => {
  const payload = montarPayloadCriarEntrega(PARAMS);
  const chaves = Object.keys(payload.data);
  assert.equal(chaves.includes('isPODEnabled'), false);
  assert.equal(chaves.includes('partner'), false);
  assert.equal(chaves.includes('specialRequests'), false);
});

test('metadata contem so o pedidoId — nunca dados pessoais do cliente (nome/telefone ja vao em sender/recipients)', () => {
  const payload = montarPayloadCriarEntrega(PARAMS);
  assert.deepEqual(payload.data.metadata, { pedidoId: 'pedido-abc' });
});

test('quotationId e passado exatamente como recebido, sem transformacao', () => {
  const payload = montarPayloadCriarEntrega(PARAMS);
  assert.equal(payload.data.quotationId, 'quotation-123');
});
