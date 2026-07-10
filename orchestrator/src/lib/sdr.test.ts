// Testes locais da lógica de personalidade da Flora (sdr.ts).
// Não fazem chamada de rede, não dependem de Groq/Redis/Supabase/Meta/
// WhatsApp — testam só a composição determinística do prompt e das
// mensagens de escalonamento.
//
// Rodar: npm run test (dentro de orchestrator/)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInstrucaoPrimeiraMensagem } from './sdr.js'

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

// Mensagem de transferência para atendimento humano (texto fixo "WhatsApp
// final 8282", nunca telefone completo hardcoded) é testada em
// funil.test.ts, junto com o classificador de intenção que decide quando
// ela é usada — ver testes 14-15 daquele arquivo.

test('instrucao vazia quando nao e primeira mensagem', () => {
  assert.equal(buildInstrucaoPrimeiraMensagem(false, 'Camila'), '')
  assert.equal(buildInstrucaoPrimeiraMensagem(false, undefined), '')
})
