// Simulações de conversa completa (início -> escolha -> recomendação ->
// coleta de dados -> confirmação -> retomada após pausa -> aprovação de
// frete -> pagamento), generalizando o padrão de loop limitado já usado em
// funil.test.ts (bounded while na qualificação) para cobrir a jornada
// inteira, não só um trecho isolado. Valida especificamente que: o fluxo
// avança, nenhum dado é perdido, a Flora nunca repete uma pergunta já
// respondida, não existe loop, e o cliente consegue concluir usando
// linguagem natural — inclusive formulações nunca cadastradas em nenhuma
// lista fixa (via a camada de interpretação contextual, fatia 1).
//
// Rodar: npm run test (dentro de orchestrator/)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avancarFunil, estadoInicial, type EstadoConversa } from './funil.js'
import { depsFake, formularioTexto, criarInterpretadorFake } from './funil.test-helpers.js'

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

test('conversa completa 1: pausa de mais de 1h no meio do fluxo, cliente retoma em linguagem natural inédita, chega até a aprovação de pagamento sem perder nenhum dado', async () => {
  const interpretarIntencao = criarInterpretadorFake([
    {
      quando: (msg) => /retomar|de onde paramos|terminar o que/i.test(msg),
      resultado: { intencaoPrimaria: 'continuar_pedido_anterior', intencoesSecundarias: [], entidades: {}, camposParaAtualizar: [], confianca: 'alta', evidenciaContextual: 'cliente pediu pra retomar', acaoRecomendada: 'continuar', precisaEsclarecimento: false },
    },
  ])
  const deps = depsFake({ interpretarIntencao })

  const { estado: estadoEscolha } = await avancarAteEscolherProduto(estadoInicial(), 'Queria um buquê pro aniversário da minha esposa', deps)
  assert.notEqual(estadoEscolha.fase, 'qualificacao', 'sai da qualificação sem travar')

  let r = await avancarFunil(estadoEscolha, 'Fico com o buquê de rosas', 'compra_produto', deps)
  let estado = r.estado
  assert.equal(estado.dados.produto?.nome, 'Buquê de Rosas', 'produto escolhido corretamente')

  r = await avancarFunil(estado, '1', 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, 'amanhã', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_formulario', 'avança pro formulário depois de quantidade + data, nunca repete pergunta já respondida')

  r = await avancarFunil(estado, formularioTexto(), 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'confirmando_formulario')
  assert.equal(estado.dados.formulario?.nomeDestinatario, 'Camila')

  // ── Pausa real de mais de 1h ──
  const antesDaPausa = new Date('2026-08-03T10:00:00Z')
  const depoisDaPausa = new Date('2026-08-03T12:30:00Z')
  estado = { ...estado, dados: { ...estado.dados, ultimaInteracaoEm: antesDaPausa.toISOString() } }

  r = await avancarFunil(estado, 'oi, quero retomar de onde paramos', 'compra_produto', deps, false, undefined, depoisDaPausa)
  estado = r.estado
  assert.equal(estado.fase, 'retomada_apos_intervalo', 'gate de retomada dispara depois de 1h+ sem interação')

  r = await avancarFunil(estado, 'quero terminar o que eu tinha começado', 'compra_produto', deps, false, undefined, depoisDaPausa)
  estado = r.estado
  assert.equal(estado.fase, 'confirmando_formulario', 'retoma exatamente a fase salva, mesmo com formulação inédita, via interpretação contextual')
  assert.equal(estado.dados.formulario?.nomeDestinatario, 'Camila', 'nenhum dado do formulário foi perdido durante a pausa')
  assert.equal(estado.dados.produto?.nome, 'Buquê de Rosas', 'produto preservado durante a pausa')

  r = await avancarFunil(estado, 'sim, pode confirmar', 'compra_produto', deps, false, undefined, depoisDaPausa)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_aprovacao_frete', 'confirma o formulário e avança pra cotação de frete real')

  r = await avancarFunil(estado, 'sim', 'compra_produto', deps, false, undefined, depoisDaPausa)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_pagamento', 'aprova o frete e chega até o pagamento')
  assert.ok(estado.dados.linkPagamento, 'link de pagamento real foi gerado')
  assert.equal(estado.dados.pedidoId, 'pedido_fake_001', 'pedido criado uma única vez (sem duplicar)')
})

test('conversa completa 2: fluxo inteiro sem interrupção, do início ao pagamento, usando só linguagem natural (sem nenhuma frase exata cadastrada)', async () => {
  const deps = depsFake()
  const { estado: estadoEscolha } = await avancarAteEscolherProduto(estadoInicial(), 'Preciso de flores pra hoje, minha mãe faz aniversário', deps)

  let r = await avancarFunil(estadoEscolha, 'Vou querer esse aí mesmo, o buquê de rosas', 'compra_produto', deps)
  let estado = r.estado
  assert.equal(estado.dados.produto?.nome, 'Buquê de Rosas')

  r = await avancarFunil(estado, '1', 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, 'pode ser amanhã de manhã', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_formulario')

  r = await avancarFunil(estado, formularioTexto({ 'Data desejada para entrega': 'amanhã de manhã' }), 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'confirmando_formulario', 'formulário completo reconhecido mesmo com data em linguagem natural')

  r = await avancarFunil(estado, 'tá certo, perfeito', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_aprovacao_frete', '"tá certo, perfeito" reconhecido como confirmação')

  r = await avancarFunil(estado, 'fechado, pode gerar', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_pagamento', 'chega até o pagamento só com linguagem natural do início ao fim')
})

test('conversa completa 3: correção de um campo depois da confirmação substitui só o campo corrigido, nunca reinicia o fluxo', async () => {
  const deps = depsFake()
  const { estado: estadoEscolha } = await avancarAteEscolherProduto(estadoInicial(), 'Quero um arranjo para o escritório', deps)

  let r = await avancarFunil(estadoEscolha, 'Arranjo Girassóis', 'compra_produto', deps)
  let estado = r.estado
  r = await avancarFunil(estado, '2', 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, 'depois de amanhã', 'compra_produto', deps)
  estado = r.estado
  r = await avancarFunil(estado, formularioTexto(), 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'confirmando_formulario')

  // Mudança de ideia: corrige só o destinatário, sem confirmar nem cancelar.
  r = await avancarFunil(estado, 'quem vai receber é a Fernanda', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.dados.formulario?.nomeDestinatario, 'a Fernanda', 'corrige só o campo mencionado')
  assert.equal(estado.dados.formulario?.nomeComprador, 'Ana', 'campos não mencionados permanecem intactos')
  assert.equal(estado.dados.formulario?.cep, '04204-030', 'CEP permanece intacto')
  assert.equal(estado.fase, 'confirmando_formulario', 'correção nunca reinicia o fluxo nem avança sozinha')

  r = await avancarFunil(estado, 'agora sim, confirmo', 'compra_produto', deps)
  estado = r.estado
  assert.equal(estado.fase, 'aguardando_aprovacao_frete', 'depois da correção, confirmação normal avança o fluxo')
  assert.equal(estado.dados.produto?.quantidade, 2, 'quantidade escolhida antes da correção permanece')
})
