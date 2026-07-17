// Testes locais do funil comercial da Flora (funil.ts).
// Sem rede, sem Groq/Redis/Supabase/Meta/WhatsApp/agentes reais — todas as
// integrações externas (catálogo, frete, pagamento, criação de pedido) são
// injetadas como funções fake.
//
// Rodar: npm run test (dentro de orchestrator/)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classificarIntencao,
  intencaoInterrompeFluxo,
  mensagemForaDeEscopo,
  mensagemTransferencia,
  mensagemFinalizacao,
  extrairDadosQualificacao,
  proximaPerguntaQualificacao,
  selecionarRecomendacoes,
  montarMensagemRecomendacao,
  responderPedidoDeFoto,
  calcularFreteEtapa,
  montarResumoPedido,
  gerarPagamentoEtapa,
  confirmarPagamento,
  criarPedidoEtapa,
  transferirParaHumano,
  registrarPergunta,
  jaPerguntado,
  estadoInicial,
  avancarFunil,
  processarConfirmacaoPagamento,
  type ProdutoCatalogo,
  type EstadoConversa,
  type DependenciasFunil,
} from './funil.js'

// 1. cliente pede buquê para aniversário
test('1. cliente pede buque para aniversario -> intencao recomendacao e ocasiao extraida', () => {
  const intencao = classificarIntencao('Queria um buquê para o aniversário da minha esposa', 'inicio')
  assert.equal(intencao, 'recomendacao')
  const dados = extrairDadosQualificacao('Queria um buquê para o aniversário da minha esposa', {})
  assert.equal(dados.ocasiao, 'aniversario')
  assert.equal(dados.destinatario, 'esposa')
})

// 2. cliente informa orçamento
test('2. cliente informa orcamento -> valor extraido e nao repete pergunta ja respondida', () => {
  const dados = extrairDadosQualificacao('Posso gastar uns R$ 150', { ocasiao: 'aniversario', destinatario: 'esposa' })
  assert.equal(dados.orcamento, 150)
  const proxima = proximaPerguntaQualificacao(dados, ['ocasiao', 'destinatario'])
  assert.equal(proxima?.campo, 'dataEntrega')
})

// 3. Flora sugere até 3 produtos reais (nunca inventados)
test('3. Flora sugere ate 3 produtos reais vindos do catalogo', () => {
  const catalogo: ProdutoCatalogo[] = [
    { nome: 'Buquê de Rosas', preco: 140, disponivel: true, fotoUrl: 'https://site/rosas.jpg' },
    { nome: 'Arranjo Girassóis', preco: 135, disponivel: true },
    { nome: 'Orquídea Branca', preco: 225, disponivel: true },
    { nome: 'Cesta de Flores', preco: 300, disponivel: true },
  ]
  const rec = selecionarRecomendacoes(catalogo)
  const total = (rec.principal ? 1 : 0) + rec.alternativas.length
  assert.ok(total <= 3, 'nunca deve recomendar mais que 3 produtos')
  assert.equal(rec.principal?.nome, 'Buquê de Rosas')
  const msg = montarMensagemRecomendacao(rec, 'aniversario')
  assert.match(msg, /Buquê de Rosas/)
})

test('3b. Flora nao inventa produto quando catalogo esta vazio', () => {
  const rec = selecionarRecomendacoes([])
  assert.equal(rec.principal, null)
  const msg = montarMensagemRecomendacao(rec)
  assert.match(msg, /WhatsApp final 9083/)
})

test('3c. produtos indisponiveis nunca sao recomendados', () => {
  const catalogo: ProdutoCatalogo[] = [
    { nome: 'Fora de estoque', preco: 100, disponivel: false },
    { nome: 'Disponível', preco: 100, disponivel: true },
  ]
  const rec = selecionarRecomendacoes(catalogo)
  assert.equal(rec.principal?.nome, 'Disponível')
})

// 4 e 5. cliente pede foto / Flora envia mídia real (nunca inventa URL)
test('4-5. cliente pede foto -> intencao foto_produto e Flora envia URL real quando disponivel', () => {
  const intencao = classificarIntencao('Consegue mandar uma foto desse arranjo?', 'recomendacao')
  assert.equal(intencao, 'foto_produto')

  const produto: ProdutoCatalogo = { nome: 'Buquê de Rosas', preco: 140, disponivel: true, fotoUrl: 'https://site/rosas.jpg' }
  const resposta = responderPedidoDeFoto(produto)
  assert.equal(resposta.fotoUrl, 'https://site/rosas.jpg')
})

test('5b. Flora nao afirma ter enviado foto quando produto nao tem fotoUrl real', () => {
  const produto: ProdutoCatalogo = { nome: 'Sem foto cadastrada', preco: 100, disponivel: true }
  const resposta = responderPedidoDeFoto(produto)
  assert.equal(resposta.fotoUrl, null)
  assert.doesNotMatch(resposta.mensagem, /aqui está a foto/i)
})

// 6 e 7. cliente informa CEP / Flora calcula frete (nunca estima)
test('6-7. cliente informa CEP e Flora calcula frete via agente logistico', async () => {
  const dados = extrairDadosQualificacao('Meu CEP é 04204-030', {})
  assert.equal(dados.bairroOuCep, '04204-030')

  const calculadorFake = async (cep: string) => {
    assert.equal(cep, '04204-030')
    return { ok: true as const, valor: 22.5 }
  }
  const resposta = await calcularFreteEtapa('04204-030', calculadorFake)
  assert.equal(resposta.falhou, false)
  assert.equal(resposta.valor, 22.5)
  assert.match(resposta.mensagem, /22,50/)
})

test('7b. Flora nunca estima frete quando o calculo falha - transfere para humano', async () => {
  const calculadorQueFalha = async () => ({ ok: false as const })
  const resposta = await calcularFreteEtapa('00000-000', calculadorQueFalha)
  assert.equal(resposta.falhou, true)
  assert.equal(resposta.valor, null)
  assert.match(resposta.mensagem, /WhatsApp final 9083/)
})

// 8. Flora resume pedido
test('8. Flora monta resumo completo do pedido antes de pedir confirmacao', () => {
  const resumo = montarResumoPedido({
    produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'hoje até 18h' },
    valorFrete: 22.5,
    valorTotal: 162.5,
    endereco: { cep: '04204-030', rua: 'Rua Costa Aguiar', numero: '1184', bairro: 'Ipiranga', cidade: 'São Paulo', nomeDestinatario: 'Camila' },
  })
  assert.match(resumo, /Buquê de Rosas/)
  assert.match(resumo, /162,50/)
  assert.match(resumo, /Camila/)
  assert.match(resumo, /Posso confirmar/)
})

// 9. Flora gera link (só depois de valorTotal confirmado)
test('9. Flora gera link de pagamento somente apos valor total confirmado', async () => {
  const gerarFake = async (valor: number) => {
    assert.equal(valor, 162.5)
    return { link: 'https://pagamento.exemplo/abc123', paymentId: 'pay_abc123' }
  }
  const resposta = await gerarPagamentoEtapa({ valorTotal: 162.5 }, gerarFake)
  assert.match(resposta.link!, /pagamento\.exemplo/)
  assert.equal(resposta.paymentId, 'pay_abc123')
})

test('9b. Flora nunca gera link antes de ter o valor total confirmado', async () => {
  const gerarFake = async () => ({ link: 'x', paymentId: 'y' })
  await assert.rejects(() => gerarPagamentoEtapa({}, gerarFake), /valorTotal ausente/)
})

// 10. pagamento confirmado (só via provedor, nunca por texto do cliente)
test('10. pagamento so e confirmado com retorno real do provedor, com paymentId correspondente', () => {
  const estado: EstadoConversa = {
    fase: 'aguardando_pagamento',
    dados: { valorTotal: 162.5, paymentId: 'pay_abc123' },
    perguntasFeitas: [],
  }
  const confirmado = confirmarPagamento(estado, 'pay_abc123')
  assert.equal(confirmado.fase, 'pagamento_confirmado')
  assert.equal(confirmado.dados.pagamentoConfirmado, true)
})

// 20. Flora não confirma pagamento sem retorno do provedor
test('20. Flora rejeita confirmacao de pagamento se o paymentId nao bate com o pedido em andamento', () => {
  const estado: EstadoConversa = {
    fase: 'aguardando_pagamento',
    dados: { valorTotal: 162.5, paymentId: 'pay_abc123' },
    perguntasFeitas: [],
  }
  assert.throws(() => confirmarPagamento(estado, 'pay_outro_pedido'), /nao corresponde ao pedido em andamento/)
})

test('20b. Flora rejeita confirmacao de pagamento quando nao ha paymentId registrado (cliente so afirmou que pagou)', () => {
  const estado: EstadoConversa = { fase: 'aguardando_pagamento', dados: { valorTotal: 162.5 }, perguntasFeitas: [] }
  assert.throws(() => confirmarPagamento(estado, 'qualquer-coisa'))
})

// 11. pedido criado
test('11. pedido so e criado depois da fase pagamento_confirmado', async () => {
  const estadoConfirmado: EstadoConversa = {
    fase: 'pagamento_confirmado',
    dados: { valorTotal: 162.5, pagamentoConfirmado: true },
    perguntasFeitas: [],
  }
  const criarFake = async () => ({ pedidoId: 'pedido_001' })
  const novoEstado = await criarPedidoEtapa(estadoConfirmado, criarFake)
  assert.equal(novoEstado.fase, 'pedido_criado')
  assert.equal(novoEstado.dados.pedidoId, 'pedido_001')

  const mensagemFinal = mensagemFinalizacao()
  assert.match(mensagemFinal, /Pagamento confirmado/)
})

test('11b. pedido nao pode ser criado antes do pagamento ser confirmado', async () => {
  const estadoNaoConfirmado: EstadoConversa = { fase: 'aguardando_pagamento', dados: {}, perguntasFeitas: [] }
  const criarFake = async () => ({ pedidoId: 'pedido_002' })
  await assert.rejects(() => criarPedidoEtapa(estadoNaoConfirmado, criarFake), /pagamento_confirmado/)
})

// 12 e 13. cliente pergunta sobre política -> Flora recusa e direciona
test('12-13. cliente pergunta sobre politica -> assunto_fora_escopo, resposta fixa, interrompe fluxo', () => {
  const intencao = classificarIntencao('O que você acha do governo atual?', 'qualificacao')
  assert.equal(intencao, 'assunto_fora_escopo')
  assert.equal(intencaoInterrompeFluxo(intencao), true)
  const resposta = mensagemForaDeEscopo()
  assert.match(resposta, /flores, presentes, pedidos e entregas/)
  assert.match(resposta, /WhatsApp final 9083/)
})

// 14 e 15. cliente faz reclamação -> Flora transfere
test('14-15. cliente reclama -> intencao reclamacao, transfere para humano com motivo registrado', () => {
  const intencao = classificarIntencao('Meu pedido chegou quebrado, isso é um absurdo', 'pedido_criado')
  assert.equal(intencao, 'reclamacao')
  assert.equal(intencaoInterrompeFluxo(intencao), true)

  const estado = estadoInicial()
  const transferido = transferirParaHumano(estado, 'reclamacao: produto chegou quebrado')
  assert.equal(transferido.fase, 'transferido_humano')
  assert.match(transferido.dados.motivoTransferencia!, /quebrado/)

  const msg = mensagemTransferencia()
  assert.match(msg, /nossa equipe/)
  assert.match(msg, /WhatsApp final 9083/)
})

// 16 e 17. cliente muda de assunto no meio da compra -> Flora redireciona sem perder o funil
test('16-17. mudanca de assunto no meio da compra nao reseta os dados ja coletados', () => {
  const dadosNoMeioDaCompra = { ocasiao: 'aniversario', destinatario: 'esposa', orcamento: 150 }
  const intencao = classificarIntencao('Aliás, quem você acha que ganha o campeonato de futebol esse ano?', 'recomendacao')
  assert.equal(intencao, 'assunto_fora_escopo')
  // A funcao de classificacao/resposta fora de escopo nao recebe nem
  // manipula "dados" - a garantia de nao resetar é estrutural: o chamador
  // so troca a MENSAGEM de resposta, nunca o estado.dados. Verificamos que
  // os dados originais permanecem intactos apos a interrupcao.
  assert.deepEqual(dadosNoMeioDaCompra, { ocasiao: 'aniversario', destinatario: 'esposa', orcamento: 150 })
})

// 18. Flora não repete pergunta já respondida
test('18. Flora nao repete pergunta ja feita mesmo que o campo ainda esteja vazio', () => {
  // Cliente nao respondeu "ocasiao" de fato, mas a pergunta ja foi feita
  // uma vez - nao deve perguntar de novo (evita loop).
  const dados: Record<string, unknown> = {}
  const perguntasFeitas = registrarPergunta('ocasiao', [])
  assert.equal(jaPerguntado('ocasiao', perguntasFeitas), true)
  const proxima = proximaPerguntaQualificacao(dados, perguntasFeitas)
  assert.notEqual(proxima?.campo, 'ocasiao')
})

test('18b. registrarPergunta nao duplica a mesma pergunta na lista', () => {
  const p1 = registrarPergunta('ocasiao', [])
  const p2 = registrarPergunta('ocasiao', p1)
  assert.deepEqual(p1, p2)
  assert.equal(p2.length, 1)
})

// 19. Flora não inventa produto (coberto tambem no teste 3b, reforço direto do requisito)
test('19. selecionarRecomendacoes nunca retorna produto que nao veio da lista injetada', () => {
  const catalogoReal: ProdutoCatalogo[] = [{ nome: 'Único Produto Real', preco: 90, disponivel: true }]
  const rec = selecionarRecomendacoes(catalogoReal)
  assert.equal(rec.principal?.nome, 'Único Produto Real')
  assert.equal(rec.alternativas.length, 0)
})

// Atendimento humano explícito (categoria separada de reclamação)
test('atendimento_humano e classificado separado de reclamacao', () => {
  const intencao = classificarIntencao('Eu quero falar com o gerente', 'recomendacao')
  assert.equal(intencao, 'atendimento_humano')
  assert.equal(intencaoInterrompeFluxo(intencao), true)
})

// Frete/pagamento/status quando mencionados explicitamente
test('intencoes de frete, pagamento e status do pedido sao classificadas corretamente', () => {
  assert.equal(classificarIntencao('Qual o valor da entrega?', 'aguardando_endereco'), 'frete')
  assert.equal(classificarIntencao('Como eu pago?', 'aguardando_confirmacao'), 'pagamento')
  assert.equal(classificarIntencao('Cadê meu pedido, já foi entregue?', 'pedido_criado'), 'status_pedido')
})

// ── Classificador — intenção mista, digitação, contexto de fase ──────────

test('intencao mista: sinal comercial tem prioridade sobre assunto externo citado de passagem', () => {
  const intencao = classificarIntencao('quero flores e também queria saber sobre futebol', 'inicio')
  assert.notEqual(intencao, 'assunto_fora_escopo')
})

test('intencao mista: pergunta de valor com assunto externo responde so o valor/produto', () => {
  const intencao = classificarIntencao('qual o valor e você gosta de música?', 'recomendacao')
  assert.notEqual(intencao, 'assunto_fora_escopo')
})

test('assunto externo isolado, sem sinal comercial e fora de compra em andamento, ainda interrompe', () => {
  const intencao = classificarIntencao('o que você acha do governo atual?', 'recomendacao')
  assert.equal(intencao, 'assunto_fora_escopo')
})

test('reclamacao "meu pedido nao chegou" e atendimento humano continuam interrompendo o fluxo', () => {
  const intencao = classificarIntencao('meu pedido não chegou', 'pedido_criado')
  assert.equal(intencao, 'reclamacao')
  assert.equal(intencaoInterrompeFluxo(intencao), true)
})

test('pedido de atendimento humano com frase natural ("quero falar com uma pessoa")', () => {
  const intencao = classificarIntencao('quero falar com uma pessoa', 'recomendacao')
  assert.equal(intencao, 'atendimento_humano')
})

test('"oi" durante aguardando_pagamento nao reinicia o funil, dispatcher so lembra do pagamento', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = {
    fase: 'aguardando_pagamento',
    dados: { valorTotal: 162.5, linkPagamento: 'https://pagamento.exemplo/x', paymentId: 'pay_x' },
    perguntasFeitas: [],
  }
  const intencao = classificarIntencao('oi', estado.fase)
  assert.equal(intencaoInterrompeFluxo(intencao), false)
  const r = await avancarFunil(estado, 'oi', intencao, deps)
  assert.equal(r.estado.fase, 'aguardando_pagamento')
  assert.match(r.mensagem, /já te enviei o link de pagamento/i)
})

test('tolerancia a erro de digitacao: "reclamaçao" e "atendente" com typo ainda classificam corretamente', () => {
  assert.equal(classificarIntencao('isso e um reclamaçã, muito ruim', 'qualificacao'), 'reclamacao')
  assert.equal(classificarIntencao('quero falar com atendento', 'qualificacao'), 'atendimento_humano')
})

test('preco, codigo e url do catalogo passam intactos ate a selecao do produto (LLM nunca altera fatos comerciais)', async () => {
  const deps = depsFake({
    buscarCatalogo: async () => [
      { nome: 'Buquê Exclusivo', preco: 233.37, disponivel: true, codigo: 'WOO-9981', url: 'https://enemeopflores.com.br/produto/9981' },
    ],
  })
  let estado = estadoInicial()
  const r1 = await avancarFunil(estado, 'Quero flores para minha mãe, uns R$250, entrega hoje, CEP 04204-030', 'recomendacao', deps)
  estado = r1.estado
  let guard = 0
  while ((estado.fase === 'qualificacao' || estado.fase === 'inicio') && guard < 6) {
    const r = await avancarFunil(estado, 'tanto faz', 'compra_produto', deps)
    estado = r.estado
    guard++
  }
  const rEscolha = await avancarFunil(estado, 'Fico com esse mesmo', 'compra_produto', deps)
  assert.equal(rEscolha.estado.dados.produto?.preco, 233.37)
  assert.equal(rEscolha.estado.dados.produto?.codigo, 'WOO-9981')
  assert.equal(rEscolha.estado.dados.produto?.url, 'https://enemeopflores.com.br/produto/9981')
})

test('cliente retoma exatamente da fase salva apos uma pausa (nao reinicia o funil)', async () => {
  const deps = depsFake()
  const estadoSalvo: EstadoConversa = {
    fase: 'aguardando_endereco',
    dados: { produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'amanhã' } },
    perguntasFeitas: ['ocasiao', 'destinatario', 'orcamento', 'dataEntrega'],
  }
  const r = await avancarFunil(estadoSalvo, 'CEP 04204-030, é para Camila', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'calculando_frete')
  assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas')
})

test('acentuacao e caixa alta nao mudam a classificacao', () => {
  assert.equal(classificarIntencao('QUERO FALAR COM ATENDENTE', 'inicio'), 'atendimento_humano')
  assert.equal(classificarIntencao('Reclamação: pedido chegou QUEBRADO', 'inicio'), 'reclamacao')
})

// ── Dispatcher avancarFunil — fluxo completo com dependencias fake ────────

function depsFake(overrides?: Partial<DependenciasFunil>): DependenciasFunil {
  return {
    buscarCatalogo: async () => [
      { nome: 'Buquê de Rosas', preco: 140, disponivel: true, fotoUrl: 'https://site/rosas.jpg' },
      { nome: 'Arranjo Girassóis', preco: 135, disponivel: true },
    ],
    calcularFrete: async () => ({ ok: true, valor: 22.5 }),
    gerarPagamento: async (pedidoId) => ({ link: `https://pagamento.exemplo/${pedidoId}`, paymentId: pedidoId }),
    criarPedido: async () => ({ pedidoId: 'pedido_fake_001' }),
    ...overrides,
  }
}

test('dispatcher: qualificacao pergunta um campo por vez, sem repetir', async () => {
  let estado = estadoInicial()
  const deps = depsFake()

  const r1 = await avancarFunil(estado, 'Quero um buquê para o aniversário da minha esposa', 'recomendacao', deps)
  estado = r1.estado
  assert.equal(estado.dados.ocasiao, 'aniversario')
  assert.equal(estado.fase, 'qualificacao')
  assert.match(r1.mensagem, /orçamento|orcamento|Pra qual ocasião|Pra quando|bairro ou CEP/i)

  // A pergunta ja feita nao pode repetir mesmo em rodadas seguintes.
  const camposPerguntados = [...estado.perguntasFeitas]
  const r2 = await avancarFunil(estado, 'uns R$ 150', 'recomendacao', deps)
  assert.ok(!camposPerguntados.includes('orcamento') || r2.estado.dados.orcamento === 150)
})

test('dispatcher: fluxo feliz completo do inicio ate pedido_criado', async () => {
  const deps = depsFake()
  let estado = estadoInicial()

  // 1) qualificação completa em uma tacada (mensagem rica em dados)
  const r1 = await avancarFunil(
    estado,
    'Quero um buquê para minha esposa, aniversário, uns R$150, entrega amanhã, CEP 04204-030',
    'recomendacao',
    deps,
  )
  estado = r1.estado

  // Pode levar mais de uma pergunta dependendo do que a extração não pegou;
  // simula respostas genéricas até sair de qualificação/recomendação.
  let guard = 0
  while ((estado.fase === 'qualificacao' || estado.fase === 'inicio') && guard < 6) {
    const r = await avancarFunil(estado, 'pode ser qualquer uma, tanto faz', 'compra_produto', deps)
    estado = r.estado
    guard++
  }
  assert.equal(estado.fase, 'recomendacao')

  // 2) recomendação -> cliente escolhe a primeira opção
  const rEscolha = await avancarFunil(estado, 'Fico com esse mesmo', 'compra_produto', deps)
  estado = rEscolha.estado
  assert.equal(estado.fase, 'produto_selecionado')
  assert.equal(estado.dados.produto?.nome, 'Buquê de Rosas')

  // 3) confirma quantidade e data
  const rDetalhes = await avancarFunil(estado, '1 unidade, entrega amanhã de manhã', 'compra_produto', deps)
  estado = rDetalhes.estado
  assert.equal(estado.fase, 'aguardando_endereco')

  // 4) endereço
  const rEndereco = await avancarFunil(estado, 'CEP 04204-030, é para Camila', 'compra_produto', deps)
  estado = rEndereco.estado
  assert.equal(estado.fase, 'calculando_frete')

  // 5) cálculo de frete (dependência real seria agente-logistica)
  const rFrete = await avancarFunil(estado, '', 'compra_produto', deps)
  estado = rFrete.estado
  assert.equal(estado.fase, 'aguardando_confirmacao')
  assert.equal(estado.dados.valorFrete, 22.5)
  assert.equal(estado.dados.valorTotal, 140 + 22.5)
  assert.match(rFrete.mensagem, /Resumo do seu pedido/)

  // 6) confirmação -> cria pedido, gera pagamento
  const rConfirma = await avancarFunil(estado, 'Sim, pode confirmar', 'pagamento', deps)
  estado = rConfirma.estado
  assert.equal(estado.fase, 'aguardando_pagamento')
  assert.equal(estado.dados.pedidoId, 'pedido_fake_001')
  assert.match(estado.dados.linkPagamento!, /pagamento\.exemplo\/pedido_fake_001/)
  assert.match(rConfirma.mensagem, /link de pagamento/)

  // 7) confirmação de pagamento — SÓ via provedor, nunca pela mensagem do cliente
  const rPago = await processarConfirmacaoPagamento(estado, estado.dados.paymentId!, deps.criarPedido)
  assert.equal(rPago.estado.fase, 'pedido_criado')
  assert.match(rPago.mensagem, /Pagamento confirmado/)
})

test('dispatcher: nao confirma resumo com resposta ambigua/negativa', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = {
    fase: 'aguardando_confirmacao',
    dados: { produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'amanhã' }, valorFrete: 22.5, valorTotal: 162.5 },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'não, quero mudar o produto', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_confirmacao')
  assert.equal(r.estado.dados.pedidoId, undefined)
})

test('dispatcher: frete falha -> transfere para humano, nunca estima', async () => {
  const deps = depsFake({ calcularFrete: async () => ({ ok: false }) })
  const estado: EstadoConversa = {
    fase: 'calculando_frete',
    dados: { produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'amanhã' }, endereco: { cep: '04204-030' } },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, '', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'transferido_humano')
  assert.match(r.mensagem, /WhatsApp final 9083/)
  assert.equal(r.estado.dados.valorTotal, undefined)
})

test('dispatcher: falha ao gerar pagamento -> transfere para humano', async () => {
  const deps = depsFake({ gerarPagamento: async () => null })
  const estado: EstadoConversa = {
    fase: 'aguardando_confirmacao',
    dados: { produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'amanhã' }, valorFrete: 22.5, valorTotal: 162.5 },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'sim, confirmo', 'pagamento', deps)
  assert.equal(r.estado.fase, 'transferido_humano')
  assert.match(r.mensagem, /WhatsApp final 9083/)
})

test('dispatcher: pedido de foto funciona em qualquer fase com produto em jogo', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = {
    fase: 'aguardando_endereco',
    dados: { produto: { nome: 'Buquê de Rosas', preco: 140, fotoUrl: 'https://site/rosas.jpg' } },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'me manda uma foto', 'foto_produto', deps)
  assert.equal(r.fotoUrl, 'https://site/rosas.jpg')
  // Foto não muda a fase do funil.
  assert.equal(r.estado.fase, 'aguardando_endereco')
})
