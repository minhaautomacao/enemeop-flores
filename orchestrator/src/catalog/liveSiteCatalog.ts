/**
 * Catálogo ao vivo — Enemeop Flores
 *
 * Fonte primária: WooCommerce REST API (JSON estruturado, latência ~200ms)
 * Fallback: scraping HTML (somente se API indisponível, com regras estritas)
 *
 * Regras obrigatórias:
 *  - Produto só é sugerido se vier da API OU se a página individual foi lida com sucesso
 *  - Cores só são mencionadas se vierem de atributos do produto (API) ou da descrição da página
 *  - Flores/composição só se vierem da descrição
 *  - Se nenhuma fonte retornar produtos válidos → [] → sdr.ts dispara fallback + REQUER_ESCALADA
 *
 * Variáveis de ambiente:
 *   WOOCOMMERCE_API_URL              https://www.enemeopflores.com.br/wp-json/wc/v3
 *   WOOCOMMERCE_CONSUMER_KEY         ck_...
 *   WOOCOMMERCE_CONSUMER_SECRET      cs_...
 *   LIVE_CATALOG_CACHE_TTL_SECONDS   TTL do cache em segundos (default: 120)
 */

import { parse } from 'node-html-parser'

// ── Constantes ────────────────────────────────────────────────────────────────

const BASE_SITE_URL        = 'https://www.enemeopflores.com.br'
const API_TIMEOUT_MS       = 8_000
const CATEGORY_TIMEOUT_MS  = 10_000
const DETAIL_TIMEOUT_MS    = 8_000
const MAX_FROM_CATEGORY    = 12
const MAX_TO_DETAIL        = 5
const API_PER_PAGE         = 15

function getCacheTTL(): number {
  const raw = process.env.LIVE_CATALOG_CACHE_TTL_SECONDS
  const parsed = raw ? parseInt(raw, 10) : NaN
  return isNaN(parsed) || parsed < 0 ? 120_000 : parsed * 1_000
}

function getWooConfig(): { url: string; key: string; secret: string } | null {
  const url    = process.env.WOOCOMMERCE_API_URL?.trim()
  const key    = process.env.WOOCOMMERCE_CONSUMER_KEY?.trim()
  const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET?.trim()
  if (!url || !key || !secret) return null
  return { url, key, secret }
}

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type LiveProduct = {
  name: string
  url: string
  price?: number
  description?: string
  colors: string[]
  flowers: string[]
  category?: string
}

export type SearchLiveProductsParams = {
  query: string
  occasion?: string
  budget?: number
  color?: string
  limit?: number
}

// ── Tipo interno WooCommerce ──────────────────────────────────────────────────

interface WooAttribute {
  id: number
  name: string
  slug: string
  options: string[]
}

interface WooCategory {
  id: number
  name: string
  slug: string
}

interface WooProduct {
  id: number
  name: string
  permalink: string
  status: string
  price: string
  regular_price: string
  sale_price: string
  short_description: string
  description: string
  categories: WooCategory[]
  attributes: WooAttribute[]
}

// ── Log estruturado ───────────────────────────────────────────────────────────

type CatalogLogLevel = 'INFO' | 'WARN' | 'ERROR'

function log(level: CatalogLogLevel, event: string, data?: Record<string, unknown>): void {
  const entry = { ts: new Date().toISOString(), src: 'Catalog', level, event, ...data }
  if (level === 'ERROR') console.error(JSON.stringify(entry))
  else if (level === 'WARN') console.warn(JSON.stringify(entry))
  else console.log(JSON.stringify(entry))
}

// ── Cache em memória (por processo) ──────────────────────────────────────────

const _cache = new Map<string, { data: LiveProduct[]; ts: number }>()

function cacheGet(key: string): LiveProduct[] | null {
  const entry = _cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > getCacheTTL()) { _cache.delete(key); return null }
  return entry.data
}

function cacheSet(key: string, data: LiveProduct[]): void {
  _cache.set(key, { data, ts: Date.now() })
}

// Cache de categorias WooCommerce (carregado 1x por processo)
let _wooCategories: Map<string, number> | null = null

// ── Mapeamento ocasião → slugs de categoria ───────────────────────────────────

const OCCASION_CATEGORIES: Array<{ keys: string[]; paths: string[] }> = [
  { keys: ['noiva', 'casamento'],
    paths: ['/categoria/buques-de-noiva/'] },
  { keys: ['namorad', 'namorado', 'namorada', 'amor', 'valentine', 'paixão', 'paixao'],
    paths: ['/categoria/buques-de-flores/', '/categoria/ramalhetes/'] },
  { keys: ['mãe', 'mae', 'mamã', 'mama', 'minha mãe', 'para minha mae'],
    paths: ['/categoria/maternidade/', '/categoria/arranjos-florais/'] },
  { keys: ['maternidade', 'bebê', 'bebe', 'nasciment', 'recém-nascid', 'recem-nascid'],
    paths: ['/categoria/maternidade/'] },
  { keys: ['luto', 'faleciment', 'condolênc', 'condolencia', 'velório', 'velorio', 'enterro', 'funeral'],
    paths: ['/categoria/condolencias/'] },
  { keys: ['aniversário', 'aniversario', 'parabéns', 'parabens', 'aniver'],
    paths: ['/categoria/arranjos-florais/', '/categoria/buques-de-flores/'] },
  { keys: ['orquídea', 'orquidea', 'orquídeas', 'orquideas', 'phalaenopsis'],
    paths: ['/categoria/arranjos-de-orquidea/', '/categoria/plantadas/'] },
  { keys: ['kit', 'cesta', 'vinho', 'chocolate', 'presente com chocolat'],
    paths: ['/categoria/kits/'] },
  { keys: ['corporativo', 'empresa', 'escritório', 'escritorio'],
    paths: ['/categoria/arranjos-florais/'] },
]

const DEFAULT_CATEGORY_PATHS = [
  '/categoria/arranjos-florais/',
  '/categoria/buques-de-flores/',
  '/categoria/ramalhetes/',
]

const COLOR_ATTR_SLUGS = new Set(['pa_cor', 'pa_cores', 'cor', 'cores', 'color', 'colours', 'colour'])
const COLOR_ATTR_NAMES = new Set(['cor', 'cores', 'color', 'colours', 'couleur'])

const COLORS_PT = [
  'branca', 'branco', 'vermelha', 'vermelho', 'rosa', 'pink', 'cor-de-rosa',
  'amarela', 'amarelo', 'laranja', 'lilás', 'lilas', 'roxa', 'roxo',
  'colorida', 'colorido', 'mista', 'misto', 'multicolor', 'natural',
]

const FLOWERS_PT = [
  'rosa', 'rosas', 'girassol', 'girassóis', 'girassois',
  'alstroemêria', 'alstroemeria', 'alstroemérias', 'alstromerias',
  'orquídea', 'orquidea', 'orquídeas', 'orquideas',
  'lírio', 'lirio', 'lírios', 'lirios',
  'tulipa', 'tulipas',
  'hortênsia', 'hortensia', 'hortênsias',
  'lisianthus', 'ruscus', 'calla', 'callas', 'snapdragon', 'junco',
  'flores do campo', 'flores desidratadas', 'flores secas',
  'pelúcia', 'pelucia', 'ferrero',
]

// ── Utilitários de texto ──────────────────────────────────────────────────────

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => {
      const cp = parseInt(code, 10)
      if ((cp >= 0x202A && cp <= 0x202E) || (cp >= 0x2066 && cp <= 0x2069)) return ''
      return String.fromCharCode(cp)
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => {
      const cp = parseInt(code, 16)
      if ((cp >= 0x202A && cp <= 0x202E) || (cp >= 0x2066 && cp <= 0x2069)) return ''
      return String.fromCharCode(cp)
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim()
}

function extractColors(text: string): string[] {
  const lower = text.toLowerCase()
  return [...new Set(COLORS_PT.filter(c => lower.includes(c)))]
}

function extractFlowers(text: string): string[] {
  const lower = text.toLowerCase()
  return [...new Set(FLOWERS_PT.filter(f => lower.includes(f)))]
}

function parsePrice(rawText: string): number | undefined {
  const noEntities = rawText.replace(/&[^;]{1,10};/g, ' ')
  const stripped = noEntities
    .replace(/[^\d.,]/g, '')
    .replace(/\.(?=\d{3}[,])/g, '')
    .replace(',', '.')
  const n = parseFloat(stripped)
  return isNaN(n) || n <= 0 ? undefined : n
}

function selectCategoryPaths(params: SearchLiveProductsParams): string[] {
  const text = `${params.query} ${params.occasion ?? ''}`.toLowerCase()
  const paths = new Set<string>()
  for (const { keys, paths: catPaths } of OCCASION_CATEGORIES) {
    if (keys.some(k => text.includes(k))) catPaths.forEach(p => paths.add(p))
  }
  if (paths.size === 0) DEFAULT_CATEGORY_PATHS.forEach(p => paths.add(p))
  return Array.from(paths).slice(0, 2)
}

function pathToSlug(path: string): string {
  return path.replace('/categoria/', '').replace(/\//g, '')
}

function scoreProduct(
  p: { name: string; price?: number; colors?: string[]; description?: string; category: string },
  params: SearchLiveProductsParams,
): number {
  let score = 0
  const name  = p.name.toLowerCase()
  const query = params.query.toLowerCase()
  for (const word of query.split(/\s+/)) {
    if (word.length > 3 && name.includes(word)) score += 2
  }
  if (params.budget && p.price) {
    if (p.price <= params.budget)       score += 4
    if (p.price <= params.budget * 0.8) score += 2
    if (p.price > params.budget * 1.25) score -= 4
  }
  if (params.color) {
    const cl = params.color.toLowerCase()
    if (name.includes(cl))                                   score += 5
    if (p.colors?.some(c => c.includes(cl)))                 score += 3
    if ((p.description ?? '').toLowerCase().includes(cl))    score += 2
  }
  return score
}

// ── WooCommerce API client ────────────────────────────────────────────────────

interface FetchJsonResult<T> {
  data: T | null
  timedOut: boolean
  httpStatus?: number
  error?: string
}

async function fetchJson<T>(url: string, headers: Record<string, string>, timeoutMs: number): Promise<FetchJsonResult<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, headers })
    clearTimeout(timer)
    if (!res.ok) {
      log('WARN', 'api_http_error', { url, status: res.status })
      return { data: null, timedOut: false, httpStatus: res.status }
    }
    const data = await res.json() as T
    return { data, timedOut: false, httpStatus: res.status }
  } catch (e) {
    clearTimeout(timer)
    const isAbort = e instanceof Error && e.name === 'AbortError'
    const msg     = e instanceof Error ? e.message : String(e)
    if (isAbort) {
      log('WARN', 'api_timeout', { url, timeout_ms: timeoutMs })
      return { data: null, timedOut: true, error: 'timeout' }
    }
    log('ERROR', 'api_fetch_error', { url, error: msg })
    return { data: null, timedOut: false, error: msg }
  }
}

function buildWooHeaders(key: string, secret: string): Record<string, string> {
  const encoded = Buffer.from(`${key}:${secret}`).toString('base64')
  return {
    'Authorization': `Basic ${encoded}`,
    'Accept': 'application/json',
    'User-Agent': 'EnemeoPFlores-SDR/2.0',
  }
}

async function loadWooCategories(apiUrl: string, headers: Record<string, string>): Promise<Map<string, number>> {
  if (_wooCategories) return _wooCategories
  const url = `${apiUrl}/products/categories?per_page=100`
  const { data } = await fetchJson<WooCategory[]>(url, headers, API_TIMEOUT_MS)
  const map = new Map<string, number>()
  if (data) {
    for (const c of data) map.set(c.slug, c.id)
    log('INFO', 'woo_categories_loaded', { count: data.length })
  }
  _wooCategories = map
  return map
}

// ── Extração de cores e flores da resposta da API ────────────────────────────

function colorsFromWooProduct(product: WooProduct): string[] {
  // Prioridade 1: atributos estruturados do produto
  for (const attr of product.attributes) {
    const slug = attr.slug.toLowerCase()
    const name = attr.name.toLowerCase()
    if (COLOR_ATTR_SLUGS.has(slug) || COLOR_ATTR_NAMES.has(name)) {
      if (attr.options.length > 0) {
        return attr.options.map(o => o.toLowerCase().trim())
      }
    }
  }
  // Prioridade 2: descrição/short_description da página
  const text = stripHtml(`${product.short_description} ${product.description}`)
  return extractColors(text)
}

function flowersFromWooProduct(product: WooProduct): string[] {
  const text = stripHtml(`${product.short_description} ${product.description}`)
  return extractFlowers(text)
}

function mapWooToLiveProduct(p: WooProduct): LiveProduct {
  const shortDesc = stripHtml(p.short_description).substring(0, 500)
  const longDesc  = stripHtml(p.description).substring(0, 500)
  const description = (shortDesc || longDesc) || undefined

  const priceNum = parsePrice(p.sale_price || p.price || p.regular_price)
  const category = p.categories[0]?.slug ?? ''

  return {
    name:        decodeHtmlEntities(p.name),
    url:         p.permalink,
    price:       priceNum,
    description,
    colors:      colorsFromWooProduct(p),
    flowers:     flowersFromWooProduct(p),
    category,
  }
}

// ── Busca via WooCommerce REST API ────────────────────────────────────────────

async function searchViaApi(
  params: SearchLiveProductsParams,
  cfg: { url: string; key: string; secret: string },
): Promise<LiveProduct[]> {
  const t0      = Date.now()
  const headers = buildWooHeaders(cfg.key, cfg.secret)
  const limit   = params.limit ?? 3

  const catMap    = await loadWooCategories(cfg.url, headers)
  const catPaths  = selectCategoryPaths(params)
  const catSlugs  = catPaths.map(pathToSlug)
  const catIds    = catSlugs.map(s => catMap.get(s)).filter((id): id is number => id !== undefined)

  log('INFO', 'api_search_start', {
    query:      params.query,
    occasion:   params.occasion,
    budget:     params.budget,
    color:      params.color,
    categories: catSlugs,
    cat_ids:    catIds,
  })

  const rawProducts: WooProduct[] = []
  const calls: Array<Promise<void>> = []

  if (catIds.length > 0) {
    // Uma chamada por categoria (máx 2)
    for (const catId of catIds.slice(0, 2)) {
      const url = `${cfg.url}/products?category=${catId}&per_page=${API_PER_PAGE}&status=publish&orderby=menu_order&order=asc`
      calls.push(
        fetchJson<WooProduct[]>(url, headers, API_TIMEOUT_MS).then(({ data, timedOut, error, httpStatus }) => {
          if (!data) {
            log('WARN', 'api_category_failed', { cat_id: catId, timedOut, error, httpStatus })
            return
          }
          log('INFO', 'api_category_ok', { cat_id: catId, count: data.length, latency_ms: Date.now() - t0 })
          rawProducts.push(...data)
        })
      )
    }
  } else {
    // Sem categoria mapeada — usar busca por texto
    const searchTerm = params.query.split(/\s+/).filter(w => w.length > 3).slice(0, 3).join(' ')
    const url = `${cfg.url}/products?search=${encodeURIComponent(searchTerm)}&per_page=${API_PER_PAGE}&status=publish`
    calls.push(
      fetchJson<WooProduct[]>(url, headers, API_TIMEOUT_MS).then(({ data, timedOut, error, httpStatus }) => {
        if (!data) {
          log('WARN', 'api_search_failed', { search: searchTerm, timedOut, error, httpStatus })
          return
        }
        log('INFO', 'api_search_ok', { search: searchTerm, count: data.length, latency_ms: Date.now() - t0 })
        rawProducts.push(...data)
      })
    )
  }

  await Promise.all(calls)

  if (rawProducts.length === 0) {
    log('WARN', 'api_no_products', { elapsed_ms: Date.now() - t0 })
    return []
  }

  // Deduplica por ID, mapeia para LiveProduct, pontua e retorna top N
  const seen = new Set<number>()
  const candidates: LiveProduct[] = []
  for (const p of rawProducts) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    candidates.push(mapWooToLiveProduct(p))
  }

  const final = candidates
    .map(p => ({ p, score: scoreProduct({ name: p.name, price: p.price, colors: p.colors, description: p.description, category: p.category ?? '' }, params) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ p }) => p)

  log('INFO', 'api_search_done', {
    catalog_source:    'woocommerce_api',
    products_found:    candidates.length,
    products_returned: final.length,
    api_latency_ms:    Date.now() - t0,
  })

  return final
}

// ── Fallback: scraping HTML (regras estritas) ────────────────────────────────

interface RawProduct {
  name: string
  url: string
  price?: number
  category: string
}

interface FetchHtmlResult {
  html: string | null
  timedOut: boolean
  httpStatus?: number
  error?: string
}

async function fetchHtml(url: string, timeoutMs: number): Promise<FetchHtmlResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'EnemeoPFlores-SDR/2.0 (catalog-reader)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
    clearTimeout(timer)
    if (!res.ok) {
      log('WARN', 'scrape_http_error', { url, status: res.status })
      return { html: null, timedOut: false, httpStatus: res.status }
    }
    return { html: await res.text(), timedOut: false, httpStatus: res.status }
  } catch (e) {
    clearTimeout(timer)
    const isAbort = e instanceof Error && e.name === 'AbortError'
    const msg     = e instanceof Error ? e.message : String(e)
    if (isAbort) {
      log('WARN', 'scrape_timeout', { url, timeout_ms: timeoutMs })
      return { html: null, timedOut: true, error: 'timeout' }
    }
    log('ERROR', 'scrape_fetch_error', { url, error: msg })
    return { html: null, timedOut: false, error: msg }
  }
}

function parseCategoryPage(html: string, categorySlug: string): RawProduct[] {
  const root    = parse(html)
  const results: RawProduct[] = []
  const items   = root.querySelectorAll('li.product')
  log('INFO', 'scrape_category_found', { slug: categorySlug, count: items.length })

  for (const item of items.slice(0, MAX_FROM_CATEGORY)) {
    const link  = item.querySelector('a.woocommerce-LoopProduct-link')
    const title = item.querySelector('.woocommerce-loop-product__title')
    const salePriceEl    = item.querySelector('.price ins .woocommerce-Price-amount bdi')
    const regularPriceEl = item.querySelector('.price .woocommerce-Price-amount bdi')
    const priceEl        = salePriceEl ?? regularPriceEl

    const url  = link?.getAttribute('href')?.trim()
    const name = decodeHtmlEntities(title?.innerText?.trim() ?? '')
    if (!url || !name) continue

    results.push({
      name,
      url,
      price: priceEl ? parsePrice(priceEl.innerText) : undefined,
      category: categorySlug,
    })
  }
  return results
}

async function fetchProductDetailScrape(raw: RawProduct): Promise<LiveProduct | null> {
  log('INFO', 'scrape_page_open', { name: raw.name, url: raw.url })
  const { html, timedOut, error, httpStatus } = await fetchHtml(raw.url, DETAIL_TIMEOUT_MS)

  if (!html) {
    log('WARN', 'scrape_page_skipped', {
      name: raw.name,
      reason: timedOut ? 'timeout' : 'http_error',
      httpStatus,
      error,
    })
    return null
  }

  const root = parse(html)
  const salePriceEl    = root.querySelector('.entry-summary .price ins .woocommerce-Price-amount bdi')
  const regularPriceEl = root.querySelector('.entry-summary .price .woocommerce-Price-amount bdi')
  const priceEl        = salePriceEl ?? regularPriceEl
  const price          = priceEl ? parsePrice(priceEl.innerText) : raw.price

  const shortDescRaw = root.querySelector('.woocommerce-product-details__short-description')?.innerText?.trim()
  const longDescRaw  = root.querySelector('#tab-description')?.innerText?.trim()
                    ?? root.querySelector('.woocommerce-Tabs-panel--description')?.innerText?.trim()

  const description = decodeHtmlEntities(shortDescRaw || longDescRaw || '')
    .replace(/\s+/g, ' ').trim().substring(0, 500) || undefined

  // Cores e flores: SOMENTE da descrição da página individual
  const pageText = description ?? ''

  const detail: LiveProduct = {
    name:        raw.name,
    url:         raw.url,
    price,
    description,
    colors:      extractColors(pageText),
    flowers:     extractFlowers(pageText),
    category:    raw.category,
  }

  log('INFO', 'scrape_page_read', {
    catalog_source: 'scraping_fallback',
    name:     detail.name,
    price:    detail.price,
    colors:   detail.colors,
    flowers:  detail.flowers,
    has_desc: !!detail.description,
  })

  return detail
}

async function searchViaScraping(params: SearchLiveProductsParams): Promise<LiveProduct[]> {
  const t0        = Date.now()
  const limit     = params.limit ?? 3
  const catPaths  = selectCategoryPaths(params)

  log('INFO', 'scrape_search_start', {
    query:      params.query,
    categories: catPaths,
    fallback_used: true,
  })

  const categoryResults = await Promise.allSettled(
    catPaths.map(async path => {
      const url = `${BASE_SITE_URL}${path}`
      const { html, timedOut, error, httpStatus } = await fetchHtml(url, CATEGORY_TIMEOUT_MS)
      if (!html) {
        log('WARN', 'scrape_category_failed', { path, timedOut, error, httpStatus })
        return []
      }
      return parseCategoryPage(html, pathToSlug(path))
    })
  )

  const rawProducts: RawProduct[] = []
  for (const r of categoryResults) {
    if (r.status === 'fulfilled') rawProducts.push(...r.value)
    else log('ERROR', 'scrape_category_rejected', { reason: String(r.reason) })
  }

  if (rawProducts.length === 0) {
    log('WARN', 'scrape_no_products', { elapsed_ms: Date.now() - t0 })
    return []
  }

  const topCandidates = rawProducts
    .map(p => ({ p, score: scoreProduct(p, params) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TO_DETAIL)

  log('INFO', 'scrape_candidates_selected', {
    total_found:   rawProducts.length,
    pages_to_open: topCandidates.length,
    top_names:     topCandidates.map(c => c.p.name),
  })

  const t1 = Date.now()
  const detailResults = await Promise.allSettled(
    topCandidates.map(({ p }) => fetchProductDetailScrape(p))
  )
  const detailElapsed = Date.now() - t1

  const detailed: LiveProduct[] = []
  let pagesSkipped = 0
  for (const r of detailResults) {
    if (r.status === 'fulfilled') {
      if (r.value !== null) detailed.push(r.value)
      else pagesSkipped++
    } else {
      log('WARN', 'scrape_detail_rejected', { reason: String(r.reason) })
    }
  }

  log('INFO', 'scrape_detail_done', {
    pages_opened:  topCandidates.length,
    pages_ok:      detailed.length,
    pages_skipped: pagesSkipped,
    elapsed_ms:    detailElapsed,
  })

  if (detailed.length === 0) {
    log('WARN', 'scrape_no_detail_loaded', { elapsed_ms: Date.now() - t0 })
    return []
  }

  const final = detailed
    .map(p => ({ p, score: scoreProduct({ name: p.name, price: p.price, colors: p.colors, description: p.description, category: p.category ?? '' }, params) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ p }) => p)

  log('INFO', 'scrape_search_done', {
    catalog_source:    'scraping_fallback',
    products_found:    detailed.length,
    products_returned: final.length,
    fallback_used:     true,
    elapsed_ms:        Date.now() - t0,
  })

  return final
}

// ── Função principal exportada ────────────────────────────────────────────────

export async function searchLiveProductsFromSite(
  params: SearchLiveProductsParams,
): Promise<LiveProduct[]> {
  const t0       = Date.now()
  const cacheKey = JSON.stringify(params)
  const cached   = cacheGet(cacheKey)

  if (cached) {
    log('INFO', 'cache_hit', {
      query:        params.query,
      cached_count: cached.length,
      ttl_s:        Math.round(getCacheTTL() / 1000),
    })
    return cached
  }

  log('INFO', 'search_start', {
    query:    params.query,
    occasion: params.occasion,
    budget:   params.budget,
    color:    params.color,
    limit:    params.limit ?? 3,
  })

  const cfg = getWooConfig()

  // ── Fonte primária: WooCommerce REST API ──────────────────────────────────
  if (cfg) {
    try {
      const apiResults = await searchViaApi(params, cfg)
      if (apiResults.length > 0) {
        cacheSet(cacheKey, apiResults)
        log('INFO', 'search_done', {
          catalog_source:    'woocommerce_api',
          products_returned: apiResults.length,
          api_error:         false,
          fallback_used:     false,
          elapsed_ms:        Date.now() - t0,
        })
        return apiResults
      }
      log('WARN', 'api_returned_empty', { elapsed_ms: Date.now() - t0 })
    } catch (err) {
      log('ERROR', 'api_exception', {
        api_error: true,
        error:     err instanceof Error ? err.message : String(err),
      })
    }
  } else {
    log('WARN', 'woo_credentials_missing', {
      hint: 'Configure WOOCOMMERCE_API_URL, WOOCOMMERCE_CONSUMER_KEY, WOOCOMMERCE_CONSUMER_SECRET',
    })
  }

  // ── Fallback: scraping HTML com regras estritas ───────────────────────────
  log('INFO', 'fallback_scraping_start', { elapsed_ms: Date.now() - t0 })
  const scrapeResults = await searchViaScraping(params)

  if (scrapeResults.length > 0) {
    cacheSet(cacheKey, scrapeResults)
  }

  log('INFO', 'search_done', {
    catalog_source:    scrapeResults.length > 0 ? 'scraping_fallback' : 'none',
    products_returned: scrapeResults.length,
    api_error:         !!cfg,
    fallback_used:     true,
    elapsed_ms:        Date.now() - t0,
  })

  return scrapeResults
}
