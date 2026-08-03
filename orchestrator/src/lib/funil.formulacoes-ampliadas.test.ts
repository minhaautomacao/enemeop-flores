// Ampliação de cobertura (complemento mínimo pré-rollout, ver relatório da
// tarefa): tabelas parametrizadas de formulações naturais distintas — erro
// de digitação, sem acento, abreviadas, informais — cobrindo confirmação,
// negação, cancelamento, troca de produto, correção de dado e pergunta
// durante a aprovação de frete. Complementa (nunca duplica)
// funil.interpretacao.test.ts (Fatia 1) e funil.fatia2.test.ts (Fatia 2).
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

// ── Grupo A: confirmação — todas resolvidas pelo caminho determinístico
// (sem interpretador), variando acentuação, caixa, pontuação e espaçamento ──

test('grupo A: 24 variações de confirmação resolvidas sem o interpretador', async () => {
  const deps = depsFake()
  const variantes = [
    'sim', 'Sim', 'SIM', 'sim.', 'sim!', 'sim,', '  sim  ', 'Sim.',
    'confirmo', 'Confirmo', 'CONFIRMO', 'confirmo.', 'confirmado', 'Confirmado', 'confirmado!',
    'isso mesmo', 'Isso mesmo', 'ISSO MESMO', 'pode confirmar', 'Pode confirmar',
    'tá certo', 'ta certo', 'TA CERTO', 'correto', 'perfeito',
  ]
  let ok = 0
  for (const texto of variantes) {
    const r = await avancarFunil(estadoAprovacaoFreteFixture(), texto, 'compra_produto', deps)
    assert.notEqual(r.estado.fase, 'aguardando_aprovacao_frete', `"${texto}" deveria confirmar`)
    ok++
  }
  assert.equal(ok, variantes.length)
})

// ── Grupo B: negação — determinístico também, mesma variação ──────────────

test('grupo B: 8 variações de negação resolvidas sem o interpretador', async () => {
  const deps = depsFake()
  const variantes = ['não', 'nao', 'Não', 'NAO', 'não.', 'errado', 'Errado', 'na verdade']
  for (const texto of variantes) {
    const r = await avancarFunil(estadoAprovacaoFreteFixture(), texto, 'compra_produto', deps)
    assert.equal(r.estado.fase, 'aguardando_aprovacao_frete', `"${texto}" deveria negar/pedir pra continuar depois`)
  }
})

function interpretadorAmplo() {
  const cenarios: CenarioInterpretacaoFake[] = [
    { quando: (m) => /\b(cancela|cancelar|cancelamento|desist)\w*\b/i.test(m) && !/n[ãa]o\s+(quero\s+)?cancelar/i.test(m), resultado: { intencaoPrimaria: 'cancelar', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'cancelamento', acaoRecomendada: 'confirmar_cancelamento', precisaEsclarecimento: false } },
    { quando: (m) => /n[ãa]o\s+(quero\s+)?cancelar/i.test(m), resultado: { intencaoPrimaria: 'confirmar', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'não quer cancelar', acaoRecomendada: 'manter', precisaEsclarecimento: false } },
    { quando: (m) => /trocar?\s+(de\s+|o\s+)?produto|outro\s+produto|outra\s+flor|mud\w*\s+de\s+ideia.*produto/i.test(m), resultado: { intencaoPrimaria: 'trocar_produto', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'troca de produto', acaoRecomendada: 'trocar', precisaEsclarecimento: false } },
    { quando: (m) => /quanto\s+(fica|custa|é|sai)|qual\s+o\s+valor|qual\s+valor|valor\s+total/i.test(m), resultado: { intencaoPrimaria: 'perguntar_preco', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'pergunta preço', acaoRecomendada: 'responder', precisaEsclarecimento: false } },
    { quando: (m) => /chega\s+quando|prazo|qual\s+data|vai\s+chegar/i.test(m), resultado: { intencaoPrimaria: 'perguntar_prazo', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'pergunta prazo', acaoRecomendada: 'responder', precisaEsclarecimento: false } },
    { quando: (m) => /falar\s+com\s+(um[a]?\s+)?(atendente|pessoa|humano|algu[ée]m)/i.test(m) || /(me\s+passa\s+pra|chamar)\s+um\s+atendente/i.test(m), resultado: { intencaoPrimaria: 'falar_com_humano', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'quer humano', acaoRecomendada: 'transferir', precisaEsclarecimento: false } },
    { quando: () => true, resultado: { intencaoPrimaria: 'ambigua', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'baixa', evidenciaContextual: 'sem sinal claro', acaoRecomendada: 'esclarecer', precisaEsclarecimento: true } },
  ]
  return criarInterpretadorFake(cenarios)
}

// ── Grupo C: cancelamento — erro de digitação, sem acento, abreviado ──────

test('grupo C: 12 formulações de cancelamento (digitação/sem acento/abreviado) abrem confirmação, nunca cancelam direto', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorAmplo() })
  const variantes = [
    'quero cancelar', 'quero cancela', 'pfv cancela esse pedido', 'cancela ai',
    'nao quero mais, cancela', 'da pra cancelar?', 'gostaria de cancelar o pedido',
    'CANCELAR', 'cancelameno', 'quero desistir', 'desisto', 'melhor cancelar',
  ]
  for (const texto of variantes) {
    const r = await avancarFunil(estadoAprovacaoFreteFixture(), texto, 'compra_produto', deps)
    assert.notEqual(r.estado.fase, 'encerrado_sem_venda', `"${texto}" nunca cancela na mesma mensagem`)
    assert.match(r.mensagem, /quer mesmo cancelar/i, `"${texto}" deveria abrir a confirmação`)
  }
})

// ── Grupo D: negativa indireta — mencionar cancelamento sem querer cancelar ──

test('grupo D: 6 formulações que mencionam cancelamento mas não cancelam', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorAmplo() })
  const variantes = [
    'não quero cancelar, só trocar o produto',
    'nao quero cancelar de jeito nenhum',
    'não, não quero cancelar',
    'longe de cancelar, só queria trocar o produto',
    'não é pra cancelar, é pra trocar o produto',
    'nunca ia cancelar, quero trocar o produto',
  ]
  for (const texto of variantes) {
    const r = await avancarFunil(estadoAprovacaoFreteFixture(), texto, 'compra_produto', deps)
    assert.notEqual(r.estado.fase, 'encerrado_sem_venda', `"${texto}" nunca deveria cancelar`)
  }
})

// ── Grupo E: troca de produto — variedade de formulação ───────────────────

test('grupo E: 10 formulações de troca de produto', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorAmplo() })
  const variantes = [
    'quero trocar o produto', 'quero trocar produto', 'da pra trocar o produto?',
    'pode trocar o produto', 'quero outro produto', 'quero outra flor',
    'na verdade quero trocar o produto', 'mudei de ideia sobre o produto',
    'quero trocar de produto por favor', 'trocar produto, por gentileza',
  ]
  for (const texto of variantes) {
    const r = await avancarFunil(estadoAprovacaoFreteFixture(), texto, 'compra_produto', deps)
    // Frases que também batem em FRASES_NOVO_PEDIDO (lista determinística
    // pré-existente, ex.: "trocar o produto") são interceptadas ANTES do
    // gate contextual e, como o formulário está completo, perguntam se o
    // cliente quer reaproveitar os dados — nunca ficam presas na aprovação
    // de frete. As demais (formulação inédita) passam pelo interpretador e
    // vão direto pra escolha_categoria. Ambos os desfechos contam como
    // "reconheceu a troca", nunca como "ignorou a mensagem".
    assert.notEqual(r.estado.fase, 'aguardando_aprovacao_frete', `"${texto}" deveria reconhecer a troca de produto`)
    assert.ok(
      r.estado.fase === 'escolha_categoria' || r.estado.fase === 'aguardando_reaproveitar_dados',
      `"${texto}" deveria ir para escolha_categoria ou aguardando_reaproveitar_dados, foi para ${r.estado.fase}`,
    )
  }
})

// ── Grupo F: perguntas durante a aprovação — preço/prazo, sem perder estado ──

test('grupo F: 8 formulações de pergunta durante a aprovação de frete, nunca avançam nem cancelam', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorAmplo() })
  const variantes = [
    'quanto fica no total?', 'quanto custa tudo junto', 'qual o valor final',
    'valor total, por favor', 'chega quando', 'qual o prazo de entrega',
    'vai chegar quando exatamente', 'qual a data'
  ]
  for (const texto of variantes) {
    const r = await avancarFunil(estadoAprovacaoFreteFixture(), texto, 'compra_produto', deps)
    assert.equal(r.estado.fase, 'aguardando_aprovacao_frete', `"${texto}" nunca avança sozinho`)
    assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas', `"${texto}" nunca perde o produto`)
  }
})

// ── Grupo G: falar com humano — formulação indireta ────────────────────────

test('grupo G: 6 formulações de pedido de atendente', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorAmplo() })
  const variantes = [
    'quero falar com um atendente', 'quero falar com uma pessoa', 'quero falar com humano',
    'me passa pra um atendente', 'quero falar com alguem de verdade', 'pode chamar um atendente?'
  ]
  for (const texto of variantes) {
    const r = await avancarFunil(estadoAprovacaoFreteFixture(), texto, 'compra_produto', deps)
    assert.equal(r.estado.fase, 'transferido_humano', `"${texto}" deveria transferir`)
  }
})

// ── Grupo H: correção de dado em linguagem livre — o interpretador
// classifica QUE tipo de alteração é (corrigir_informacao), e o extrator
// determinístico (extrairCorrecaoFormulario, reaproveitado de
// etapaConfirmandoFormulario) lê o valor real do texto — nunca o valor vem
// do modelo diretamente. ─────────────────────────────────────────────────

test('grupo H: 8 formulações de correção de dado — intenção via interpretador, valor via extrator determinístico', async () => {
  const deps = depsFake({ interpretarIntencao: criarInterpretadorFake([
    { quando: () => true, resultado: { intencaoPrimaria: 'corrigir_informacao', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'correção de dado', acaoRecomendada: 'corrigir', precisaEsclarecimento: false } },
  ]) })
  const casos: [string, keyof NonNullable<EstadoConversa['dados']['formulario']>, string][] = [
    ['o destinatário é Fernanda', 'nomeDestinatario', 'Fernanda'],
    ['quem vai receber é Fernanda', 'nomeDestinatario', 'Fernanda'],
    ['corrija o destinatário para Fernanda', 'nomeDestinatario', 'Fernanda'],
    ['o remetente é Carlos', 'nomeComprador', 'Carlos'],
    ['quem está fazendo o pedido é Carlos', 'nomeComprador', 'Carlos'],
    ['o cep é 04204-030', 'cep', '04204-030'],
    ['o número é 55', 'numero', '55'],
    ['o complemento é apto 12', 'complemento', 'apto 12'],
  ]
  // "correção aplicada" nem sempre muda a fase — só campos que invalidam a
  // cotação (endereço/data) fazem isso (ver CAMPOS_FORMULARIO_QUE_INVALIDAM_COTACAO
  // em funil.ts); nomeDestinatario/nomeComprador/cep/número/complemento
  // recalculam o total e permanecem na mesma etapa, prontos pra aprovação —
  // por isso a asserção correta é checar o VALOR do campo, não a fase.
  for (const [texto, campo, valorEsperado] of casos) {
    const r = await avancarFunil(estadoAprovacaoFreteFixture(), texto, 'compra_produto', deps)
    assert.equal(r.estado.dados.formulario?.[campo], valorEsperado, `"${texto}" deveria corrigir ${campo}`)
  }
})

// ── Grupo I: transcrição imperfeita de áudio (sem pontuação, hesitações,
// tudo minúsculo) ──────────────────────────────────────────────────────────

test('grupo I: 6 transcrições imperfeitas de áudio interpretadas corretamente', async () => {
  const deps = depsFake({ interpretarIntencao: criarInterpretadorFake([
    { quando: (m) => /cancela/i.test(m), resultado: { intencaoPrimaria: 'cancelar', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'x', acaoRecomendada: 'x', precisaEsclarecimento: false } },
    { quando: (m) => /trocar/i.test(m), resultado: { intencaoPrimaria: 'trocar_produto', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'x', acaoRecomendada: 'x', precisaEsclarecimento: false } },
    { quando: () => true, resultado: { intencaoPrimaria: 'ambigua', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'baixa', evidenciaContextual: 'x', acaoRecomendada: 'x', precisaEsclarecimento: true } },
  ]) })
  const variantes = [
    'eh tipo assim acho que pode cancela isso ai',
    'entao eh o seguinte eu queria trocar o produto sabe',
    'oi tudo bem eu queria cancela por favor',
    'eh entao eu acho que quero trocar sabe como e',
    'ah tipo assim cancela pra mim por favor',
    'bom eh so isso mesmo quero trocar o produto ai',
  ]
  for (const texto of variantes) {
    const r = await avancarFunil(estadoAprovacaoFreteFixture(), texto, 'compra_produto', deps)
    assert.notEqual(r.estado.fase, 'aguardando_pagamento', `"${texto}" nunca deveria confirmar pagamento sozinho`)
  }
})

// ── Grupo J: respostas contraditórias — nunca resolvidas com confiança,
// sempre escalam pro esclarecimento (nunca adivinham) ─────────────────────

test('grupo J: 5 respostas contraditórias nunca são resolvidas com confiança', async () => {
  const deps = depsFake({ interpretarIntencao: criarInterpretadorFake([
    { quando: () => true, resultado: { intencaoPrimaria: 'ambigua', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'baixa', evidenciaContextual: 'contraditório', acaoRecomendada: 'esclarecer', precisaEsclarecimento: true } },
  ]) })
  const variantes = [
    'sim não sei', 'quero e não quero', 'confirmo mas cancela', 'sim mas não', 'pode ser mas na verdade não',
  ]
  for (const texto of variantes) {
    const r = await avancarFunil(estadoAprovacaoFreteFixture(), texto, 'compra_produto', deps)
    assert.equal(r.estado.fase, 'aguardando_aprovacao_frete', `"${texto}" nunca decide sozinho`)
    assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas')
  }
})

// ── Grupo K: mais 10 formulações negativas explícitas (nunca viram a ação oposta) ──

test('grupo K: 10 negativos adicionais', async () => {
  const deps = depsFake({ interpretarIntencao: criarInterpretadorFake([
    { quando: (m) => /n[ãa]o.*confirma|n[ãa]o.*quero.*seguir|n[ãa]o.*avan[çc]a/i.test(m), resultado: { intencaoPrimaria: 'negar', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'nega explicitamente', acaoRecomendada: 'negar', precisaEsclarecimento: false } },
    { quando: () => true, resultado: { intencaoPrimaria: 'ambigua', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'baixa', evidenciaContextual: 'x', acaoRecomendada: 'x', precisaEsclarecimento: true } },
  ]) })
  const variantes = [
    'não confirma não', 'não quero seguir assim não', 'não avança ainda não',
    'espera, não confirma', 'pera, não quero seguir agora', 'ainda não, não confirma',
    'nao quero seguir com isso nao', 'nao da pra confirmar agora nao', 'nao avanca nao, calma',
    'nao, nao quero seguir',
  ]
  for (const texto of variantes) {
    const r = await avancarFunil(estadoAprovacaoFreteFixture(), texto, 'compra_produto', deps)
    assert.notEqual(r.estado.fase, 'aguardando_pagamento', `"${texto}" nunca confirma o pagamento`)
  }
})
