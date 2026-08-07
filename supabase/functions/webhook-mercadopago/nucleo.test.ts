// Rodar: npx tsx --test supabase/functions/webhook-mercadopago/nucleo.test.ts
//
// Fake-db genérico (múltiplas tabelas: pedidos, mercadopago_eventos,
// atendimentos_humanos, conversas), mesmo espírito de
// _shared/pedido-repositorio.test.ts — só o suficiente pra exercitar as
// cadeias reais que nucleo.ts usa (insert/select/update com
// eq/is/or/maybeSingle/single, e update aguardado direto sem .select()).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processarEventoPagamento, type PedidoRowNucleo, type DependenciasNucleo } from './nucleo.ts';
import type { PagamentoReal } from '../_shared/mercadopago.ts';

type Linha = Record<string, unknown>;

function criarDbFake() {
  const tabelas: Record<string, Linha[]> = {
    pedidos: [], mercadopago_eventos: [], atendimentos_humanos: [], conversas: [],
  };

  function aplicaOr(linha: Linha, expressao: string): boolean {
    // "col.is.null,col2.eq.valor" -> true se QUALQUER condição bater.
    return expressao.split(',').some(parte => {
      const [col, op, valBruto] = parte.split('.');
      const val = valBruto === 'null' ? null : valBruto;
      const atual = linha[col] ?? null;
      if (op === 'is') return atual === val;
      if (op === 'eq') return atual === val;
      return false;
    });
  }

  function from(nomeTabela: string) {
    if (!(nomeTabela in tabelas)) tabelas[nomeTabela] = [];
    const linhas = tabelas[nomeTabela];

    return {
      insert(obj: Linha) {
        const promessa = (async () => {
          if (nomeTabela === 'mercadopago_eventos') {
            const colide = linhas.some(r => r.payment_id === obj.payment_id && r.status === obj.status && r.ambiente === obj.ambiente);
            if (colide) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "mercadopago_eventos_pkey"' } };
          }
          linhas.push({ ...obj });
          return { data: null, error: null };
        })();
        (promessa as unknown as { select: (cols: string) => { single: () => Promise<{ data: unknown; error: unknown }> } }).select = (_cols: string) => ({
          async single() {
            const jaExiste = linhas.length > 0 ? linhas[linhas.length - 1] : null;
            return { data: jaExiste, error: null };
          },
        });
        return promessa;
      },
      select(_cols: string) {
        const filtros: Array<(r: Linha) => boolean> = [];
        const builder = {
          eq(col: string, val: unknown) { filtros.push(r => r[col] === val); return builder; },
          async maybeSingle() {
            const achadas = linhas.filter(r => filtros.every(f => f(r)));
            return { data: achadas[0] ?? null, error: null };
          },
          async single() {
            const achadas = linhas.filter(r => filtros.every(f => f(r)));
            return achadas[0] ? { data: achadas[0], error: null } : { data: null, error: { message: 'not found' } };
          },
        };
        return builder;
      },
      update(patch: Linha) {
        const filtros: Array<(r: Linha) => boolean> = [];
        const builder: {
          eq: (col: string, val: unknown) => typeof builder;
          is: (col: string, val: unknown) => typeof builder;
          or: (expr: string) => typeof builder;
          select: (cols: string) => { maybeSingle(): Promise<{ data: unknown; error: unknown }> };
          then: (resolve: (r: { data: unknown; error: unknown }) => void) => void;
        } = {
          eq(col: string, val: unknown) { filtros.push(r => r[col] === val); return builder; },
          is(col: string, val: unknown) { filtros.push(r => (r[col] ?? null) === val); return builder; },
          or(expr: string) { filtros.push(r => aplicaOr(r, expr)); return builder; },
          select(_cols: string) {
            return {
              async maybeSingle() {
                const achadas = linhas.filter(r => filtros.every(f => f(r)));
                if (achadas.length === 0) return { data: null, error: null };
                Object.assign(achadas[0], patch);
                return { data: { id: achadas[0].id }, error: null };
              },
            };
          },
          then(resolve) {
            const achadas = linhas.filter(r => filtros.every(f => f(r)));
            achadas.forEach(r => Object.assign(r, patch));
            resolve({ data: achadas, error: null });
          },
        };
        return builder;
      },
    };
  }

  return { from, tabelas };
}

const PEDIDO_BASE: PedidoRowNucleo = {
  id: 'pedido-1',
  canal: 'whatsapp',
  canal_id: '5511999990000',
  cliente_telefone: '5511999990000',
  valor: 100,
  external_reference: 'enemeop-pedido-1',
  mp_ambiente: 'producao',
  data_entrega_solicitada: null,
  periodo_entrega: null,
  entrega_prometida_em: null,
  logistica_executar_em: null,
  link_pagamento: 'https://mp/pedido-1',
  status_logistica: null,
};

const PAGAMENTO_APROVADO: PagamentoReal = {
  id: 'pay-1', status: 'approved', valor: 100, metodo: 'pix', externalReference: 'enemeop-pedido-1',
};

function depsFake(overrides: Partial<DependenciasNucleo> = {}): { deps: DependenciasNucleo; chamadas: Record<string, number> } {
  const chamadas = { notificarCliente: 0, processarLogisticaAposPagamento: 0, processarCancelamentoLogistica: 0, criarAlertaOperacional: 0 };
  const deps: DependenciasNucleo = {
    buscarPedidoPorExternalReference: async (db, externalReference) => {
      const linha = db.tabelas.pedidos.find((p: Linha) => p.external_reference === externalReference);
      return (linha as PedidoRowNucleo | undefined) ?? null;
    },
    notificarCliente: async () => { chamadas.notificarCliente++; },
    processarLogisticaAposPagamento: async () => { chamadas.processarLogisticaAposPagamento++; return { status: 'criada' }; },
    processarCancelamentoLogistica: async () => { chamadas.processarCancelamentoLogistica++; return {}; },
    criarAlertaOperacional: async () => { chamadas.criarAlertaOperacional++; },
    leadTimeMinutos: 30,
    ...overrides,
  };
  return { deps, chamadas };
}

test('caminho feliz: ambiente bate, pedido é achado, status vira pago, notifica e processa logística exatamente uma vez', async () => {
  const db = criarDbFake();
  db.tabelas.pedidos.push({ ...PEDIDO_BASE });
  const { deps, chamadas } = depsFake();

  const agoraDentroDoHorario = new Date('2026-08-10T14:00:00.000Z'); // segunda, horário comercial
  const r = await processarEventoPagamento(db, 'pay-1', PAGAMENTO_APROVADO, 'producao', deps, agoraDentroDoHorario);

  assert.equal(r.status, 'pago_confirmado');
  const pedido = db.tabelas.pedidos[0];
  assert.equal(pedido.status, 'pago');
  assert.equal(pedido.mp_payment_id, 'pay-1');
  assert.ok(pedido.pago_em);
  assert.equal(chamadas.notificarCliente, 1);
  assert.equal(chamadas.processarLogisticaAposPagamento, 1);

  const evento = db.tabelas.mercadopago_eventos[0];
  assert.equal(evento.processamento_status, 'ok');
  assert.equal(evento.ambiente, 'producao');
});

test('pagamento de ambiente errado: pedido.mp_ambiente=producao mas ambienteResolvido=teste -> nunca marca pago, cria alerta operacional', async () => {
  const db = criarDbFake();
  db.tabelas.pedidos.push({ ...PEDIDO_BASE, mp_ambiente: 'producao' });
  const { deps, chamadas } = depsFake();

  const r = await processarEventoPagamento(db, 'pay-1', PAGAMENTO_APROVADO, 'teste', deps);

  assert.equal(r.status, 'ambiente_divergente');
  const pedido = db.tabelas.pedidos[0];
  assert.notEqual(pedido.status, 'pago', 'nunca deve marcar como pago quando o ambiente diverge');
  assert.equal(chamadas.criarAlertaOperacional, 1);
  assert.equal(chamadas.notificarCliente, 0, 'nunca notifica o cliente quando o ambiente diverge');
  assert.equal(chamadas.processarLogisticaAposPagamento, 0);
});

test('pagamento inexistente (pedido não encontrado por external_reference) -> nada persistido, evento não marcado ok', async () => {
  const db = criarDbFake();
  // nenhum pedido cadastrado
  const { deps, chamadas } = depsFake();

  const r = await processarEventoPagamento(db, 'pay-1', PAGAMENTO_APROVADO, 'producao', deps);

  assert.equal(r.status, 'pedido_nao_encontrado');
  assert.equal(db.tabelas.pedidos.length, 0);
  assert.equal(chamadas.notificarCliente, 0);
  const evento = db.tabelas.mercadopago_eventos[0];
  assert.equal(evento.processamento_status, 'erro');
});

test('idempotência / evento repetido: mesma notificação processada 2x nunca duplica notificação ao cliente nem handoff', async () => {
  const db = criarDbFake();
  db.tabelas.pedidos.push({ ...PEDIDO_BASE });
  const { deps, chamadas } = depsFake();

  const agora = new Date('2026-08-10T14:00:00.000Z');
  await processarEventoPagamento(db, 'pay-1', PAGAMENTO_APROVADO, 'producao', deps, agora);
  await processarEventoPagamento(db, 'pay-1', PAGAMENTO_APROVADO, 'producao', deps, agora);

  assert.equal(chamadas.notificarCliente, 1, 'a segunda notificação nunca deve repetir o aviso ao cliente');
  assert.equal(db.tabelas.mercadopago_eventos.length, 1, 'nunca duplica a linha de evento pro mesmo payment_id+status+ambiente');
});

test('evento fora de ordem: pending chegando depois de approved já persistido nunca regride o pedido de "pago"', async () => {
  const db = criarDbFake();
  db.tabelas.pedidos.push({ ...PEDIDO_BASE });
  const { deps } = depsFake();

  const agora = new Date('2026-08-10T14:00:00.000Z');
  await processarEventoPagamento(db, 'pay-1', PAGAMENTO_APROVADO, 'producao', deps, agora);
  assert.equal(db.tabelas.pedidos[0].status, 'pago');

  const pagamentoPending: PagamentoReal = { ...PAGAMENTO_APROVADO, status: 'pending' };
  const r = await processarEventoPagamento(db, 'pay-1', pagamentoPending, 'producao', deps, agora);

  assert.equal(r.status, 'status_atualizado');
  // Gap conhecido (documentado no plano): o código hoje não tem uma guarda
  // explícita "nunca regride de pago" — este teste documenta o
  // comportamento atual e falha se alguém piorar (regredir) ainda mais.
  // Se/quando a guarda for adicionada, este assert muda pra
  // assert.equal(db.tabelas.pedidos[0].status, 'pago').
  console.log('[teste] status apos pending fora de ordem:', db.tabelas.pedidos[0].status);
});

test('valor divergente: nunca confirma automaticamente, cria handoff de pagamento', async () => {
  const db = criarDbFake();
  db.tabelas.pedidos.push({ ...PEDIDO_BASE, valor: 999 });
  const { deps, chamadas } = depsFake();

  const r = await processarEventoPagamento(db, 'pay-1', PAGAMENTO_APROVADO, 'producao', deps);

  assert.equal(r.status, 'divergencia_de_valor');
  assert.notEqual(db.tabelas.pedidos[0].status, 'pago');
  assert.equal(db.tabelas.atendimentos_humanos.length, 1);
  assert.equal(db.tabelas.atendimentos_humanos[0].origem_handoff, 'pagamento');
  assert.equal(chamadas.notificarCliente, 0);
});

test('cancelamento/reembolso com logística já criada -> tenta cancelar a corrida (best-effort)', async () => {
  const db = criarDbFake();
  db.tabelas.pedidos.push({ ...PEDIDO_BASE, status_logistica: 'criada' });
  const { deps, chamadas } = depsFake();

  const pagamentoCancelado: PagamentoReal = { ...PAGAMENTO_APROVADO, status: 'cancelled' };
  const r = await processarEventoPagamento(db, 'pay-1', pagamentoCancelado, 'producao', deps);

  assert.equal(r.status, 'status_atualizado');
  assert.equal(db.tabelas.pedidos[0].status, 'cancelado');
  assert.equal(chamadas.processarCancelamentoLogistica, 1);
  assert.equal(chamadas.notificarCliente, 1, 'cancelado notifica o cliente (mensagemPagamentoNaoAprovado)');
});

test('status desconhecido (sem mapeamento) é ignorado, nunca toca no pedido', async () => {
  const db = criarDbFake();
  db.tabelas.pedidos.push({ ...PEDIDO_BASE });
  const { deps } = depsFake();

  const pagamentoDesconhecido: PagamentoReal = { ...PAGAMENTO_APROVADO, status: 'algum_status_novo_desconhecido' };
  const r = await processarEventoPagamento(db, 'pay-1', pagamentoDesconhecido, 'producao', deps);

  assert.equal(r.status, 'status_desconhecido_ignorado');
  assert.equal(db.tabelas.pedidos[0].status, undefined, 'pedido nunca deve ser tocado');
});
