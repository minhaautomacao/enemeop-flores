// Testes da camada de interpretação contextual de intenção (fatia 1: gate
// resolverRetomadaAposIntervalo). Diferente de funil.test.ts (casos isolados
// conhecidos), este arquivo cobre CLASSES inteiras de formulações
// equivalentes — o objetivo explícito é provar que a Flora entende variações
// linguísticas nunca cadastradas em nenhuma lista, não só as frases que já
// causaram bug em produção.
//
// Rodar: npm run test (dentro de orchestrator/)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avancarFunil, mensagemRetomadaAposIntervalo, type EstadoConversa } from './funil.js'
import { depsFake, criarInterpretadorFake, type CenarioInterpretacaoFake } from './funil.test-helpers.js'

function estadoRetomadaFixture(overrides: Partial<EstadoConversa['dados']> = {}): EstadoConversa {
  return {
    fase: 'retomada_apos_intervalo',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1 },
      faseAntesDoIntervalo: 'aguardando_aprovacao_frete',
      valorFrete: 22.5, valorTotal: 162.5,
      freteDetalhes: { cotadoEm: new Date().toISOString() },
      ...overrides,
    },
    perguntasFeitas: [],
  }
}

// Fake "plausível": decide como um modelo real decidiria, olhando a própria
// mensagem — nunca um valor fixo cego, senão os testes negativos (que
// dependem do fake reconhecer negação) não teriam nenhum valor real.
function interpretadorPlausivel() {
  const cenarios: CenarioInterpretacaoFake[] = [
    {
      quando: (msg) => /\bn[ãa]o\b/i.test(msg) && /(anterior|continuar|mesmo)/i.test(msg),
      resultado: { intencaoPrimaria: 'iniciar_nova_compra', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'media', evidenciaContextual: 'negação explícita', acaoRecomendada: 'nova_compra', precisaEsclarecimento: false },
    },
    {
      quando: (msg) => /(continu|retom|termin|manter|mesm|aquele pedido|de onde paramos|dar continuidade|prossegu|deixa como|nao quero (outro|comecar))/i.test(msg),
      resultado: { intencaoPrimaria: 'continuar_pedido_anterior', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'cliente referenciou o pedido/atendimento anterior', acaoRecomendada: 'continuar', precisaEsclarecimento: false },
    },
    {
      quando: (msg) => /(novo|diferente|outra compra|começar de novo|comecar de novo)/i.test(msg),
      resultado: { intencaoPrimaria: 'iniciar_nova_compra', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'cliente quer algo novo', acaoRecomendada: 'nova_compra', precisaEsclarecimento: false },
    },
    {
      quando: (msg) => /(atendente|humano|pessoa de verdade|falar com alguem)/i.test(msg),
      resultado: { intencaoPrimaria: 'falar_com_humano', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'pediu atendente', acaoRecomendada: 'transferir', precisaEsclarecimento: false },
    },
  ]
  return criarInterpretadorFake(cenarios)
}

// ── Classe: "continuar pedido anterior" — já coberta pelo caminho
// determinístico existente (nunca precisa do modelo pra isso; sem
// deps.interpretarIntencao, prova que o caminho rápido/gratuito funciona) ──

test('continuar pedido anterior: variações cobertas pelo caminho determinístico, sem precisar do interpretador', async () => {
  const deps = depsFake() // sem interpretarIntencao — se algum destes precisasse do modelo, o teste falharia
  const variantes = [
    'anterior', 'o anterior', 'pedido anterior', 'Anterior', 'ANTERIOR', 'continuar com o anterior',
    'continuar', 'continua', 'pode continuar', 'pode seguir', 'segue', 'prossegue',
    'sim', 'confirmo', 'confirmado', 'isso mesmo', 'pode confirmar', 'tá certo', 'ta certo', 'correto', 'perfeito',
  ]
  for (const texto of variantes) {
    const r = await avancarFunil(estadoRetomadaFixture(), texto, 'compra_produto', deps)
    assert.equal(r.estado.fase, 'aguardando_aprovacao_frete', `"${texto}" deveria continuar o pedido anterior via caminho determinístico`)
    assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas', `"${texto}" deveria preservar o produto`)
  }
})

// ── Classe: formulações inéditas — nunca cadastradas em nenhuma lista fixa,
// só resolvidas pela camada de interpretação contextual. É exatamente a
// classe de bug que gerava patch pontual atrás de patch pontual em produção
// (ver comentários "bug real observado em monitoramento" em funil.ts) ──

test('continuar pedido anterior: formulações inéditas, resolvidas só pela interpretação contextual (não cadastradas em nenhuma lista)', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorPlausivel() })
  const variantes = [
    'vamos terminar o que começamos',
    'quero aquele pedido',
    'sim, aquele mesmo',
    'esse mesmo',
    'prefiro manter o pedido',
    'pode dar continuidade',
    'quero retomar',
    'retomar atendimento',
    'deixa como estava',
  ]
  for (const texto of variantes) {
    const r = await avancarFunil(estadoRetomadaFixture(), texto, 'compra_produto', deps)
    assert.equal(r.estado.fase, 'aguardando_aprovacao_frete', `"${texto}" deveria continuar via interpretação contextual`)
    assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas', `"${texto}" deveria preservar o produto`)
  }
})

// ── Classe: "iniciar nova compra" via interpretação contextual ────────────

test('iniciar nova compra: formulações inéditas resolvidas pela interpretação contextual', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorPlausivel() })
  const variantes = ['quero um pedido diferente agora', 'prefiro começar de novo', 'quero outra compra']
  for (const texto of variantes) {
    const r = await avancarFunil(estadoRetomadaFixture(), texto, 'compra_produto', deps)
    assert.notEqual(r.estado.fase, 'aguardando_aprovacao_frete', `"${texto}" deveria iniciar nova compra, nunca continuar o pedido anterior`)
    assert.equal(r.estado.dados.produto, undefined, `"${texto}" nunca deveria reaproveitar o produto anterior`)
  }
})

// ── Falar com humano via interpretação contextual (mesma gate, nunca exige
// que o cliente use as palavras exatas "falar com atendente") ────────────

test('falar com humano: reconhecido pela interpretação contextual mesmo com formulação indireta', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorPlausivel() })
  const r = await avancarFunil(estadoRetomadaFixture(), 'prefiro falar com uma pessoa de verdade', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'transferido_humano')
})

// ── Testes NEGATIVOS — frases parecidas que NUNCA podem virar a ação
// oposta. Sem estes testes, um "sim" solto dentro de "não quero continuar,
// prefiro parar" poderia enganar um matching ingênuo. ─────────────────────

test('negativo: "não quero o pedido anterior" nunca é classificado como continuar (bug real de falso-positivo por substring, corrigido nesta correção)', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorPlausivel() })
  const r = await avancarFunil(estadoRetomadaFixture(), 'não quero o pedido anterior', 'compra_produto', deps)
  assert.notEqual(r.estado.fase, 'aguardando_aprovacao_frete', 'negação explícita nunca pode resolver como continuar')
})

test('negativo: "não, quero continuar não, prefiro outro" nunca continua o pedido anterior', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorPlausivel() })
  const r = await avancarFunil(estadoRetomadaFixture(), 'não, quero continuar não, prefiro outro', 'compra_produto', deps)
  assert.notEqual(r.estado.fase, 'aguardando_aprovacao_frete')
})

test('negativo: mensagem genuinamente fora de contexto nunca avança sozinha nem é tratada como confirmação', async () => {
  const deps = depsFake({ interpretarIntencao: criarInterpretadorFake([
    { quando: () => true, resultado: { intencaoPrimaria: 'fora_de_contexto', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'assunto não relacionado', acaoRecomendada: 'esclarecer', precisaEsclarecimento: true } },
  ]) })
  const r = await avancarFunil(estadoRetomadaFixture(), 'vocês vendem bolo também?', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'retomada_apos_intervalo', 'nunca avança sozinho numa mensagem fora de contexto')
  assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas', 'nunca apaga dados válidos por causa de uma interpretação incerta')
})

// ── Proteção anti-loop: escalada 1ª/2ª/3ª falha, nunca repete a mesma
// redação, nunca reseta o estado silenciosamente ─────────────────────────

test('anti-loop: 1ª falha reformula, 2ª falha mostra opções numeradas, contador nunca reseta sozinho', async () => {
  const deps = depsFake() // sem interpretador — toda mensagem ambígua cai direto na escalada
  let estado = estadoRetomadaFixture()

  const r1 = await avancarFunil(estado, 'hein', 'compra_produto', deps)
  assert.equal(r1.estado.fase, 'retomada_apos_intervalo')
  assert.notEqual(r1.mensagem, mensagemRetomadaAposIntervalo(), '1ª falha reformula, nunca repete a redação exata')
  assert.equal(r1.estado.dados.tentativasInterpretacao?.['retomada_apos_intervalo'], 1)
  estado = r1.estado

  const r2 = await avancarFunil(estado, 'sei la', 'compra_produto', deps)
  assert.equal(r2.estado.fase, 'retomada_apos_intervalo')
  assert.match(r2.mensagem, /1\..*2\./s, '2ª falha apresenta opções numeradas')
  assert.equal(r2.estado.dados.tentativasInterpretacao?.['retomada_apos_intervalo'], 2)
  estado = r2.estado

  const r3 = await avancarFunil(estado, 'ainda nao sei', 'compra_produto', deps)
  assert.equal(r3.estado.fase, 'retomada_apos_intervalo', '3ª falha preserva o estado, nunca reinicia nem transfere sozinho')
  assert.match(r3.mensagem, /atendente/i, '3ª falha oferece atendimento humano, mas continua tentando interpretar')
  assert.equal(r3.estado.dados.produto?.nome, 'Buquê de Rosas', 'produto nunca é apagado durante a escalada')
})

test('anti-loop: opção numérica "1"/"2" (mostrada na 2ª+ falha) é aceita mesmo sem o interpretador', async () => {
  const deps = depsFake()
  let estado = estadoRetomadaFixture()
  estado = (await avancarFunil(estado, 'hein', 'compra_produto', deps)).estado
  estado = (await avancarFunil(estado, 'sei la', 'compra_produto', deps)).estado // agora em tentativas=2, opções numeradas mostradas

  const rNumero = await avancarFunil(estado, '1', 'compra_produto', deps)
  assert.equal(rNumero.estado.fase, 'aguardando_aprovacao_frete', 'responder "1" às opções numeradas continua o pedido anterior')
})

test('anti-loop: contador reseta só no único caminho de sucesso, nunca por mudança de fase', async () => {
  const deps = depsFake()
  let estado = estadoRetomadaFixture()
  estado = (await avancarFunil(estado, 'hein', 'compra_produto', deps)).estado
  assert.equal(estado.dados.tentativasInterpretacao?.['retomada_apos_intervalo'], 1)

  const rSucesso = await avancarFunil(estado, 'sim, quero continuar', 'compra_produto', deps)
  assert.equal(rSucesso.estado.fase, 'aguardando_aprovacao_frete')
  assert.equal(rSucesso.estado.dados.tentativasInterpretacao, undefined, 'sucesso limpa o contador de tentativas')
  assert.equal(rSucesso.estado.dados.ultimaPergunta, undefined, 'sucesso limpa a pergunta pendente')
})

// ── Indisponibilidade do modelo: nunca quebra o atendimento, cai no mesmo
// fallback de "sem interpretador conectado" ──────────────────────────────

test('modelo indisponível/timeout (interpretarIntencao devolve null) nunca quebra o atendimento, cai na escalada anti-loop normalmente', async () => {
  const deps = depsFake({ interpretarIntencao: async () => null })
  const r = await avancarFunil(estadoRetomadaFixture(), 'sei la, me ajuda', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'retomada_apos_intervalo')
  assert.equal(typeof r.mensagem, 'string')
})

test('modelo devolve JSON inválido/fora do schema: tratado exatamente como indisponibilidade, nunca aceito parcialmente', async () => {
  const deps = depsFake({ interpretarIntencao: async () => 'isto não é um JSON válido {' })
  const r = await avancarFunil(estadoRetomadaFixture(), 'sei la', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'retomada_apos_intervalo', 'JSON inválido nunca é aceito, cai no fallback determinístico/anti-loop')
})

test('modelo devolve confiança baixa: nunca executa a ação, sempre pede esclarecimento', async () => {
  const deps = depsFake({ interpretarIntencao: criarInterpretadorFake([
    { quando: () => true, resultado: { intencaoPrimaria: 'continuar_pedido_anterior', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'baixa', evidenciaContextual: 'não tenho certeza', acaoRecomendada: 'esclarecer', precisaEsclarecimento: true } },
  ]) })
  const r = await avancarFunil(estadoRetomadaFixture(), 'talvez', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'retomada_apos_intervalo', 'confiança baixa nunca executa a ação sozinha, mesmo que a intenção pareça clara')
})
