// Testa a decisão pura de mensagem duplicada (sem I/O, sem Deno.serve).
// Rodar: npx tsx --test supabase/functions/webhook-meta/dedup.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mensagemDuplicada, type MensagemHistorico } from './dedup.ts';

test('evento Meta repetido: mesmo mid ja presente no historico e bloqueado', () => {
  const historico: MensagemHistorico[] = [
    { role: 'user', content: 'Tem arranjo de aniversario?', ts: '2026-07-19T10:00:00.000Z', mid: 'mid-abc-123' },
    { role: 'assistant', content: 'Temos sim! ...', ts: '2026-07-19T10:00:01.000Z' },
  ];
  const duplicada = mensagemDuplicada(historico, 'Tem arranjo de aniversario?', 'mid-abc-123', new Date('2026-07-19T10:05:00.000Z'));
  assert.equal(duplicada, true);
});

test('mid novo (nunca visto) nao e bloqueado mesmo com conteudo repetido antigo', () => {
  const historico: MensagemHistorico[] = [
    { role: 'user', content: 'Tem arranjo de aniversario?', ts: '2026-07-19T10:00:00.000Z', mid: 'mid-abc-123' },
    { role: 'assistant', content: 'Temos sim! ...', ts: '2026-07-19T10:00:01.000Z' },
  ];
  const duplicada = mensagemDuplicada(historico, 'Outra pergunta', 'mid-novo-999', new Date('2026-07-19T10:05:00.000Z'));
  assert.equal(duplicada, false);
});

test('mensagem duplicada por conversa/conteudo: ultima mensagem do cliente identica, chegada ha pouco tempo, e bloqueada mesmo sem mid', () => {
  const historico: MensagemHistorico[] = [
    { role: 'assistant', content: 'Oi! Pode me dizer seu nome?', ts: '2026-07-19T10:00:00.000Z' },
    { role: 'user', content: 'Tem arranjo de aniversario?', ts: '2026-07-19T10:00:05.000Z' },
  ];
  const duplicada = mensagemDuplicada(historico, 'Tem arranjo de aniversario?', undefined, new Date('2026-07-19T10:00:10.000Z'));
  assert.equal(duplicada, true);
});

test('conteudo identico mas ha muito tempo (fora da janela) NAO e bloqueado — pode ser um pedido novo genuino', () => {
  const historico: MensagemHistorico[] = [
    { role: 'user', content: 'Tem arranjo de aniversario?', ts: '2026-07-19T10:00:00.000Z' },
  ];
  const duplicada = mensagemDuplicada(historico, 'Tem arranjo de aniversario?', undefined, new Date('2026-07-19T10:10:00.000Z'));
  assert.equal(duplicada, false);
});

test('ultima mensagem do historico e da assistente (nao do cliente) — nunca bloqueia por conteudo', () => {
  const historico: MensagemHistorico[] = [
    { role: 'user', content: 'oi', ts: '2026-07-19T10:00:00.000Z' },
    { role: 'assistant', content: 'Tem arranjo de aniversario?', ts: '2026-07-19T10:00:01.000Z' },
  ];
  const duplicada = mensagemDuplicada(historico, 'Tem arranjo de aniversario?', undefined, new Date('2026-07-19T10:00:02.000Z'));
  assert.equal(duplicada, false);
});

test('historico vazio nunca e duplicata', () => {
  assert.equal(mensagemDuplicada([], 'Oi', undefined), false);
  assert.equal(mensagemDuplicada([], 'Oi', 'mid-1'), false);
});
