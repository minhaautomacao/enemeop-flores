// Testa a parte pura de mercadopago.ts (sem I/O real — nem fetch, nem DB).
// criarPreferenciaMercadoPago/buscarPagamentoReal/validarAssinaturaWebhook
// (as versões com I/O) são verificadas na integração real, não aqui — mesmo
// espírito de _shared/whatsapp.ts, que também não tem teste unitário
// próprio por ser puramente um adaptador de borda.
//
// Rodar: npx tsx --test supabase/functions/_shared/mercadopago.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarAssinaturaComSegredo } from './mercadopago-assinatura.ts';

// Vetor conhecido: HMAC-SHA256("id:123456789;request-id:abc-123;ts:1700000000;", "test_secret_123")
// calculado independentemente via node:crypto — confirma que a implementação
// em Deno (Web Crypto) produz exatamente o mesmo resultado.
const SECRET = 'test_secret_123';
const DATA_ID = '123456789';
const REQUEST_ID = 'abc-123';
const TS = '1700000000';
const HMAC_ESPERADO = 'd95be06c890e2664d693f9e54eff3fd3eb2ea287fe520c1af24401ba28b8b4eb';

function assinatura(v1: string, ts = TS): string {
  return `ts=${ts},v1=${v1}`;
}

test('validarAssinaturaComSegredo: assinatura correta (vetor HMAC-SHA256 conhecido) é válida', async () => {
  const resultado = await validarAssinaturaComSegredo(SECRET, assinatura(HMAC_ESPERADO), REQUEST_ID, DATA_ID);
  assert.equal(resultado, 'valida');
});

test('validarAssinaturaComSegredo: hash errado é invalida', async () => {
  const resultado = await validarAssinaturaComSegredo(SECRET, assinatura('0'.repeat(64)), REQUEST_ID, DATA_ID);
  assert.equal(resultado, 'invalida');
});

test('validarAssinaturaComSegredo: segredo errado produz invalida', async () => {
  const resultado = await validarAssinaturaComSegredo('outro-segredo', assinatura(HMAC_ESPERADO), REQUEST_ID, DATA_ID);
  assert.equal(resultado, 'invalida');
});

test('validarAssinaturaComSegredo: dataId com maiusculas ainda valida (manifest usa lowercase)', async () => {
  const resultado = await validarAssinaturaComSegredo(SECRET, assinatura(HMAC_ESPERADO), REQUEST_ID, DATA_ID.toUpperCase());
  assert.equal(resultado, 'valida');
});

test('validarAssinaturaComSegredo: x-signature ausente é invalida', async () => {
  const resultado = await validarAssinaturaComSegredo(SECRET, null, REQUEST_ID, DATA_ID);
  assert.equal(resultado, 'invalida');
});

test('validarAssinaturaComSegredo: x-request-id ausente é invalida', async () => {
  const resultado = await validarAssinaturaComSegredo(SECRET, assinatura(HMAC_ESPERADO), null, DATA_ID);
  assert.equal(resultado, 'invalida');
});

test('validarAssinaturaComSegredo: header sem ts ou sem v1 é invalida', async () => {
  const semTs = await validarAssinaturaComSegredo(SECRET, `v1=${HMAC_ESPERADO}`, REQUEST_ID, DATA_ID);
  assert.equal(semTs, 'invalida');
  const semV1 = await validarAssinaturaComSegredo(SECRET, `ts=${TS}`, REQUEST_ID, DATA_ID);
  assert.equal(semV1, 'invalida');
});

test('validarAssinaturaComSegredo: ts diferente do usado no manifest original invalida (replay simples)', async () => {
  const resultado = await validarAssinaturaComSegredo(SECRET, assinatura(HMAC_ESPERADO, '1700000001'), REQUEST_ID, DATA_ID);
  assert.equal(resultado, 'invalida');
});
