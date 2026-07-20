// Testa a validação de acesso ao CRM interno (leads-enemeop, conversas-enemeop).
// Rodar: npx tsx --test supabase/functions/_shared/auth-crm.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autorizacaoValida } from './auth-crm.ts';

const SEGREDO_REAL = 'segredo-de-teste-super-secreto-12345';

test('sem header Authorization: acesso negado', async () => {
  const ok = await autorizacaoValida(null, SEGREDO_REAL);
  assert.equal(ok, false);
});

test('header Authorization vazio: acesso negado', async () => {
  const ok = await autorizacaoValida('', SEGREDO_REAL);
  assert.equal(ok, false);
});

test('header malformado (sem "Bearer "): acesso negado', async () => {
  const ok = await autorizacaoValida(SEGREDO_REAL, SEGREDO_REAL);
  assert.equal(ok, false);
});

test('segredo incorreto: acesso negado', async () => {
  const ok = await autorizacaoValida('Bearer segredo-errado', SEGREDO_REAL);
  assert.equal(ok, false);
});

test('segredo correto: acesso permitido', async () => {
  const ok = await autorizacaoValida(`Bearer ${SEGREDO_REAL}`, SEGREDO_REAL);
  assert.equal(ok, true);
});

test('FACTORY_SECRET não configurado no servidor: nunca autoriza, mesmo com header presente', async () => {
  const ok = await autorizacaoValida(`Bearer ${SEGREDO_REAL}`, undefined);
  assert.equal(ok, false);
});

test('token com espaços extras ou case diferente não é aceito por engano', async () => {
  const ok = await autorizacaoValida(`Bearer ${SEGREDO_REAL.toUpperCase()}`, SEGREDO_REAL);
  assert.equal(ok, false);
});

test('o segredo nunca aparece em nenhuma saída de console durante a validação', async () => {
  const chamadas: unknown[] = [];
  const originais = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  console.log = console.error = console.warn = console.info = (...args: unknown[]) => { chamadas.push(args); };
  try {
    await autorizacaoValida('Bearer segredo-errado', SEGREDO_REAL);
    await autorizacaoValida(`Bearer ${SEGREDO_REAL}`, SEGREDO_REAL);
  } finally {
    console.log = originais.log;
    console.error = originais.error;
    console.warn = originais.warn;
    console.info = originais.info;
  }
  const textoCompleto = JSON.stringify(chamadas);
  assert.equal(chamadas.length, 0, 'autorizacaoValida nunca deve logar nada');
  assert.equal(textoCompleto.includes(SEGREDO_REAL), false);
});
