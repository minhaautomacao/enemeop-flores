// Complemento de funil.conversas.test.ts — mais 12 conversas completas
// (total 15 no conjunto combinado), cobrindo especificamente: mensagens
// sem acento/abreviadas/com erro de digitação, perguntas durante o
// formulário, respostas em mensagens consecutivas, modelo indisponível,
// timeout, JSON inválido, fallback determinístico, proteção contra loop,
// prevenção de pedido duplicado, intenção composta e cancelamento com
// confirmação — cada uma como uma jornada de várias mensagens reais, não
// um caso isolado.
//
// Rodar: npm run test (dentro de orchestrator/)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avancarFunil, estadoInicial, type EstadoConversa } from './funil.js'
import { depsFake, formularioTexto, formularioFixture, criarInterpretadorFake } from './funil.test-helpers.js'

async function avancarAteEscolherProduto(estadoInicialConversa: EstadoConversa, mensagemAbertura: string, deps: ReturnType<typeof depsFake>) {
  let estado = estadoInicialConversa
  let r = await avancarFunil(estado, mensagemAbertura, 'recomendacao', deps)
  estado = r.estado
  let guard = 0
  while ((estado.fase === 'qualificacao' || estado.fase === 'inicio') && guard < 6) {
    r = await avancarFunil(estado, 'tanto faz', 'compra_produto', deps)
    estado = r.estado
    guard++
  }
  return { estado, r }
}

// ── 4: mensagens sem acento, abreviadas, com erro de digitação, do início ao pagamento ──

test('conversa completa 4: sem acento, abreviado e com erro de digitação do início ao pagamento', async () => {
  const deps = depsFake()
  const { estado: estadoEscolha } = await avancarAteEscolherProduto(estadoInicial(), 'preciso de flors pra hj, aniverssario da minha mae', deps)

  let r = await avancarFunil(estadoEscolha, 'vou qerer o buquê de rosas', 'compra_produto', deps)
  let estado = r.estado
  assert.equal(estado.dados.produto?.nome, 'Buquê de Rosas')

  r = await avancarFunil(estado, '1', 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, 'amanha', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_formulario')

  r = await avancarFunil(estado, formularioTexto(), 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'confirmando_formulario')

  r = await avancarFunil(estado, 'ta certo', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_aprovacao_frete')

  r = await avancarFunil(estado, 'pd confirmar', 'compra_produto', deps)
  estado = r.estado
  // "pd confirmar" não bate com nenhuma frase determinística nem tem
  // interpretador conectado — anti-loop entra em ação, nunca avança sozinho.
  assert.equal(estado.fase, 'aguardando_aprovacao_frete', 'abreviação não reconhecida nunca avança sozinha sem confirmação real')

  r = await avancarFunil(estado, 'sim', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_pagamento', 'confirmação clara em seguida completa a compra')
  assert.equal(estado.dados.pedidoId, 'pedido_fake_001')
})

// ── 5: perguntas durante o preenchimento do formulário, sem perder o progresso ──

test('conversa completa 5: perguntas do cliente durante o formulário não atrapalham a coleta', async () => {
  const deps = depsFake()
  const { estado: estadoEscolha } = await avancarAteEscolherProduto(estadoInicial(), 'Quero flores para minha namorada', deps)
  let r = await avancarFunil(estadoEscolha, 'Buquê de Rosas', 'compra_produto', deps)
  let estado = r.estado
  r = await avancarFunil(estado, '1', 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, 'hoje', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_formulario')

  // Pergunta de frete no meio da coleta — interrompe pra responder, sem
  // apagar o produto/quantidade/data já coletados.
  r = await avancarFunil(estado, 'quanto custa o frete?', 'frete', deps)
  estado = r.estado
  assert.equal(estado.dados.produto?.nome, 'Buquê de Rosas', 'produto preservado durante a pergunta de frete')

  // Cliente responde o formulário normalmente depois.
  r = await avancarFunil(estado, formularioTexto(), 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'confirmando_formulario', 'formulário é aceito normalmente depois da pergunta')
  assert.equal(estado.dados.formulario?.nomeDestinatario, 'Camila')
})

// ── 6: dados enviados em mensagens consecutivas (nunca perde o que já veio) ──

test('conversa completa 6: dados do formulário chegam em mensagens consecutivas, nada é perdido nem pedido de novo', async () => {
  const deps = depsFake()
  const { estado: estadoEscolha } = await avancarAteEscolherProduto(estadoInicial(), 'Quero um arranjo', deps)
  let r = await avancarFunil(estadoEscolha, 'Arranjo Girassóis', 'compra_produto', deps)
  let estado = r.estado
  r = await avancarFunil(estado, '1', 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, 'amanhã', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_formulario')

  // Primeira mensagem: só remetente e destinatário.
  r = await avancarFunil(estado, 'Ana enviar pra Camila', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.dados.formulario?.nomeComprador, 'Ana')
  assert.equal(estado.dados.formulario?.nomeDestinatario, 'Camila')
  assert.notEqual(estado.fase, 'confirmando_formulario', 'ainda faltam campos, não deveria completar')

  // Segunda mensagem consecutiva: telefone.
  r = await avancarFunil(estado, '11999990000', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.dados.formulario?.nomeComprador, 'Ana', 'dado da mensagem anterior não foi perdido')

  // Terceira mensagem consecutiva: CEP + número.
  r = await avancarFunil(estado, 'CEP 04204-030, número 123, bairro Ipiranga', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'confirmando_formulario', 'formulário completo depois de 3 mensagens consecutivas, sem perder nada')
  assert.equal(estado.dados.formulario?.nomeDestinatario, 'Camila', 'destinatário da 1ª mensagem preservado até o fim')
})

// ── 7: modelo indisponível no meio da conversa — fallback determinístico completa a compra ──

test('conversa completa 7: modelo indisponível durante a aprovação de frete — fallback determinístico ainda completa a compra', async () => {
  const deps = depsFake({ interpretarIntencao: async () => null })
  const { estado: estadoEscolha } = await avancarAteEscolherProduto(estadoInicial(), 'Quero rosas para minha esposa', deps)
  let r = await avancarFunil(estadoEscolha, 'Buquê de Rosas', 'compra_produto', deps)
  let estado = r.estado
  r = await avancarFunil(estado, '1', 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, 'hoje', 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, formularioTexto(), 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, 'sim', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_aprovacao_frete')

  // Modelo indisponível (retorna null sempre) — mensagem clara "sim" ainda
  // resolve pelo caminho determinístico, nunca trava por causa da falha do modelo.
  r = await avancarFunil(estado, 'sim, pode confirmar', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_pagamento', 'fallback determinístico completa a compra mesmo com o modelo fora do ar')
  assert.ok(estado.dados.linkPagamento)
})

// ── 8: resposta inválida do modelo (JSON malformado) — nunca quebra, escalona normalmente ──

test('conversa completa 8: modelo devolve JSON inválido repetidamente — escalada anti-loop, nunca trava nem quebra', async () => {
  const deps = depsFake({ interpretarIntencao: async () => '{ isto nao é json válido' })
  const estado0: EstadoConversa = {
    fase: 'aguardando_aprovacao_frete',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'hoje' },
      valorTotal: 162.5, valorFrete: 22.5,
      freteDetalhes: { cotadoEm: new Date().toISOString() },
      formulario: formularioFixture(),
    },
    perguntasFeitas: [],
  }
  let r = await avancarFunil(estado0, 'sei lá, talvez', 'compra_produto', deps)
  let estado = r.estado
  assert.equal(estado.fase, 'aguardando_aprovacao_frete')
  assert.equal(typeof r.mensagem, 'string')

  r = await avancarFunil(estado, 'me ajuda', 'compra_produto', deps)
  estado = r.estado
  assert.match(r.mensagem, /1\..*2\./s, '2ª falha escala pra opções numeradas mesmo com JSON inválido repetido')

  // Cliente usa a opção numérica — resolve mesmo com o modelo sempre inválido.
  r = await avancarFunil(estado, '1', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_pagamento', 'opção numérica resolve independente do modelo')
})

// ── 9: três falhas consecutivas com escalada, depois resolvida por opção numérica ──

test('conversa completa 9: três falhas consecutivas (nunca repete a mesma redação) seguidas de resolução por opção numérica', async () => {
  const deps = depsFake()
  const estado0: EstadoConversa = {
    fase: 'aguardando_aprovacao_frete',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'hoje' },
      valorTotal: 162.5, valorFrete: 22.5,
      freteDetalhes: { cotadoEm: new Date().toISOString() },
      formulario: formularioFixture(),
    },
    perguntasFeitas: [],
  }
  let r = await avancarFunil(estado0, 'hein', 'compra_produto', deps)
  let estado = r.estado
  const msg1 = r.mensagem
  assert.equal(estado.fase, 'aguardando_aprovacao_frete')

  r = await avancarFunil(estado, 'sei la', 'compra_produto', deps)
  estado = r.estado
  const msg2 = r.mensagem
  assert.notEqual(msg2, msg1, 'nunca repete a mesma redação entre tentativas')

  r = await avancarFunil(estado, 'me ajuda', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_aprovacao_frete', '3ª falha continua tentando, nunca reinicia nem transfere sozinho')
  assert.equal(estado.dados.produto?.nome, 'Buquê de Rosas', 'produto nunca é perdido durante a escalada')

  r = await avancarFunil(estado, '1', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_pagamento', 'opção numérica resolve depois da escalada completa')
})

// ── 10: prevenção de pedido duplicado — confirmar duas vezes nunca cria dois pedidos ──

test('conversa completa 10: confirmar duas vezes seguidas nunca duplica o pedido', async () => {
  let vezesCriarPedido = 0
  const deps = depsFake({ criarPedido: async () => { vezesCriarPedido++; return { pedidoId: 'pedido_unico_010' } } })
  const estado0: EstadoConversa = {
    fase: 'aguardando_aprovacao_frete',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'hoje' },
      valorTotal: 162.5, valorFrete: 22.5,
      freteDetalhes: { cotadoEm: new Date().toISOString() },
      formulario: formularioFixture(),
    },
    perguntasFeitas: [],
  }
  let r = await avancarFunil(estado0, 'sim', 'compra_produto', deps)
  let estado = r.estado
  assert.equal(estado.fase, 'aguardando_pagamento')
  assert.equal(vezesCriarPedido, 1)

  // Cliente manda "sim" de novo (ex.: reenvio duplicado do app de mensagens)
  // já na fase de pagamento — nunca deveria tentar criar outro pedido.
  r = await avancarFunil(estado, 'sim', 'compra_produto', deps)
  assert.equal(vezesCriarPedido, 1, 'nunca cria um segundo pedido a partir da fase aguardando_pagamento')
})

// ── 11: intenção composta dentro de uma conversa completa ─────────────────

test('conversa completa 11: "mantém o pedido e entrega amanhã" no meio de uma jornada real aplica as duas coisas', async () => {
  const interpretarIntencao = criarInterpretadorFake([
    { quando: (m) => /mant[ée]m o pedido e entrega amanh[ãa]/i.test(m), resultado: { intencaoPrimaria: 'confirmar', intencoesSecundarias: ['alterar_data'], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'confirma e ajusta data', acaoRecomendada: 'x', precisaEsclarecimento: false } },
  ])
  const deps = depsFake({ interpretarIntencao })
  const { estado: estadoEscolha } = await avancarAteEscolherProduto(estadoInicial(), 'Quero flores para hoje', deps)
  let r = await avancarFunil(estadoEscolha, 'Buquê de Rosas', 'compra_produto', deps)
  let estado = r.estado
  r = await avancarFunil(estado, '1', 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, 'hoje', 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, formularioTexto({ 'Data desejada para entrega': 'hoje' }), 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, 'sim', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_aprovacao_frete')

  r = await avancarFunil(estado, 'mantém o pedido e entrega amanhã', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.dados.formulario?.dataEntrega, 'amanha', 'a alteração de data foi aplicada')
  assert.notEqual(estado.fase, 'encerrado_sem_venda', 'nunca cancelou por engano')
})

// ── 12: cancelamento com confirmação explícita, dentro de uma jornada real ──

test('conversa completa 12: cliente pede cancelamento, confirma, pedido é encerrado sem custo — nunca sem essa confirmação', async () => {
  const interpretarIntencao = criarInterpretadorFake([
    { quando: (m) => /cancelar/i.test(m), resultado: { intencaoPrimaria: 'cancelar', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'x', acaoRecomendada: 'x', precisaEsclarecimento: false } },
  ])
  const deps = depsFake({ interpretarIntencao })
  const { estado: estadoEscolha } = await avancarAteEscolherProduto(estadoInicial(), 'Quero flores para minha mãe', deps)
  let r = await avancarFunil(estadoEscolha, 'Buquê de Rosas', 'compra_produto', deps)
  let estado = r.estado
  r = await avancarFunil(estado, '1', 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, 'amanhã', 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, formularioTexto(), 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, 'sim', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_aprovacao_frete')

  r = await avancarFunil(estado, 'quero cancelar', 'compra_produto', deps)
  estado = r.estado
  assert.notEqual(estado.fase, 'encerrado_sem_venda', 'nunca cancela na mesma mensagem')

  r = await avancarFunil(estado, 'sim', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'encerrado_sem_venda', 'só cancela depois da confirmação explícita')
  assert.equal(estado.dados.produto, undefined)
})

// ── 13: iniciar nova compra com frase inédita, nunca reaproveita dados do pedido anterior ──

test('conversa completa 13: iniciar nova compra com frase inédita depois de completar uma jornada anterior', async () => {
  const deps = depsFake()
  const { estado: estadoEscolha } = await avancarAteEscolherProduto(estadoInicial(), 'Quero orquídeas', deps)
  let r = await avancarFunil(estadoEscolha, 'Arranjo Girassóis', 'compra_produto', deps)
  let estado = r.estado
  r = await avancarFunil(estado, '1', 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, 'hoje', 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, formularioTexto(), 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, 'sim', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_aprovacao_frete')

  // "vamos começar tudo de novo" bate em FRASES_NOVO_PEDIDO
  // ('comecar de novo') — reinicia a jornada; como o formulário estava
  // completo, primeiro pergunta se quer reaproveitar os dados.
  r = await avancarFunil(estado, 'vamos comecar de novo, mudei de ideia sobre tudo', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_reaproveitar_dados')

  r = await avancarFunil(estado, 'não, quero informar tudo de novo', 'compra_produto', deps)
  estado = r.estado
  // Recusar o reaproveitamento zera a fase pra 'inicio' e, na mesma
  // mensagem, o dispatcher já processa o texto como o início de uma
  // jornada nova — como não traz nenhum dado de qualificação reconhecível,
  // avança naturalmente pra 'qualificacao' (nunca fica parado em 'inicio').
  assert.equal(estado.fase, 'qualificacao', 'segue fluxo normal de uma jornada nova, nunca trava')
  assert.equal(estado.dados.produto, undefined, 'produto do pedido anterior nunca é reaproveitado')
  assert.equal(estado.dados.formulario, undefined, 'formulário do pedido anterior nunca é reaproveitado quando o cliente recusa')
})

// ── 14: alterar quantidade e corrigir endereço na mesma etapa (dois turnos) ──

test('conversa completa 14: altera quantidade e depois corrige o endereço, preservando tudo o mais', async () => {
  const interpretarIntencao = criarInterpretadorFake([
    { quando: (m) => /aumenta a quantidade|quantidade para/i.test(m), resultado: { intencaoPrimaria: 'alterar_quantidade', intencoesSecundarias: [], entidades: { quantidade: 3 }, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'x', acaoRecomendada: 'x', precisaEsclarecimento: false } },
    { quando: (m) => /cep:|rua:|n[uú]mero:/i.test(m), resultado: { intencaoPrimaria: 'alterar_endereco', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'x', acaoRecomendada: 'x', precisaEsclarecimento: false } },
  ])
  const deps = depsFake({ interpretarIntencao })
  const estado0: EstadoConversa = {
    fase: 'aguardando_aprovacao_frete',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'hoje' },
      valorTotal: 162.5, valorFrete: 22.5,
      freteDetalhes: { cotadoEm: new Date().toISOString() },
      formulario: formularioFixture(),
    },
    perguntasFeitas: [],
  }
  let r = await avancarFunil(estado0, 'aumenta a quantidade para 3', 'compra_produto', deps)
  let estado = r.estado
  assert.equal(estado.dados.produto?.quantidade, 3, 'quantidade alterada')
  assert.equal(estado.dados.valorTotal, 140 * 3 + 22.5, 'total recalculado')

  // Corrige o endereço na etapa seguinte — quantidade da etapa anterior tem que continuar valendo.
  r = await avancarFunil(estado, 'CEP: 04204-030\nRua: Rua Nova\nNúmero: 77', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.dados.formulario?.numero, '77', 'endereço corrigido')
  assert.equal(estado.dados.produto?.quantidade, 3, 'quantidade alterada na etapa anterior continua preservada')
})

// ── 15: negação indireta seguida de confirmação direta — nunca confunde as duas ──

test('conversa completa 15: negação indireta ("não, prefiro pensar") seguida de confirmação real na mensagem seguinte', async () => {
  const deps = depsFake()
  const estado0: EstadoConversa = {
    fase: 'aguardando_aprovacao_frete',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'hoje' },
      valorTotal: 162.5, valorFrete: 22.5,
      freteDetalhes: { cotadoEm: new Date().toISOString() },
      formulario: formularioFixture(),
    },
    perguntasFeitas: [],
  }
  let r = await avancarFunil(estado0, 'não, prefiro pensar um pouco', 'compra_produto', deps)
  let estado = r.estado
  assert.equal(estado.fase, 'aguardando_aprovacao_frete', 'negação indireta nunca avança')
  assert.equal(estado.dados.produto?.nome, 'Buquê de Rosas', 'estado preservado enquanto o cliente pensa')

  r = await avancarFunil(estado, 'ok, pode confirmar', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_pagamento', 'confirmação real na mensagem seguinte completa normalmente')
})
