// Teste direcionado do horário comercial (America/Sao_Paulo, UTC-3 fixo).
// Sem Deno/rede — testável com Node (tsx --test), mesmo padrão de
// orchestrator/src/lib/funil.test.ts.
// Rodar: npx tsx --test supabase/functions/_shared/horario-comercial.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dentroDoHorarioComercial, proximaAberturaComercial, textoProximaAberturaComercial } from './horario-comercial.ts';

// Datas em UTC construídas para cair em horas locais (UTC-3) conhecidas.
// 2026-07-16 é quinta-feira; 2026-07-18 é sábado; 2026-07-19 é domingo.
// 2026-09-07 é feriado nacional (Independência) e cai numa segunda-feira.

function utc(iso: string): Date {
  return new Date(iso);
}

test('dentro do horário comercial: quinta-feira 14h (17h UTC)', () => {
  assert.equal(dentroDoHorarioComercial(utc('2026-07-16T17:00:00Z')), true);
});

test('fora do horário comercial: quinta-feira 20h (23h UTC)', () => {
  assert.equal(dentroDoHorarioComercial(utc('2026-07-16T23:00:00Z')), false);
});

test('fora do horário comercial: quinta-feira 7h da manhã (10h UTC)', () => {
  assert.equal(dentroDoHorarioComercial(utc('2026-07-16T10:00:00Z')), false);
});

test('limite exato de abertura em dia útil: 09:00 local (12h UTC) já está aberto', () => {
  assert.equal(dentroDoHorarioComercial(utc('2026-07-16T12:00:00Z')), true);
});

test('limite exato de fechamento em dia útil: 19:00 local (22h UTC) já fechado', () => {
  assert.equal(dentroDoHorarioComercial(utc('2026-07-16T22:00:00Z')), false);
});

test('sábado dentro do horário reduzido: 11h local (14h UTC)', () => {
  assert.equal(dentroDoHorarioComercial(utc('2026-07-18T14:00:00Z')), true);
});

test('sábado fora do horário reduzido: 08h local (11h UTC)', () => {
  assert.equal(dentroDoHorarioComercial(utc('2026-07-18T11:00:00Z')), false);
});

test('domingo dentro do horário reduzido: 12h local (15h UTC)', () => {
  assert.equal(dentroDoHorarioComercial(utc('2026-07-19T15:00:00Z')), true);
});

test('feriado nacional (07/09) numa segunda-feira usa horário reduzido, não o de dia útil', () => {
  // 2026-09-07 é segunda-feira — sem a regra de feriado, cairia no horário 09-19h.
  assert.equal(dentroDoHorarioComercial(utc('2026-09-07T21:00:00Z')), false); // 18h local: já fechado no feriado
  assert.equal(dentroDoHorarioComercial(utc('2026-09-07T15:00:00Z')), true);  // 12h local: aberto no feriado
});

test('proximaAberturaComercial: ja dentro do horario devolve o proprio instante', () => {
  const agora = utc('2026-07-16T17:00:00Z'); // quinta 14h local, aberto
  assert.equal(proximaAberturaComercial(agora).getTime(), agora.getTime());
});

test('proximaAberturaComercial: quinta 20h (fechado) -> proxima abertura e quinta 09h do dia seguinte (sexta)', () => {
  const agora = utc('2026-07-16T23:00:00Z'); // quinta 20h local
  const proxima = proximaAberturaComercial(agora);
  assert.equal(dentroDoHorarioComercial(proxima), true);
  assert.equal(proxima.toISOString().slice(0, 10), '2026-07-17'); // sexta em UTC (17-07 00h local = 17-07 03h UTC, ja e dia seguinte)
});

test('proximaAberturaComercial: sabado 08h (antes de abrir) -> abre no mesmo dia as 10h', () => {
  const agora = utc('2026-07-18T11:00:00Z'); // sabado 08h local
  const proxima = proximaAberturaComercial(agora);
  assert.equal(dentroDoHorarioComercial(proxima), true);
  const horaLocal = (proxima.getUTCHours() - 3 + 24) % 24;
  assert.equal(horaLocal, 10);
});

test('textoProximaAberturaComercial: fora do horario tarde da noite -> menciona amanha', () => {
  const agora = utc('2026-07-16T23:00:00Z'); // quinta 20h local
  const texto = textoProximaAberturaComercial(agora);
  assert.match(texto, /amanh[ãa]/i);
});

test('textoProximaAberturaComercial: antes de abrir no mesmo dia -> menciona "hoje"', () => {
  const agora = utc('2026-07-18T11:00:00Z'); // sabado 08h local, abre as 10h no mesmo dia
  const texto = textoProximaAberturaComercial(agora);
  assert.match(texto, /hoje/i);
});

console.log('OK — horario-comercial: todos os testes passaram.');
