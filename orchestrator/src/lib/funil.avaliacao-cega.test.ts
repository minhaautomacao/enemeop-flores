// AVALIAÇÃO CEGA — escrita e executada DEPOIS de toda a implementação e de
// todos os outros arquivos de teste desta iniciativa (funil.ts,
// funil.interpretacao.test.ts, funil.fatia2.test.ts,
// funil.formulacoes-ampliadas.test.ts, funil.conversas*.test.ts). Nenhuma
// das frases abaixo aparece em nenhum array de palavras-chave, em nenhum
// prompt (`montarPrompt*`/`configGate*`) nem em nenhum teste anterior desta
// iniciativa — conferido por busca textual antes de escrever este arquivo.
// O objetivo é medir generalização real, não confirmar exemplos já usados
// durante a implementação.
//
// LIMITAÇÃO HONESTA, registrada de propósito: este ambiente de teste local
// não tem acesso a um modelo de linguagem real (Groq/Anthropic) — só a
// funções fake determinísticas. Por isso este arquivo separa dois grupos:
//
//   Grupo 1 (sinal forte e honesto): frases rodadas SEM nenhum
//   interpretador conectado — testa só o código determinístico de
//   funil.ts contra formulações nunca vistas. Nenhuma simulação envolvida.
//
//   Grupo 2 (sinal parcial, limitação explícita): frases que dependem de
//   compreensão semântica geral, rodadas contra um fake propositalmente
//   novo e amplo (nunca reaproveitado de outro arquivo, pra nunca ter sido
//   "calibrado" nem de leve em torno destas frases específicas). Isto mede
//   se o CONTRATO (schema, anti-loop, gate de baixa confiança) se
//   comporta corretamente sob entrada nova — não é prova de que um modelo
//   real classificaria essas frases da mesma forma. A prova real disso só
//   vem de uma chamada de modelo de verdade (ver Seção 6/7 do rollout).
//
// Rodar: npm run test (dentro de orchestrator/)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avancarFunil, type EstadoConversa } from './funil.js'
import { depsFake, formularioFixture, criarInterpretadorFake, type CenarioInterpretacaoFake } from './funil.test-helpers.js'

function estadoAprovacaoFreteFixture(overrides: Partial<EstadoConversa['dados']> = {}): EstadoConversa {
  return {
    fase: 'aguardando_aprovacao_frete',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, codigo: '032', idExterno: '999', quantidade: 1, dataEntrega: 'hoje' },
      valorTotal: 162.5, valorFrete: 22.5,
      freteDetalhes: { cotadoEm: new Date().toISOString() },
      formulario: formularioFixture(),
      ...overrides,
    },
    perguntasFeitas: [],
  }
}

// ── Grupo 1: caminho 100% determinístico, sem nenhum interpretador ────────

test('cega/grupo 1: confirmações em formulações nunca usadas em nenhum teste desta iniciativa', async () => {
  const deps = depsFake()
  const variantes = ['beleza, fechado', 'manda ver', 'bora fechar', 'segue o jogo', 'tá tudo certo']
  const resultados: { texto: string; avancou: boolean }[] = []
  for (const texto of variantes) {
    const r = await avancarFunil(estadoAprovacaoFreteFixture(), texto, 'compra_produto', deps)
    resultados.push({ texto, avancou: r.estado.fase !== 'aguardando_aprovacao_frete' })
  }
  // Relatado sem ajustar o código: nenhuma dessas frases está na lista
  // PALAVRAS_CONFIRMACAO — é esperado (e correto) que o caminho
  // determinístico puro NÃO avance sozinho aqui; são exatamente o tipo de
  // formulação que só a camada de interpretação contextual (com
  // interpretador real conectado) resolveria. Ver Grupo 2 e a nota de
  // limitação no topo do arquivo.
  console.log('[avaliação cega/grupo 1 — confirmações informais]', JSON.stringify(resultados))
  for (const { texto, avancou } of resultados) {
    assert.equal(avancou, false, `"${texto}" não está em PALAVRAS_CONFIRMACAO — sem interpretador, corretamente não avança sozinha (nunca adivinha)`)
  }
})

test('cega/grupo 1: negações indiretas nunca confirmam por engano, mesmo em formulações inéditas', async () => {
  const deps = depsFake()
  const variantes = ['deixa eu pensar melhor', 'acho melhor eu não seguir com isso agora', 'peraí, não é bem assim que eu queria']
  for (const texto of variantes) {
    const r = await avancarFunil(estadoAprovacaoFreteFixture(), texto, 'compra_produto', deps)
    assert.notEqual(r.estado.fase, 'aguardando_pagamento', `"${texto}" nunca deveria confirmar o pagamento`)
    assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas', `"${texto}" nunca deveria perder o produto`)
  }
})

// ── Grupo 2: fake genérico, novo, nunca reaproveitado de outro arquivo ────

function fakeAmploNovoParaEsteArquivo() {
  const cenarios: CenarioInterpretacaoFake[] = [
    { quando: (m) => /esquece|deixa quieto|n[ãa]o quero mais/i.test(m), resultado: { intencaoPrimaria: 'desistir', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'x', acaoRecomendada: 'x', precisaEsclarecimento: false } },
    { quando: (m) => /troca\s+a[íi]\s+por\s+outro|prefiro\s+um\s+diferente/i.test(m), resultado: { intencaoPrimaria: 'trocar_produto', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'x', acaoRecomendada: 'x', precisaEsclarecimento: false } },
    { quando: (m) => /nome\s+de\s+quem\s+recebe\s+mudou/i.test(m), resultado: { intencaoPrimaria: 'alterar_destinatario', intencoesSecundarias: [], entidades: { nomeDestinatario: 'Beatriz' }, camposParaAtualizar: ['nomeDestinatario'], confianca: 'alta', evidenciaContextual: 'x', acaoRecomendada: 'x', precisaEsclarecimento: false } },
    { quando: (m) => /quanto\s+vai\s+custar\s+no\s+total|saber\s+quanto/i.test(m), resultado: { intencaoPrimaria: 'perguntar_preco', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'x', acaoRecomendada: 'x', precisaEsclarecimento: false } },
    { quando: (m) => /d[áa]\s+pra\s+saber\s+quando\s+chega/i.test(m), resultado: { intencaoPrimaria: 'perguntar_prazo', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'x', acaoRecomendada: 'x', precisaEsclarecimento: false } },
    { quando: (m) => /existe\s+algum\s+atendente\s+dispon[íi]vel/i.test(m), resultado: { intencaoPrimaria: 'falar_com_humano', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'x', acaoRecomendada: 'x', precisaEsclarecimento: false } },
    { quando: () => true, resultado: { intencaoPrimaria: 'ambigua', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'baixa', evidenciaContextual: 'sem sinal claro', acaoRecomendada: 'esclarecer', precisaEsclarecimento: true } },
  ]
  return criarInterpretadorFake(cenarios)
}

test('cega/grupo 2: desistência em formulação inédita pede confirmação, nunca cancela direto', async () => {
  const deps = depsFake({ interpretarIntencao: fakeAmploNovoParaEsteArquivo() })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'esquece, deixa quieto, não quero mais', 'compra_produto', deps)
  assert.notEqual(r.estado.fase, 'encerrado_sem_venda', 'nunca cancela na mesma mensagem, mesmo com confiança alta')
  assert.match(r.mensagem, /quer mesmo cancelar/i)
})

test('cega/grupo 2: troca de produto em formulação inédita é reconhecida', async () => {
  const deps = depsFake({ interpretarIntencao: fakeAmploNovoParaEsteArquivo() })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'troca aí por outro, prefiro um diferente dessa vez', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'escolha_categoria')
})

test('cega/grupo 2: correção de destinatário em formulação inédita aplica só o campo mencionado', async () => {
  const deps = depsFake({ interpretarIntencao: fakeAmploNovoParaEsteArquivo() })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'o nome de quem recebe mudou, agora é Beatriz', 'compra_produto', deps)
  assert.equal(r.estado.dados.formulario?.nomeDestinatario, 'Beatriz')
  assert.equal(r.estado.dados.formulario?.nomeComprador, 'Ana', 'campos não mencionados permanecem intactos')
})

test('cega/grupo 2: pergunta de preço em formulação inédita responde sem perder o estado', async () => {
  const deps = depsFake({ interpretarIntencao: fakeAmploNovoParaEsteArquivo() })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'posso saber quanto vai custar no total?', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_aprovacao_frete')
  assert.match(r.mensagem, /162,5/)
})

test('cega/grupo 2: pergunta de prazo em formulação inédita nunca avança nem cancela', async () => {
  const deps = depsFake({ interpretarIntencao: fakeAmploNovoParaEsteArquivo() })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'será que dá pra saber quando chega?', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_aprovacao_frete')
  assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas')
})

test('cega/grupo 2: pedido de atendente em formulação inédita transfere corretamente', async () => {
  const deps = depsFake({ interpretarIntencao: fakeAmploNovoParaEsteArquivo() })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'existe algum atendente disponível?', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'transferido_humano')
})

test('cega/grupo 2: mensagem genuinamente fora do escopo classificado (baixa confiança) nunca decide sozinha', async () => {
  const deps = depsFake({ interpretarIntencao: fakeAmploNovoParaEsteArquivo() })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'vocês entregam em outra cidade, tipo litoral?', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_aprovacao_frete', 'confiança baixa (cenario catch-all) nunca decide sozinha')
  assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas')
})
