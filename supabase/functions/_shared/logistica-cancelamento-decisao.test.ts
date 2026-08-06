// Rodar: npx tsx --test supabase/functions/_shared/logistica-cancelamento-decisao.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decidirAcaoCancelamentoLogistica,
  statusCancelamentoLogisticaReivindicavel,
  LIMITE_PENDENTE_CANCELAMENTO_AMBIGUO_MS,
} from './logistica-cancelamento-decisao.ts';

test('entrega nunca criada -> nunca tenta cancelar', () => {
  const d = decidirAcaoCancelamentoLogistica({ status_logistica: null, lalamove_order_id: null });
  assert.deepEqual(d, { acao: 'pular', motivo: 'nao_criada' });
});

test('status_logistica=criada com lalamove_order_id presente -> cancela', () => {
  const d = decidirAcaoCancelamentoLogistica({ status_logistica: 'criada', lalamove_order_id: 'abc123' });
  assert.deepEqual(d, { acao: 'cancelar' });
});

test('status_logistica=criada mas sem lalamove_order_id (estado inconsistente) -> nunca tenta cancelar', () => {
  const d = decidirAcaoCancelamentoLogistica({ status_logistica: 'criada', lalamove_order_id: null });
  assert.deepEqual(d, { acao: 'pular', motivo: 'nao_criada' });
});

test('ja cancelada -> nunca tenta de novo', () => {
  const d = decidirAcaoCancelamentoLogistica({ status_logistica: 'cancelada', lalamove_order_id: 'abc123' });
  assert.deepEqual(d, { acao: 'pular', motivo: 'ja_cancelada' });
});

test('cancelamento ja negado pela transportadora -> nunca retry automatico', () => {
  const d = decidirAcaoCancelamentoLogistica({ status_logistica: 'cancelamento_negado', lalamove_order_id: 'abc123' });
  assert.deepEqual(d, { acao: 'pular', motivo: 'cancelamento_negado_anteriormente' });
});

test('claim de cancelamento recente -> outra execucao provavelmente em andamento, nunca reivindica de novo', () => {
  const agora = new Date('2026-08-06T12:00:00Z');
  const pendenteDesde = new Date(agora.getTime() - 10_000).toISOString();
  const d = decidirAcaoCancelamentoLogistica({ status_logistica: 'cancelamento_solicitado', lalamove_order_id: 'abc123', logistica_cancelamento_pendente_desde: pendenteDesde }, agora);
  assert.deepEqual(d, { acao: 'pular', motivo: 'claim_em_andamento' });
});

test('claim de cancelamento mais velho que o limite -> ambiguo, nunca retry cego', () => {
  const agora = new Date('2026-08-06T12:00:00Z');
  const pendenteDesde = new Date(agora.getTime() - (LIMITE_PENDENTE_CANCELAMENTO_AMBIGUO_MS + 1000)).toISOString();
  const d = decidirAcaoCancelamentoLogistica({ status_logistica: 'cancelamento_solicitado', lalamove_order_id: 'abc123', logistica_cancelamento_pendente_desde: pendenteDesde }, agora);
  assert.deepEqual(d, { acao: 'marcar_ambiguo_por_timeout' });
});

test('claim de cancelamento sem timestamp (dado corrompido) -> tratado como ambiguo', () => {
  const d = decidirAcaoCancelamentoLogistica({ status_logistica: 'cancelamento_solicitado', lalamove_order_id: 'abc123', logistica_cancelamento_pendente_desde: null });
  assert.deepEqual(d, { acao: 'marcar_ambiguo_por_timeout' });
});

test('statusCancelamentoLogisticaReivindicavel: so "criada" e reivindicavel', () => {
  assert.equal(statusCancelamentoLogisticaReivindicavel('criada'), true);
  assert.equal(statusCancelamentoLogisticaReivindicavel(null), false);
  assert.equal(statusCancelamentoLogisticaReivindicavel('cancelada'), false);
  assert.equal(statusCancelamentoLogisticaReivindicavel('cancelamento_negado'), false);
  assert.equal(statusCancelamentoLogisticaReivindicavel('cancelamento_solicitado'), false);
  assert.equal(statusCancelamentoLogisticaReivindicavel('erro_logistica'), false);
});
