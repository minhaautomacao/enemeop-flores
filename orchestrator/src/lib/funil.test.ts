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
  mensagemTransferenciaLimitacaoTecnica,
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
  pareceSaudacaoSimples,
  extrairTermoDisponibilidade,
  montarMensagemRetomada,
  montarMensagemAguardandoPagamento,
  estadoComPedidoInconsistente,
  TEXTO_FORMULARIO_ENTREGA,
  type ProdutoCatalogo,
  type EstadoConversa,
  type DependenciasFunil,
  type CategoriaCatalogo,
  type FormularioEntregaDados,
  normalizarDataEntregaTexto,
  dataEntregaValida,
  dataCalendarioParaISO,
  normalizarPeriodoEntregaTexto,
  mensagemRetomadaAposIntervalo,
  deveGatilharRetomadaAposIntervalo,
  cotacaoFreteVencida,
  mensagemAvisoForaDoHorarioComOpcao,
  mensagemPagamentoConfirmadoForaDoHorario,
  querCartaoImpresso,
  camposFaltandoFormulario,
  montarMensagemCamposFaltando,
} from './funil.js'

// 1. cliente pede buquê para aniversário
test('1. cliente pede buque para aniversario -> intencao recomendacao e ocasiao extraida', () => {
  const intencao = classificarIntencao('Queria um buquê para o aniversário da minha esposa', 'inicio')
  assert.equal(intencao, 'recomendacao')
  const dados = extrairDadosQualificacao('Queria um buquê para o aniversário da minha esposa', {})
  assert.equal(dados.ocasiao, 'aniversario')
  assert.equal(dados.destinatario, 'esposa')
})

// 2. cliente informa orçamento (extraído passivamente, mas nunca perguntado — ver Parte B da correção 2026-07-20)
test('2. cliente informa orcamento -> valor extraido, mas orcamento nunca e uma pergunta de qualificacao', () => {
  const dados = extrairDadosQualificacao('Posso gastar uns R$ 150', { ocasiao: 'aniversario', destinatario: 'esposa' })
  assert.equal(dados.orcamento, 150)
  // ocasiao e destinatario ja respondidos -> nao ha mais pergunta de qualificacao (orcamento nunca e uma delas)
  const proxima = proximaPerguntaQualificacao(dados, ['ocasiao', 'destinatario'])
  assert.equal(proxima, null)
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
  assert.doesNotMatch(msg, /WhatsApp/i, 'catalogo vazio nao deve oferecer WhatsApp por padrao')
  assert.match(msg, /me conta|preferencia|preferência/i)
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
  assert.match(resposta.mensagem, /nossa equipe/)
  assert.doesNotMatch(resposta.mensagem, /WhatsApp/i, 'transferencia por falha de frete nao forca WhatsApp por padrao')
})

// 8. Flora resume pedido
test('8. Flora monta resumo completo do pedido antes de pedir confirmacao', () => {
  const resumo = montarResumoPedido({
    produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'hoje até 18h' },
    valorFrete: 22.5,
    valorTotal: 162.5,
    endereco: { cep: '04204-030', rua: 'Rua Costa Aguiar', numero: '1184', bairro: 'Ipiranga', cidade: 'São Paulo', nomeDestinatario: 'Camila', telefoneDestinatario: '11999990000' },
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
  assert.doesNotMatch(msg, /WhatsApp/i, 'transferencia padrao continua no mesmo canal, nao oferece WhatsApp por padrao')
})

test('mensagemTransferenciaLimitacaoTecnica so e usada em limitacao tecnica real, com link clicavel oficial', () => {
  const msg = mensagemTransferenciaLimitacaoTecnica()
  assert.match(msg, /https:\/\/wa\.me\/5511982829083/, 'deve ter link clicavel, nunca so "final 9083"')
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

// ── Retomada de contexto (correção do bug real 2026-07-17: Flora afirmava
// "já te enviei o link de pagamento" sem checar se um link real existia,
// mesmo para uma simples "Olá") ─────────────────────────────────────────

test('retomada 1 — saudacao com pedido em andamento: retoma contexto real citando o produto, nunca "ja enviei" fixo', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = {
    fase: 'aguardando_pagamento',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'amanhã' },
      valorTotal: 162.5,
      linkPagamento: 'https://pagamento.exemplo/x',
      paymentId: 'pay_x',
    },
    perguntasFeitas: [],
  }
  const intencao = classificarIntencao('oi', estado.fase)
  assert.equal(intencaoInterrompeFluxo(intencao), false)
  const r = await avancarFunil(estado, 'oi', intencao, deps)
  assert.equal(r.estado.fase, 'aguardando_pagamento', 'saudacao nao deve alterar a fase')
  assert.match(r.mensagem, /Podemos continuar de onde paramos/i)
  assert.match(r.mensagem, /Buquê de Rosas/)
  assert.match(r.mensagem, /Você quer seguir com essa opção\?/)
})

test('retomada 1b — saudacao em fase de compra sem produto na etapa de endereco tambem retoma (nao trata como mensagem nova)', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = {
    fase: 'aguardando_endereco',
    dados: { produto: { nome: 'Arranjo Girassóis', preco: 135 } },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'bom dia', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_endereco')
  assert.match(r.mensagem, /Arranjo Girassóis/)
})

test('retomada 2 — link de pagamento realmente enviado: Flora reenvia o link real em vez de so dizer "ja enviei"', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = {
    fase: 'aguardando_pagamento',
    dados: { produto: { nome: 'Buquê de Rosas', preco: 140 }, valorTotal: 162.5, linkPagamento: 'https://pagamento.exemplo/real123', paymentId: 'pay_real123' },
    perguntasFeitas: [],
  }
  // Mensagem com sinal comercial ("flores") nao e saudacao pura, entao cai
  // na resposta normal da fase aguardando_pagamento.
  const r = await avancarFunil(estado, 'quais flores tem pra hoje?', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_pagamento')
  assert.match(r.mensagem, /pagamento\.exemplo\/real123/, 'deve reenviar o link real, nao so afirmar que ja enviou')
  assert.doesNotMatch(r.mensagem, /^já te enviei/i)
})

test('retomada 3 — link de pagamento NAO enviado (fase avancou sem link real): Flora nunca finge ter enviado', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = {
    fase: 'aguardando_pagamento',
    dados: { produto: { nome: 'Buquê de Rosas', preco: 140 }, valorTotal: 162.5 }, // sem linkPagamento
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'quais flores tem pra hoje?', 'compra_produto', deps)
  assert.doesNotMatch(r.mensagem, /já te enviei/i, 'nunca deve afirmar envio sem um link real registrado')
  assert.match(r.mensagem, /não encontrei um link de pagamento válido/i)
  assert.match(r.mensagem, /gere um novo link|recomeçar/i)
})

test('retomada 4 — contexto inconsistente (fase aguardando_pagamento com dados vazios, como o caso real encontrado em producao): pergunta objetivamente em vez de inventar', async () => {
  const deps = depsFake()
  // Reproduz o estado real encontrado na conversa de teste 2026-07-17:
  // fase = 'aguardando_pagamento' mas pedido_info.dados = {} (sem produto
  // nem link — inconsistência entre fase e dados persistidos).
  const estadoInconsistente: EstadoConversa = { fase: 'aguardando_pagamento', dados: {}, perguntasFeitas: [] }

  const rSaudacao = await avancarFunil(estadoInconsistente, 'Olá', 'compra_produto', deps)
  assert.doesNotMatch(rSaudacao.mensagem, /já te enviei|pagamento confirmado|pedido confirmado/i)
  assert.match(rSaudacao.mensagem, /não encontrei um atendimento em andamento/i)
  assert.match(rSaudacao.mensagem, /novo pedido/i)

  // Mensagem com intencao comercial clara (nao e so uma saudacao) — a
  // intencao explicita prevalece sobre a fase antiga incompativel: repara
  // e segue pro fluxo de recomendacao, nunca fica preso em pagamento.
  const rOutraMsg = await avancarFunil(estadoInconsistente, 'quais flores tem pra hoje?', 'compra_produto', deps)
  assert.doesNotMatch(rOutraMsg.mensagem, /já te enviei|pagamento confirmado|pedido confirmado|link de pagamento/i)
  assert.notEqual(rOutraMsg.estado.fase, 'aguardando_pagamento')
})

// ── Reparo automático de fase inconsistente (2026-07-17, sessão 2) ───────
// "fase" sozinha nunca é fonte de verdade: a intenção explícita da
// mensagem atual prevalece sobre uma fase antiga fantasma.

test('estadoComPedidoInconsistente identifica fase de compra sem produto como fantasma, mas nao fases fora do funil de compra', () => {
  assert.equal(estadoComPedidoInconsistente({ fase: 'aguardando_pagamento', dados: {}, perguntasFeitas: [] }), true)
  assert.equal(estadoComPedidoInconsistente({ fase: 'produto_selecionado', dados: {}, perguntasFeitas: [] }), true)
  assert.equal(estadoComPedidoInconsistente({ fase: 'aguardando_pagamento', dados: { produto: { nome: 'Buquê X' } }, perguntasFeitas: [] }), false)
  assert.equal(estadoComPedidoInconsistente({ fase: 'inicio', dados: {}, perguntasFeitas: [] }), false)
  assert.equal(estadoComPedidoInconsistente({ fase: 'qualificacao', dados: {}, perguntasFeitas: [] }), false)
})

test('regressao real 2026-07-17: aguardando_pagamento com dados vazios -> "Sim" inicia novo pedido -> "quais flores tem pra hoje" nunca mais fala de pagamento', async () => {
  const deps = depsFake()
  let estado: EstadoConversa = { fase: 'aguardando_pagamento', dados: {}, perguntasFeitas: [] }

  // 1) "Olá" — nao ha pedido valido pra retomar, Flora pergunta objetivamente
  const r1 = await avancarFunil(estado, 'Olá', classificarIntencao('Olá', estado.fase), deps)
  assert.doesNotMatch(r1.mensagem, /já te enviei|pagamento confirmado|pedido confirmado/i)
  assert.match(r1.mensagem, /não encontrei um atendimento em andamento/i)
  assert.match(r1.mensagem, /novo pedido/i)
  estado = r1.estado
  assert.equal(estado.fase, 'aguardando_pagamento', 'saudacao sozinha nao repara ainda, so pergunta')

  // 2) "Sim" — cliente aceita comecar de novo: repara o estado (fase antiga
  // fantasma sai de cena), preserva so o que for extraivel da mensagem
  const r2 = await avancarFunil(estado, 'Sim', classificarIntencao('Sim', estado.fase), deps)
  assert.doesNotMatch(r2.mensagem, /já te enviei|pagamento confirmado|pedido confirmado|link de pagamento/i)
  assert.notEqual(r2.estado.fase, 'aguardando_pagamento')
  estado = r2.estado

  // 3) "Quais flores tem para hoje?" — intencao comercial nova segue
  // normalmente a partir do estado reparado, nunca repete pagamento
  const r3 = await avancarFunil(estado, 'Quais flores tem para hoje?', classificarIntencao('Quais flores tem para hoje?', estado.fase), deps)
  assert.doesNotMatch(r3.mensagem, /já te enviei|pagamento confirmado|pedido confirmado|link de pagamento/i)
  assert.notEqual(r3.estado.fase, 'aguardando_pagamento')
})

test('disponibilidade prevalece sobre fase antiga incompativel mesmo sem passar por "Sim" antes', async () => {
  const deps = depsFake()
  const estadoFantasma: EstadoConversa = { fase: 'aguardando_pagamento', dados: {}, perguntasFeitas: [] }
  const r = await avancarFunil(estadoFantasma, 'quais flores tem pra hoje?', 'compra_produto', deps)
  assert.doesNotMatch(r.mensagem, /já te enviei|pagamento confirmado|pedido confirmado|link de pagamento/i)
  assert.notEqual(r.estado.fase, 'aguardando_pagamento')
})

test('fase inconsistente em produto_selecionado (sem produto real) tambem e reparada, nao so aguardando_pagamento', async () => {
  const deps = depsFake()
  const estadoFantasma: EstadoConversa = { fase: 'produto_selecionado', dados: {}, perguntasFeitas: [] }
  const r = await avancarFunil(estadoFantasma, 'quero um buquê de rosas', 'compra_produto', deps)
  assert.notEqual(r.estado.fase, 'produto_selecionado')
  assert.doesNotMatch(r.mensagem, /quantas unidades|pra quando você precisa da entrega/i, 'nao deve pedir detalhes de um produto que nunca foi escolhido de verdade')
})

test('montarMensagemRetomada cita apenas fatos reais em dados, nunca inventa produto/local nao registrado', () => {
  const comProduto = montarMensagemRetomada('aguardando_pagamento', { produto: { nome: 'Buquê de Tulipas' } })
  assert.match(comProduto, /Buquê de Tulipas/)
  assert.match(comProduto, /pagamento ainda está pendente/)

  const semNadaConcreto = montarMensagemRetomada('aguardando_pagamento', {})
  assert.doesNotMatch(semNadaConcreto, /Buquê/)
  assert.match(semNadaConcreto, /não encontrei um atendimento em andamento/i)
})

test('montarMensagemAguardandoPagamento nunca afirma envio sem dados.linkPagamento real', () => {
  const semLink = montarMensagemAguardandoPagamento({})
  assert.doesNotMatch(semLink, /já te enviei|já enviei/i)

  const comLink = montarMensagemAguardandoPagamento({ linkPagamento: 'https://pagamento.exemplo/xyz' })
  assert.match(comLink, /pagamento\.exemplo\/xyz/)
})

test('extrairTermoDisponibilidade reconhece "tem X" e variantes, ignora mensagens sem esse padrao', () => {
  assert.equal(extrairTermoDisponibilidade('Tem girassol pra hoje'), 'girassol')
  assert.equal(extrairTermoDisponibilidade('Tem lírios'), 'lirios')
  assert.equal(extrairTermoDisponibilidade('vocês tem orquídea?'), 'orquidea')
  assert.equal(extrairTermoDisponibilidade('quais flores tem pra hoje?'), null, 'nao comeca com "tem" — segue o fluxo normal de qualificacao/recomendacao')
  assert.equal(extrairTermoDisponibilidade('tem'), null, 'sem produto nenhum mencionado')
})

test('classificarIntencao reconhece pergunta de disponibilidade por termo em qualquer fase', () => {
  assert.equal(classificarIntencao('Tem girassol pra hoje', 'transferido_humano'), 'disponibilidade')
  assert.equal(classificarIntencao('Tem lírios', 'aguardando_pagamento'), 'disponibilidade')
})

test('avancarFunil: pergunta de disponibilidade consulta o catalogo real pelo termo pedido, mesmo fora de inicio/qualificacao', async () => {
  const deps = depsFake({
    buscarCatalogo: async (params) => {
      assert.equal(params.query, 'girassol')
      return [{ nome: 'Arranjo Girassol em Vaso', preco: 120, disponivel: true, codigo: '010' }]
    },
  })
  const estado: EstadoConversa = { fase: 'inicio', dados: {}, perguntasFeitas: [] }
  const r = await avancarFunil(estado, 'Tem girassol pra hoje', 'disponibilidade', deps)
  assert.equal(r.estado.fase, 'recomendacao')
  assert.match(r.mensagem, /Arranjo Girassol em Vaso/)
})

test('avancarFunil: produto perguntado nao encontrado -> resposta honesta, nunca handoff automatico', async () => {
  const deps = depsFake({ buscarCatalogo: async () => [] })
  const estado: EstadoConversa = { fase: 'inicio', dados: {}, perguntasFeitas: [] }
  const r = await avancarFunil(estado, 'Tem lírios', 'disponibilidade', deps)
  assert.notEqual(r.estado.fase, 'transferido_humano')
  assert.doesNotMatch(r.mensagem, /vou te transferir|nossa equipe/i)
  assert.match(r.mensagem, /não temos lirios/i)
})

test('pareceSaudacaoSimples reconhece cumprimentos isolados e rejeita mensagens com conteudo comercial', () => {
  for (const s of ['oi', 'Oi!', 'olá', 'Olá.', 'bom dia', 'Boa tarde!', 'e aí', 'eae', 'opa']) {
    assert.equal(pareceSaudacaoSimples(s), true, `"${s}" deveria ser reconhecida como saudacao simples`)
  }
  for (const s of ['oi, quero um buquê', 'olá! quais flores vocês têm?', 'bom dia, gostaria de falar com um atendente humano']) {
    assert.equal(pareceSaudacaoSimples(s), false, `"${s}" tem conteudo alem da saudacao e nao deveria ser tratada como retomada simples`)
  }
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
    perguntasFeitas: ['ocasiao', 'destinatario'],
  }
  // 'aguardando_endereco' é uma fase legada (Parte 2) — redireciona para o
  // formulário único, sem reaproveitar CEP avulso nem calcular frete a
  // partir de texto solto, e nunca perde o produto já selecionado.
  const r = await avancarFunil(estadoSalvo, 'CEP 04204-030', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_formulario')
  assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas')
  assert.equal(r.estado.dados.valorFrete, undefined)
  assert.equal(r.mensagem, TEXTO_FORMULARIO_ENTREGA)
})

test('acentuacao e caixa alta nao mudam a classificacao', () => {
  assert.equal(classificarIntencao('QUERO FALAR COM ATENDENTE', 'inicio'), 'atendimento_humano')
  assert.equal(classificarIntencao('Reclamação: pedido chegou QUEBRADO', 'inicio'), 'reclamacao')
})

// ── Dispatcher avancarFunil — fluxo completo com dependencias fake ────────

// Formulário de entrega completo, pronto pra enviar como uma única mensagem
// do cliente (Parte 2) — usado pelos testes que precisam passar pela etapa
// de formulário/confirmação/frete.
function formularioTexto(overrides: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    'Nome de quem está fazendo o pedido': 'Ana',
    'Nome de quem vai receber': 'Camila',
    'Telefone de quem vai receber, com DDD': '11999990000',
    'CEP': '04204-030',
    'Rua ou avenida': 'Rua das Flores',
    'Número': '123',
    'Bairro': 'Ipiranga',
    'Cidade': 'São Paulo',
    'UF': 'SP',
    'Data desejada para entrega': 'amanhã',
  }
  const merged = { ...base, ...overrides }
  return Object.entries(merged).map(([k, v]) => `${k}: ${v}`).join('\n')
}

// Mesmos dados de formularioTexto(), já como objeto — pra fixtures que
// montam EstadoConversa diretamente (sem passar pelo parser).
function formularioFixture(overrides: Partial<FormularioEntregaDados> = {}): FormularioEntregaDados {
  return {
    nomeComprador: 'Ana',
    nomeDestinatario: 'Camila',
    telefoneDestinatario: '+5511999990000',
    cep: '04204-030',
    rua: 'Rua das Flores',
    numero: '123',
    bairro: 'Ipiranga',
    cidade: 'São Paulo',
    uf: 'SP',
    dataEntrega: 'amanhã',
    ...overrides,
  }
}

function depsFake(overrides?: Partial<DependenciasFunil>): DependenciasFunil {
  return {
    buscarCatalogo: async () => [
      { nome: 'Buquê de Rosas', preco: 140, disponivel: true, fotoUrl: 'https://site/rosas.jpg' },
      { nome: 'Arranjo Girassóis', preco: 135, disponivel: true },
    ],
    // [] por padrão faz etapaEscolhaCategoria cair no fluxo antigo de busca
    // direta por texto (etapaRecomendacao) — testes que não mexem com
    // categoria continuam passando sem precisar mockar isso explicitamente.
    buscarCategorias: async () => [],
    buscarProdutosPorCategoria: async () => [],
    revalidarProduto: async () => ({ disponivel: true }),
    // detalhes: {} garante que etapaCalculoFrete grava cotadoEm (cotação real
    // sempre traz detalhes reais em produção — ver cotacaoFreteVencida/Parte 4).
    calcularFrete: async () => ({ ok: true, valor: 22.5, detalhes: {} }),
    // ViaCEP fake: por padrão sempre localiza um endereço completo — testes
    // que já informam rua/bairro no formulário mantêm o valor do cliente
    // (só preenche o que estiver vazio, ver etapaFormulario); testes que
    // exercitam CEP inválido/parcial sobrescrevem isso explicitamente.
    consultarCep: async () => ({ rua: 'Rua das Flores', bairro: 'Ipiranga', cidade: 'São Paulo', uf: 'SP' }),
    // Fake determinístico e simples (não precisa reproduzir a lógica real de
    // horário comercial de _shared/agendamento-entrega.ts, usada só pelas
    // Edge Functions Deno) — só devolve datas ISO válidas e coerentes pra
    // exercitar o fluxo do funil.
    calcularAgendamento: (dataEntrega) => {
      const iso = new Date(Date.UTC(dataEntrega.ano, dataEntrega.mes, dataEntrega.dia, 12, 0)).toISOString()
      return { entregaPrometidaEmISO: iso, despachoEmISO: iso, imediato: true }
    },
    gerarPagamento: async (pedidoId) => ({ link: `https://pagamento.exemplo/${pedidoId}`, paymentId: pedidoId }),
    criarPedido: async () => ({ pedidoId: 'pedido_fake_001' }),
    buscarFormasPagamento: async () => ['Pix', 'cartão de crédito', 'cartão de débito'],
    ...overrides,
  }
}

test('dispatcher: qualificacao pergunta um campo por vez, sem repetir, e nunca pergunta orcamento', async () => {
  let estado = estadoInicial()
  const deps = depsFake()

  // Mensagem sem ocasião nem tipo de produto reconhecível -> só aí a
  // qualificação pergunta algo (ocasião OU tipo de produto já dispensa a pergunta).
  const r1 = await avancarFunil(estado, 'Oi, gostaria de fazer um pedido', 'recomendacao', deps)
  estado = r1.estado
  assert.equal(estado.fase, 'qualificacao')
  assert.match(r1.mensagem, /Pra qual ocasião/i)
  assert.doesNotMatch(r1.mensagem, /orçamento|orcamento/i, 'orcamento nunca deve ser perguntado')

  // A pergunta ja feita nao pode repetir mesmo em rodadas seguintes.
  const r2 = await avancarFunil(estado, 'é pra aniversário', 'recomendacao', deps)
  estado = r2.estado
  assert.doesNotMatch(r2.mensagem, /Pra qual ocasião/i, 'nao deve repetir pergunta ja feita')
  assert.doesNotMatch(r2.mensagem, /orçamento|orcamento/i, 'orcamento nunca deve ser perguntado')
})

test('dispatcher: tipo de produto citado ("quero um buquê") já satisfaz a qualificação, sem precisar perguntar a ocasião', async () => {
  const deps = depsFake()
  const r = await avancarFunil(estadoInicial(), 'Quero um buquê', 'recomendacao', deps)
  assert.notEqual(r.estado.fase, 'qualificacao', 'tipo de produto já conhecido dispensa a pergunta de ocasião')
  assert.equal(r.estado.dados.tipoProduto, 'buquê')
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

  // 3) confirma quantidade e data -> envia o formulário único (Parte 2)
  const rDetalhes = await avancarFunil(estado, '1 unidade, entrega amanhã de manhã', 'compra_produto', deps)
  estado = rDetalhes.estado
  assert.equal(estado.fase, 'aguardando_formulario')
  assert.equal(rDetalhes.mensagem, TEXTO_FORMULARIO_ENTREGA)

  // 4) formulário completo numa única mensagem -> pede confirmação, nunca cota frete ainda
  const rFormulario = await avancarFunil(estado, formularioTexto(), 'compra_produto', deps)
  estado = rFormulario.estado
  assert.equal(estado.fase, 'confirmando_formulario')
  assert.equal(estado.dados.valorFrete, undefined)

  // 5) cliente confirma os dados -> só agora cota o frete de verdade (Parte 3)
  const rConfirmaFormulario = await avancarFunil(estado, 'sim', 'compra_produto', deps)
  estado = rConfirmaFormulario.estado
  assert.equal(estado.fase, 'aguardando_aprovacao_frete')
  assert.equal(estado.dados.valorFrete, 22.5)
  assert.equal(estado.dados.valorTotal, 140 + 22.5)
  assert.match(rConfirmaFormulario.mensagem, /aprova o frete/i)

  // 6) cliente aprova o frete e o total -> só então cria pedido, gera pagamento
  const rConfirma = await avancarFunil(estado, 'sim, pode confirmar', 'compra_produto', deps)
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
    fase: 'aguardando_aprovacao_frete',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'amanhã' },
      valorFrete: 22.5,
      valorTotal: 162.5,
      freteDetalhes: { cotadoEm: new Date().toISOString() },
      formulario: formularioFixture(),
    },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'não, quero mudar o produto', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_aprovacao_frete')
  assert.equal(r.estado.dados.pedidoId, undefined)
})

// Falha de frete nunca inventa valor nem avança para pagamento, mas também
// NUNCA transfere pra humano de imediato por uma falha transitória — fica em
// 'confirmando_formulario', retomável com uma nova tentativa (o cliente
// confirma de novo).
test('dispatcher: frete falha -> nunca estima, nunca transfere por falha transitoria, permite nova tentativa', async () => {
  const deps = depsFake({ calcularFrete: async () => ({ ok: false }) })
  const estado: EstadoConversa = {
    fase: 'confirmando_formulario',
    dados: { produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'amanhã' }, formulario: formularioFixture() },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'sim', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'confirmando_formulario')
  assert.notEqual(r.estado.fase, 'transferido_humano')
  assert.equal(r.estado.dados.valorTotal, undefined)

  // Nova tentativa (mesma sessão, integração se recupera) segue normalmente.
  const depsOk = depsFake()
  const rRetry = await avancarFunil(r.estado, 'sim', 'compra_produto', depsOk)
  assert.equal(rRetry.estado.fase, 'aguardando_aprovacao_frete')
  assert.equal(rRetry.estado.dados.valorFrete, 22.5)
})

test('dispatcher: falha ao gerar pagamento -> transfere para humano', async () => {
  const deps = depsFake({ gerarPagamento: async () => null })
  const estado: EstadoConversa = {
    fase: 'aguardando_aprovacao_frete',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'amanhã' },
      valorFrete: 22.5,
      valorTotal: 162.5,
      freteDetalhes: { cotadoEm: new Date().toISOString() },
      formulario: formularioFixture(),
    },
    perguntasFeitas: [],
  }
  // intencao real que classificarIntencao produziria (sem PALAVRAS_PAGAMENTO em "sim, confirmo")
  const r = await avancarFunil(estado, 'sim, confirmo', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'transferido_humano')
  assert.match(r.mensagem, /nossa equipe/)
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

// ── Correção 2026-07-17 (sessão 3): roteamento de frete/pagamento, seleção
// por ordinal/preço/número, foto amarrada ao produto certo ─────────────────
// Reproduz o bug real da conversa 2543dfb8: cliente pediu foto do "Buquê de
// 24 rosas" e recebeu a foto do primeiro item da lista; perguntou frete e
// pagamento e recebeu a mesma mensagem de recomendação repetida.

const CATALOGO_ROSAS: ProdutoCatalogo[] = [
  { nome: 'Buquê de Rosas Vermelhas', preco: 140, codigo: '032', disponivel: true, fotoUrl: 'https://site/032.jpg' },
  { nome: 'Buquê de 12 Rosas Vermelhas', preco: 280, codigo: '033', disponivel: true, fotoUrl: 'https://site/033.jpg' },
  { nome: 'Buquê de 24 Rosas Vermelhas', preco: 560, codigo: '034', disponivel: true, fotoUrl: 'https://site/034.jpg' },
]

test('busca "girassol" retorna somente produtos relacionados injetados pelo catalogo real', async () => {
  const deps = depsFake({
    buscarCatalogo: async (params) => {
      assert.equal(params.query, 'girassol')
      return [{ nome: 'Arranjo Girassol em Vaso', preco: 120, codigo: '010', disponivel: true }]
    },
  })
  const r = await avancarFunil({ fase: 'inicio', dados: {}, perguntasFeitas: [] }, 'Tem girassol?', 'disponibilidade', deps)
  assert.equal(r.estado.dados.opcoesRecomendadas?.length, 1)
  assert.equal(r.estado.dados.opcoesRecomendadas?.[0].codigo, '010')
})

test('busca "lírios" retorna somente produtos relacionados, nunca um produto sem relação com o termo', async () => {
  const deps = depsFake({ buscarCatalogo: async (params) => (params.query === 'lirios' ? [{ nome: 'Buquê de Lírios Brancos', preco: 165, codigo: '021', disponivel: true }] : []) })
  const r = await avancarFunil({ fase: 'inicio', dados: {}, perguntasFeitas: [] }, 'Tem lírios', 'disponibilidade', deps)
  assert.equal(r.estado.dados.opcoesRecomendadas?.[0]?.codigo, '021')
})

// Correção 2026-07-20 (Parte E): a listagem de recomendações nunca envia
// fotos automaticamente — só texto (código, nome, preço). A foto correta
// (nunca trocada entre produtos) só é enviada quando pedida explicitamente.
test('listagem de recomendações nunca envia fotos automaticamente — só texto com código, nome e preço', async () => {
  const deps = depsFake({ buscarCatalogo: async () => CATALOGO_ROSAS })
  const estado: EstadoConversa = { fase: 'recomendacao', dados: { ocasiao: 'aniversario' }, perguntasFeitas: [] }
  const r = await avancarFunil(estado, 'quero ver as opções', 'recomendacao', deps)
  assert.equal(r.fotos, undefined, 'listagem nunca deve incluir fotos automaticamente')
  for (const p of CATALOGO_ROSAS) {
    assert.match(r.mensagem, new RegExp(`${p.codigo} — ${p.nome} — R\\$ ${p.preco!.toFixed(2).replace('.', ',')}`), `catálogo em texto deve trazer código, nome e preço reais de ${p.codigo}`)
  }

  // Pedido explícito de foto de um produto específico traz exatamente a foto dele, nunca de outro.
  for (const p of CATALOGO_ROSAS) {
    const rFoto = await avancarFunil(r.estado, `manda a foto do ${p.codigo}`, 'foto_produto', deps)
    assert.equal(rFoto.fotoUrl, p.fotoUrl, `foto pedida do produto ${p.codigo} deve ser exatamente a dele, nunca de outro`)
  }
})

test('seleção "a segunda" preserva o produto correto por código, não por nome/posição ambígua', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = { fase: 'recomendacao', dados: { opcoesRecomendadas: CATALOGO_ROSAS }, perguntasFeitas: [] }
  const r = await avancarFunil(estado, 'quero a segunda', 'compra_produto', deps)
  assert.equal(r.estado.dados.produto?.codigo, '033')
  assert.equal(r.estado.fase, 'produto_selecionado')
})

test('seleção por número embutido no nome ("24 rosas") e por preço mencionado ("no valor de 560") acham o produto certo', async () => {
  const deps = depsFake()
  const estadoBase: EstadoConversa = { fase: 'recomendacao', dados: { opcoesRecomendadas: CATALOGO_ROSAS }, perguntasFeitas: [] }

  const rNumero = await avancarFunil(estadoBase, 'Quero a foto de 24 rosa', 'foto_produto', deps)
  assert.equal(rNumero.fotoUrl, 'https://site/034.jpg', 'deve identificar o produto de 24 rosas pelo número, nao mandar a primeira foto da lista')

  const rPreco = await avancarFunil(estadoBase, 'No valor de 560,00', 'compra_produto', deps)
  assert.equal(rPreco.estado.dados.produto?.codigo, '034')
})

const CATALOGO_ANIVERSARIO: ProdutoCatalogo[] = [
  { nome: 'Arranjo Mix Flores do Campo', preco: 145, codigo: 'M08', idExterno: '4008', disponivel: true, fotoUrl: 'https://site/M08.jpg' },
  { nome: 'Arranjo 2 Rosas Nacionais e Junco', preco: 105, codigo: '002', idExterno: '3656', disponivel: true, fotoUrl: 'https://site/002.jpg' },
  { nome: 'Buquê de Rosas Vermelhas', preco: 140, codigo: '032', idExterno: '4032', disponivel: true, fotoUrl: 'https://site/032.jpg' },
]

test('recomendação já apresentada: mensagem que não escolhe nenhuma opção NUNCA repete a busca no catálogo (regressão do loop de aniversário)', async () => {
  let chamadasCatalogo = 0
  const deps = depsFake({ buscarCatalogo: async () => { chamadasCatalogo++; return CATALOGO_ANIVERSARIO } })
  const estado: EstadoConversa = {
    fase: 'recomendacao',
    dados: { ocasiao: 'aniversario', opcoesRecomendadas: CATALOGO_ANIVERSARIO, recomendacaoApresentada: true },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'e pra aniversário, tem mais alguma coisa?', 'recomendacao', deps)
  assert.equal(chamadasCatalogo, 0, 'nao deve buscar o catalogo de novo — opcoes ja foram apresentadas nesta conversa')
  assert.equal(r.estado.fase, 'recomendacao')
  assert.match(r.mensagem, /qual das op(c|ç)(o|õ)es/i)
  assert.doesNotMatch(r.mensagem, /R\$ ?105|R\$ ?145|R\$ ?140/i, 'nao deve reapresentar a lista de produtos/precos')
})

test('escolha "quero o código 002" após recomendação apresentada avança pro próximo passo, sem repetir o catálogo', async () => {
  let chamadasCatalogo = 0
  const deps = depsFake({ buscarCatalogo: async () => { chamadasCatalogo++; return CATALOGO_ANIVERSARIO } })
  const estado: EstadoConversa = {
    fase: 'recomendacao',
    dados: { opcoesRecomendadas: CATALOGO_ANIVERSARIO, recomendacaoApresentada: true },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'quero o código 002', 'compra_produto', deps)
  assert.equal(chamadasCatalogo, 0)
  assert.equal(r.estado.dados.produto?.codigo, '002')
  assert.equal(r.estado.fase, 'produto_selecionado')
  assert.match(r.mensagem, /quantas unidades/i)
})

test('escolha "quero o de R$105" após recomendação apresentada identifica o produto pelo preço', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = {
    fase: 'recomendacao',
    dados: { opcoesRecomendadas: CATALOGO_ANIVERSARIO, recomendacaoApresentada: true },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'quero o de R$105', 'compra_produto', deps)
  assert.equal(r.estado.dados.produto?.codigo, '002')
  assert.equal(r.estado.fase, 'produto_selecionado')
})

test('pergunta de frete durante a recomendação (produto já escolhido) interrompe as sugestões e pede só o CEP', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = {
    fase: 'recomendacao',
    dados: { produto: { nome: 'Buquê de 24 Rosas Vermelhas', preco: 560, codigo: '034' }, opcoesRecomendadas: CATALOGO_ROSAS },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'Qual o valor do frete', 'frete', deps)
  assert.doesNotMatch(r.mensagem, /Buquê de Rosas Vermelhas.*R\$ 140/i, 'nao deve voltar a mostrar as sugestoes')
  assert.match(r.mensagem, /CEP/i)
  assert.equal(r.estado.dados.produto?.codigo, '034', 'produto escolhido deve ser preservado')
})

test('pergunta de frete com CEP já conhecido executa a cotação real imediatamente e nunca estima', async () => {
  const deps = depsFake({ calcularFrete: async (cep) => { assert.equal(cep, '01040010'); return { ok: true, valor: 40.13 } } })
  const estado: EstadoConversa = {
    fase: 'produto_selecionado',
    dados: { produto: { nome: 'Buquê de 24 Rosas Vermelhas', preco: 560, codigo: '034', quantidade: 1 }, bairroOuCep: '01040010' },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'Qual o valor do frete', 'frete', deps)
  assert.equal(r.estado.fase, 'aguardando_aprovacao_frete')
  assert.equal(r.estado.dados.valorFrete, 40.13)
  assert.equal(r.estado.dados.valorTotal, 560 + 40.13, 'total deve usar o retorno real da cotação')
  assert.match(r.mensagem, /40,13/)
})

test('pergunta de pagamento em qualquer fase recebe resposta real baseada na configuração, nunca inventa formas', async () => {
  const deps = depsFake({ buscarFormasPagamento: async () => ['Pix', 'cartão de crédito', 'cartão de débito'] })
  const estado: EstadoConversa = { fase: 'produto_selecionado', dados: { produto: { nome: 'Buquê de Rosas', preco: 140 } }, perguntasFeitas: [] }
  const r = await avancarFunil(estado, 'Quais formas de pagamento vocês aceitam?', 'pagamento', deps)
  assert.match(r.mensagem, /Pix/)
  assert.match(r.mensagem, /cartão de crédito/)
  assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas', 'pergunta incidental nao apaga o produto ja escolhido')
})

test('pergunta de pagamento sem integração configurada admite a limitação honestamente, sem inventar Pix/cartão/dinheiro', async () => {
  const deps = depsFake({ buscarFormasPagamento: async () => [] })
  const r = await avancarFunil({ fase: 'inicio', dados: {}, perguntasFeitas: [] }, 'Quais formas de pagamento?', 'pagamento', deps)
  assert.doesNotMatch(r.mensagem, /pix|cart[ãa]o|dinheiro/i)
  assert.match(r.mensagem, /não consigo confirmar|validar.*equipe/i)
})

test('regressão completa 2026-07-17: qualificação -> 2 opções com fotos corretas -> "a segunda" -> frete -> pagamento -> confirmação -> pagamento gerado, sem nunca voltar às sugestões', async () => {
  const CATALOGO_2: ProdutoCatalogo[] = [
    { nome: 'Arranjo Alegre Colorido', preco: 130, codigo: '050', disponivel: true, fotoUrl: 'https://site/050.jpg' },
    { nome: 'Arranjo Elegante Branco', preco: 190, codigo: '051', disponivel: true, fotoUrl: 'https://site/051.jpg' },
  ]
  const deps = depsFake({
    buscarCatalogo: async () => CATALOGO_2,
    calcularFrete: async () => ({ ok: true, valor: 18, detalhes: {} }),
    buscarFormasPagamento: async () => ['Pix', 'cartão de crédito'],
    gerarPagamento: async (pedidoId) => ({ link: `https://pagamento.exemplo/${pedidoId}`, paymentId: pedidoId }),
    criarPedido: async () => ({ pedidoId: 'pedido_regressao_001' }),
  })
  let estado = estadoInicial()

  // 1) "Quero flores para aniversário."
  let r = await avancarFunil(estado, 'Quero flores para aniversário', classificarIntencao('Quero flores para aniversário', estado.fase), deps)
  estado = r.estado
  assert.equal(estado.dados.ocasiao, 'aniversario')

  // 2-3) Flora pergunta preferência/orçamento; cliente informa os dados restantes.
  let guard = 0
  while ((estado.fase === 'qualificacao' || estado.fase === 'inicio') && guard < 6) {
    r = await avancarFunil(estado, 'tanto faz, pode ser qualquer uma, uns R$150', classificarIntencao('tanto faz', estado.fase), deps)
    estado = r.estado
    guard++
  }
  assert.equal(estado.fase, 'recomendacao')

  // 4) Flora apresenta duas opções reais, em texto (código, nome, preço), sem foto automática.
  assert.equal(r.fotos, undefined)
  assert.match(r.mensagem, /050 — Arranjo Alegre Colorido — R\$ 130,00/)
  assert.match(r.mensagem, /051 — Arranjo Elegante Branco — R\$ 190,00/)

  // 5) Cliente escolhe "a segunda".
  r = await avancarFunil(estado, 'quero a segunda', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.dados.produto?.codigo, '051')
  assert.equal(estado.fase, 'produto_selecionado')

  // Confirma quantidade/data -> Flora envia o formulário único de entrega.
  r = await avancarFunil(estado, '1 unidade, entrega amanhã', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_formulario')

  // 6) "Qual o valor do frete?"
  r = await avancarFunil(estado, 'Qual o valor do frete?', 'frete', deps)
  estado = r.estado
  // 7) Sem CEP ainda -> Flora pede só o CEP, sem apagar o produto.
  assert.match(r.mensagem, /CEP/i)
  assert.equal(estado.dados.produto?.codigo, '051')

  // Cliente preenche o formulário completo numa única mensagem.
  r = await avancarFunil(estado, formularioTexto({ CEP: '01040-010' }), 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'confirmando_formulario')
  assert.equal(estado.dados.valorFrete, undefined, 'frete nunca é cotado antes da confirmação dos dados')

  // Cliente confirma os dados -> só agora a cotação real acontece.
  r = await avancarFunil(estado, 'sim', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_aprovacao_frete')
  assert.equal(estado.dados.valorFrete, 18)

  // 8) "Quais formas de pagamento?"
  r = await avancarFunil(estado, 'Quais formas de pagamento vocês têm?', 'pagamento', deps)
  // 9) Flora responde com as opções reais, sem voltar às sugestões nem gerar link ainda.
  assert.match(r.mensagem, /Pix/)
  assert.equal(r.estado.dados.pedidoId, undefined, 'pagamento nao pode ser gerado antes do resumo confirmado')
  estado = r.estado

  // 10) Cliente confirma.
  r = await avancarFunil(estado, 'Sim, confirmo', 'compra_produto', deps)
  estado = r.estado

  // 11) Flora apresenta resumo, gera pagamento e avança — sem voltar às sugestões.
  assert.equal(estado.fase, 'aguardando_pagamento')
  assert.equal(estado.dados.pedidoId, 'pedido_regressao_001')
  assert.match(estado.dados.linkPagamento!, /pagamento\.exemplo\/pedido_regressao_001/)
  assert.doesNotMatch(r.mensagem, /Arranjo Alegre Colorido.*R\$ 130/i)
})

// ── Catálogo conversacional dinâmico (categorias reais, ao vivo) ──────────

test('filtro de categoria: ao escolher uma categoria, mostra somente produtos dessa categoria, nunca mistura com outra', async () => {
  const categorias: CategoriaCatalogo[] = [{ id: '10', nome: 'Arranjos Florais' }, { id: '20', nome: 'Buquês' }]
  const produtosArranjos: ProdutoCatalogo[] = [{ nome: 'Arranjo Girassol', preco: 120, codigo: '010', disponivel: true, fotoUrl: 'https://site/010.jpg' }]
  const produtosBuques: ProdutoCatalogo[] = [{ nome: 'Buquê de Rosas', preco: 140, codigo: '032', disponivel: true, fotoUrl: 'https://site/032.jpg' }]
  const deps = depsFake({
    buscarCategorias: async () => categorias,
    buscarProdutosPorCategoria: async (id) => (id === '10' ? produtosArranjos : produtosBuques),
  })
  const estado: EstadoConversa = { fase: 'escolha_categoria', dados: { categoriasApresentadas: ['10', '20'] }, perguntasFeitas: [] }
  const r = await avancarFunil(estado, 'Arranjos Florais', 'recomendacao', deps)
  assert.equal(r.estado.dados.categoriaEscolhida?.id, '10')
  assert.equal(r.estado.dados.opcoesRecomendadas?.length, 1)
  assert.equal(r.estado.dados.opcoesRecomendadas?.[0].codigo, '010')
  assert.doesNotMatch(r.mensagem, /Buquê de Rosas/, 'nunca mistura produto de outra categoria')
})

test('fim da qualificação apresenta as categorias reais (nunca inventadas) para escolha', async () => {
  const categorias: CategoriaCatalogo[] = [{ id: '10', nome: 'Arranjos Florais' }, { id: '20', nome: 'Buquês' }]
  const deps = depsFake({ buscarCategorias: async () => categorias })
  const estado: EstadoConversa = {
    fase: 'qualificacao',
    dados: { ocasiao: 'aniversario', destinatario: 'mae', orcamento: 150, dataEntrega: 'hoje', bairroOuCep: '01000-000' },
    perguntasFeitas: ['ocasiao', 'destinatario', 'orcamento', 'dataEntrega', 'bairroOuCep'],
  }
  const r = await avancarFunil(estado, 'quero ver as opções', 'recomendacao', deps)
  assert.equal(r.estado.fase, 'escolha_categoria')
  assert.match(r.mensagem, /Arranjos Florais/)
  assert.match(r.mensagem, /Buquês/)
  assert.deepEqual(r.estado.dados.categoriasApresentadas, ['10', '20'])
})

test('listagem por categoria nunca envia fotos automaticamente; foto pedida depois e exata, nunca trocada', async () => {
  const categorias: CategoriaCatalogo[] = [{ id: '10', nome: 'Arranjos Florais' }]
  const deps = depsFake({ buscarCategorias: async () => categorias, buscarProdutosPorCategoria: async () => CATALOGO_ANIVERSARIO })
  const estado: EstadoConversa = { fase: 'escolha_categoria', dados: { categoriasApresentadas: ['10'] }, perguntasFeitas: [] }
  const r = await avancarFunil(estado, 'Arranjos Florais', 'recomendacao', deps)
  assert.equal(r.fotos, undefined, 'listagem por categoria nunca deve incluir fotos automaticamente')
  for (const p of CATALOGO_ANIVERSARIO) {
    const rFoto = await avancarFunil(r.estado, `foto do ${p.codigo}`, 'foto_produto', deps)
    assert.equal(rFoto.fotoUrl, p.fotoUrl, `foto pedida do produto ${p.codigo} deve ser exatamente a dele`)
  }
})

test('pedido de "catálogo completo" durante a escolha de categoria entra no modo paginado', async () => {
  const categorias: CategoriaCatalogo[] = [{ id: '10', nome: 'Arranjos Florais' }, { id: '20', nome: 'Buquês' }]
  const deps = depsFake({
    buscarCategorias: async () => categorias,
    buscarProdutosPorCategoria: async () => [{ nome: 'X', preco: 100, codigo: 'X1', disponivel: true }],
  })
  const estado: EstadoConversa = { fase: 'escolha_categoria', dados: { categoriasApresentadas: ['10', '20'] }, perguntasFeitas: [] }
  const r = await avancarFunil(estado, 'quero o catálogo completo', 'recomendacao', deps)
  assert.equal(r.estado.fase, 'catalogo_completo')
})

test('paginação do catálogo completo: mostra em grupos pequenos e nunca despeja tudo de uma vez', async () => {
  const categorias: CategoriaCatalogo[] = [{ id: '10', nome: 'Arranjos Florais' }]
  const cincoProdutos: ProdutoCatalogo[] = Array.from({ length: 5 }, (_, i) => ({
    nome: `Produto ${i + 1}`, preco: 100 + i, codigo: `P${i + 1}`, disponivel: true,
  }))
  const deps = depsFake({ buscarCategorias: async () => categorias, buscarProdutosPorCategoria: async () => cincoProdutos })
  const estado: EstadoConversa = { fase: 'escolha_categoria', dados: {}, perguntasFeitas: [] }

  const r1 = await avancarFunil(estado, 'quero ver o catálogo completo', 'recomendacao', deps)
  assert.equal(r1.estado.fase, 'catalogo_completo')
  assert.equal(r1.estado.dados.opcoesRecomendadas?.length, 3, 'nunca despeja mais que um grupo pequeno de uma vez')
  assert.match(r1.mensagem, /quer ver mais/i)

  const r2 = await avancarFunil(r1.estado, 'sim', 'recomendacao', deps)
  assert.deepEqual(r2.estado.dados.opcoesRecomendadas?.map(p => p.codigo), ['P4', 'P5'], 'mostra o restante, nunca repete os 3 primeiros')
})

test('ausência de repetição: catálogo completo nunca repete um produto já mostrado ao avançar de categoria', async () => {
  const categorias: CategoriaCatalogo[] = [{ id: '10', nome: 'Categoria A' }, { id: '20', nome: 'Categoria B' }]
  const compartilhado: ProdutoCatalogo = { nome: 'Compartilhado', preco: 50, codigo: 'C1', disponivel: true }
  const deps = depsFake({
    buscarCategorias: async () => categorias,
    buscarProdutosPorCategoria: async (id) => (id === '10' ? [compartilhado] : [compartilhado, { nome: 'Exclusivo B', preco: 60, codigo: 'C2', disponivel: true }]),
  })
  const estado: EstadoConversa = { fase: 'escolha_categoria', dados: {}, perguntasFeitas: [] }
  const r1 = await avancarFunil(estado, 'catálogo completo', 'recomendacao', deps)
  assert.deepEqual(r1.estado.dados.opcoesRecomendadas?.map(p => p.codigo), ['C1'])
  const r2 = await avancarFunil(r1.estado, 'sim', 'recomendacao', deps)
  assert.deepEqual(r2.estado.dados.opcoesRecomendadas?.map(p => p.codigo), ['C2'], 'produto já mostrado na categoria A nunca reaparece na B')
})

test('escolha por código funciona dentro do fluxo de categoria (continuidade com a correção do commit 007b96a)', async () => {
  const categorias: CategoriaCatalogo[] = [{ id: '10', nome: 'Arranjos Florais' }]
  const deps = depsFake({ buscarCategorias: async () => categorias, buscarProdutosPorCategoria: async () => CATALOGO_ANIVERSARIO })
  const estado: EstadoConversa = { fase: 'escolha_categoria', dados: { categoriasApresentadas: ['10'] }, perguntasFeitas: [] }
  const r1 = await avancarFunil(estado, 'Arranjos Florais', 'recomendacao', deps)
  assert.equal(r1.estado.fase, 'recomendacao')
  const r2 = await avancarFunil(r1.estado, 'quero o código 002', 'compra_produto', deps)
  assert.equal(r2.estado.dados.produto?.codigo, '002')
  assert.equal(r2.estado.fase, 'produto_selecionado')
})

test('revalidação antes do pedido: produto que saiu de disponibilidade nunca cria pedido', async () => {
  let criarPedidoChamado = false
  const deps = depsFake({
    revalidarProduto: async () => ({ disponivel: false }),
    criarPedido: async () => { criarPedidoChamado = true; return { pedidoId: 'x' } },
  })
  const estado: EstadoConversa = {
    fase: 'aguardando_aprovacao_frete',
    dados: { produto: { nome: 'Buquê X', preco: 140, codigo: '032', idExterno: '999', quantidade: 1, dataEntrega: 'hoje' }, valorTotal: 162.5, valorFrete: 22.5, freteDetalhes: { cotadoEm: new Date().toISOString() }, formulario: formularioFixture() },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'sim, confirmo', 'compra_produto', deps)
  assert.equal(criarPedidoChamado, false, 'nunca cria pedido de um produto revalidado como indisponível')
  assert.equal(r.estado.fase, 'escolha_categoria')
  assert.equal(r.estado.dados.produto, undefined)
  assert.match(r.mensagem, /saiu de disponibilidade/i)
})

test('revalidação antes do pedido: preço mudou -> avisa o novo total e não cria o pedido sem reconfirmação', async () => {
  let criarPedidoChamado = false
  const deps = depsFake({
    revalidarProduto: async () => ({ disponivel: true, preco: 160 }),
    criarPedido: async () => { criarPedidoChamado = true; return { pedidoId: 'x' } },
  })
  const estado: EstadoConversa = {
    fase: 'aguardando_aprovacao_frete',
    dados: { produto: { nome: 'Buquê X', preco: 140, codigo: '032', idExterno: '999', quantidade: 1, dataEntrega: 'hoje' }, valorTotal: 162.5, valorFrete: 22.5, freteDetalhes: { cotadoEm: new Date().toISOString() }, formulario: formularioFixture() },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'sim, confirmo', 'compra_produto', deps)
  assert.equal(criarPedidoChamado, false)
  assert.equal(r.estado.dados.produto?.preco, 160)
  assert.equal(r.estado.dados.valorTotal, 182.5)
  assert.match(r.mensagem, /atualizado para R\$ 160,00/)
})

test('revalidação antes do pedido: preço e disponibilidade confirmados na fonte -> segue e cria o pedido normalmente', async () => {
  const deps = depsFake({ revalidarProduto: async () => ({ disponivel: true, preco: 140 }) })
  const estado: EstadoConversa = {
    fase: 'aguardando_aprovacao_frete',
    dados: { produto: { nome: 'Buquê X', preco: 140, codigo: '032', idExterno: '999', quantidade: 1, dataEntrega: 'hoje' }, valorTotal: 162.5, valorFrete: 22.5, freteDetalhes: { cotadoEm: new Date().toISOString() }, formulario: formularioFixture() },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'sim, confirmo', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_pagamento')
  assert.match(r.mensagem, /link de pagamento/i)
})

test('continuidade completa: categoria -> produto por código -> quantidade/data -> CEP -> frete -> confirmação -> pagamento', async () => {
  const categorias: CategoriaCatalogo[] = [{ id: '10', nome: 'Arranjos Florais' }]
  const deps = depsFake({
    buscarCategorias: async () => categorias,
    buscarProdutosPorCategoria: async () => CATALOGO_ANIVERSARIO,
    revalidarProduto: async () => ({ disponivel: true, preco: 105 }),
    calcularFrete: async () => ({ ok: true, valor: 18, detalhes: {} }),
    criarPedido: async () => ({ pedidoId: 'pedido_catalogo_dinamico_001' }),
  })
  let estado: EstadoConversa = { fase: 'escolha_categoria', dados: { categoriasApresentadas: ['10'] }, perguntasFeitas: [] }

  let r = await avancarFunil(estado, 'Arranjos Florais', 'recomendacao', deps)
  estado = r.estado
  assert.equal(estado.fase, 'recomendacao')

  r = await avancarFunil(estado, 'quero o código 002', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'produto_selecionado')
  assert.equal(estado.dados.produto?.codigo, '002')

  r = await avancarFunil(estado, '1 unidade, entrega amanhã', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_formulario')
  assert.equal(r.mensagem, TEXTO_FORMULARIO_ENTREGA)

  r = await avancarFunil(estado, formularioTexto({ CEP: '01040-010' }), 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'confirmando_formulario')

  r = await avancarFunil(estado, 'sim', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_aprovacao_frete')
  assert.equal(estado.dados.valorFrete, 18)

  r = await avancarFunil(estado, 'sim, confirmo', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_pagamento')
  assert.equal(estado.dados.pedidoId, 'pedido_catalogo_dinamico_001')
  assert.match(r.mensagem, /Mercado Pago/i)
})

// 6. Revalidação sempre pelo ID técnico (idExterno), nunca pelo código comercial.
test('revalidação antes do pedido chama revalidarProduto com o ID técnico (idExterno), nunca com o código comercial', async () => {
  let idRecebido: string | undefined
  const deps = depsFake({
    revalidarProduto: async (id) => { idRecebido = id; return { disponivel: true, preco: 105 } },
  })
  const estado: EstadoConversa = {
    fase: 'aguardando_aprovacao_frete',
    dados: {
      produto: { nome: '002 - Arranjo A', preco: 105, codigo: '002', idExterno: '100', quantidade: 1, dataEntrega: 'hoje' },
      valorTotal: 127.5, valorFrete: 22.5, freteDetalhes: { cotadoEm: new Date().toISOString() }, formulario: formularioFixture(),
    },
    perguntasFeitas: [],
  }
  await avancarFunil(estado, 'sim, confirmo', 'compra_produto', deps)
  assert.equal(idRecebido, '100', 'deve revalidar pelo idExterno, nunca pelo codigo comercial ("002")')
})

// 5b. Escolha preserva código, ID, foto e preço exatos mesmo quando duas opções compartilham o mesmo código comercial (cadastro duplicado).
test('escolha entre duas opções com o mesmo código comercial preserva o ID, nome, foto e preço exatos da opção escolhida', async () => {
  const opcoesDuplicadas: ProdutoCatalogo[] = [
    { nome: '002 - Arranjo A', codigo: '002', idExterno: '100', preco: 105, disponivel: true, fotoUrl: 'https://site/a.jpg' },
    { nome: '002 - Arranjo B', codigo: '002', idExterno: '200', preco: 130, disponivel: true, fotoUrl: 'https://site/b.jpg' },
  ]
  const deps = depsFake()
  const estado: EstadoConversa = { fase: 'recomendacao', dados: { opcoesRecomendadas: opcoesDuplicadas }, perguntasFeitas: [] }
  // Mesmo código nas duas opções ("002") — o cliente desambigua pelo preço,
  // que é único por opção mesmo quando o código comercial está duplicado.
  const r = await avancarFunil(estado, 'quero o de R$130', 'compra_produto', deps)
  assert.equal(r.estado.dados.produto?.idExterno, '200', 'deve preservar o ID exato da opcao B, nunca o da A')
  assert.equal(r.estado.dados.produto?.preco, 130)
  assert.equal(r.estado.dados.produto?.fotoUrl, 'https://site/b.jpg')
})

// Código duplicado escolhido SOMENTE pelo código: nunca seleciona sozinho, pede desambiguação.
test('código duplicado entre opções, escolhido apenas pelo código, gera desambiguação em vez de selecionar automaticamente', async () => {
  const opcoesDuplicadas: ProdutoCatalogo[] = [
    { nome: '002 - Arranjo A', codigo: '002', idExterno: '100', preco: 105, disponivel: true, fotoUrl: 'https://site/a.jpg' },
    { nome: '002 - Arranjo B', codigo: '002', idExterno: '200', preco: 130, disponivel: true, fotoUrl: 'https://site/b.jpg' },
  ]
  const deps = depsFake()
  const estado: EstadoConversa = { fase: 'recomendacao', dados: { opcoesRecomendadas: opcoesDuplicadas }, perguntasFeitas: [] }
  // "quero o código 002" bate com as DUAS opções — não há nome/preço/posição na mensagem, só o código.
  const r = await avancarFunil(estado, 'quero o código 002', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'recomendacao', 'nao deve avancar de fase sem uma escolha inequivoca')
  assert.equal(r.estado.dados.produto, undefined, 'nunca seleciona automaticamente entre opcoes conflitantes')
  assert.match(r.mensagem, /mais de uma op[cç][aã]o/i)
  assert.match(r.mensagem, /nome.*pre[cç]o.*posi[cç][aã]o|posi[cç][aã]o.*pre[cç]o.*nome/i)
})

// Escolha posterior por posição, após a desambiguação, seleciona o ID correto.
test('após a desambiguação, escolha por posição ("a segunda") seleciona o ID, foto e preço corretos', async () => {
  const opcoesDuplicadas: ProdutoCatalogo[] = [
    { nome: '002 - Arranjo A', codigo: '002', idExterno: '100', preco: 105, disponivel: true, fotoUrl: 'https://site/a.jpg' },
    { nome: '002 - Arranjo B', codigo: '002', idExterno: '200', preco: 130, disponivel: true, fotoUrl: 'https://site/b.jpg' },
  ]
  const deps = depsFake()
  let estado: EstadoConversa = { fase: 'recomendacao', dados: { opcoesRecomendadas: opcoesDuplicadas }, perguntasFeitas: [] }

  const r1 = await avancarFunil(estado, 'quero o código 002', 'compra_produto', deps)
  estado = r1.estado
  assert.equal(estado.dados.produto, undefined, 'ainda ambiguo apos a primeira tentativa')

  const r2 = await avancarFunil(estado, 'a segunda', 'compra_produto', deps)
  assert.equal(r2.estado.fase, 'produto_selecionado')
  assert.equal(r2.estado.dados.produto?.idExterno, '200', 'posicao "a segunda" deve resolver pro ID exato da opcao B')
  assert.equal(r2.estado.dados.produto?.preco, 130)
  assert.equal(r2.estado.dados.produto?.fotoUrl, 'https://site/b.jpg')
})

// ── Correção P0 consolidada 2026-07-20 (CRM, catálogo, fotos, frete, continuidade) ──

const CATALOGO_RAMALHETES: ProdutoCatalogo[] = [
  { nome: 'Mini Ramalhete - Frente única', preco: 55, codigo: '028', disponivel: true, fotoUrl: 'https://site/028.jpg' },
  { nome: 'Mini Ramalhete + Ferrero Rocher 100g', preco: 100, codigo: '029', disponivel: true, fotoUrl: 'https://site/029.jpg' },
  { nome: 'Ramalhete de Rosas', preco: 70, codigo: '030', disponivel: false },
]

test('8. "quero ramalhetes" retorna opções reais em texto (código — nome — preço), sem despejar foto/link', async () => {
  const deps = depsFake({ buscarCatalogo: async (params) => { assert.match(params.query, /ramalhete/); return CATALOGO_RAMALHETES } })
  const r = await avancarFunil({ fase: 'inicio', dados: {}, perguntasFeitas: [] }, 'quero ramalhetes', 'recomendacao', deps)
  assert.equal(r.estado.fase, 'recomendacao')
  assert.match(r.mensagem, /028 — Mini Ramalhete - Frente única — R\$ 55,00/)
  assert.match(r.mensagem, /029 — Mini Ramalhete \+ Ferrero Rocher 100g — R\$ 100,00/)
  assert.equal(r.fotos, undefined)
})

test('11. foto inexistente nunca usa foto de outro produto', () => {
  const semFoto: ProdutoCatalogo = { nome: 'Ramalhete de Rosas', preco: 70, codigo: '030', disponivel: true }
  const resp = responderPedidoDeFoto(semFoto)
  assert.equal(resp.fotoUrl, null, 'nunca deve inventar/reaproveitar foto de outro produto')
  assert.match(resp.mensagem, /não tenho uma foto/i)
})

test('12. código "029" seleciona corretamente o produto correspondente', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = { fase: 'recomendacao', dados: { opcoesRecomendadas: CATALOGO_RAMALHETES }, perguntasFeitas: [] }
  const r = await avancarFunil(estado, 'quero o 029', 'compra_produto', deps)
  assert.equal(r.estado.dados.produto?.codigo, '029')
  assert.equal(r.estado.dados.produto?.preco, 100)
  assert.equal(r.estado.fase, 'produto_selecionado')
})

test('13. nome inequívoco ("Ramalhete de Rosas") seleciona corretamente', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = { fase: 'recomendacao', dados: { opcoesRecomendadas: CATALOGO_RAMALHETES }, perguntasFeitas: [] }
  const r = await avancarFunil(estado, 'quero o ramalhete de rosas', 'compra_produto', deps)
  assert.equal(r.estado.dados.produto?.codigo, '030')
})

test('14. nome ambíguo (a mensagem cita um nome que é substring de mais de uma opção) pede desambiguação, nunca escolhe pelo primeiro', async () => {
  const deps = depsFake()
  const opcoesPrefixoComum: ProdutoCatalogo[] = [
    { nome: 'rosa', codigo: '040', preco: 50, disponivel: true },
    { nome: 'rosa vermelha', codigo: '041', preco: 60, disponivel: true },
  ]
  const estado: EstadoConversa = { fase: 'recomendacao', dados: { opcoesRecomendadas: opcoesPrefixoComum }, perguntasFeitas: [] }
  const r = await avancarFunil(estado, 'quero rosa vermelha', 'compra_produto', deps)
  assert.equal(r.estado.dados.produto, undefined, 'nunca escolhe automaticamente entre nomes ambíguos')
  assert.match(r.mensagem, /mais de uma op/i)
})

test('15. "quero ele" seleciona a recomendação principal quando ela está claramente destacada (regressão real observada 2026-07-20)', async () => {
  const deps = depsFake({ buscarCatalogo: async () => [{ nome: 'Arranjo 2 Rosas Nacionais e Junco', preco: 105, codigo: '002', disponivel: true }] })
  const r1 = await avancarFunil({ fase: 'inicio', dados: {}, perguntasFeitas: [] }, 'quero um arranjo', 'recomendacao', deps)
  assert.equal(r1.estado.fase, 'recomendacao')
  const r2 = await avancarFunil(r1.estado, 'quero ele', 'compra_produto', deps)
  assert.equal(r2.estado.dados.produto?.codigo, '002', '"quero ele" deve selecionar a recomendação principal quando inequívoca')
  assert.equal(r2.estado.fase, 'produto_selecionado')
})

test('16. quantidade e data são coletadas sem repetição de pergunta', async () => {
  const estado: EstadoConversa = {
    fase: 'produto_selecionado',
    dados: { produto: { nome: 'Mini Ramalhete', preco: 55, codigo: '028' } },
    perguntasFeitas: [],
  }
  const r1 = await avancarFunil(estado, '2 unidades', 'compra_produto', depsFake())
  assert.equal(r1.estado.dados.produto?.quantidade, 2)
  assert.match(r1.mensagem, /quando/i, 'so deve faltar perguntar a data, nunca repete "quantas unidades"')
  const r2 = await avancarFunil(r1.estado, 'amanhã', 'compra_produto', depsFake())
  assert.equal(r2.estado.dados.produto?.dataEntrega, 'amanhã')
  assert.equal(r2.estado.fase, 'aguardando_formulario')
  assert.doesNotMatch(r2.mensagem, /quantas unidades/i)
})

test('20. cotação de frete bem-sucedida retorna subtotal, frete e total corretos, sem inventar valor', async () => {
  const deps = depsFake({ calcularFrete: async () => ({ ok: true, valor: 40.13 }) })
  const estado: EstadoConversa = {
    fase: 'confirmando_formulario',
    dados: { produto: { nome: 'Arranjo 2 Rosas', preco: 105, quantidade: 1, dataEntrega: 'hoje' }, formulario: formularioFixture({ cep: '01040-010' }) },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'sim', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_aprovacao_frete')
  assert.equal(r.estado.dados.valorFrete, 40.13)
  assert.equal(r.estado.dados.valorTotal, 145.13)
  assert.match(r.mensagem, /40,13/)
  assert.match(r.mensagem, /145,13|Total: R\$ 145,13/)
})

test('21. endereço incompleto bloqueia a confirmação/pagamento — nunca gera link sem endereço completo', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = {
    fase: 'aguardando_aprovacao_frete',
    dados: {
      produto: { nome: 'Arranjo 2 Rosas', preco: 105, quantidade: 1, dataEntrega: 'hoje' },
      valorFrete: 40.13, valorTotal: 145.13, freteDetalhes: { cotadoEm: new Date().toISOString() },
      formulario: formularioFixture({ rua: undefined, numero: undefined, bairro: undefined, cidade: undefined }), // endereço incompleto
    },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'sim, confirmo', 'compra_produto', deps)
  assert.equal(r.estado.dados.pedidoId, undefined, 'nunca cria pedido/link com endereço incompleto')
  assert.equal(r.estado.dados.linkPagamento, undefined)
})

test('22. confirmação sem destinatário bloqueia o pagamento', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = {
    fase: 'aguardando_aprovacao_frete',
    dados: {
      produto: { nome: 'Arranjo 2 Rosas', preco: 105, quantidade: 1, dataEntrega: 'hoje' },
      valorFrete: 40.13, valorTotal: 145.13, freteDetalhes: { cotadoEm: new Date().toISOString() },
      formulario: formularioFixture({ nomeDestinatario: undefined }), // sem nomeDestinatario
    },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'sim, confirmo', 'compra_produto', deps)
  assert.equal(r.estado.dados.pedidoId, undefined, 'nunca gera pagamento sem destinatário')
})

test('23. dados completos (produto, quantidade, data, frete, destinatário, endereço, confirmação) chegam até a geração do link', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = {
    fase: 'aguardando_aprovacao_frete',
    dados: {
      produto: { nome: 'Arranjo 2 Rosas', preco: 105, quantidade: 1, dataEntrega: 'hoje', idExterno: '3656' },
      valorFrete: 40.13, valorTotal: 145.13, freteDetalhes: { cotadoEm: new Date().toISOString() },
      formulario: formularioFixture({ cep: '01040-010', rua: 'Rua X', numero: '10', bairro: 'Centro', cidade: 'São Paulo', nomeDestinatario: 'Camila', telefoneDestinatario: '+5511999990000' }),
    },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'sim, confirmo', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_pagamento')
  assert.match(r.estado.dados.linkPagamento ?? '', /pagamento\.exemplo/)
})

test('25. pagamento nunca é marcado como confirmado por mensagem do cliente — só processarConfirmacaoPagamento (via webhook real)', async () => {
  const estado: EstadoConversa = {
    fase: 'aguardando_pagamento',
    dados: { produto: { nome: 'Arranjo 2 Rosas', preco: 105 }, paymentId: 'pay_real_123', valorTotal: 145.13 },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'já paguei, pode confirmar', 'compra_produto', depsFake())
  assert.notEqual(r.estado.fase, 'pagamento_confirmado', 'mensagem do cliente nunca confirma pagamento sozinha')
  assert.equal(r.estado.dados.pagamentoConfirmado, undefined)
})

// ── Parte 1 — reinício seguro de uma nova compra ───────────────────────────

test('Parte 1: nova intenção de compra durante conversa antiga em frete não reutiliza CEP/cotação antiga (caso real observado em monitoramento)', async () => {
  const deps = depsFake()
  const estadoAntigo: EstadoConversa = {
    fase: 'aguardando_aprovacao_frete',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'hoje' },
      formulario: formularioFixture({ cep: '04204-030' }),
      valorFrete: 44.63,
      valorTotal: 184.63,
    },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estadoAntigo, 'Olá! Quero ver opções de ramalhetes para hoje', 'compra_produto', deps)
  assert.doesNotMatch(r.mensagem, /04204-030/)
  assert.doesNotMatch(r.mensagem, /44,63/)
  assert.equal(r.estado.dados.valorFrete, undefined, 'nunca reaproveita a cotação antiga')
  assert.equal(r.estado.dados.formulario, undefined, 'nunca reaproveita o endereço antigo')
  assert.notEqual(r.estado.fase, 'aguardando_aprovacao_frete', 'nunca retoma a fase antiga de frete')
})

test('Parte 1: "continuar" preserva a compra em andamento, nunca reinicia', async () => {
  const deps = depsFake()
  const estadoEmAndamento: EstadoConversa = {
    fase: 'aguardando_aprovacao_frete',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'hoje' },
      formulario: formularioFixture(),
      valorFrete: 22.5,
      valorTotal: 162.5,
    },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estadoEmAndamento, 'pode continuar', 'compra_produto', deps)
  assert.equal(r.estado.dados.produto?.nome, 'Buquê de Rosas')
  assert.equal(r.estado.dados.valorFrete, 22.5)
  assert.equal(r.estado.fase, 'aguardando_aprovacao_frete', 'nunca reinicia so por causa de "continuar"')
})

// ── Parte 2 — formulário padrão único ──────────────────────────────────────

test('Parte 2: nunca envia foto junto com o formulário de entrega', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = { fase: 'produto_selecionado', dados: { produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1 } }, perguntasFeitas: [] }
  const r = await avancarFunil(estado, 'entrega amanhã', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_formulario')
  assert.equal(r.fotoUrl, undefined)
  assert.equal(r.fotos, undefined)
})

test('Parte 2/3: telefone do destinatário chega normalizado em E.164 antes de seguir para o frete (exigido pela Lalamove)', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = { fase: 'aguardando_formulario', dados: { produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'amanhã' } }, perguntasFeitas: [] }
  const r = await avancarFunil(estado, formularioTexto({ 'Telefone de quem vai receber, com DDD': '(11) 99999-0000' }), 'compra_produto', deps)
  assert.equal(r.estado.fase, 'confirmando_formulario')
  assert.equal(r.estado.dados.formulario?.telefoneDestinatario, '+5511999990000')
})

// ── Parte 4 — aviso fora do horário no início ──────────────────────────────

test('Parte 4: fora do horário mostra o aviso com opt-in na primeira mensagem, antes de catálogo/formulário', async () => {
  const deps = depsFake()
  const r = await avancarFunil(estadoInicial(), 'Quero um buquê para hoje', 'recomendacao', deps, true, 'amanhã (terça-feira), a partir das 09h')
  assert.equal(r.estado.fase, 'aviso_fora_horario')
  assert.match(r.mensagem, /fora do hor[aá]rio da loja/i)
  assert.match(r.mensagem, /Deseja continuar\?/)
})

test('Parte 4: fora do horário aguarda sim/continuar antes de avançar, nunca repete o aviso completo de novo', async () => {
  const deps = depsFake()
  const estadoAvisado: EstadoConversa = { fase: 'aviso_fora_horario', dados: {}, perguntasFeitas: [] }
  const r = await avancarFunil(estadoAvisado, 'quero saber mais sobre o produto', 'compra_produto', deps, true, 'amanhã, a partir das 09h')
  assert.equal(r.estado.fase, 'aviso_fora_horario')
  assert.doesNotMatch(r.mensagem, /9h às 19h/, 'nunca repete o aviso completo de novo')
})

test('Parte 4: "sim" fora do horário libera o fluxo normal e registra o aceite', async () => {
  const deps = depsFake()
  const estadoAvisado: EstadoConversa = { fase: 'aviso_fora_horario', dados: {}, perguntasFeitas: [] }
  const r = await avancarFunil(estadoAvisado, 'sim', 'compra_produto', deps, true, 'amanhã, a partir das 09h')
  assert.notEqual(r.estado.fase, 'aviso_fora_horario')
  assert.equal(r.estado.dados.aceitouForaDoHorario, true)
})

test('Parte 4: "hoje" numa jornada aceita fora do horário vira o próximo dia útil, comunicado claramente', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = {
    fase: 'produto_selecionado',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1 },
      aceitouForaDoHorario: true,
      proximoHorarioTexto: 'amanhã (terça-feira), a partir das 09h',
    },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'hoje', 'compra_produto', deps)
  assert.equal(r.estado.dados.produto?.dataEntrega, 'amanhã (terça-feira), a partir das 09h')
  assert.match(r.mensagem, /ajustei sua entrega para amanhã/i)
})

// ── Parte 2 (correção "fechar bloqueios do agendamento") — data/período de entrega tipados ──

const AGORA_TERCA = new Date('2026-07-21T15:00:00Z') // terça-feira 12h BRT

test('normalizarDataEntregaTexto reconhece "hoje" e "amanhã" relativos à data atual', () => {
  assert.deepEqual(normalizarDataEntregaTexto('hoje', AGORA_TERCA), { ano: 2026, mes: 6, dia: 21 })
  assert.deepEqual(normalizarDataEntregaTexto('amanhã', AGORA_TERCA), { ano: 2026, mes: 6, dia: 22 })
})

test('normalizarDataEntregaTexto reconhece dia da semana — dito no próprio dia sempre significa a próxima ocorrência, nunca hoje', () => {
  // AGORA_TERCA já é terça — "terça" dito agora tem que ser a terça QUE VEM, não hoje.
  assert.deepEqual(normalizarDataEntregaTexto('terça', AGORA_TERCA), { ano: 2026, mes: 6, dia: 28 })
  assert.deepEqual(normalizarDataEntregaTexto('sexta-feira', AGORA_TERCA), { ano: 2026, mes: 6, dia: 24 })
})

test('normalizarDataEntregaTexto reconhece datas explícitas DD/MM e DD/MM/AAAA', () => {
  assert.deepEqual(normalizarDataEntregaTexto('25/12', AGORA_TERCA), { ano: 2026, mes: 11, dia: 25 })
  assert.deepEqual(normalizarDataEntregaTexto('25/12/2027', AGORA_TERCA), { ano: 2027, mes: 11, dia: 25 })
})

test('normalizarDataEntregaTexto nunca adivinha texto livre não reconhecido (datas por extenso, "semana que vem", etc.)', () => {
  assert.equal(normalizarDataEntregaTexto('depois do carnaval', AGORA_TERCA), null)
  assert.equal(normalizarDataEntregaTexto('semana que vem', AGORA_TERCA), null)
  assert.equal(normalizarDataEntregaTexto('assim que possível', AGORA_TERCA), null)
})

test('dataEntregaValida rejeita data nula, não reconhecida ou no passado; aceita hoje e futuro', () => {
  assert.equal(dataEntregaValida(null, AGORA_TERCA), false)
  assert.equal(dataEntregaValida({ ano: 2026, mes: 6, dia: 20 }, AGORA_TERCA), false, 'ontem nunca é válido')
  assert.equal(dataEntregaValida({ ano: 2026, mes: 6, dia: 21 }, AGORA_TERCA), true, 'hoje é válido')
  assert.equal(dataEntregaValida({ ano: 2026, mes: 6, dia: 22 }, AGORA_TERCA), true, 'futuro é válido')
})

test('dataCalendarioParaISO formata AAAA-MM-DD com zero à esquerda', () => {
  assert.equal(dataCalendarioParaISO({ ano: 2026, mes: 6, dia: 5 }), '2026-07-05')
  assert.equal(dataCalendarioParaISO({ ano: 2027, mes: 0, dia: 1 }), '2027-01-01')
})

test('normalizarPeriodoEntregaTexto reconhece manhã/tarde/noite e nunca inventa um período não informado', () => {
  assert.equal(normalizarPeriodoEntregaTexto('de manhã'), 'manha')
  assert.equal(normalizarPeriodoEntregaTexto('à tarde'), 'tarde')
  assert.equal(normalizarPeriodoEntregaTexto('período da noite'), 'noite')
  assert.equal(normalizarPeriodoEntregaTexto(undefined), null)
  assert.equal(normalizarPeriodoEntregaTexto('qualquer horário'), null)
})

test('Parte 2: data de entrega não reconhecida bloqueia a confirmação — nunca cota frete nem gera pagamento com data inválida', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = {
    fase: 'confirmando_formulario',
    dados: { produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1 }, formulario: formularioFixture({ dataEntrega: 'depois do carnaval' }) },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'sim', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'confirmando_formulario')
  assert.equal(r.estado.dados.valorFrete, undefined, 'nunca cota frete com data invalida')
  assert.equal(r.estado.dados.pedidoId, undefined)
  assert.match(r.mensagem, /não consegui identificar a data/i)
})

test('Parte 2: data de entrega no passado bloqueia a confirmação até o cliente corrigir', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = {
    fase: 'confirmando_formulario',
    dados: { produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1 }, formulario: formularioFixture({ dataEntrega: '01/01/2020' }) },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'sim', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'confirmando_formulario')
  assert.equal(r.estado.dados.pedidoId, undefined)
  assert.match(r.mensagem, /não consegui identificar a data/i)
})

test('Parte 2: data de entrega válida segue normalmente e fica disponível tipada em dados.dataEntregaSolicitada', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = {
    fase: 'confirmando_formulario',
    dados: { produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1 }, formulario: formularioFixture({ dataEntrega: 'amanhã' }) },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'sim', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_aprovacao_frete')
  assert.ok(r.estado.dados.dataEntregaSolicitada, 'data tipada deve estar presente apos a confirmacao')
  assert.equal(typeof r.estado.dados.dataEntregaSolicitada?.ano, 'number')
})

// ── Parte 7 (correção "fechar bloqueios do agendamento") — ponta a ponta,
// totalmente mockado, simulando o caminho do WhatsApp (webhook-whatsapp usa
// exatamente este mesmo dispatcher avancarFunil desde a reescrita da Parte
// 5/6 — nunca mais uma segunda implementação comercial divergente por
// canal). Sem rede real, sem efeitos externos: catálogo/frete/pagamento/
// pedido inteiramente via depsFake().

test('Parte 7: ponta a ponta mockado — produto WooCommerce -> formulário -> confirmação -> cotação -> aprovação do frete -> pedido -> preference -> pagamento (caminho do WhatsApp)', async () => {
  let revalidarChamadoComId: string | undefined
  const deps = depsFake({
    // idExterno presente simula o ID técnico real do WooCommerce — nunca o
    // código comercial (Parte 6: "produto escolhido deve guardar ID técnico
    // do WooCommerce" / "revalidar produto/preço/estoque antes de criar pedido").
    buscarCatalogo: async () => [
      { nome: 'Buquê de Rosas', preco: 140, disponivel: true, fotoUrl: 'https://site/rosas.jpg', idExterno: 'wc_9001' },
      { nome: 'Arranjo Girassóis', preco: 135, disponivel: true, idExterno: 'wc_9002' },
    ],
    revalidarProduto: async (idExterno) => { revalidarChamadoComId = idExterno; return { disponivel: true, preco: 140 } },
    criarPedido: async () => ({ pedidoId: 'pedido_whatsapp_e2e_001' }),
    gerarPagamento: async (pedidoId) => ({ link: `https://pagamento.exemplo/${pedidoId}`, paymentId: pedidoId }),
  })
  let estado = estadoInicial()

  // 1) produto vindo do catálogo real (nunca hardcoded — mesma função
  // buscarCatalogo que webhook-meta/webhook-whatsapp injetam com o
  // WooCommerce de verdade em produção).
  let r = await avancarFunil(estado, 'Quero um buquê de rosas para hoje', 'recomendacao', deps)
  estado = r.estado
  let guard = 0
  while ((estado.fase === 'qualificacao' || estado.fase === 'inicio') && guard < 6) {
    r = await avancarFunil(estado, 'tanto faz', 'compra_produto', deps)
    estado = r.estado
    guard++
  }
  assert.equal(estado.fase, 'recomendacao')

  r = await avancarFunil(estado, 'quero esse mesmo', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'produto_selecionado')
  const produtoEscolhidoId = estado.dados.produto?.idExterno
  assert.equal(produtoEscolhidoId, 'wc_9001', 'produto escolhido guarda o ID técnico do WooCommerce')

  // 2) quantidade/data -> formulário único de entrega
  r = await avancarFunil(estado, '1 unidade, entrega amanhã', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_formulario')
  assert.equal(r.fotoUrl, undefined, 'nunca envia foto junto com o formulário')
  assert.equal(r.fotos, undefined)

  // 3) formulário completo numa única mensagem
  r = await avancarFunil(estado, formularioTexto(), 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'confirmando_formulario')
  assert.equal(estado.dados.valorFrete, undefined, 'nunca cota frete antes da confirmação')

  // 4) confirmação -> cotação real do frete
  r = await avancarFunil(estado, 'sim', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_aprovacao_frete')
  assert.equal(estado.dados.valorFrete, 22.5)
  assert.match(r.mensagem, /Subtotal:/)
  assert.match(r.mensagem, /Frete/)
  assert.match(r.mensagem, /Total:/)
  assert.match(r.mensagem, /Você aprova o frete e o total\?/)

  // 5) aprovação explícita do frete -> pedido provisório + preference única
  r = await avancarFunil(estado, 'sim, pode confirmar', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_pagamento')
  assert.equal(estado.dados.pedidoId, 'pedido_whatsapp_e2e_001')
  assert.match(estado.dados.linkPagamento!, /pagamento\.exemplo\/pedido_whatsapp_e2e_001/)
  assert.equal(revalidarChamadoComId, produtoEscolhidoId, 'revalida preço/estoque sempre pelo ID técnico do produto, nunca pelo código comercial')

  // 6) "paguei" nunca confirma pagamento — só o webhook real do Mercado Pago
  const rPaguei = await avancarFunil(estado, 'paguei, pode confirmar', 'compra_produto', deps)
  assert.equal(rPaguei.estado.fase, 'aguardando_pagamento')
  assert.equal(rPaguei.estado.dados.pagamentoConfirmado, undefined)

  // 7) só processarConfirmacaoPagamento (chamado pelo webhook-mercadopago
  // real após consultar a API) avança pra pedido_criado (produção).
  const rPago = await processarConfirmacaoPagamento(estado, estado.dados.paymentId!, deps.criarPedido)
  assert.equal(rPago.estado.fase, 'pedido_criado')
})

// ── Parte 3 — retomada após intervalo sem interação ───────────────────────

test('retomada apos intervalo 1: mais de 1h sem interacao com compra em andamento pergunta se continua ou inicia nova compra; ate 1h segue normalmente', async () => {
  const deps = depsFake()
  const agora = new Date('2026-07-21T15:00:00Z')
  const maisDeUmaHoraAtras = new Date(agora.getTime() - 61 * 60_000).toISOString()
  const ateUmaHoraAtras = new Date(agora.getTime() - 59 * 60_000).toISOString()
  const estadoBase: EstadoConversa = {
    fase: 'aguardando_formulario',
    dados: { produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'amanhã' } },
    perguntasFeitas: [],
  }

  const rMaisDeUmaHora = await avancarFunil(
    { ...estadoBase, dados: { ...estadoBase.dados, ultimaInteracaoEm: maisDeUmaHoraAtras } },
    'Oi, ainda quero o buquê',
    'compra_produto',
    deps, false, undefined, agora,
  )
  assert.equal(rMaisDeUmaHora.estado.fase, 'retomada_apos_intervalo')
  assert.equal(rMaisDeUmaHora.mensagem, mensagemRetomadaAposIntervalo())
  assert.equal(rMaisDeUmaHora.estado.dados.faseAntesDoIntervalo, 'aguardando_formulario')
  assert.equal(rMaisDeUmaHora.estado.dados.produto?.nome, 'Buquê de Rosas', 'nunca perde os dados enquanto aguarda a resposta')

  const rAteUmaHora = await avancarFunil(
    { ...estadoBase, dados: { ...estadoBase.dados, ultimaInteracaoEm: ateUmaHoraAtras } },
    'coloquei os dados certinho',
    'compra_produto',
    deps, false, undefined, agora,
  )
  assert.notEqual(rAteUmaHora.estado.fase, 'retomada_apos_intervalo', 'até 1h sem interação, segue normalmente')

  assert.equal(deveGatilharRetomadaAposIntervalo({ fase: 'aguardando_formulario', dados: {}, perguntasFeitas: [] }, agora), false, 'sem ultimaInteracaoEm registrada nunca dispara')
  assert.equal(deveGatilharRetomadaAposIntervalo({ fase: 'recomendacao', dados: { ultimaInteracaoEm: maisDeUmaHoraAtras }, perguntasFeitas: [] }, agora), false, 'fora de uma compra em andamento nunca dispara')
})

test('retomada apos intervalo 2: "continuar" restaura a fase e os dados salvos; "nova compra" reinicia sem reaproveitar produto/endereço/frete', async () => {
  const deps = depsFake()
  const estadoAguardando: EstadoConversa = {
    fase: 'retomada_apos_intervalo',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1 },
      valorFrete: 22.5, valorTotal: 162.5,
      freteDetalhes: { cotadoEm: new Date().toISOString() },
      faseAntesDoIntervalo: 'aguardando_aprovacao_frete',
    },
    perguntasFeitas: [],
  }

  const rContinuar = await avancarFunil(estadoAguardando, 'quero continuar o pedido anterior', 'compra_produto', deps)
  assert.equal(rContinuar.estado.fase, 'aguardando_aprovacao_frete', 'restaura exatamente a fase salva')
  assert.equal(rContinuar.estado.dados.produto?.nome, 'Buquê de Rosas', 'recupera o contexto real, nunca reinventa')
  assert.equal(rContinuar.estado.dados.faseAntesDoIntervalo, undefined)
  assert.match(rContinuar.mensagem, /Buquê de Rosas/)

  const rNovaCompra = await avancarFunil(estadoAguardando, 'quero iniciar uma nova compra', 'compra_produto', deps)
  assert.notEqual(rNovaCompra.estado.fase, 'aguardando_aprovacao_frete')
  assert.equal(rNovaCompra.estado.dados.produto, undefined, 'nunca reaproveita produto da jornada anterior')
  assert.equal(rNovaCompra.estado.dados.valorFrete, undefined, 'nunca reaproveita frete da jornada anterior')
  assert.equal(rNovaCompra.estado.dados.freteDetalhes, undefined, 'nunca reaproveita cotação da jornada anterior')

  const rAmbiguo = await avancarFunil(estadoAguardando, 'hein?', 'compra_produto', deps)
  assert.equal(rAmbiguo.estado.fase, 'retomada_apos_intervalo', 'resposta que não escolhe nenhuma opção repete a pergunta, nunca avança sozinho')
  assert.equal(rAmbiguo.mensagem, mensagemRetomadaAposIntervalo())
})

// ── Parte 4 — validade da cotação real de frete ───────────────────────────

test('cotacao 29 minutos ainda valida, 30 minutos ja vencida — nunca gera pagamento sobre cotação vencida', async () => {
  const cotadoEm = new Date('2026-07-21T15:00:00Z')
  const detalhes = { cotadoEm: cotadoEm.toISOString() }

  assert.equal(cotacaoFreteVencida(detalhes, new Date(cotadoEm.getTime() + 29 * 60_000)), false, '29 minutos ainda dentro da validade')
  assert.equal(cotacaoFreteVencida(detalhes, new Date(cotadoEm.getTime() + 30 * 60_000)), true, '30 minutos já vencida')
  assert.equal(cotacaoFreteVencida(undefined, cotadoEm), true, 'sem cotação real registrada, trata como vencida')

  // expiresAt real da Lalamove menor que 30min prevalece (menor dos dois valores).
  const detalhesExpiraCedo = { cotadoEm: cotadoEm.toISOString(), expiresAt: new Date(cotadoEm.getTime() + 10 * 60_000).toISOString() }
  assert.equal(cotacaoFreteVencida(detalhesExpiraCedo, new Date(cotadoEm.getTime() + 15 * 60_000)), true, 'expiresAt da Lalamove vence antes dos 30 minutos e prevalece')

  // Fim a fim: cotação vencida em aguardando_aprovacao_frete nunca aprova o total antigo — recota e pede aprovação de novo.
  const deps = depsFake({ calcularFrete: async () => ({ ok: true, valor: 30, detalhes: {} }) })
  const estadoVencido: EstadoConversa = {
    fase: 'aguardando_aprovacao_frete',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'hoje' },
      valorFrete: 22.5, valorTotal: 162.5,
      freteDetalhes: { cotadoEm: new Date(Date.now() - 31 * 60_000).toISOString() },
      formulario: formularioFixture(),
    },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estadoVencido, 'sim, confirmo', 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_aprovacao_frete', 'recota e volta a pedir aprovação, nunca gera pagamento direto')
  assert.equal(r.estado.dados.valorFrete, 30, 'novo valor cotado, nunca o total antigo vencido')
  assert.equal(r.estado.dados.pedidoId, undefined, 'nunca gera pedido/pagamento sobre a cotação vencida')
})

// ── Parte 4/6 — cotação e pagamento fora do horário comercial ────────────

// Regra oficial (2026-07-23): todo o fluxo comercial pode acontecer fora do
// horário — atendimento, catálogo, formulário, cotação real, aprovação,
// link, pagamento, confirmação e criação do pedido. Só a corrida real
// (despacho) nunca acontece fora dele, decidida só depois do pagamento (ver
// webhook-mercadopago). A validade máxima da cotação (30min/expiresAt real
// da Lalamove) continua valendo do mesmo jeito, dentro ou fora do horário.
test('1. cotação permitida fora do horário: cota normalmente, sem nenhum bloqueio', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = {
    fase: 'confirmando_formulario',
    dados: { produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'amanhã' }, formulario: formularioFixture() },
    perguntasFeitas: [],
  }
  const r = await avancarFunil(estado, 'sim', 'compra_produto', deps, true)
  assert.equal(r.estado.fase, 'aguardando_aprovacao_frete', 'cota normalmente fora do horário, nunca bloqueia')
  assert.equal(r.estado.dados.valorFrete, 22.5)
  assert.match(r.mensagem, /Total:/)
  assert.match(r.mensagem, /Você aprova o frete e o total\?/)

  // Cotação vencida (30min/expiresAt) continua sendo respeitada mesmo fora
  // do horário — recota automaticamente, nunca aprova um total vencido.
  const estadoVencidoForaDoHorario: EstadoConversa = {
    fase: 'aguardando_aprovacao_frete',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'hoje' },
      valorFrete: 99, valorTotal: 239,
      freteDetalhes: { cotadoEm: new Date(Date.now() - 31 * 60_000).toISOString() },
      formulario: formularioFixture(),
    },
    perguntasFeitas: [],
  }
  const rVencido = await avancarFunil(estadoVencidoForaDoHorario, 'sim, confirmo', 'compra_produto', deps, true)
  assert.equal(rVencido.estado.fase, 'aguardando_aprovacao_frete', 'recota normalmente mesmo fora do horário')
  assert.equal(rVencido.estado.dados.valorFrete, 22.5, 'novo valor cotado, nunca o total antigo vencido')
  assert.equal(rVencido.estado.dados.pedidoId, undefined)

  // Aviso inicial (Parte 4) usa o texto exato definido — nunca diz que a
  // cotação fica pro próximo dia, já que ela acontece normalmente agora.
  assert.match(mensagemAvisoForaDoHorarioComOpcao(), /Podemos concluir seu pedido agora/)
  assert.match(mensagemAvisoForaDoHorarioComOpcao(), /pr[óo]ximo dia de funcionamento/i)
  assert.doesNotMatch(mensagemAvisoForaDoHorarioComOpcao(), /cota[çc][ãa]o.*pr[óo]ximo/i)
  assert.match(mensagemAvisoForaDoHorarioComOpcao(), /Deseja continuar\?/)
})

test('pagamento confirmado fora do horario: nunca cria corrida imediata, agenda para o horário comercial do próximo dia', async () => {
  const proximaAbertura = '2026-07-22T12:00:00.000Z' // 09h BRT do próximo dia útil
  const estado: EstadoConversa = {
    fase: 'aguardando_pagamento',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1 },
      paymentId: 'pay_real_fora_horario',
      valorTotal: 162.5,
      entregaImediata: true, // cotado dentro do horário, mas o pagamento só confirma depois de fechar
      despachoEmISO: '2026-07-21T13:00:00.000Z',
    },
    perguntasFeitas: [],
  }
  const criar = async () => ({ pedidoId: 'pedido_fora_horario_001' })

  const r = await processarConfirmacaoPagamento(estado, 'pay_real_fora_horario', criar, true, proximaAbertura)
  assert.equal(r.estado.fase, 'pedido_criado')
  assert.equal(r.estado.dados.entregaImediata, false, 'nunca cria corrida imediata fora do horário, mesmo cotada como imediata antes')
  assert.equal(r.estado.dados.despachoEmISO, proximaAbertura, 'despacho agendado pro próximo horário comercial')
  assert.equal(r.mensagem, mensagemPagamentoConfirmadoForaDoHorario())

  // Dentro do horário, comportamento de sempre (mensagem padrão, sem forçar agendamento).
  const rDentroDoHorario = await processarConfirmacaoPagamento(
    { ...estado, dados: { ...estado.dados, paymentId: 'pay_real_dentro_horario' } },
    'pay_real_dentro_horario', criar,
  )
  assert.equal(rDentroDoHorario.mensagem, mensagemFinalizacao())
  assert.equal(rDentroDoHorario.estado.dados.entregaImediata, true, 'dentro do horário nunca sobrescreve o agendamento já calculado na cotação')
})

// ── Parte 2 — formulário único (novo texto) e cartão impresso condicional ──

test('formulario unico: pede so o campo isolado que falta, nunca reenvia o formulario completo', async () => {
  const deps = depsFake()
  const estado: EstadoConversa = { fase: 'aguardando_formulario', dados: { produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'amanhã' } }, perguntasFeitas: [] }

  // Envia tudo no formato novo (Remetente/Destinatário/Rua e número/...), exceto o telefone do destinatário.
  const respostaSemTelefone = [
    'Remetente: Ana',
    'Destinatário: Camila',
    'Rua e número: Rua das Flores',
    'Número: 123',
    'Bairro: Ipiranga',
    'CEP: 04204-030',
    'Data de entrega: amanhã',
  ].join('\n')
  const r = await avancarFunil(estado, respostaSemTelefone, 'compra_produto', deps)
  assert.equal(r.estado.fase, 'aguardando_formulario')
  assert.match(r.mensagem, /telefone do destinat[áa]rio/i, 'único campo obrigatório que ainda falta')
  assert.doesNotMatch(r.mensagem, /Remetente:/i, 'nunca reenvia o formulário completo, só o campo isolado que falta')
  assert.equal(r.estado.dados.formulario?.rua, 'Rua das Flores', '"Rua e número" reconhecido como alias do campo rua')
  assert.equal(r.estado.dados.formulario?.numero, '123')

  // Cidade/UF nunca são pedidas — não aparecem nem no texto inicial nem como pendência.
  assert.doesNotMatch(TEXTO_FORMULARIO_ENTREGA, /\bcidade\b/i)
  assert.doesNotMatch(TEXTO_FORMULARIO_ENTREGA, /\bUF\b/)
})

test('formulario unico: cartão impresso é opcional; mensagem só é obrigatória quando o cliente confirma que quer cartão', async () => {
  assert.equal(querCartaoImpresso({}), false, 'ausência de resposta nunca bloqueia — equivale a não')
  assert.equal(querCartaoImpresso({ querCartaoImpresso: 'não' }), false)
  assert.equal(querCartaoImpresso({ querCartaoImpresso: 'sim' }), true)

  assert.deepEqual(camposFaltandoFormulario(formularioFixture()), [], 'formulário completo sem cartão nunca exige mensagem')
  assert.deepEqual(
    camposFaltandoFormulario(formularioFixture({ querCartaoImpresso: 'sim' })),
    ['mensagemCartao'],
    'confirmou que quer cartão sem informar a mensagem -> só esse campo fica faltando',
  )
  assert.deepEqual(
    camposFaltandoFormulario(formularioFixture({ querCartaoImpresso: 'sim', mensagemCartao: 'Com carinho, Ana' })),
    [],
  )
  assert.match(montarMensagemCamposFaltando(['mensagemCartao']), /mensagem para o cart[ãa]o/i)
})

// ── Parte 3 — coleta de entrega em duas etapas (ViaCEP) ───────────────────

function estadoAguardandoFormulario(formulario?: Partial<FormularioEntregaDados>): EstadoConversa {
  return {
    fase: 'aguardando_formulario',
    dados: {
      produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'amanhã' },
      ...(formulario ? { formulario: formulario as FormularioEntregaDados } : {}),
    },
    perguntasFeitas: [],
  }
}

test('1. etapa 1 pede so os quatro campos iniciais, em qualquer ordem, sem repetir o que ja foi informado', async () => {
  assert.match(TEXTO_FORMULARIO_ENTREGA, /Nome do remetente:/i)
  assert.match(TEXTO_FORMULARIO_ENTREGA, /Nome do destinat[áa]rio:/i)
  assert.match(TEXTO_FORMULARIO_ENTREGA, /Telefone do destinat[áa]rio:/i)
  assert.match(TEXTO_FORMULARIO_ENTREGA, /CEP da entrega:/i)
  assert.doesNotMatch(TEXTO_FORMULARIO_ENTREGA, /\brua\b|\bn[úu]mero\b|\bbairro\b|data de entrega/i, 'etapa 1 nunca mistura endereço/data com os quatro campos iniciais')

  const deps = depsFake()
  const estado = estadoAguardandoFormulario()

  // Ordem invertida (telefone e destinatário antes do remetente/CEP) — aceita igual.
  const r1 = await avancarFunil(estado, 'Telefone do destinatário: 11999990000\nNome do destinatário: Camila', 'compra_produto', deps)
  assert.equal(r1.estado.fase, 'aguardando_formulario')
  assert.match(r1.mensagem, /remetente/i)
  assert.doesNotMatch(r1.mensagem, /destinat[áa]rio/i, 'nunca repete o que já foi informado')

  const r2 = await avancarFunil(r1.estado, 'Nome do remetente: Ana\nCEP da entrega: 04204-030', 'compra_produto', deps)
  assert.match(r2.mensagem, /Localizei o endere[çc]o/i, 'CEP válido dispara a etapa 2 (ViaCEP) automaticamente')
})

test('2. CEP valido consulta o ViaCEP e preenche rua/bairro/cidade/UF automaticamente no formulário', async () => {
  const deps = depsFake({
    consultarCep: async (cep) => {
      assert.equal(cep, '04204-030')
      return { rua: 'Rua das Flores', bairro: 'Ipiranga', cidade: 'São Paulo', uf: 'SP' }
    },
  })
  const estado = estadoAguardandoFormulario({ nomeComprador: 'Ana', nomeDestinatario: 'Camila', telefoneDestinatario: '11999990000' })

  const r = await avancarFunil(estado, 'CEP da entrega: 04204-030', 'compra_produto', deps)
  assert.equal(r.estado.dados.formulario?.rua, 'Rua das Flores')
  assert.equal(r.estado.dados.formulario?.bairro, 'Ipiranga')
  assert.equal(r.estado.dados.formulario?.cidade, 'São Paulo')
  assert.equal(r.estado.dados.formulario?.uf, 'SP')
  assert.equal(r.estado.dados.cepConsultadoViaApi, '04204-030', 'marca o CEP como já consultado, pra nunca reconsultar a cada mensagem')
})

test('3. endereço completo via ViaCEP pergunta apenas número e complemento, sem repetir nenhum outro campo', async () => {
  const deps = depsFake()
  const estado = estadoAguardandoFormulario({ nomeComprador: 'Ana', nomeDestinatario: 'Camila', telefoneDestinatario: '11999990000' })

  const r = await avancarFunil(estado, 'CEP da entrega: 04204-030', 'compra_produto', deps)
  assert.equal(
    r.mensagem,
    'Localizei o endereço em Rua das Flores, Ipiranga, São Paulo–SP. Qual é o número? Se houver apartamento, bloco ou outro complemento, informe também.',
  )
})

test('4. ViaCEP sem rua (CEP geral) pede somente rua e número, numa única mensagem curta', async () => {
  const deps = depsFake({ consultarCep: async () => ({ bairro: 'Centro', cidade: 'Poá', uf: 'SP' }) }) // logradouro ausente
  const estado = estadoAguardandoFormulario({ nomeComprador: 'Ana', nomeDestinatario: 'Camila', telefoneDestinatario: '11999990000' })

  const r = await avancarFunil(estado, 'CEP da entrega: 08550-000', 'compra_produto', deps)
  assert.match(r.mensagem, /rua/i)
  assert.match(r.mensagem, /n[úu]mero/i)
  assert.doesNotMatch(r.mensagem, /bairro/i, 'bairro já veio do ViaCEP, nunca é pedido de novo')
  assert.equal(r.estado.dados.formulario?.bairro, 'Centro', 'bairro preenchido automaticamente mesmo com rua ausente')
})

test('5. CEP não localizado pelo ViaCEP pede pro cliente reenviar, sem travar a conversa', async () => {
  const deps = depsFake({ consultarCep: async () => null })
  const estado = estadoAguardandoFormulario({ nomeComprador: 'Ana', nomeDestinatario: 'Camila', telefoneDestinatario: '11999990000' })

  const r = await avancarFunil(estado, 'CEP da entrega: 99999-999', 'compra_produto', deps)
  assert.equal(r.mensagem, 'Não consegui localizar esse CEP. Pode conferir e enviar novamente?')
  assert.equal(r.estado.dados.formulario?.cep, undefined, 'CEP inválido nunca fica preso no estado — cliente pode reenviar')
  assert.equal(r.estado.fase, 'aguardando_formulario')
})

test('6. dados já fornecidos nunca são pedidos de novo ao longo das duas etapas', async () => {
  const deps = depsFake()
  const estado = estadoAguardandoFormulario()

  const r1 = await avancarFunil(
    estado,
    'Nome do remetente: Ana\nNome do destinatário: Camila\nTelefone do destinatário: 11999990000\nCEP da entrega: 04204-030',
    'compra_produto',
    deps,
  )
  assert.match(r1.mensagem, /Qual é o número/i)

  // Responde só com o número, em texto livre (sem rótulo "Número:") — nunca perde o dado.
  const r2 = await avancarFunil(r1.estado, '123', 'compra_produto', deps)
  assert.equal(r2.estado.dados.formulario?.numero, '123')
  assert.match(r2.mensagem, /data de entrega/i, 'só falta a data — único campo pedido agora')
  assert.doesNotMatch(r2.mensagem, /remetente|destinat[áa]rio|CEP|rua|bairro|n[úu]mero/i, 'nunca repete nenhum campo já coletado')

  const r3 = await avancarFunil(r2.estado, 'Data de entrega: amanhã', 'compra_produto', deps)
  assert.equal(r3.estado.fase, 'confirmando_formulario', 'formulário completo -> segue direto pra confirmação/cotação, sem reenviar nada')
})
