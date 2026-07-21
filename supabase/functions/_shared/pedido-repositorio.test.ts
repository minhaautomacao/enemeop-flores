// Rodar: npx tsx --test supabase/functions/_shared/pedido-repositorio.test.ts
//
// GO-LIVE Parte 1 ("idempotência real do pedido e da preference"). Simula
// concorrência chamando as funções em sequência sobre o MESMO banco fake —
// mesmo padrão já usado em logistica-decisao.test.ts ("cron e retry
// concorrentes"): o que importa é provar que o SEGUNDO chamador da mesma
// jornada/claim nunca cria um segundo registro, reaproveitando o que o
// primeiro já criou — não literalmente escalonar o event loop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarOuReusarPedido, gerarOuReusarPreference, chaveJornada, type DadosClientePedido } from './pedido-repositorio.ts';
import type { DadosPedido } from './funil.ts';

// ── Banco fake mínimo — só o suficiente pra exercitar as cadeias reais
// usadas por pedido-repositorio.ts (insert/select/update com
// eq/is/maybeSingle/single), incluindo a violação de unicidade (23505) em
// jornada_key, que é a garantia real contra corrida do banco. ────────────

function criarDbFake() {
  const pedidos: Record<string, unknown>[] = [];

  function aplicaFiltros(linhas: Record<string, unknown>[], filtros: Array<(r: Record<string, unknown>) => boolean>) {
    return linhas.filter(r => filtros.every(f => f(r)));
  }

  function from(nomeTabela: string) {
    if (nomeTabela !== 'pedidos') throw new Error(`tabela fake nao suportada: ${nomeTabela}`);
    return {
      insert(obj: Record<string, unknown>) {
        return {
          select(_cols: string) {
            return {
              async single() {
                if (obj.jornada_key != null && pedidos.some(p => p.jornada_key === obj.jornada_key)) {
                  return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "pedidos_jornada_key_idx"' } };
                }
                const linha = { ...obj };
                pedidos.push(linha);
                return { data: { id: linha.id }, error: null };
              },
            };
          },
        };
      },
      select(_cols: string) {
        const filtros: Array<(r: Record<string, unknown>) => boolean> = [];
        const builder = {
          eq(col: string, val: unknown) { filtros.push(r => r[col] === val); return builder; },
          async maybeSingle() {
            const achadas = aplicaFiltros(pedidos, filtros);
            return { data: achadas[0] ?? null, error: null };
          },
          async single() {
            const achadas = aplicaFiltros(pedidos, filtros);
            return achadas[0] ? { data: achadas[0], error: null } : { data: null, error: { message: 'not found' } };
          },
        };
        return builder;
      },
      update(patch: Record<string, unknown>) {
        const filtros: Array<(r: Record<string, unknown>) => boolean> = [];
        const builder: {
          eq: (col: string, val: unknown) => typeof builder;
          is: (col: string, val: unknown) => typeof builder;
          select: (cols: string) => { maybeSingle(): Promise<{ data: unknown; error: unknown }> };
          then: (resolve: (r: { data: unknown; error: unknown }) => void) => void;
        } = {
          eq(col: string, val: unknown) { filtros.push(r => r[col] === val); return builder; },
          is(col: string, val: unknown) { filtros.push(r => (r[col] ?? null) === val); return builder; },
          select(_cols: string) {
            return {
              async maybeSingle() {
                const achadas = aplicaFiltros(pedidos, filtros);
                if (achadas.length === 0) return { data: null, error: null };
                Object.assign(achadas[0], patch);
                return { data: { id: achadas[0].id }, error: null };
              },
            };
          },
          then(resolve) {
            const achadas = aplicaFiltros(pedidos, filtros);
            achadas.forEach(r => Object.assign(r, patch));
            resolve({ data: achadas, error: null });
          },
        };
        return builder;
      },
    };
  }

  return { from, pedidos };
}

function dadosFake(overrides: Partial<DadosPedido> = {}): DadosPedido {
  return {
    produto: { nome: 'Buquê de Rosas', codigo: 'R1', preco: 140, quantidade: 1 },
    valorTotal: 162.5,
    valorFrete: 22.5,
    ...overrides,
  } as DadosPedido;
}

const cliente: DadosClientePedido = { nome: 'Ana', telefone: '+5511999990000', canal: 'whatsapp', canalId: '5511999990000', conversaId: 'conversa-1' };

test('chaveJornada: mesma conversa sem jornadaIniciadaEm -> mesma chave ("inicial"); jornadas diferentes -> chaves diferentes', () => {
  assert.equal(chaveJornada('c1', undefined), 'c1:inicial');
  assert.equal(chaveJornada('c1', undefined), chaveJornada('c1', undefined));
  assert.notEqual(chaveJornada('c1', '2026-07-21T10:00:00.000Z'), chaveJornada('c1', undefined));
});

test('duas aprovações concorrentes da mesma jornada -> um único pedido (a segunda reaproveita, nunca cria outro)', async () => {
  const db = criarDbFake();
  const dados = dadosFake();

  const r1 = await criarOuReusarPedido(db, dados, cliente, 'ws1', 'test');
  const r2 = await criarOuReusarPedido(db, dados, cliente, 'ws1', 'test');

  assert.ok(r1 && r2);
  assert.equal(r1!.pedidoId, r2!.pedidoId, 'as duas chamadas da mesma jornada devem devolver o MESMO pedido');
  assert.equal(db.pedidos.length, 1, 'nunca cria um segundo pedido pra mesma jornada');
});

test('nova jornada genuína (jornadaIniciadaEm diferente) permite um novo pedido', async () => {
  const db = criarDbFake();
  const r1 = await criarOuReusarPedido(db, dadosFake(), cliente, 'ws1', 'test');
  const r2 = await criarOuReusarPedido(db, dadosFake({ jornadaIniciadaEm: '2026-07-21T12:00:00.000Z' }), cliente, 'ws1', 'test');

  assert.ok(r1 && r2);
  assert.notEqual(r1!.pedidoId, r2!.pedidoId, 'jornadas diferentes devem gerar pedidos diferentes');
  assert.equal(db.pedidos.length, 2);
});

function criarPreferenciaFake(chamadas: { total: number }) {
  return async (_ws: string | undefined, opcoes: { externalReference: string }) => {
    chamadas.total++;
    return { criado: true, preferenceId: `pref_${opcoes.externalReference}`, initPoint: `https://mp/${opcoes.externalReference}` };
  };
}

test('dois pedidos de gerar pagamento pro MESMO pedido -> uma única preference (a segunda chamada reaproveita)', async () => {
  const db = criarDbFake();
  const criado = await criarOuReusarPedido(db, dadosFake(), cliente, 'ws1', 'test');
  const pedidoId = criado!.pedidoId;

  const chamadas = { total: 0 };
  const fakeMp = criarPreferenciaFake(chamadas);
  const [p1, p2] = await Promise.all([
    gerarOuReusarPreference(db, pedidoId, 'ws1', 'https://supabase.fake', 'test', fakeMp),
    gerarOuReusarPreference(db, pedidoId, 'ws1', 'https://supabase.fake', 'test', fakeMp),
  ]);
  // Uma das duas chamadas ganha o claim e cria de verdade; a outra nunca
  // ganha (mp_preference_status já não é mais null quando ela roda) —
  // ambas devem devolver o mesmo link no fim (nunca duas cobranças).
  assert.equal(chamadas.total, 1, 'só uma chamada real ao Mercado Pago pro mesmo pedido');
  assert.ok(p1 && p2);
  assert.equal(p1!.link, p2!.link);
});

test('retry depois da persistência já confirmada -> devolve o mesmo link, sem chamar o Mercado Pago de novo', async () => {
  const db = criarDbFake();
  const criado = await criarOuReusarPedido(db, dadosFake(), cliente, 'ws1', 'test');
  const pedidoId = criado!.pedidoId;
  const linha = db.pedidos.find(p => p.id === pedidoId)!;
  linha.mp_preference_id = 'pref_ja_criada';
  linha.link_pagamento = 'https://mp/ja-criada';
  linha.mp_preference_status = 'criado';

  const chamadas = { total: 0 };
  const r = await gerarOuReusarPreference(db, pedidoId, 'ws1', 'https://supabase.fake', 'test', criarPreferenciaFake(chamadas));
  assert.equal(r?.link, 'https://mp/ja-criada');
  assert.equal(chamadas.total, 0, 'nunca chama o Mercado Pago de novo se já está persistido');
});

test('pedido travado em mp_preference_status="criando" (estado ambíguo) nunca gera uma segunda cobrança automaticamente', async () => {
  const db = criarDbFake();
  const criado = await criarOuReusarPedido(db, dadosFake(), cliente, 'ws1', 'test');
  const pedidoId = criado!.pedidoId;
  const linha = db.pedidos.find(p => p.id === pedidoId)!;
  linha.mp_preference_status = 'criando'; // simula falha de persistência depois da criação externa

  const chamadas = { total: 0 };
  const r = await gerarOuReusarPreference(db, pedidoId, 'ws1', 'https://supabase.fake', 'test', criarPreferenciaFake(chamadas));
  assert.equal(r, null, 'nunca devolve link de sucesso enquanto o estado for ambíguo');
  assert.equal(chamadas.total, 0, 'nunca tenta criar uma nova preference sozinho quando o estado já está ambíguo');
  assert.equal(linha.mp_preference_status, 'criando', 'estado ambíguo nunca é revertido automaticamente (só reconciliação manual)');
});

test('falha ao criar no Mercado Pago (nada foi criado externamente) -> libera o claim, permite tentar de novo depois', async () => {
  const db = criarDbFake();
  const criado = await criarOuReusarPedido(db, dadosFake(), cliente, 'ws1', 'test');
  const pedidoId = criado!.pedidoId;

  const falhaMp = async () => ({ criado: false, erro: 'sem credencial configurada' });
  const r = await gerarOuReusarPreference(db, pedidoId, 'ws1', 'https://supabase.fake', 'test', falhaMp);
  assert.equal(r, null);
  const linha = db.pedidos.find(p => p.id === pedidoId)!;
  assert.equal(linha.mp_preference_status, null, 'claim liberado — nada foi criado no Mercado Pago, seguro tentar de novo');
});
