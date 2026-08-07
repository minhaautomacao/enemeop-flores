// Rodar: npx tsx --test supabase/functions/_shared/resolucao-ambiente.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolverPagamentoEAmbiente, type BuscadorPagamento } from './resolucao-ambiente.ts';
import type { PagamentoReal, ResultadoBuscaPagamento } from './mercadopago.ts';

const PAGAMENTO_FAKE: PagamentoReal = {
  id: 'pay-123',
  status: 'approved',
  valor: 100,
  metodo: 'pix',
  externalReference: 'enemeop-abc',
};

function buscadorFake(
  respostas: Partial<Record<'producao' | 'teste', ResultadoBuscaPagamento>>,
  chamadas: string[] = [],
): BuscadorPagamento {
  return async (ambiente, _paymentId) => {
    chamadas.push(ambiente);
    return respostas[ambiente] ?? { ok: false, motivo: 'nao_encontrado' };
  };
}

test('pagamento existe em produção -> resolve produção sem nunca tentar teste', async () => {
  const chamadas: string[] = [];
  const buscar = buscadorFake({ producao: { ok: true, pagamento: PAGAMENTO_FAKE } }, chamadas);
  const r = await resolverPagamentoEAmbiente('pay-123', buscar);
  assert.equal(r.resolvido, true);
  if (r.resolvido) assert.equal(r.ambiente, 'producao');
  assert.deepEqual(chamadas, ['producao'], 'nunca deve consultar teste se produção já respondeu ok');
});

test('não encontrado em produção, existe em teste -> resolve teste', async () => {
  const chamadas: string[] = [];
  const buscar = buscadorFake({
    producao: { ok: false, motivo: 'nao_encontrado' },
    teste: { ok: true, pagamento: PAGAMENTO_FAKE },
  }, chamadas);
  const r = await resolverPagamentoEAmbiente('pay-123', buscar);
  assert.equal(r.resolvido, true);
  if (r.resolvido) assert.equal(r.ambiente, 'teste');
  assert.deepEqual(chamadas, ['producao', 'teste']);
});

test('não encontrado nos dois ambientes -> resolvido:false, motivo nao_encontrado_em_nenhum_ambiente', async () => {
  const buscar = buscadorFake({
    producao: { ok: false, motivo: 'nao_encontrado' },
    teste: { ok: false, motivo: 'nao_encontrado' },
  });
  const r = await resolverPagamentoEAmbiente('pay-123', buscar);
  assert.equal(r.resolvido, false);
  if (!r.resolvido) assert.equal(r.motivo, 'nao_encontrado_em_nenhum_ambiente');
});

test('erro transitório em produção (ex.: 401/500/timeout) NUNCA tenta teste, propaga como erro real', async () => {
  const chamadas: string[] = [];
  const buscar = buscadorFake({
    producao: { ok: false, motivo: 'erro_transitorio', detalhe: 'HTTP 500: instabilidade' },
  }, chamadas);
  const r = await resolverPagamentoEAmbiente('pay-123', buscar);
  assert.equal(r.resolvido, false);
  if (!r.resolvido) {
    assert.equal(r.motivo, 'erro_transitorio');
    if (r.motivo === 'erro_transitorio') assert.equal(r.detalhe, 'HTTP 500: instabilidade');
  }
  assert.deepEqual(chamadas, ['producao'], 'erro transitorio nunca deve mascarar-se como "tenta o outro ambiente"');
});

test('erro transitório em teste (depois de 404 real em produção) também propaga como erro, nunca vira "não encontrado"', async () => {
  const buscar = buscadorFake({
    producao: { ok: false, motivo: 'nao_encontrado' },
    teste: { ok: false, motivo: 'erro_transitorio', detalhe: 'timeout' },
  });
  const r = await resolverPagamentoEAmbiente('pay-123', buscar);
  assert.equal(r.resolvido, false);
  if (!r.resolvido) assert.equal(r.motivo, 'erro_transitorio');
});

test('sem credencial configurada em produção -> nunca tenta teste, propaga sem_credencial', async () => {
  const chamadas: string[] = [];
  const buscar = buscadorFake({ producao: { ok: false, motivo: 'sem_credencial' } }, chamadas);
  const r = await resolverPagamentoEAmbiente('pay-123', buscar);
  assert.equal(r.resolvido, false);
  if (!r.resolvido) assert.equal(r.motivo, 'sem_credencial');
  assert.deepEqual(chamadas, ['producao']);
});
