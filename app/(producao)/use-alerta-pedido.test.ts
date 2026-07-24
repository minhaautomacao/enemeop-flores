// Rodar: npx tsx --test "app/(producao)/use-alerta-pedido.test.ts"

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularNovos, numerosAgendados } from './use-alerta-pedido.ts'

test('primeira carga: todos contam como novos em relacao a um Set vazio', () => {
  assert.deepEqual(calcularNovos([1, 2, 3], new Set()), [1, 2, 3])
})

test('pedido ja visto nunca conta como novo de novo — alerta nunca repete pro mesmo pedido', () => {
  assert.deepEqual(calcularNovos([1, 2, 3], new Set([1, 2, 3])), [])
})

test('so os pedidos realmente novos aparecem, mesmo misturados com ja vistos', () => {
  assert.deepEqual(calcularNovos([1, 2, 3, 4], new Set([1, 2])), [3, 4])
})

test('lista vazia nunca gera novos', () => {
  assert.deepEqual(calcularNovos([], new Set([1, 2])), [])
})

// ── numerosAgendados — alerta de pedidos pagos fora do horário ───────────

test('numerosAgendados extrai so os pedidos com status_logistica agendada, vindos direto da resposta do banco', () => {
  const pedidos = [
    { numero_pedido: 101, status_logistica: 'agendada' },
    { numero_pedido: 102, status_logistica: 'criada' },
    { numero_pedido: 103, status_logistica: 'agendada' },
    { numero_pedido: 104, status_logistica: null },
    { numero_pedido: 105, status_logistica: 'pendente' },
  ]
  assert.deepEqual(numerosAgendados(pedidos), [101, 103])
})

test('numerosAgendados nunca inclui numero_pedido invalido/ausente', () => {
  const pedidos = [
    { numero_pedido: 'abc', status_logistica: 'agendada' },
    { numero_pedido: null, status_logistica: 'agendada' },
    { status_logistica: 'agendada' },
  ]
  assert.deepEqual(numerosAgendados(pedidos), [])
})

test('numerosAgendados com lista vazia nunca gera agendados', () => {
  assert.deepEqual(numerosAgendados([]), [])
})

// 6. painel mostra pedido pago/agendado após novo login — simula duas
// "cargas de página" (login inicial + reload/novo login depois) sobre a
// MESMA fonte de verdade (resposta do banco), nunca dependendo de um
// estado em memória perdido entre sessões: a lista de agendados nunca
// desaparece só porque a página foi recarregada/reaberta.
test('6. painel mostra pedido pago/agendado apos novo login (fonte e sempre o banco, nunca so localStorage)', () => {
  const respostaBanco = [
    { numero_pedido: 201, status_logistica: 'agendada' },
    { numero_pedido: 202, status_logistica: 'pendente' },
  ]

  // Primeiro login: painel calcula os agendados diretamente da resposta.
  const agendadosPrimeiroLogin = numerosAgendados(respostaBanco)
  assert.deepEqual(agendadosPrimeiroLogin, [201])

  // "Novo login" (nova sessão de navegador, sem nenhum estado em memória
  // anterior) — a mesma resposta do banco continua produzindo a mesma
  // lista de agendados, independente de qualquer localStorage local.
  const agendadosNovoLogin = numerosAgendados(respostaBanco)
  assert.deepEqual(agendadosNovoLogin, [201], 'pedido agendado continua aparecendo apos um novo login')

  // O alerta sonoro (dedup local) nunca decide quais pedidos existem — só
  // decide se o bipe já tocou. Simula: no novo login, um Set de "vistos"
  // vazio (ex.: outro navegador/perfil) ainda assim mostra o pedido 201.
  const vistosDeOutroNavegador = new Set<number>()
  assert.deepEqual(calcularNovos(agendadosNovoLogin, vistosDeOutroNavegador), [201])
})
