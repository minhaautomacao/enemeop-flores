// Testes locais da lógica de personalidade da Flora (sdr.ts).
// Não fazem chamada de rede, não dependem de Groq/Redis/Supabase/Meta/
// WhatsApp — testam só a composição determinística do prompt e das
// mensagens de escalonamento.
//
// Rodar: npm run test (dentro de orchestrator/)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInstrucaoPrimeiraMensagem, mensagemEscalada } from './sdr.js'

test('primeira mensagem sem nome conhecido pede o nome', () => {
  const instrucao = buildInstrucaoPrimeiraMensagem(true, undefined)
  assert.match(instrucao, /pedindo o nome/)
  assert.doesNotMatch(instrucao, /Cumprimente pelo nome/)
})

test('primeira mensagem com nome conhecido cumprimenta pelo nome e nao pede de novo', () => {
  const instrucao = buildInstrucaoPrimeiraMensagem(true, 'Camila')
  assert.match(instrucao, /Cumprimente pelo nome/)
  assert.match(instrucao, /Camila/)
  assert.match(instrucao, /NÃO peça o nome/)
})

test('instrucao usa AGENT_NAME configurado, nao "FLORA" fixo', async (t) => {
  const nomeOriginal = process.env.AGENT_NAME
  process.env.AGENT_NAME = 'Bloom'

  // Reimporta o módulo com o novo valor de env var (module cache do node:test
  // é por processo — usamos um import dinâmico com query string para forçar
  // reavaliação do módulo com o novo AGENT_NAME).
  const mod = await import(`./sdr.js?agent-name-test=${Date.now()}`)
  const instrucao = mod.buildInstrucaoPrimeiraMensagem(true, 'Camila')

  assert.match(instrucao, /BLOOM/, 'deveria usar o AGENT_NAME configurado em maiusculas, nao "FLORA" fixo')
  assert.doesNotMatch(instrucao, /\bFLORA\b/)

  process.env.AGENT_NAME = nomeOriginal
})

test('mensagem de escalonamento nao tem numero de telefone hardcoded quando STORE_HUMAN_PHONE nao esta configurado', () => {
  const original = process.env.STORE_HUMAN_PHONE
  delete process.env.STORE_HUMAN_PHONE

  const msg = mensagemEscalada()
  // Regressão: garante que o numero fixo antigo, (11) 91280-8282, nao volta
  // a aparecer hardcoded — e que nenhum padrao de telefone brasileiro vaza
  // quando a env var nao esta configurada.
  assert.doesNotMatch(msg, /\(11\)\s*9\d{4}-?\d{4}/)
  assert.match(msg, /especialista/)

  if (original !== undefined) process.env.STORE_HUMAN_PHONE = original
})

test('mensagem de escalonamento usa STORE_HUMAN_PHONE quando configurado', async () => {
  process.env.STORE_HUMAN_PHONE = '(11) 90000-0000'
  const mod = await import(`./sdr.js?human-phone-test=${Date.now()}`)
  const msg = mod.mensagemEscalada()
  assert.match(msg, /\(11\) 90000-0000/)
  delete process.env.STORE_HUMAN_PHONE
})

test('instrucao vazia quando nao e primeira mensagem', () => {
  assert.equal(buildInstrucaoPrimeiraMensagem(false, 'Camila'), '')
  assert.equal(buildInstrucaoPrimeiraMensagem(false, undefined), '')
})
