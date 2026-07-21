// Testa as decisões puras da integração Lalamove — sem rede, sem Deno.env.
// Rodar: npx tsx --test supabase/functions/_shared/lalamove-config.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolverAmbiente, resolverBaseUrl, resolverMarket, montarStringAssinatura,
  validarPreco, cotacaoExpirada, servicoDisponivel, mascarar,
  telefoneE164Valido, mascararTelefone,
} from './lalamove-config.ts';

test('resolverAmbiente aceita sandbox e production', () => {
  assert.equal(resolverAmbiente('sandbox'), 'sandbox');
  assert.equal(resolverAmbiente('production'), 'production');
});

test('resolverAmbiente rejeita valor ausente com mensagem sanitizada (nunca ecoa o valor)', () => {
  assert.throws(() => resolverAmbiente(undefined), /nao configurado/);
  assert.throws(() => resolverAmbiente(''), /nao configurado/);
});

test('resolverAmbiente rejeita valor invalido sem ecoar o conteudo recebido', () => {
  assert.throws(() => resolverAmbiente('PRODUCTION'), (e: Error) => {
    assert.match(e.message, /invalido/);
    assert.doesNotMatch(e.message, /PRODUCTION/);
    return true;
  });
});

test('resolverAmbiente nunca infere pelo formato/conteudo — so aceita os dois literais', () => {
  assert.throws(() => resolverAmbiente('prod'));
  assert.throws(() => resolverAmbiente('live'));
  assert.throws(() => resolverAmbiente('sandbox '));
});

test('resolverBaseUrl mapeia cada ambiente pro host correto', () => {
  assert.equal(resolverBaseUrl('sandbox'), 'https://rest.sandbox.lalamove.com');
  assert.equal(resolverBaseUrl('production'), 'https://rest.lalamove.com');
});

test('resolverMarket usa a configuracao, nunca fixa BR', () => {
  assert.equal(resolverMarket('br'), 'BR');
  assert.equal(resolverMarket(' MX '), 'MX');
});

test('resolverMarket falha sem mercado configurado', () => {
  assert.throws(() => resolverMarket(undefined), /nao configurado/);
  assert.throws(() => resolverMarket('   '), /nao configurado/);
});

test('montarStringAssinatura segue exatamente timestamp\\r\\nmethod\\r\\npath\\r\\n\\r\\nbody', () => {
  const s = montarStringAssinatura('1234', 'POST', '/v3/quotations', '{"a":1}');
  assert.equal(s, '1234\r\nPOST\r\n/v3/quotations\r\n\r\n{"a":1}');
});

test('validarPreco rejeita nao finito, zero, negativo e moeda errada', () => {
  assert.equal(validarPreco(NaN, 'BRL', 'BRL').valido, false);
  assert.equal(validarPreco(Infinity, 'BRL', 'BRL').valido, false);
  assert.equal(validarPreco(0, 'BRL', 'BRL').valido, false);
  assert.equal(validarPreco(-5, 'BRL', 'BRL').valido, false);
  assert.equal(validarPreco(30.47, 'HKD', 'BRL').valido, false);
  assert.equal(validarPreco(30.47, '', 'BRL').valido, false);
});

test('validarPreco aceita preco finito positivo na moeda esperada', () => {
  const r = validarPreco(30.47, 'BRL', 'BRL');
  assert.equal(r.valido, true);
  assert.equal(r.motivo, undefined);
});

test('cotacaoExpirada: sem expiresAt conta como expirada (nunca usa cotacao sem validade conhecida)', () => {
  assert.equal(cotacaoExpirada(null), true);
});

test('cotacaoExpirada: data invalida conta como expirada', () => {
  assert.equal(cotacaoExpirada('lixo'), true);
});

test('cotacaoExpirada: no passado é expirada, no futuro nao', () => {
  const agora = new Date('2026-07-20T12:00:00Z');
  assert.equal(cotacaoExpirada('2026-07-20T11:59:59Z', agora), true);
  assert.equal(cotacaoExpirada('2026-07-20T12:00:01Z', agora), false);
});

test('servicoDisponivel so confirma o que a API realmente listou — nunca assume MOTORCYCLE/CAR por padrao', () => {
  assert.equal(servicoDisponivel([], 'MOTORCYCLE'), false);
  assert.equal(servicoDisponivel([{ key: 'CAR' }], 'MOTORCYCLE'), false);
  assert.equal(servicoDisponivel([{ key: 'CAR' }, { key: 'MOTORCYCLE' }], 'MOTORCYCLE'), true);
});

test('mascarar nunca expoe o quotationId inteiro em log', () => {
  assert.equal(mascarar('1514140994227007571'), '1514…7571');
  assert.equal(mascarar('abcd'), '****');
  assert.equal(mascarar(null), '');
  assert.equal(mascarar(undefined), '');
});

test('telefoneE164Valido aceita E.164 com sinal + (exigencia oficial da Lalamove, regex ^\\+[1-9]\\d{1,14}$)', () => {
  assert.equal(telefoneE164Valido('+5511982829083'), true);
  assert.equal(telefoneE164Valido('+6512345678'), true);
});

test('telefoneE164Valido rejeita sem o sinal +, com formatacao, vazio ou ausente', () => {
  assert.equal(telefoneE164Valido('5511982829083'), false);
  assert.equal(telefoneE164Valido('+55 11 98282-9083'), false);
  assert.equal(telefoneE164Valido('+55 (11) 98282-9083'), false);
  assert.equal(telefoneE164Valido(''), false);
  assert.equal(telefoneE164Valido(null), false);
  assert.equal(telefoneE164Valido(undefined), false);
});

test('telefoneE164Valido rejeita numero comecando com 0 apos o + (regex oficial exige [1-9] primeiro)', () => {
  assert.equal(telefoneE164Valido('+0511982829083'), false);
});

test('mascararTelefone nunca expoe o numero completo — mantem so +DDI e os 4 ultimos digitos', () => {
  assert.equal(mascararTelefone('+5511982829083'), '+55•••••••9083');
});

test('mascararTelefone com telefone ausente/vazio devolve vazio', () => {
  assert.equal(mascararTelefone(null), '');
  assert.equal(mascararTelefone(undefined), '');
  assert.equal(mascararTelefone(''), '');
});
