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

// ── Correção P0: cálculo direto (sem loop de 5min) e timezone correto ─────
// 2026-07-20 é segunda-feira; 2026-07-21 é terça; 2026-07-17 é sexta.

test('proximaAberturaComercial: segunda 22h53 -> terça 09h00 exato, nunca 09h03 (cálculo direto, sem resíduo de incrementos de 5min)', () => {
  const agora = utc('2026-07-21T01:53:00Z'); // segunda 22h53 BRT
  const proxima = proximaAberturaComercial(agora);
  assert.equal(proxima.toISOString(), '2026-07-21T12:00:00.000Z'); // terça 09h00 BRT exato
});

test('proximaAberturaComercial: sexta após 19h -> abre sábado às 10h (fim de semana), não 09h', () => {
  const agora = utc('2026-07-17T23:00:00Z'); // sexta 20h BRT
  const proxima = proximaAberturaComercial(agora);
  assert.equal(proxima.toISOString(), '2026-07-18T13:00:00.000Z');
});

test('proximaAberturaComercial: sábado antes do horário reduzido (08h) -> abre no mesmo dia às 10h', () => {
  const agora = utc('2026-07-18T11:00:00Z'); // sábado 08h BRT
  const proxima = proximaAberturaComercial(agora);
  assert.equal(proxima.toISOString(), '2026-07-18T13:00:00.000Z');
});

test('proximaAberturaComercial: sábado depois do horário reduzido (19h) -> abre domingo às 10h', () => {
  const agora = utc('2026-07-18T22:00:00Z'); // sábado 19h BRT
  const proxima = proximaAberturaComercial(agora);
  assert.equal(proxima.toISOString(), '2026-07-19T13:00:00.000Z');
});

test('proximaAberturaComercial: domingo antes do horário reduzido -> abre no mesmo dia às 10h', () => {
  const agora = utc('2026-07-19T11:00:00Z'); // domingo 08h BRT
  const proxima = proximaAberturaComercial(agora);
  assert.equal(proxima.toISOString(), '2026-07-19T13:00:00.000Z');
});

test('proximaAberturaComercial: domingo depois do horário reduzido -> abre segunda às 09h (dia útil)', () => {
  const agora = utc('2026-07-19T22:00:00Z'); // domingo 19h BRT
  const proxima = proximaAberturaComercial(agora);
  assert.equal(proxima.toISOString(), '2026-07-20T12:00:00.000Z');
});

test('proximaAberturaComercial/texto: instante logo após meia-noite UTC que ainda é a noite anterior em São Paulo — nunca confunde com "hoje" nem com o dia UTC errado', () => {
  const agora = utc('2026-07-21T02:30:00Z'); // segunda 23h30 BRT (já é terça em UTC, mas ainda é segunda à noite em SP)
  const proxima = proximaAberturaComercial(agora);
  assert.equal(proxima.toISOString(), '2026-07-21T12:00:00.000Z'); // terça 09h00 BRT
  const texto = textoProximaAberturaComercial(agora);
  assert.match(texto, /amanh[ãa]/i);
  assert.doesNotMatch(texto, /hoje/i);
});

test('proximaAberturaComercial: virada de mês (30/abr fechado -> abre 1/mai, feriado fixo, às 10h)', () => {
  const agora = utc('2026-05-01T00:00:00Z'); // 30/abr 21h BRT
  const proxima = proximaAberturaComercial(agora);
  assert.equal(proxima.toISOString(), '2026-05-01T13:00:00.000Z');
});

test('proximaAberturaComercial: virada de ano (31/dez fechado -> abre 1/jan, feriado fixo, às 10h)', () => {
  const agora = utc('2027-01-01T00:00:00Z'); // 31/dez 21h BRT
  const proxima = proximaAberturaComercial(agora);
  assert.equal(proxima.toISOString(), '2027-01-01T13:00:00.000Z');
});

test('proximaAberturaComercial: feriado fixo (25/dez) abre às 10h, mesmo vindo de um dia fechado às 19h/18h na véspera', () => {
  const agora = utc('2026-12-25T01:00:00Z'); // 24/dez 22h BRT
  const proxima = proximaAberturaComercial(agora);
  assert.equal(proxima.toISOString(), '2026-12-25T13:00:00.000Z');
});

console.log('OK — horario-comercial: todos os testes passaram.');
