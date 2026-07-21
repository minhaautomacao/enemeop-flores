// Rodar: npx tsx --test supabase/functions/_shared/handoff.test.ts
//
// GO-LIVE Parte 2 ("handoff real no WhatsApp"). webhook-whatsapp antes só
// enviava mensagemTransferencia() e marcava fase='transferido_humano' sem
// nunca criar um ticket real em atendimentos_humanos — este módulo é a
// implementação compartilhada que corrige isso (webhook-meta e
// webhook-whatsapp).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarOuReusarAtendimento } from './handoff.ts';

function criarDbFake(opts: { falharInsertSempre?: boolean } = {}) {
  const tickets: Record<string, unknown>[] = [];
  let contador = 0;

  function aplicaFiltros(linhas: Record<string, unknown>[], filtros: Array<(r: Record<string, unknown>) => boolean>) {
    return linhas.filter(r => filtros.every(f => f(r)));
  }

  function from(nome: string) {
    if (nome !== 'atendimentos_humanos') throw new Error(`tabela fake nao suportada: ${nome}`);
    return {
      insert(obj: Record<string, unknown>) {
        return {
          select(_cols: string) {
            return {
              async single() {
                if (opts.falharInsertSempre) {
                  return { data: null, error: { code: 'XX000', message: 'falha de banco simulada' } };
                }
                const jaAberto = tickets.some(t => t.conversa_id === obj.conversa_id && ['aguardando_humano', 'em_atendimento'].includes(t.status as string));
                if (jaAberto) {
                  return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "atendimentos_humanos_conversa_aberto_idx"' } };
                }
                contador++;
                const linha = { ...obj, codigo: `COD${contador}`, status: 'aguardando_humano', criado_em: new Date(Date.now() + contador).toISOString() };
                tickets.push(linha);
                return { data: { codigo: linha.codigo }, error: null };
              },
            };
          },
        };
      },
      select(_cols: string) {
        const filtros: Array<(r: Record<string, unknown>) => boolean> = [];
        const builder = {
          eq(col: string, val: unknown) { filtros.push(r => r[col] === val); return builder; },
          in(col: string, vals: unknown[]) { filtros.push(r => vals.includes(r[col])); return builder; },
          order() { return builder; },
          limit() { return builder; },
          async maybeSingle() {
            const achadas = aplicaFiltros(tickets, filtros).sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
            return { data: achadas[0] ?? null, error: null };
          },
        };
        return builder;
      },
    };
  }

  return { from, tickets };
}

test('pedido explícito de humano cria exatamente um ticket', async () => {
  const db = criarDbFake();
  const r = await criarOuReusarAtendimento(db, 'conversa-1', 'whatsapp', '5511999990000', 'Ana', 'cliente_solicitou', 'quero falar com atendente', '+5511999990000', 'test');
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.codigo);
  assert.equal(db.tickets.length, 1);
});

test('erro de banco (insert falha e não há ticket aberto pra reaproveitar) nunca declara handoff concluído', async () => {
  const db = criarDbFake({ falharInsertSempre: true });
  const r = await criarOuReusarAtendimento(db, 'conversa-2', 'whatsapp', '5511999990001', 'Bia', 'cliente_solicitou', 'quero falar com atendente', '+5511999990001', 'test');
  assert.equal(r.ok, false);
  assert.equal(db.tickets.length, 0);
});

test('repetição da mesma mensagem/handoff não duplica ticket — reaproveita o já aberto', async () => {
  const db = criarDbFake();
  const r1 = await criarOuReusarAtendimento(db, 'conversa-3', 'whatsapp', '5511999990002', 'Carla', 'cliente_solicitou', 'quero falar com atendente', '+5511999990002', 'test');
  const r2 = await criarOuReusarAtendimento(db, 'conversa-3', 'whatsapp', '5511999990002', 'Carla', 'cliente_solicitou', 'quero falar com atendente de novo', '+5511999990002', 'test');
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.ok(r1.ok && r2.ok && r1.codigo === r2.codigo, 'mesmo código de atendimento — nunca um segundo ticket enquanto o primeiro está aberto');
  assert.equal(db.tickets.length, 1);
});

test('conversas diferentes sempre criam tickets diferentes (unicidade é por conversa, não global)', async () => {
  const db = criarDbFake();
  const r1 = await criarOuReusarAtendimento(db, 'conversa-4', 'whatsapp', '5511999990003', 'Duda', 'cliente_solicitou', 'motivo a', '+5511999990003', 'test');
  const r2 = await criarOuReusarAtendimento(db, 'conversa-5', 'whatsapp', '5511999990004', 'Eva', 'cliente_solicitou', 'motivo b', '+5511999990004', 'test');
  assert.ok(r1.ok && r2.ok);
  assert.notEqual((r1 as { codigo: string }).codigo, (r2 as { codigo: string }).codigo);
  assert.equal(db.tickets.length, 2);
});
