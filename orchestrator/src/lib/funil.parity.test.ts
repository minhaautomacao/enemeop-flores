// Teste de paridade — garante que supabase/functions/_shared/funil.ts (cópia
// Deno-compatível do núcleo puro do funil) nunca diverge de
// orchestrator/src/lib/funil.ts (fonte Node). Ver o comentário no topo do
// arquivo Deno para a decisão de arquitetura completa: como Edge Functions
// (Deno) e o orchestrator (Node/Render) são bundles de deploy independentes,
// a "fonte única" é garantida por este teste, não por um grafo de import
// compartilhado entre os dois runtimes.
//
// Se este teste falhar: alguém editou um dos dois arquivos sem replicar a
// mudança no outro. Corrija copiando o conteúdo de funil.ts para dentro do
// bloco final de _shared/funil.ts (tudo depois do comentário de cabeçalho).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import * as nucleoNode from './funil.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('nucleo Deno (_shared/funil.ts) esta em paridade com a fonte Node (funil.ts)', () => {
  const nodeSource = readFileSync(join(__dirname, 'funil.ts'), 'utf8')
  const denoSource = readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'functions', '_shared', 'funil.ts'), 'utf8')

  assert.ok(
    denoSource.endsWith(nodeSource),
    'supabase/functions/_shared/funil.ts deve terminar com o conteúdo exato (caractere por caractere) de orchestrator/src/lib/funil.ts — copie a fonte Node para dentro do bloco final do arquivo Deno.'
  )
})

// Paridade COMPORTAMENTAL, não só textual: o núcleo Deno não usa nenhuma API
// específica de Deno (zero imports), então tsx consegue executá-lo
// diretamente como um módulo TypeScript comum — isso prova que o código
// realmente roda igual nos dois runtimes, não só que os arquivos são
// idênticos como texto.
test('nucleo Deno (_shared/funil.ts) produz exatamente os mesmos resultados que a fonte Node, para os mesmos cenarios', async () => {
  const denoPath = join(__dirname, '..', '..', '..', 'supabase', 'functions', '_shared', 'funil.ts')
  const nucleoDeno = await import(pathToFileURL(denoPath).href)

  const cenarios = [
    ['Queria um buquê para o aniversário da minha esposa', 'inicio'],
    ['quero flores e também queria saber sobre futebol', 'inicio'],
    ['o que você acha do governo atual?', 'recomendacao'],
    ['meu pedido não chegou', 'pedido_criado'],
    ['quero falar com uma pessoa', 'recomendacao'],
    ['isso e um reclamaçã, muito ruim', 'qualificacao'],
    ['oi', 'aguardando_pagamento'],
  ] as const

  for (const [mensagem, fase] of cenarios) {
    assert.equal(
      nucleoDeno.classificarIntencao(mensagem, fase),
      nucleoNode.classificarIntencao(mensagem, fase),
      `classificarIntencao diverge entre Node e Deno para "${mensagem}" na fase ${fase}`
    )
  }

  const estadoNode = nucleoNode.estadoInicial()
  const estadoDeno = nucleoDeno.estadoInicial()
  assert.deepEqual(estadoDeno, estadoNode)

  const deps = {
    buscarCatalogo: async () => [{ nome: 'Buquê de Rosas', preco: 140, disponivel: true, codigo: 'R1', url: 'https://site/r1' }],
    buscarCategorias: async () => [],
    buscarProdutosPorCategoria: async () => [],
    revalidarProduto: async () => ({ disponivel: true }),
    calcularFrete: async () => ({ ok: true as const, valor: 22.5 }),
    consultarCep: async () => ({ rua: 'Rua das Flores', bairro: 'Ipiranga', cidade: 'São Paulo', uf: 'SP' }),
    calcularAgendamento: (dataEntrega: { ano: number; mes: number; dia: number }) => {
      const iso = new Date(Date.UTC(dataEntrega.ano, dataEntrega.mes, dataEntrega.dia, 12, 0)).toISOString()
      return { entregaPrometidaEmISO: iso, despachoEmISO: iso, imediato: true }
    },
    gerarPagamento: async (pedidoId: string) => ({ link: `https://pag/${pedidoId}`, paymentId: pedidoId }),
    criarPedido: async () => ({ pedidoId: 'pedido_x' }),
    buscarFormasPagamento: async () => ['Pix'],
  }

  // agora fixo e idêntico nas duas chamadas — avancarFunil grava
  // ultimaInteracaoEm (Parte 3) com o instante real por padrão, e duas
  // chamadas em momentos ligeiramente diferentes produziriam ISO strings
  // diferentes, uma divergência de timing e não de comportamento real.
  const agoraFixo = new Date('2026-07-21T15:00:00Z')
  const rNode = await nucleoNode.avancarFunil(estadoNode, 'Quero flores para minha mãe', 'recomendacao', deps, false, undefined, agoraFixo)
  const rDeno = await nucleoDeno.avancarFunil(estadoDeno, 'Quero flores para minha mãe', 'recomendacao', deps, false, undefined, agoraFixo)
  assert.deepEqual(rDeno, rNode)
})
