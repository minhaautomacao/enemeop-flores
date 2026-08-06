// Rodar: npx tsx --test supabase/functions/_shared/cancelamento-decisao.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificarEstagioPedido, decidirCancelamentoPedido, type PedidoParaCancelamento } from './cancelamento-decisao.ts';

function pedido(overrides: Partial<PedidoParaCancelamento> = {}): PedidoParaCancelamento {
  return { status: 'aguardando_pagamento', status_logistica: null, status_producao: null, ...overrides };
}

test('classificarEstagioPedido: pedido nao pago -> pre_pagamento', () => {
  assert.equal(classificarEstagioPedido(pedido({ status: 'aguardando_pagamento' })), 'pre_pagamento');
  assert.equal(classificarEstagioPedido(pedido({ status: 'novo' })), 'pre_pagamento');
});

test('classificarEstagioPedido: pago sem logistica -> pago_pre_logistica', () => {
  assert.equal(classificarEstagioPedido(pedido({ status: 'pago' })), 'pago_pre_logistica');
});

test('classificarEstagioPedido: pago com status_logistica=criada -> logistica_solicitada', () => {
  assert.equal(classificarEstagioPedido(pedido({ status: 'pago', status_logistica: 'criada' })), 'logistica_solicitada');
});

test('classificarEstagioPedido: status_producao=saiu -> entrega_iniciada, mesmo com status_logistica criada', () => {
  assert.equal(classificarEstagioPedido(pedido({ status: 'pago', status_logistica: 'criada', status_producao: 'saiu' })), 'entrega_iniciada');
});

test('classificarEstagioPedido: status_producao=entregue -> entrega_concluida', () => {
  assert.equal(classificarEstagioPedido(pedido({ status: 'pago', status_logistica: 'criada', status_producao: 'entregue' })), 'entrega_concluida');
});

test('classificarEstagioPedido: status=cancelado ou reembolsado -> ja_cancelado_ou_estornado, mesmo com logistica criada (nunca reabre)', () => {
  assert.equal(classificarEstagioPedido(pedido({ status: 'cancelado', status_logistica: 'criada' })), 'ja_cancelado_ou_estornado');
  assert.equal(classificarEstagioPedido(pedido({ status: 'reembolsado' })), 'ja_cancelado_ou_estornado');
});

test('decidirCancelamentoPedido: pre_pagamento cancela direto, nunca precisa de estorno', () => {
  const d = decidirCancelamentoPedido(pedido({ status: 'aguardando_pagamento' }));
  assert.equal(d.acaoRecomendada, 'cancelar_direto');
  assert.equal(d.podeCancelarAutomaticamente, true);
  assert.equal(d.precisaEstorno, false);
  assert.match(d.mensagemParaFlora, /nada foi cobrado/i);
});

test('decidirCancelamentoPedido: pago_pre_logistica precisa de estorno, mas nunca promete estorno concluido', () => {
  const d = decidirCancelamentoPedido(pedido({ status: 'pago' }));
  assert.equal(d.acaoRecomendada, 'cancelar_com_estorno_pendente');
  assert.equal(d.precisaEstorno, true);
  assert.equal(d.precisaCancelarLogisticaAntes, false);
  assert.doesNotMatch(d.mensagemParaFlora, /estorno (concluido|realizado|feito)/i);
  assert.match(d.mensagemParaFlora, /equipe confirma/i);
});

test('decidirCancelamentoPedido: logistica_solicitada tenta cancelar logistica E precisa estorno, avisa sobre taxa', () => {
  const d = decidirCancelamentoPedido(pedido({ status: 'pago', status_logistica: 'criada' }));
  assert.equal(d.acaoRecomendada, 'tentar_cancelar_logistica_e_estornar');
  assert.equal(d.precisaCancelarLogisticaAntes, true);
  assert.equal(d.precisaEstorno, true);
  assert.match(d.mensagemParaFlora, /taxa de cancelamento/i);
});

test('decidirCancelamentoPedido: entrega_iniciada nunca cancela sozinha, sempre escala humano', () => {
  const d = decidirCancelamentoPedido(pedido({ status: 'pago', status_logistica: 'criada', status_producao: 'saiu' }));
  assert.equal(d.acaoRecomendada, 'escalar_humano_sem_prometer');
  assert.equal(d.podeCancelarAutomaticamente, false);
  assert.match(d.mensagemParaFlora, /transferir/i);
});

test('decidirCancelamentoPedido: entrega_concluida nunca cancela sozinha, sempre escala humano', () => {
  const d = decidirCancelamentoPedido(pedido({ status: 'pago', status_logistica: 'criada', status_producao: 'entregue' }));
  assert.equal(d.acaoRecomendada, 'escalar_humano_sem_prometer');
  assert.equal(d.podeCancelarAutomaticamente, false);
});

test('decidirCancelamentoPedido: pedido ja cancelado nunca tenta cancelar de novo', () => {
  const d = decidirCancelamentoPedido(pedido({ status: 'cancelado' }));
  assert.equal(d.acaoRecomendada, 'ja_cancelado');
  assert.equal(d.podeCancelarAutomaticamente, false);
  assert.equal(d.precisaEstorno, false);
});

test('decidirCancelamentoPedido: pedido ja reembolsado nunca tenta cancelar de novo, mesmo se status_logistica ainda diz criada (dado desatualizado)', () => {
  const d = decidirCancelamentoPedido(pedido({ status: 'reembolsado', status_logistica: 'criada' }));
  assert.equal(d.estagio, 'ja_cancelado_ou_estornado');
  assert.equal(d.acaoRecomendada, 'ja_cancelado');
});

test('nenhuma mensagemParaFlora promete estorno automatico/imediato — sempre "equipe confirma" ou similar quando precisaEstorno=true', () => {
  for (const status of ['pago']) {
    const d = decidirCancelamentoPedido(pedido({ status }));
    if (d.precisaEstorno) {
      assert.doesNotMatch(d.mensagemParaFlora, /estorno (foi feito|automatico|imediato)/i);
    }
  }
});
