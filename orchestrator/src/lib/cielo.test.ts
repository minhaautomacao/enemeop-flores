// Testes do adaptador Cielo (lib/cielo.ts) — mocka fetch, nunca chama a API
// real nem usa credenciais reais (regra explícita do pedido de integração).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gerarLinkPagamentoCielo } from './cielo.js'

test('gerarLinkPagamentoCielo: sem credenciais configuradas, falha sem chamar rede', async () => {
  const originalId = process.env.CIELO_CLIENT_ID
  const originalSecret = process.env.CIELO_CLIENT_SECRET
  delete process.env.CIELO_CLIENT_ID
  delete process.env.CIELO_CLIENT_SECRET

  const originalFetch = globalThis.fetch
  let chamouRede = false
  globalThis.fetch = (async () => { chamouRede = true; throw new Error('não deveria chamar rede') }) as typeof fetch

  try {
    const resultado = await gerarLinkPagamentoCielo({ numeroPedido: 'p1', item: { nome: 'Teste', valorCentavos: 100 } })
    assert.equal(resultado.criado, false)
    assert.equal(chamouRede, false)
  } finally {
    globalThis.fetch = originalFetch
    if (originalId) process.env.CIELO_CLIENT_ID = originalId
    if (originalSecret) process.env.CIELO_CLIENT_SECRET = originalSecret
  }
})

test('gerarLinkPagamentoCielo: com credenciais (fake) e resposta real simulada, devolve link e linkId', async () => {
  process.env.CIELO_CLIENT_ID = 'fake-client-id'
  process.env.CIELO_CLIENT_SECRET = 'fake-client-secret'

  const originalFetch = globalThis.fetch
  // @ts-expect-error mock simples para o teste
  globalThis.fetch = async (url: string, init: RequestInit) => {
    if (String(url).includes('/token')) {
      return new Response(JSON.stringify({ access_token: 'fake-token' }), { status: 200 })
    }
    if (String(url).includes('/products/')) {
      const body = JSON.parse(String(init.body))
      assert.equal(body.Cart.Items[0].UnitPrice, 14000) // R$140,00 em centavos, nunca alterado pelo adaptador
      return new Response(JSON.stringify({ id: 'link_123', url: 'https://cielo.example/pay/abc', shortUrl: 'https://cielo.example/s/abc' }), { status: 200 })
    }
    throw new Error(`URL inesperada: ${url}`)
  }

  try {
    const resultado = await gerarLinkPagamentoCielo({ numeroPedido: 'pedido_001', item: { nome: 'Buquê de Rosas', valorCentavos: 14000 } })
    assert.equal(resultado.criado, true)
    assert.equal(resultado.linkId, 'link_123')
    assert.equal(resultado.link, 'https://cielo.example/s/abc')
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.CIELO_CLIENT_ID
    delete process.env.CIELO_CLIENT_SECRET
  }
})

test('gerarLinkPagamentoCielo: falha HTTP da Cielo nao trava, devolve criado=false com erro', async () => {
  process.env.CIELO_CLIENT_ID = 'fake-client-id'
  process.env.CIELO_CLIENT_SECRET = 'fake-client-secret'

  const originalFetch = globalThis.fetch
  // @ts-expect-error mock simples para o teste
  globalThis.fetch = async (url: string) => {
    if (String(url).includes('/token')) return new Response(JSON.stringify({ access_token: 'fake-token' }), { status: 200 })
    return new Response('erro interno', { status: 500 })
  }

  try {
    const resultado = await gerarLinkPagamentoCielo({ numeroPedido: 'pedido_002', item: { nome: 'X', valorCentavos: 100 } })
    assert.equal(resultado.criado, false)
    assert.match(resultado.erro ?? '', /HTTP 500/)
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.CIELO_CLIENT_ID
    delete process.env.CIELO_CLIENT_SECRET
  }
})
