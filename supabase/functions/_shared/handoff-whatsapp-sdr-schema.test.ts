// Regressão do bug real corrigido em 2026-07-21: o handoff whatsapp-sdr
// inseria origem_handoff='whatsapp_sdr' em atendimentos_humanos, mas a
// constraint original (202607170001_atendimento_humano.sql) não previa
// esse valor — todo INSERT falhava em produção. Este teste valida, ao
// mesmo tempo:
//   1) montarRegistroHandoff produz origem_handoff='whatsapp_sdr';
//   2) a migration mais recente da constraint contém esse valor;
//   3) nenhum valor antigo foi removido;
//   4) o objeto montado só usa colunas que realmente existem na tabela
//      (extraídas do CREATE TABLE original, nunca de uma lista solta que
//      pode ficar desatualizada).
// Rodar: npx tsx --test supabase/functions/_shared/handoff-whatsapp-sdr-schema.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { montarRegistroHandoff } from './handoff-whatsapp-sdr.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
const MIGRATION_CRIACAO = readFileSync(join(MIGRATIONS_DIR, '202607170001_atendimento_humano.sql'), 'utf8');
const MIGRATION_CONSTRAINT_NOVA = readFileSync(join(MIGRATIONS_DIR, '202607210002_atendimento_humano_origem_whatsapp_sdr.sql'), 'utf8');

function extrairValoresCheckIn(sql: string): string[] {
  const match = sql.match(/origem_handoff\s+in\s*\(([\s\S]*?)\)/i);
  assert.ok(match, 'nao encontrei "origem_handoff in (...)" no SQL');
  return [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function extrairColunasCreateTable(sql: string): string[] {
  const match = sql.match(/create table if not exists public\.atendimentos_humanos\s*\(([\s\S]*?)\n\);/i);
  assert.ok(match, 'nao encontrei o CREATE TABLE de atendimentos_humanos');
  return match![1]
    .split('\n')
    .map((linha) => linha.match(/^\s*(\w+)\s+/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1]);
}

test('montarRegistroHandoff produz origem_handoff="whatsapp_sdr"', () => {
  const registro = montarRegistroHandoff({ motivo: 'teste', horarioComercial: true });
  assert.equal(registro.origem_handoff, 'whatsapp_sdr');
});

test('a migration mais recente da constraint contem "whatsapp_sdr"', () => {
  const valoresNovos = extrairValoresCheckIn(MIGRATION_CONSTRAINT_NOVA);
  assert.ok(valoresNovos.includes('whatsapp_sdr'), `whatsapp_sdr ausente na constraint nova: ${valoresNovos.join(', ')}`);
});

test('nenhum valor de origem_handoff permitido na migration original foi removido pela nova', () => {
  const valoresOriginais = extrairValoresCheckIn(MIGRATION_CRIACAO);
  const valoresNovos = extrairValoresCheckIn(MIGRATION_CONSTRAINT_NOVA);
  for (const v of valoresOriginais) {
    assert.ok(valoresNovos.includes(v), `valor original "${v}" foi removido na migration nova`);
  }
});

test('a nova migration adiciona exatamente um valor novo (whatsapp_sdr) em relacao a original', () => {
  const valoresOriginais = new Set(extrairValoresCheckIn(MIGRATION_CRIACAO));
  const valoresNovos = extrairValoresCheckIn(MIGRATION_CONSTRAINT_NOVA);
  const adicionados = valoresNovos.filter((v) => !valoresOriginais.has(v));
  assert.deepEqual(adicionados, ['whatsapp_sdr']);
});

test('o registro montado por montarRegistroHandoff so usa colunas que existem em atendimentos_humanos', () => {
  const colunasReais = new Set(extrairColunasCreateTable(MIGRATION_CRIACAO));
  const registro = montarRegistroHandoff({
    canal: 'whatsapp', canalId: 'x', telefone: '5511900000000', nome: 'Teste',
    leadId: 'lead-1', intencao: 'alta', ultimaMensagem: 'oi', motivo: 'teste', horarioComercial: true,
  });
  for (const coluna of Object.keys(registro)) {
    assert.ok(colunasReais.has(coluna), `coluna "${coluna}" usada pelo registro nao existe em atendimentos_humanos (colunas reais: ${[...colunasReais].join(', ')})`);
  }
});
