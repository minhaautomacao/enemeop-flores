// Testes da Fatia 2 (correção estrutural): migração dos gates de
// confirmação/negação restantes (aprovação de frete, confirmação do
// formulário, reaproveitamento de dados) e do motor de ações compostas —
// intenção primária + secundárias aplicadas em conjunto, sem descartar
// nenhuma informação da mensagem. Complementa funil.interpretacao.test.ts
// (Fatia 1, gate resolverRetomadaAposIntervalo), que continua intocado.
//
// Rodar: npm run test (dentro de orchestrator/)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avancarFunil, classificarIntencao, intencaoInterrompeFluxo, type EstadoConversa } from './funil.js'
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

function estadoConfirmandoFormularioFixture(overrides: Partial<EstadoConversa['dados']> = {}): EstadoConversa {
  return {
    fase: 'confirmando_formulario',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1 },
      formulario: formularioFixture(),
      ...overrides,
    },
    perguntasFeitas: [],
  }
}

/** Fake "plausível" pro conjunto de intenções desta fatia — decide olhando a própria mensagem, nunca um valor fixo cego (senão os testes negativos não teriam valor real). */
function interpretadorPlausivelFatia2() {
  const cenarios: CenarioInterpretacaoFake[] = [
    {
      quando: (msg) => /(cancela|cancelar|desist)/i.test(msg) && !/n[ãa]o quero cancelar/i.test(msg),
      resultado: { intencaoPrimaria: 'cancelar', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'pediu cancelamento', acaoRecomendada: 'confirmar_cancelamento', precisaEsclarecimento: false },
    },
    {
      quando: (msg) => /n[ãa]o quero cancelar.*troca/i.test(msg),
      resultado: { intencaoPrimaria: 'trocar_produto', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'quer trocar, não cancelar', acaoRecomendada: 'trocar_produto', precisaEsclarecimento: false },
    },
    {
      quando: (msg) => /mant[ée]m o pedido e entrega amanh[ãa]/i.test(msg),
      resultado: { intencaoPrimaria: 'confirmar', intencoesSecundarias: ['alterar_data'], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'confirma e pede nova data', acaoRecomendada: 'confirmar_e_alterar_data', precisaEsclarecimento: false },
    },
    {
      quando: (msg) => /pode seguir.*(s[óo] )?muda o endere[çc]o/i.test(msg),
      resultado: { intencaoPrimaria: 'confirmar', intencoesSecundarias: ['alterar_endereco'], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'confirma e corrige endereço', acaoRecomendada: 'confirmar_e_alterar_endereco', precisaEsclarecimento: false },
    },
    {
      quando: (msg) => /troca o destinat[áa]rio.*aumenta a quantidade/i.test(msg),
      resultado: { intencaoPrimaria: 'alterar_destinatario', intencoesSecundarias: ['alterar_quantidade'], entidades: { nomeDestinatario: 'Fernanda', quantidade: 3 }, camposParaAtualizar: ['nomeDestinatario'], confianca: 'alta', evidenciaContextual: 'troca destinatário e quantidade', acaoRecomendada: 'aplicar_duas_alteracoes', precisaEsclarecimento: false },
    },
    {
      quando: (msg) => /quanto (fica|custa|est[áa])|qual o valor/i.test(msg),
      resultado: { intencaoPrimaria: 'perguntar_preco', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'pergunta o valor antes de decidir', acaoRecomendada: 'responder_preco', precisaEsclarecimento: false },
    },
    {
      quando: (msg) => /prefiro falar com uma pessoa|falar com atendente/i.test(msg),
      resultado: { intencaoPrimaria: 'falar_com_humano', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'pediu atendente', acaoRecomendada: 'transferir', precisaEsclarecimento: false },
    },
    {
      quando: (msg) => /quero (trocar|escolher outro) (o )?produto|prefiro ver outro tipo de flor/i.test(msg),
      resultado: { intencaoPrimaria: 'trocar_produto', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'quer outro produto', acaoRecomendada: 'trocar_produto', precisaEsclarecimento: false },
    },
    {
      quando: (msg) => /o destinat[áa]rio agora [ée]|corrija o destinat[áa]rio/i.test(msg),
      resultado: { intencaoPrimaria: 'corrigir_informacao', intencoesSecundarias: [], entidades: { nomeDestinatario: 'Fernanda' }, camposParaAtualizar: ['nomeDestinatario'], confianca: 'alta', evidenciaContextual: 'corrige destinatário', acaoRecomendada: 'corrigir_destinatario', precisaEsclarecimento: false },
    },
  ]
  return criarInterpretadorFake(cenarios)
}

// ── Ações compostas: confirmar + alterar_data / alterar_endereco ──────────

test('composta: "mantém o pedido e entrega amanhã" confirma E aplica a nova data, sem descartar nenhuma das duas informações', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorPlausivelFatia2() })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'mantém o pedido e entrega amanhã', 'compra_produto', deps)
  assert.equal(r.estado.dados.formulario?.dataEntrega, 'amanha', 'nunca descarta a nova data')
  assert.equal(r.estado.fase, 'aguardando_aprovacao_frete', 'data nova invalida a cotação, recota, e volta a pedir aprovação com o total atualizado')
  assert.match(r.mensagem, /aprova o frete/i, 'recotação concluída, nunca trava em calculando_frete')
})

test('composta: "pode seguir, só muda o endereço" preserva a intenção de confirmar E aplica a correção de endereço', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorPlausivelFatia2() })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'pode seguir, só muda o endereço para Rua Nova, número 55, cep 04204-030', 'compra_produto', deps)
  assert.equal(r.estado.dados.formulario?.numero, '55')
})

test('composta: "troca o destinatário e aumenta a quantidade" aplica as duas alterações juntas', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorPlausivelFatia2() })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'troca o destinatário e aumenta a quantidade para 3', 'compra_produto', deps)
  assert.equal(r.estado.dados.formulario?.nomeDestinatario, 'Fernanda', 'nunca descarta a troca de destinatário')
  assert.equal(r.estado.dados.produto?.quantidade, 3, 'nunca descarta o aumento de quantidade')
  assert.equal(r.estado.dados.valorTotal, 140 * 3 + 22.5, 'total recalculado com a nova quantidade')
})

// ── Cancelamento nunca é automático — sempre pede confirmação explícita ───

test('"não quero cancelar, quero trocar" NUNCA cancela — reconhece a intenção real (trocar), não a palavra "cancelar" isolada', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorPlausivelFatia2() })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'não quero cancelar, quero trocar de produto', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'escolha_categoria', 'troca de produto, nunca cancelamento')
  assert.notEqual(r.estado.fase, 'encerrado_sem_venda')
})

test('"quero cancelar" abre confirmação explícita, nunca cancela na mesma mensagem', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorPlausivelFatia2() })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'quero cancelar esse pedido', 'compra_produto', deps)
  assert.notEqual(r.estado.fase, 'encerrado_sem_venda', 'nunca cancela automaticamente numa única mensagem')
  assert.match(r.mensagem, /quer mesmo cancelar/i)
  assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas', 'produto preservado enquanto aguarda a confirmação do cancelamento')

  const rConfirma = await avancarFunil(r.estado, 'sim', 'compra_produto', deps)
  assert.equal(rConfirma.estado.fase, 'encerrado_sem_venda')
  assert.equal(rConfirma.estado.dados.produto, undefined)

  const rNega = await avancarFunil(r.estado, 'não', 'compra_produto', deps)
  assert.notEqual(rNega.estado.fase, 'encerrado_sem_venda')
  assert.equal(rNega.estado.dados.produto?.nome, 'Buquê de Rosas', 'produto preservado quando o cliente desiste do cancelamento')
})

test('cancelamento puro fora de qualquer fase de confirmação também pede confirmação explícita, nunca reinicia a jornada silenciosamente', async () => {
  const deps = depsFake()
  const estado = estadoAprovacaoFreteFixture()
  const r = await avancarFunil(estado, 'cancele este pedido', 'compra_produto', deps)
  assert.notEqual(r.estado.fase, 'inicio', 'nunca reinicia silenciosamente')
  assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas', 'produto nunca é descartado sem confirmação')
  assert.match(r.mensagem, /quer mesmo cancelar/i)
})

test('mensagem composta "cancele este pedido. Vamos fazer um novo" continua reiniciando direto (comportamento existente, nunca alterado)', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = { fase: 'aguardando_pagamento', dados: { produto: { nome: 'Buquê X', preco: 100, quantidade: 1 }, linkPagamento: 'https://pagamento.exemplo/pref_id=abc-123' }, perguntasFeitas: [] }
  const r = await avancarFunil(estado, 'cancele este pedido. Vamos fazer um novo', 'compra_produto', deps)
  assert.notEqual(r.estado.fase, 'aguardando_pagamento')
  assert.equal(r.estado.dados.produto, undefined)
})

// ── Perguntas do cliente durante a aprovação — respondidas sem perder o estado ──

test('"sim, mas antes quero saber o valor" responde o preço e preserva o estado, sem confirmar nem cancelar sozinho', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorPlausivelFatia2() })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'quanto fica no total?', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_aprovacao_frete', 'pergunta nunca avança nem cancela sozinha')
  assert.match(r.mensagem, /162,5|162\.5/)
  assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas')
})

// ── Falar com humano reconhecido durante a aprovação ──────────────────────

test('"prefiro falar com uma pessoa de verdade" transfere para humano, mesmo durante a aprovação do frete', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorPlausivelFatia2() })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'prefiro falar com uma pessoa de verdade', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'transferido_humano')
})

// ── Confiança baixa nunca executa nada, mesmo com intenção aparentemente clara ──

test('confiança baixa na aprovação de frete nunca cancela nem confirma — sempre esclarece', async () => {
  const deps = depsFake({ interpretarIntencao: criarInterpretadorFake([
    { quando: () => true, resultado: { intencaoPrimaria: 'cancelar', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'baixa', evidenciaContextual: 'não tenho certeza', acaoRecomendada: 'esclarecer', precisaEsclarecimento: true } },
  ]) })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'sei lá, talvez', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_aprovacao_frete')
  assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas')
})

// ── Anti-loop na aprovação de frete: nunca repete a mesma redação ─────────

test('anti-loop na aprovação de frete: 1ª falha reformula, nunca repete a mensagem original', async () => {
  const deps = depsFake()
  const r1 = await avancarFunil(estadoAprovacaoFreteFixture(), 'hein', 'compra_produto', deps)
  assert.equal(r1.estado.fase, 'aguardando_aprovacao_frete')
  assert.equal(r1.estado.dados.tentativasInterpretacao?.['aprovacao_frete'], 1)

  const r2 = await avancarFunil(r1.estado, 'sei la', 'compra_produto', deps)
  assert.match(r2.mensagem, /1\..*2\./s, '2ª falha apresenta opções numeradas')

  const rNumero = await avancarFunil(r2.estado, '1', 'compra_produto', deps)
  assert.notEqual(rNumero.estado.fase, 'aguardando_aprovacao_frete', 'opção numérica "1" confirma mesmo sem o interpretador')
})

// ── etapaConfirmandoFormulario: correção em formulação inédita ────────────

test('correção em formulação inédita ("o destinatário agora é...") é aplicada via interpretação contextual quando o parser determinístico não reconhece', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorPlausivelFatia2() })
  const r = await avancarFunil(estadoConfirmandoFormularioFixture(), 'o destinatário agora é Fernanda, por favor', 'compra_produto', deps)
  assert.equal(r.estado.dados.formulario?.nomeDestinatario, 'Fernanda')
})

test('etapaConfirmandoFormulario: cancelamento pede confirmação explícita, nunca cancela direto', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorPlausivelFatia2() })
  const r = await avancarFunil(estadoConfirmandoFormularioFixture(), 'quero cancelar esse pedido', 'compra_produto', deps)
  assert.notEqual(r.estado.fase, 'encerrado_sem_venda')
  const rConfirma = await avancarFunil(r.estado, 'sim', 'compra_produto', deps)
  assert.equal(rConfirma.estado.fase, 'encerrado_sem_venda')
})

test('etapaConfirmandoFormulario: troca de produto em formulação que não está em nenhuma lista fixa (FRASES_NOVO_PEDIDO) é reconhecida via interpretação contextual', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorPlausivelFatia2() })
  const r = await avancarFunil(estadoConfirmandoFormularioFixture(), 'prefiro ver outro tipo de flor', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'escolha_categoria')
})

test('etapaConfirmandoFormulario: correção rotulada continua tendo prioridade mesmo sem interpretador conectado (comportamento determinístico preservado)', async () => {
  const deps = depsFake()
  const r = await avancarFunil(estadoConfirmandoFormularioFixture(), 'Destinatário: Fernanda', 'compra_produto', deps)
  assert.equal(r.estado.dados.formulario?.nomeDestinatario, 'Fernanda')
})

// ── Reaproveitamento de dados: formulações inéditas via interpretação (sem quebrar o comportamento exato sem interpretador) ──

test('reaproveitamento de dados: "pode usar os mesmos" (formulação inédita) reconhecida via interpretação contextual', async () => {
  const deps = depsFake({ interpretarIntencao: criarInterpretadorFake([
    { quando: (msg) => /pode usar os mesmos/i.test(msg), resultado: { intencaoPrimaria: 'confirmar', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'aceita reaproveitar', acaoRecomendada: 'reaproveitar', precisaEsclarecimento: false } },
  ]) })
  const estado: EstadoConversa = { fase: 'aguardando_reaproveitar_dados', dados: { formularioAnterior: formularioFixture() }, perguntasFeitas: [] }
  const r = await avancarFunil(estado, 'pode usar os mesmos', 'compra_produto', deps)
  assert.notEqual(r.estado.fase, 'aguardando_reaproveitar_dados')
  assert.equal(r.estado.dados.formulario?.nomeDestinatario, 'Camila')
})

test('reaproveitamento de dados: sem interpretador conectado, resposta ambígua continua repetindo a pergunta exata de sempre (nenhuma regressão)', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = { fase: 'aguardando_reaproveitar_dados', dados: { formularioAnterior: formularioFixture() }, perguntasFeitas: [] }
  const r = await avancarFunil(estado, 'quero um buquê de rosas', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_reaproveitar_dados')
  assert.match(r.mensagem, /mesmos dados de entrega do pedido anterior/i)
})

// ── Variedade de formulação: erro de digitação, sem acento, abreviado,
// transcrição imperfeita de áudio — todas resolvidas pelo caminho
// determinístico (nunca precisam do interpretador) ou pela camada
// contextual, nunca por uma frase nova cadastrada numa lista ──────────────

test('confirmação na aprovação de frete: variações de digitação/acentuação/caixa resolvidas sem o interpretador', async () => {
  const deps = depsFake()
  const variantes = ['sim', 'Sim', 'SIM', 'confirmo', 'confirmado', 'isso mesmo', 'pode confirmar', 'ta certo', 'perfeito']
  for (const texto of variantes) {
    const r = await avancarFunil(estadoAprovacaoFreteFixture(), texto, 'compra_produto', deps)
    assert.notEqual(r.estado.fase, 'aguardando_aprovacao_frete', `"${texto}" deveria confirmar`)
  }
})

test('cancelamento: variações de digitação/sem acento/abreviadas reconhecidas via interpretação contextual', async () => {
  const deps = depsFake({ interpretarIntencao: criarInterpretadorFake([
    { quando: (msg) => /(cancela|cancelr|canselar|desist)/i.test(msg), resultado: { intencaoPrimaria: 'cancelar', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'pediu cancelamento', acaoRecomendada: 'confirmar_cancelamento', precisaEsclarecimento: false } },
  ]) })
  const variantes = ['quero cancelr', 'pfv cancela', 'quero desistir do pedido', 'nao quero mais, canselar']
  for (const texto of variantes) {
    const r = await avancarFunil(estadoAprovacaoFreteFixture(), texto, 'compra_produto', deps)
    assert.notEqual(r.estado.fase, 'encerrado_sem_venda', `"${texto}" nunca cancela na mesma mensagem`)
    assert.match(r.mensagem, /quer mesmo cancelar/i, `"${texto}" deveria abrir a confirmação de cancelamento`)
  }
})

test('transcrição imperfeita de áudio (sem pontuação, tudo em minúsculas, hesitação) ainda é interpretada corretamente', async () => {
  const deps = depsFake({ interpretarIntencao: criarInterpretadorFake([
    { quando: (msg) => /pode ser amanha mesmo/i.test(msg), resultado: { intencaoPrimaria: 'confirmar', intencoesSecundarias: ['alterar_data'], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'confirma e ajusta a data', acaoRecomendada: 'confirmar_e_alterar_data', precisaEsclarecimento: false } },
  ]) })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'eh tipo assim acho que pode ser amanha mesmo ta bom', 'compra_produto', deps)
  assert.equal(r.estado.dados.formulario?.dataEntrega, 'amanha')
})

// ── Mais testes negativos: nunca podem virar a ação oposta ────────────────

test('negativo: "não confirma não, quero pensar" nunca confirma o pedido', async () => {
  const deps = depsFake()
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'não confirma não, quero pensar', 'compra_produto', deps)
  assert.notEqual(r.estado.fase, 'aguardando_pagamento')
  assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas')
})

test('negativo: mensagem fora de contexto durante a aprovação de frete nunca confirma nem cancela sozinha', async () => {
  const deps = depsFake({ interpretarIntencao: criarInterpretadorFake([
    { quando: () => true, resultado: { intencaoPrimaria: 'fora_de_contexto', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'assunto não relacionado', acaoRecomendada: 'esclarecer', precisaEsclarecimento: true } },
  ]) })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'vocês entregam em outra cidade também?', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_aprovacao_frete')
  assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas')
})

test('negativo: "quero trocar de ideia sobre o endereço" nunca é lido como cancelamento', async () => {
  const deps = depsFake({ interpretarIntencao: criarInterpretadorFake([
    { quando: (msg) => /trocar de ideia sobre o endere[çc]o/i.test(msg), resultado: { intencaoPrimaria: 'alterar_endereco', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'quer mudar o endereço', acaoRecomendada: 'alterar_endereco', precisaEsclarecimento: false } },
  ]) })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'quero trocar de ideia sobre o endereço, numero 90, cep 04204-030', 'compra_produto', deps)
  assert.notEqual(r.estado.fase, 'encerrado_sem_venda')
  assert.equal(r.estado.dados.formulario?.numero, '90')
})

test('negativo: intenção secundária "cancelar" dentro de uma mensagem majoritariamente de confirmação ainda abre a confirmação de cancelamento (nunca ignorada por estar em segundo plano)', async () => {
  const deps = depsFake({ interpretarIntencao: criarInterpretadorFake([
    { quando: () => true, resultado: { intencaoPrimaria: 'confirmar', intencoesSecundarias: ['cancelar'], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'ambivalente', acaoRecomendada: 'esclarecer_cancelamento', precisaEsclarecimento: false } },
  ]) })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'sim pode ser, mas pensando bem acho melhor cancelar', 'compra_produto', deps)
  assert.notEqual(r.estado.fase, 'aguardando_pagamento', 'nunca confirma o pagamento quando há sinal de cancelamento na mesma mensagem')
  assert.match(r.mensagem, /quer mesmo cancelar/i)
})

// ── Resiliência do modelo nos novos gates (mesma garantia da Fatia 1,
// agora extendida à aprovação de frete) ───────────────────────────────────

test('aprovação de frete: modelo indisponível/timeout nunca quebra o atendimento, cai na escalada anti-loop', async () => {
  const deps = depsFake({ interpretarIntencao: async () => null })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'sei lá, me ajuda', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_aprovacao_frete')
  assert.equal(typeof r.mensagem, 'string')
})

test('aprovação de frete: modelo devolve JSON inválido é tratado exatamente como indisponibilidade', async () => {
  const deps = depsFake({ interpretarIntencao: async () => 'não é um JSON {' })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'sei la', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_aprovacao_frete')
  assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas')
})

test('aprovação de frete: indisponibilidade total dos provedores (interpretarIntencao ausente) preserva o comportamento determinístico de sempre', async () => {
  const deps = depsFake()
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'sim', 'compra_produto', deps)
  assert.notEqual(r.estado.fase, 'aguardando_aprovacao_frete')
})

// ── Idempotência / preservação de dados válidos através de uma sequência
// de mensagens (mudança de ideia após confirmação) ────────────────────────

test('mudança de ideia após confirmação: cliente confirma, o pedido é criado, e uma mensagem seguinte nunca cria um segundo pedido', async () => {
  let vezesCriarPedido = 0
  const deps = depsFake({ criarPedido: async () => { vezesCriarPedido++; return { pedidoId: 'pedido_unico_001' } } })
  const r1 = await avancarFunil(estadoAprovacaoFreteFixture(), 'sim, confirmo', 'compra_produto', deps)
  assert.equal(r1.estado.fase, 'aguardando_pagamento')
  assert.equal(vezesCriarPedido, 1)

  // Cliente muda de ideia depois de já estar em aguardando_pagamento —
  // nunca deveria recriar o pedido; o link já existe.
  const r2 = await avancarFunil(r1.estado, 'na verdade quero trocar o produto', 'compra_produto', deps)
  assert.equal(vezesCriarPedido, 1, 'nunca cria um segundo pedido para a mesma jornada')
})

// ── diagnosticoInterpretacao: o contrato mínimo pedido pra telemetria
// (intenção, confiança, esclarecimento, campos alterados, motivo, fallback,
// tentativa) precisa realmente sair populado do funil — nunca só existir no
// tipo. Nunca inclui o texto da mensagem nem valores de campo (só nomes). ──

test('diagnosticoInterpretacao: confirmação simples na aprovação de frete traz gate, motivo e nenhum dado pessoal', async () => {
  const deps = depsFake()
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'sim, confirmo', 'compra_produto', deps)
  assert.equal(r.diagnosticoInterpretacao?.gate, 'aprovacao_frete')
  assert.equal(r.diagnosticoInterpretacao?.motivo, 'confirmou_pagamento_gerado')
  assert.equal(r.diagnosticoInterpretacao?.fallbackAcionado, false)
  assert.equal(JSON.stringify(r.diagnosticoInterpretacao).includes('Rua das Flores'), false, 'nunca inclui dado do endereço')
})

test('diagnosticoInterpretacao: ação composta relata os campos efetivamente alterados, nunca os valores', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorPlausivelFatia2() })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'troca o destinatário e aumenta a quantidade para 3', 'compra_produto', deps)
  assert.ok(r.diagnosticoInterpretacao?.camposAlterados?.includes('nomeDestinatario'))
  assert.ok(r.diagnosticoInterpretacao?.camposAlterados?.includes('quantidade'))
  assert.equal(JSON.stringify(r.diagnosticoInterpretacao).includes('Fernanda'), false, 'nunca inclui o valor novo do campo, só o nome do campo')
})

test('diagnosticoInterpretacao: cancelamento confirmado registra confiança e intenção reconhecidas pelo interpretador', async () => {
  const deps = depsFake({ interpretarIntencao: interpretadorPlausivelFatia2() })
  const r1 = await avancarFunil(estadoAprovacaoFreteFixture(), 'quero cancelar esse pedido', 'compra_produto', deps)
  assert.equal(r1.diagnosticoInterpretacao?.intencaoPrimaria, 'cancelar')
  assert.equal(r1.diagnosticoInterpretacao?.confianca, 'alta')
  assert.equal(r1.diagnosticoInterpretacao?.motivo, 'cancelamento_pendente_confirmacao')

  const r2 = await avancarFunil(r1.estado, 'sim', 'compra_produto', deps)
  assert.equal(r2.diagnosticoInterpretacao?.gate, 'cancelamento_aprovacao_frete')
  assert.equal(r2.diagnosticoInterpretacao?.motivo, 'cancelamento_confirmado')
})

test('diagnosticoInterpretacao: confiança baixa é registrada mesmo quando nenhuma ação é executada (auditoria de decisões recusadas)', async () => {
  const deps = depsFake({ interpretarIntencao: criarInterpretadorFake([
    { quando: () => true, resultado: { intencaoPrimaria: 'cancelar', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'baixa', evidenciaContextual: 'não tenho certeza', acaoRecomendada: 'esclarecer', precisaEsclarecimento: true } },
  ]) })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'sei lá, talvez', 'compra_produto', deps)
  assert.equal(r.diagnosticoInterpretacao?.confianca, 'baixa')
  assert.equal(r.diagnosticoInterpretacao?.precisaEsclarecimento, true)
  assert.equal(r.diagnosticoInterpretacao?.fallbackAcionado, false, 'o modelo respondeu (não falhou) — a confiança baixa é uma resposta válida, não uma indisponibilidade')
})

test('diagnosticoInterpretacao: modelo indisponível marca fallbackAcionado=true; canal sem rollout marca fallbackAcionado=false (nunca confundidos)', async () => {
  const semInterpretador = await avancarFunil(estadoAprovacaoFreteFixture(), 'hein', 'compra_produto', depsFake())
  assert.equal(semInterpretador.diagnosticoInterpretacao?.fallbackAcionado, false, 'sem interpretador conectado nunca é "fallback acionado" — é o comportamento normal do canal')

  const comFalha = await avancarFunil(estadoAprovacaoFreteFixture(), 'hein', 'compra_produto', depsFake({ interpretarIntencao: async () => null }))
  assert.equal(comFalha.diagnosticoInterpretacao?.fallbackAcionado, true, 'interpretador conectado mas sem resposta usável é fallback de verdade')
})

// Regressão — achado ao vivo na Seção 7 do rollout (2026-08-04, flora-internal-test):
// "quero cancelar"/"quero cancelar tudo" nunca alcançavam o gate de
// confirmação de cancelamento (CHAVE_GATE_CANCELAMENTO_GLOBAL) porque
// classificarIntencao (chamado ANTES de avancarFunil, em cada canal) batia
// primeiro em PALAVRAS_RECLAMACAO (que incluía 'cancelar'/'cancelamento') e
// devolvia 'reclamacao' — intencaoInterrompeFluxo trata isso igual a
// atendimento_humano, então o canal transferia pra humano direto, sem nunca
// chamar avancarFunil. Bug pré-existente (commit 6547eaba, 2026-07-10),
// anterior a esta camada de interpretação — só ficou visível agora porque
// o gate de cancelamento seguro desta iniciativa depende de avancarFunil
// rodar. Corrigido removendo 'cancelar'/'cancelamento' de PALAVRAS_RECLAMACAO.
test('regressão: "quero cancelar" não é classificado como reclamação — alcança o gate de confirmação de cancelamento, não a transferência humana direta', () => {
  const intencao = classificarIntencao('quero cancelar tudo', 'aguardando_aprovacao_frete')
  assert.notEqual(intencao, 'reclamacao', '"cancelar" sozinho não é reclamação — bloqueava o gate de confirmação de cancelamento')
  assert.equal(intencaoInterrompeFluxo(intencao), false, '"quero cancelar" nunca deve pular direto pra transferência humana sem passar pelo gate de confirmação')
})

test('regressão: reclamações genuínas continuam indo para atendimento humano (a correção não removeu a detecção real de reclamação)', () => {
  for (const mensagem of ['o pedido veio errado', 'isso é terrível, muito ruim', 'chegou quebrado e estragado']) {
    const intencao = classificarIntencao(mensagem, 'aguardando_aprovacao_frete')
    assert.equal(intencao, 'reclamacao', `"${mensagem}" ainda deve ser reconhecida como reclamação`)
    assert.equal(intencaoInterrompeFluxo(intencao), true)
  }
})

test('regressão: "quero cancelar tudo" (fora da lista determinística FRASES_CANCELAMENTO_PEDIDO, exige interpretação) chega no sub-gate de confirmação via o gate de aprovação de frete, nunca cancela na mesma mensagem nem vira transferência humana', async () => {
  const deps = depsFake({ interpretarIntencao: criarInterpretadorFake([
    { quando: (m) => /cancelar/i.test(m), resultado: { intencaoPrimaria: 'cancelar', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'cliente pediu cancelamento', acaoRecomendada: 'confirmar_cancelamento', precisaEsclarecimento: false } },
  ]) })
  const r = await avancarFunil(estadoAprovacaoFreteFixture(), 'quero cancelar tudo', 'compra_produto', deps)
  assert.notEqual(r.estado.fase, 'encerrado_sem_venda', 'nunca cancela sem confirmação explícita')
  assert.notEqual(r.estado.fase, 'transferido_humano', 'não deve ser tratado como reclamação/atendimento humano (esse era o bug)')
  assert.match(r.mensagem, /quer mesmo cancelar/i)
  assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas', 'produto preservado enquanto aguarda confirmação')
})
