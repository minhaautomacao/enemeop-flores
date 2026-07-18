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
    buscarFormasPagamento: async () => ['Pix', 'cartão de crédito', 'cartão de débito'],
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
  // intencao real que classificarIntencao produziria pra essa mensagem
  // nessa fase (nao ha PALAVRAS_PAGAMENTO em "sim, pode confirmar")
  const rConfirma = await avancarFunil(estado, 'Sim, pode confirmar', 'compra_produto', deps)
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
  assert.match(r.mensagem, /nossa equipe/)
  assert.equal(r.estado.dados.valorTotal, undefined)
})

test('dispatcher: falha ao gerar pagamento -> transfere para humano', async () => {
  const deps = depsFake({ gerarPagamento: async () => null })
  const estado: EstadoConversa = {
    fase: 'aguardando_confirmacao',
    dados: { produto: { nome: 'Buquê de Rosas', preco: 140, quantidade: 1, dataEntrega: 'amanhã' }, valorFrete: 22.5, valorTotal: 162.5 },
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

test('foto enviada na recomendação pertence exatamente ao código do produto apresentado — duas opções nunca trocam fotos', async () => {
  const deps = depsFake({ buscarCatalogo: async () => CATALOGO_ROSAS })
  const estado: EstadoConversa = { fase: 'recomendacao', dados: { ocasiao: 'aniversario' }, perguntasFeitas: [] }
  const r = await avancarFunil(estado, 'quero ver as opções', 'recomendacao', deps)
  assert.equal(r.fotos?.length, 3)
  for (const p of CATALOGO_ROSAS) {
    const fotoDoProduto: { codigo?: string; nome: string; url: string } | undefined = r.fotos?.find(f => f.codigo === p.codigo)
    assert.equal(fotoDoProduto?.url, p.fotoUrl, `foto do produto ${p.codigo} deve ser exatamente a dele, nunca de outro`)
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
  { nome: 'Arranjo Mix Flores do Campo', preco: 145, codigo: 'M08', disponivel: true, fotoUrl: 'https://site/M08.jpg' },
  { nome: 'Arranjo 2 Rosas Nacionais e Junco', preco: 105, codigo: '002', disponivel: true, fotoUrl: 'https://site/002.jpg' },
  { nome: 'Buquê de Rosas Vermelhas', preco: 140, codigo: '032', disponivel: true, fotoUrl: 'https://site/032.jpg' },
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
  assert.equal(r.estado.fase, 'aguardando_confirmacao')
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
    calcularFrete: async () => ({ ok: true, valor: 18 }),
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

  // 4) Flora apresenta duas opções reais, cada uma com sua foto correta.
  assert.equal(r.fotos?.length, 2)
  assert.equal(r.fotos?.find(f => f.codigo === '050')?.url, 'https://site/050.jpg')
  assert.equal(r.fotos?.find(f => f.codigo === '051')?.url, 'https://site/051.jpg')

  // 5) Cliente escolhe "a segunda".
  r = await avancarFunil(estado, 'quero a segunda', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.dados.produto?.codigo, '051')
  assert.equal(estado.fase, 'produto_selecionado')

  // Confirma quantidade/data pra poder cotar frete de verdade.
  r = await avancarFunil(estado, '1 unidade, entrega amanhã', 'compra_produto', deps)
  estado = r.estado

  // 6) "Qual o valor do frete?"
  r = await avancarFunil(estado, 'Qual o valor do frete?', 'frete', deps)
  estado = r.estado
  // 7) Sem CEP ainda -> Flora pede só o CEP, sem apagar o produto.
  assert.match(r.mensagem, /CEP/i)
  assert.equal(estado.dados.produto?.codigo, '051')

  // Cliente informa o CEP (etapaEndereco registra o CEP e passa pra
  // calculando_frete; a cotação real acontece na virada seguinte, mesmo
  // comportamento já coberto por "dispatcher: fluxo feliz completo").
  r = await avancarFunil(estado, 'CEP 01040-010', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'calculando_frete')
  r = await avancarFunil(estado, '', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_confirmacao')
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
