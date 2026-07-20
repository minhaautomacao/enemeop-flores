// Rodar: npx tsx --test "app/(producao)/use-alerta-pedido.test.ts"

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularNovos } from './use-alerta-pedido.ts'

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
