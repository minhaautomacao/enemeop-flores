// Testes do adaptador de frete real (lib/frete.ts) — mocka fetch (ViaCEP +
// Melhor Envio), nunca faz chamada de rede real. Cobre a seção 7/9 do
// pedido de integração: frete usa retorno estruturado, nunca estima.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const ENV_KEYS = ['STORE_CEP', 'STORE_CITY', 'STORE_STATE'] as const

function comEnvDeLoja<T>(fn: () => Promise<T>): Promise<T> {
  process.env.STORE_CEP = '04101-000'
  process.env.STORE_CITY = 'São Paulo'
  process.env.STORE_STATE = 'SP'
  return fn()
}

function limparEnvDeLoja(): void {
  for (const k of ENV_KEYS) delete process.env[k]
}

test('calcularFreteReal: sem STORE_CEP/CITY/STATE configurados, falha sem chamar rede', async () => {
  limparEnvDeLoja()
  const originalFetch = globalThis.fetch
  let chamouRede = false
  globalThis.fetch = (async () => { chamouRede = true; throw new Error('não deveria chamar rede') }) as typeof fetch
  try {
    const mod = await import(`./frete.js?t=${Date.now()}-a`)
    const resultado = await mod.calcularFreteReal('04204-030', 140)
    assert.equal(resultado.ok, false)
    assert.equal(chamouRede, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('calcularFreteReal: retorno estruturado real (ViaCEP + Melhor Envio) escolhe a opção mais barata', async () => {
  const originalFetch = globalThis.fetch
  // @ts-expect-error mock simples para o teste
  globalThis.fetch = async (url: string) => {
    if (String(url).includes('viacep.com.br')) {
      return new Response(JSON.stringify({ localidade: 'São Paulo', uf: 'SP' }), { status: 200 })
    }
    if (String(url).includes('melhorenvio.com.br')) {
      return new Response(JSON.stringify([
        { id: 1, price: '35.90', company: { id: 1, name: 'Correios' } },
        { id: 2, price: '22.50', company: { id: 2, name: 'Jadlog' } },
        { id: 3, price: '18.00', error: 'sem cobertura', company: { id: 3, name: 'X' } },
      ]), { status: 200 })
    }
    throw new Error(`URL inesperada no teste: ${url}`)
  }
  try {
    await comEnvDeLoja(async () => {
      const mod = await import(`./frete.js?t=${Date.now()}-b`)
      const resultado = await mod.calcularFreteReal('04204-030', 140)
      assert.equal(resultado.ok, true)
      assert.equal(resultado.valor, 22.5) // ignora a opção com erro, escolhe a mais barata válida
    })
  } finally {
    globalThis.fetch = originalFetch
    limparEnvDeLoja()
  }
})

test('calcularFreteReal: ViaCEP não resolve o endereço -> falha, nunca estima', async () => {
  const originalFetch = globalThis.fetch
  // @ts-expect-error mock simples para o teste
  globalThis.fetch = async (url: string) => {
    if (String(url).includes('viacep.com.br')) {
      return new Response(JSON.stringify({ erro: true }), { status: 200 })
    }
    throw new Error('não deveria chamar Melhor Envio sem resolver o CEP antes')
  }
  try {
    await comEnvDeLoja(async () => {
      const mod = await import(`./frete.js?t=${Date.now()}-c`)
      const resultado = await mod.calcularFreteReal('00000-000', 140)
      assert.equal(resultado.ok, false)
    })
  } finally {
    globalThis.fetch = originalFetch
    limparEnvDeLoja()
  }
})

test('calcularFreteReal: Melhor Envio so retorna opcoes com erro -> falha, nunca estima', async () => {
  const originalFetch = globalThis.fetch
  // @ts-expect-error mock simples para o teste
  globalThis.fetch = async (url: string) => {
    if (String(url).includes('viacep.com.br')) {
      return new Response(JSON.stringify({ localidade: 'São Paulo', uf: 'SP' }), { status: 200 })
    }
    if (String(url).includes('melhorenvio.com.br')) {
      return new Response(JSON.stringify([{ id: 1, price: '0', error: 'sem cobertura', company: { id: 1, name: 'X' } }]), { status: 200 })
    }
    throw new Error(`URL inesperada: ${url}`)
  }
  try {
    await comEnvDeLoja(async () => {
      const mod = await import(`./frete.js?t=${Date.now()}-d`)
      const resultado = await mod.calcularFreteReal('04204-030', 140)
      assert.equal(resultado.ok, false)
    })
  } finally {
    globalThis.fetch = originalFetch
    limparEnvDeLoja()
  }
})
