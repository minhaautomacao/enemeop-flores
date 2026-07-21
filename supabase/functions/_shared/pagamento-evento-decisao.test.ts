// Rodar: npx tsx --test supabase/functions/_shared/pagamento-evento-decisao.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirProcessamentoEvento } from './pagamento-evento-decisao.ts';

test('evento genuinamente novo (insert sem conflito) -> processa completo', () => {
  const d = decidirProcessamentoEvento(null, false);
  assert.deepEqual(d, { acao: 'processar_completo' });
});

test('evento repetido ja processado com sucesso -> nunca notifica de novo, so tenta retomar logistica', () => {
  const d = decidirProcessamentoEvento({ processamento_status: 'ok', tentativas: 1 }, false);
  assert.deepEqual(d, { acao: 'retomar_logistica_apenas' });
});

test('evento repetido que tinha falhado antes e foi reivindicado agora -> processa completo (nunca notificou antes)', () => {
  const d = decidirProcessamentoEvento({ processamento_status: 'erro', tentativas: 1 }, true);
  assert.deepEqual(d, { acao: 'processar_completo' });
});

test('evento em erro mas NAO reivindicado agora (outra execucao ganhou a corrida) -> nunca processa completo, evita notificacao duplicada', () => {
  const d = decidirProcessamentoEvento({ processamento_status: 'erro', tentativas: 2 }, false);
  assert.deepEqual(d, { acao: 'retomar_logistica_apenas' });
});

test('evento com status_processando de outra execucao concorrente -> nunca processa completo', () => {
  const d = decidirProcessamentoEvento({ processamento_status: 'processando', tentativas: 1 }, false);
  assert.deepEqual(d, { acao: 'retomar_logistica_apenas' });
});
