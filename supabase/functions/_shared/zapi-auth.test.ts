// Rodar: npx tsx --test supabase/functions/_shared/zapi-auth.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarTokenWebhook } from './zapi-auth.ts';

test('token correto -> valido', async () => {
  assert.equal(await validarTokenWebhook('segredo-forte-123', 'segredo-forte-123'), 'valido');
});

test('token ausente (string vazia), com secret configurado -> invalido (401)', async () => {
  assert.equal(await validarTokenWebhook('segredo-forte-123', ''), 'invalido');
});

test('token incorreto, com secret configurado -> invalido (401)', async () => {
  assert.equal(await validarTokenWebhook('segredo-forte-123', 'chute-do-atacante'), 'invalido');
});

test('secret nao configurado -> sem_segredo_configurado, nunca "invalido" (nunca derruba o canal antes da configuracao manual)', async () => {
  assert.equal(await validarTokenWebhook('', ''), 'sem_segredo_configurado');
  assert.equal(await validarTokenWebhook('', 'qualquer-coisa'), 'sem_segredo_configurado');
});

test('comparacao e sensivel a caso e a espacos — nunca normaliza o token recebido', async () => {
  assert.equal(await validarTokenWebhook('Segredo123', 'segredo123'), 'invalido');
  assert.equal(await validarTokenWebhook('segredo123', 'segredo123 '), 'invalido');
});
