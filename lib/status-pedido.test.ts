// Testa a classificação central de status de pedido usada pelo painel de
// Produção e pela tela de Status — nunca reaproveita `status` (pagamento)
// com `status_producao` (workflow de cozinha).
// Rodar: npx tsx --test lib/status-pedido.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificarParaProducao, pedidoNoFiltroStatus, FILTROS_PRODUCAO, FILTROS_STATUS_PEDIDOS, lerFiltroProducaoDaUrl, lerFiltroStatusDaUrl } from './status-pedido';

test('pedido aguardando_pagamento é classificado como "em_atendimento", nunca como status de produção', () => {
  assert.equal(classificarParaProducao({ status: 'aguardando_pagamento', status_producao: 'novo' }), 'em_atendimento');
  // Mesmo se status_producao tiver algum valor avançado por engano (bug de
  // outra parte do sistema), pagamento pendente nunca vira "pronto"/"confirmado".
  assert.equal(classificarParaProducao({ status: 'aguardando_pagamento', status_producao: 'pronto' }), 'em_atendimento');
});

test('pedido pago usa status_producao real', () => {
  assert.equal(classificarParaProducao({ status: 'pago', status_producao: 'confirmado' }), 'confirmado');
  assert.equal(classificarParaProducao({ status: 'pago', status_producao: 'preparando' }), 'preparando');
  assert.equal(classificarParaProducao({ status: 'pago', status_producao: 'pronto' }), 'pronto');
  assert.equal(classificarParaProducao({ status: 'pago', status_producao: 'saiu' }), 'saiu');
});

test('pedido pago sem status_producao reconhecido cai em "novo" (default real da coluna no banco)', () => {
  assert.equal(classificarParaProducao({ status: 'pago', status_producao: null }), 'novo');
  assert.equal(classificarParaProducao({ status: 'pago' }), 'novo');
});

test('pagamento recusado, cancelado ou reembolsado nunca aparece em nenhum filtro de produção', () => {
  assert.equal(classificarParaProducao({ status: 'pagamento_recusado', status_producao: 'novo' }), null);
  assert.equal(classificarParaProducao({ status: 'cancelado', status_producao: 'novo' }), null);
  assert.equal(classificarParaProducao({ status: 'reembolsado', status_producao: 'pronto' }), null);
});

test('FILTROS_PRODUCAO tem exatamente os 6 filtros pedidos, na ordem certa', () => {
  assert.deepEqual(FILTROS_PRODUCAO.map(f => f.label), [
    'Pedido em Atendimento', 'Novo', 'Confirmado', 'Preparando', 'Prontos', 'Saiu para Entrega',
  ]);
});

test('FILTROS_STATUS_PEDIDOS tem exatamente os 4 filtros pedidos, na ordem certa', () => {
  assert.deepEqual(FILTROS_STATUS_PEDIDOS.map(f => f.label), ['Em aberto', 'Preparando', 'Prontos', 'Entregues']);
});

test('pedidoNoFiltroStatus: "em aberto" é somente novo + confirmado', () => {
  assert.equal(pedidoNoFiltroStatus('novo', 'em_aberto'), true);
  assert.equal(pedidoNoFiltroStatus('confirmado', 'em_aberto'), true);
  assert.equal(pedidoNoFiltroStatus('preparando', 'em_aberto'), false);
  assert.equal(pedidoNoFiltroStatus('pronto', 'em_aberto'), false);
  assert.equal(pedidoNoFiltroStatus('saiu', 'em_aberto'), false);
  assert.equal(pedidoNoFiltroStatus('entregue', 'em_aberto'), false);
});

test('pedidoNoFiltroStatus: "saiu" nunca aparece em nenhum dos 4 filtros desta tela (visualização própria fica no Painel de Produção)', () => {
  for (const filtro of ['em_aberto', 'preparando', 'prontos', 'entregues'] as const) {
    assert.equal(pedidoNoFiltroStatus('saiu', filtro), false, `'saiu' não deveria aparecer no filtro '${filtro}'`);
  }
});

test('pedidoNoFiltroStatus: os 4 filtros são mutuamente exclusivos — cada status real cai em no máximo um', () => {
  const statusReais = ['novo', 'confirmado', 'preparando', 'pronto', 'saiu', 'entregue'] as const;
  const filtros = ['em_aberto', 'preparando', 'prontos', 'entregues'] as const;
  for (const status of statusReais) {
    const filtrosQueBatem = filtros.filter(f => pedidoNoFiltroStatus(status, f));
    assert.ok(filtrosQueBatem.length <= 1, `status '${status}' bateu em mais de um filtro: ${filtrosQueBatem.join(', ')}`);
  }
});

test('pedidoNoFiltroStatus: preparando/prontos/entregues continuam isolados', () => {
  assert.equal(pedidoNoFiltroStatus('preparando', 'preparando'), true);
  assert.equal(pedidoNoFiltroStatus('pronto', 'preparando'), false);
  assert.equal(pedidoNoFiltroStatus('pronto', 'prontos'), true);
  assert.equal(pedidoNoFiltroStatus('preparando', 'prontos'), false);
  assert.equal(pedidoNoFiltroStatus('entregue', 'entregues'), true);
  assert.equal(pedidoNoFiltroStatus('confirmado', 'entregues'), false);
});

// ── Filtro persistido via query string (refresh nunca perde o filtro) ────

test('lerFiltroProducaoDaUrl: sem query string, cai no padrão "novo"', () => {
  assert.equal(lerFiltroProducaoDaUrl(''), 'novo');
});

test('lerFiltroProducaoDaUrl: lê cada filtro real, inclusive "em_atendimento"', () => {
  assert.equal(lerFiltroProducaoDaUrl('?status=em_atendimento'), 'em_atendimento');
  assert.equal(lerFiltroProducaoDaUrl('?status=preparando'), 'preparando');
  assert.equal(lerFiltroProducaoDaUrl('?status=saiu'), 'saiu');
});

test('lerFiltroProducaoDaUrl: valor inválido/adulterado na URL nunca é aceito, cai no padrão', () => {
  assert.equal(lerFiltroProducaoDaUrl('?status=pago'), 'novo');
  assert.equal(lerFiltroProducaoDaUrl('?status=<script>'), 'novo');
});

test('lerFiltroStatusDaUrl: sem query string, cai no padrão "em_aberto"', () => {
  assert.equal(lerFiltroStatusDaUrl(''), 'em_aberto');
});

test('lerFiltroStatusDaUrl: lê cada filtro real', () => {
  assert.equal(lerFiltroStatusDaUrl('?status=preparando'), 'preparando');
  assert.equal(lerFiltroStatusDaUrl('?status=prontos'), 'prontos');
  assert.equal(lerFiltroStatusDaUrl('?status=entregues'), 'entregues');
});

test('lerFiltroStatusDaUrl: valor inválido nunca é aceito, cai no padrão', () => {
  assert.equal(lerFiltroStatusDaUrl('?status=em_atendimento'), 'em_aberto');
  assert.equal(lerFiltroStatusDaUrl('?status=novo'), 'em_aberto');
});

// ── Pipeline completo (classificar -> filtrar): "Em aberto" nunca vaza
// pedido recusado/cancelado/reembolsado nem pedido ainda não pago ──────────

test('pipeline: pedido cancelado/recusado/reembolsado nunca aparece em "Em aberto" da tela de Status', () => {
  for (const status of ['cancelado', 'pagamento_recusado', 'reembolsado']) {
    const filtroProducao = classificarParaProducao({ status, status_producao: 'novo' });
    // A tela de Status descarta null e 'em_atendimento' antes de checar
    // pedidoNoFiltroStatus — nunca chega a ser avaliado como "em aberto".
    assert.equal(filtroProducao, null, `status '${status}' deveria ser excluído (null), nunca aparecer em produção`);
  }
});

test('pipeline: pedido aguardando_pagamento nunca aparece em "Em aberto" da tela de Status (só produção real, pedidos pagos)', () => {
  const filtroProducao = classificarParaProducao({ status: 'aguardando_pagamento', status_producao: 'novo' });
  assert.equal(filtroProducao, 'em_atendimento');
  // A tela de Status filtra explicitamente 'em_atendimento' fora da lista
  // antes de aplicar pedidoNoFiltroStatus — nunca é tratado como produção aberta.
  assert.notEqual(filtroProducao, 'novo');
});
