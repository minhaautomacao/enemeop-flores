// Origem: recuperado da versão implantada no projeto Supabase da Fábrica
// (ebeapnydeiwuewxatuuw, slug marketing-scraping, v1) em 2026-07-10.
// Nunca esteve versionado em nenhum repositório Git antes desta migração.
// Sem alteração de lógica — só reposicionamento de repositório.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const HEADERS_HTTP = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Accept': 'text/html,application/xhtml+xml',
}

type TipoScraping = 'concorrente' | 'google_local' | 'hashtag_instagram'

interface ScrapingRequest {
  tipo: TipoScraping
  url?: string
  query?: string
  hashtag?: string
  cidade?: string
  seletores?: {
    produto: string
    nome: string
    preco: string
    disponivel?: string
    imagem?: string
    link?: string
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' },
    })
  }

  try {
    const body: ScrapingRequest = await req.json()
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const coletado_em = new Date().toISOString()
    let resultado: Record<string, unknown> = { coletado_em }

    if (body.tipo === 'concorrente' && body.url) {
      resultado = await rasparConcorrente(body.url, body.seletores)
    } else if (body.tipo === 'google_local') {
      resultado = await rasparGoogleLocal(body.query || 'floricultura', body.cidade || 'São Paulo')
    } else if (body.tipo === 'hashtag_instagram' && body.hashtag) {
      resultado = await rasparHashtagInstagram(body.hashtag)
    } else {
      return new Response(JSON.stringify({ erro: 'Parâmetros inválidos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Salva resultado no Supabase para histórico
    await supabase.from('scraping_resultados').insert({
      tipo: body.tipo,
      parametros: body,
      resultado,
      coletado_em,
    }).then() // não bloqueia resposta em caso de erro de inserção

    return new Response(JSON.stringify(resultado), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ erro: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

// --- Scrapers ---

async function rasparConcorrente(
  url: string,
  seletores?: ScrapingRequest['seletores']
): Promise<Record<string, unknown>> {
  const sel = seletores ?? { produto: '.product, .item-produto', nome: 'h2, h3, .nome', preco: '.price, .preco, [class*=preco]' }
  try {
    const html = await fetch(url, { headers: HEADERS_HTTP }).then(r => r.text())
    const produtos = extrairProdutosComRegex(html, sel)
    return { url, produtos, total: produtos.length, coletado_em: new Date().toISOString() }
  } catch (err) {
    return { url, produtos: [], erro: String(err), coletado_em: new Date().toISOString() }
  }
}

async function rasparGoogleLocal(query: string, cidade: string): Promise<Record<string, unknown>> {
  const q = encodeURIComponent(`${query} ${cidade}`)
  const url = `https://www.google.com/search?q=${q}&hl=pt-BR&gl=BR&num=10`
  try {
    const html = await fetch(url, { headers: HEADERS_HTTP }).then(r => r.text())
    const resultados = extrairResultadosGoogle(html)
    return { query, cidade, resultados, total: resultados.length, coletado_em: new Date().toISOString() }
  } catch (err) {
    return { query, cidade, resultados: [], erro: String(err), coletado_em: new Date().toISOString() }
  }
}

async function rasparHashtagInstagram(hashtag: string): Promise<Record<string, unknown>> {
  const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/`
  try {
    const html = await fetch(url, { headers: HEADERS_HTTP }).then(r => r.text())
    const posts = extrairPostsInstagram(html)
    return { hashtag, posts, total: posts.length, coletado_em: new Date().toISOString() }
  } catch (err) {
    return { hashtag, posts: [], erro: String(err), coletado_em: new Date().toISOString() }
  }
}

// --- Parsers via regex (sem dependência externa) ---

function extrairProdutosComRegex(
  html: string,
  seletores: NonNullable<ScrapingRequest['seletores']>
): Array<{ nome: string; preco?: string }> {
  // Extração simplificada de meta tags og:title + og:price
  const produtos: Array<{ nome: string; preco?: string }> = []
  const ogTitles = html.matchAll(/property="og:title"[^>]*content="([^"]+)"/g)
  const ogPrices = [...html.matchAll(/property="product:price:amount"[^>]*content="([^"]+)"/g)]
  let i = 0
  for (const match of ogTitles) {
    produtos.push({ nome: match[1], preco: ogPrices[i]?.[1] })
    i++
  }
  // Fallback: título da página como produto único
  if (produtos.length === 0) {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/)
    if (titleMatch) produtos.push({ nome: titleMatch[1] })
  }
  return produtos
}

function extrairResultadosGoogle(
  html: string
): Array<{ titulo: string; url: string; snippet: string }> {
  const resultados: Array<{ titulo: string; url: string; snippet: string }> = []
  // Extrai h3 seguidos de href
  const matches = html.matchAll(/<h3[^>]*>([^<]+)<\/h3>[\s\S]{0,500}?href="(\/url\?q=([^&"]+))/g)
  for (const m of matches) {
    try {
      resultados.push({
        titulo: m[1].replace(/<[^>]+>/g, '').trim(),
        url: decodeURIComponent(m[3]),
        snippet: '',
      })
    } catch { /* ignora URLs inválidas */ }
  }
  return resultados.slice(0, 10)
}

function extrairPostsInstagram(
  html: string
): Array<{ texto: string; shortcode?: string; tem_intencao_compra: boolean }> {
  const posts: Array<{ texto: string; shortcode?: string; tem_intencao_compra: boolean }> = []
  const sharedData = html.match(/window\._sharedData\s*=\s*(\{.+?\});/s)
  if (!sharedData) return posts

  try {
    const data = JSON.parse(sharedData[1])
    const edges =
      data?.entry_data?.TagPage?.[0]?.graphql?.hashtag?.edge_hashtag_to_media?.edges ?? []
    for (const edge of edges) {
      const node = edge.node
      const texto = node?.edge_media_to_caption?.edges?.[0]?.node?.text ?? ''
      posts.push({
        shortcode: node.shortcode,
        texto,
        tem_intencao_compra: detectarIntencaoCompra(texto),
      })
    }
  } catch { /* JSON inválido */ }

  return posts
}

function detectarIntencaoCompra(texto: string): boolean {
  const palavras = [
    'quero comprar', 'quanto custa', 'tem disponível', 'onde comprar',
    'preciso de', 'orçamento', 'encomenda', 'entreg', 'preço',
    'alguém indica', 'boa floricultura', 'flores para',
  ]
  const lower = texto.toLowerCase()
  return palavras.some(p => lower.includes(p))
}
