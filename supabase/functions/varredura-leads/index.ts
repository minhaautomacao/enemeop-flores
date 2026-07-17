/**
 * varredura-leads
 *
 * Origem: recuperado da versão implantada no projeto Supabase da Fábrica
 * (ebeapnydeiwuewxatuuw, slug varredura-leads, v1) em 2026-07-10.
 * Nunca esteve versionado em nenhum repositório Git antes desta migração.
 * Sanitização aplicada: default de workspace_id movido para env var
 * WORKSPACE_NAME (ver .env.example).
 *
 * Varre múltiplas fontes públicas buscando pessoas com intenção
 * de compra relacionada a floricultura.
 *
 * Fontes suportadas:
 *   - Google Search (buscas locais de floricultura)
 *   - Pinterest (hashtags de casamento, decoração)
 *   - Twitter/X (menções públicas)
 *   - Casamento.com.br / noivas / sites de evento
 *   - Mercado Livre (monitoramento de concorrentes)
 *   - Instagram via scraping público (hashtags)
 *
 * Após coletar, cada item é classificado com IA (Groq).
 * Itens com intenção alta/urgente são inseridos como leads
 * via captacao-leads e encaminhados ao whatsapp-sdr.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')
const ORQUESTRADOR_URL = `${SUPABASE_URL}/functions/v1/orquestrador`
const WORKSPACE_NAME = Deno.env.get('WORKSPACE_NAME') ?? 'enemeop'

const HEADERS_HTTP = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

// ─── Palavras-chave por segmento ───────────────────────────────────────────

const PALAVRAS_FLORICULTURA = [
  // Produtos
  'flores', 'rosas', 'buquê', 'buque', 'arranjo floral', 'arranjos de flores',
  'coroa de flores', 'bouquet', 'flores artificiais', 'flores naturais',
  // Serviços
  'floricultura', 'decoração floral', 'decoração com flores',
  // Eventos
  'decoração de casamento', 'flores para casamento', 'buquê de noiva',
  'decoração de batizado', 'flores para batizado',
  'decoração de aniversário', 'flores para festa',
  'decoração corporativa', 'flores para evento corporativo',
  'flores para formatura', 'flores para velório', 'coroa fúnebre',
  // Intenção de compra direta
  'comprar flores', 'encomendar flores', 'entrega de flores',
  'floricultura perto de mim', 'floricultura em sp', 'flores sp',
  'quanto custa buquê', 'preço de arranjo', 'orçamento flores',
]

const HASHTAGS_INSTAGRAM = [
  'casamento', 'noiva', 'noivas', 'casamentoreal',
  'decoracaofloral', 'floricultura', 'arranjofloral',
  'buque', 'flores', 'rosas', 'eventocorporativo',
  'batizado', 'festadeaniversario', 'decoracaodeeventos',
  'weddingflowers', 'weddingdecor',
]

const HASHTAGS_TWITTER = [
  'flores', 'casamento', 'noiva', 'buque', 'floricultura',
  'arranjofloral', 'decoracaocasamento',
]

const QUERIES_GOOGLE = [
  'floricultura São Paulo',
  'comprar flores online SP',
  'decoração floral casamento SP',
  'buquê de noiva preço',
  'flores para evento corporativo',
  'floricultura entrega hoje',
]

const SITES_NICHO = [
  { url: 'https://www.casamentos.com.br/forum/flores/', tipo: 'forum_casamento' },
  { url: 'https://www.noivas.com.br/', tipo: 'portal_noiva' },
]

// ─── Tipos ─────────────────────────────────────────────────────────────────

interface ItemColetado {
  fonte: string
  tipo_fonte: 'instagram' | 'twitter' | 'google' | 'pinterest' | 'forum' | 'portal' | 'mercadolivre'
  texto: string
  url?: string
  autor?: string
  data_publicacao?: string
  metadata?: Record<string, unknown>
}

interface LeadClassificado {
  item: ItemColetado
  intencao: 'urgente' | 'alta' | 'media' | 'baixa' | 'nenhuma'
  segmento: string
  resumo: string
  canal_resposta: 'instagram_dm' | 'instagram_comentario' | 'whatsapp' | 'email' | 'nenhum'
  mensagem_abordagem: string
}

interface ResultadoVarredura {
  total_coletados: number
  total_leads_criados: number
  por_fonte: Record<string, number>
  leads_urgentes: number
  leads_altos: number
  iniciado_em: string
  concluido_em: string
  erros: string[]
}

// ─── Main ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
  }

  const iniciado_em = new Date().toISOString()
  const erros: string[] = []
  const por_fonte: Record<string, number> = {}
  let total_leads_criados = 0
  let leads_urgentes = 0
  let leads_altos = 0

  // Parâmetros opcionais para varredura parcial
  let config: { fontes?: string[]; workspace_id?: string } = {}
  try { config = await req.json() } catch { /* usa defaults */ }

  const fontes = config.fontes ?? ['instagram', 'twitter', 'google', 'pinterest', 'forums']
  const workspace_id = config.workspace_id ?? WORKSPACE_NAME

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // ── 1. Coleta em paralelo ──────────────────────────────────────────────
  const tarefasColeta: Promise<ItemColetado[]>[] = []

  if (fontes.includes('instagram')) {
    for (const tag of HASHTAGS_INSTAGRAM.slice(0, 5)) { // 5 hashtags por rodada
      tarefasColeta.push(coletarInstagram(tag).catch(e => { erros.push(`instagram:${tag}: ${e}`); return [] }))
    }
  }

  if (fontes.includes('twitter')) {
    for (const tag of HASHTAGS_TWITTER.slice(0, 3)) {
      tarefasColeta.push(coletarTwitter(tag).catch(e => { erros.push(`twitter:${tag}: ${e}`); return [] }))
    }
  }

  if (fontes.includes('google')) {
    for (const query of QUERIES_GOOGLE.slice(0, 3)) {
      tarefasColeta.push(coletarGoogle(query).catch(e => { erros.push(`google: ${e}`); return [] }))
    }
  }

  if (fontes.includes('pinterest')) {
    tarefasColeta.push(coletarPinterest().catch(e => { erros.push(`pinterest: ${e}`); return [] }))
  }

  if (fontes.includes('forums')) {
    for (const site of SITES_NICHO) {
      tarefasColeta.push(coletarSiteNicho(site.url, site.tipo as ItemColetado['tipo_fonte']).catch(e => { erros.push(`forum: ${e}`); return [] }))
    }
  }

  const resultados = await Promise.allSettled(tarefasColeta)
  const itensColetados: ItemColetado[] = []
  for (const r of resultados) {
    if (r.status === 'fulfilled') itensColetados.push(...r.value)
  }

  // Contagem por fonte
  for (const item of itensColetados) {
    por_fonte[item.tipo_fonte] = (por_fonte[item.tipo_fonte] ?? 0) + 1
  }

  // ── 2. Deduplicação: ignora textos já vistos recentemente ─────────────
  const itensFiltrados = await deduplicar(sb, itensColetados)

  // ── 3. Classificação com IA em lotes ──────────────────────────────────
  const lotes = criarLotes(itensFiltrados, 5)
  const classificados: LeadClassificado[] = []

  for (const lote of lotes) {
    const cls = await classificarLote(lote).catch(e => { erros.push(`classificacao: ${e}`); return [] as LeadClassificado[] })
    classificados.push(...cls)
  }

  // ── 4. Cria leads e dispara SDR para intenção alta/urgente ────────────
  for (const lead of classificados) {
    if (lead.intencao === 'nenhuma' || lead.intencao === 'baixa') continue

    try {
      await sb.from('leads').insert({
        canal: lead.item.tipo_fonte,
        nome: lead.item.autor ?? null,
        mensagem_inicial: lead.item.texto.slice(0, 500),
        canal_id: lead.item.url ?? null,
        utm_source: `varredura_${lead.item.tipo_fonte}`,
        notas: lead.resumo,
        intencao: lead.intencao,
        status: 'novo',
        metadata: {
          workspace_id,
          fonte_url: lead.item.url,
          segmento: lead.segmento,
          canal_resposta: lead.canal_resposta,
          mensagem_abordagem: lead.mensagem_abordagem,
          coletado_em: lead.item.data_publicacao,
        },
      })

      total_leads_criados++
      if (lead.intencao === 'urgente') leads_urgentes++
      if (lead.intencao === 'alta') leads_altos++

      // Dispara SDR para urgente/alta via orquestrador
      if (lead.intencao === 'urgente' || lead.intencao === 'alta') {
        await dispararSDR(lead, workspace_id).catch(e => erros.push(`sdr: ${e}`))
      }
    } catch (e) {
      erros.push(`insert_lead: ${e}`)
    }
  }

  // ── 5. Salva relatório da varredura ───────────────────────────────────
  const concluido_em = new Date().toISOString()
  const resultado: ResultadoVarredura = {
    total_coletados: itensColetados.length,
    total_leads_criados,
    por_fonte,
    leads_urgentes,
    leads_altos,
    iniciado_em,
    concluido_em,
    erros: erros.slice(0, 10),
  }

  await sb.from('varredura_log').insert({ resultado, workspace_id, criado_em: concluido_em }).catch(() => {})

  return new Response(JSON.stringify(resultado), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
})

// ─── Coletores por fonte ───────────────────────────────────────────────────

async function coletarInstagram(hashtag: string): Promise<ItemColetado[]> {
  const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/`
  const html = await fetch(url, { headers: HEADERS_HTTP }).then(r => r.text())
  const itens: ItemColetado[] = []

  // Tenta window._sharedData (formato antigo)
  const match = html.match(/window\._sharedData\s*=\s*(\{.+?\});/s)
  if (match) {
    try {
      const data = JSON.parse(match[1])
      const edges = data?.entry_data?.TagPage?.[0]?.graphql?.hashtag?.edge_hashtag_to_media?.edges ?? []
      for (const edge of edges) {
        const node = edge.node
        const texto = node?.edge_media_to_caption?.edges?.[0]?.node?.text ?? ''
        if (texto.length < 10) continue
        itens.push({
          fonte: `instagram_hashtag_${hashtag}`,
          tipo_fonte: 'instagram',
          texto,
          url: node.shortcode ? `https://www.instagram.com/p/${node.shortcode}/` : undefined,
          data_publicacao: node.taken_at_timestamp ? new Date(node.taken_at_timestamp * 1000).toISOString() : undefined,
          metadata: { hashtag, curtidas: node.edge_liked_by?.count, comentarios: node.edge_media_to_comment?.count },
        })
      }
    } catch { /* ignora */ }
  }

  // Tenta JSON embedado no formato mais novo
  if (itens.length === 0) {
    const scripts = html.matchAll(/<script type="application\/json"[^>]*>([^<]+)<\/script>/g)
    for (const s of scripts) {
      try {
        const json = JSON.parse(s[1])
        const edges = json?.data?.hashtag?.edge_hashtag_to_media?.edges ?? []
        for (const edge of edges) {
          const texto = edge?.node?.edge_media_to_caption?.edges?.[0]?.node?.text ?? ''
          if (texto.length > 10) {
            itens.push({
              fonte: `instagram_hashtag_${hashtag}`,
              tipo_fonte: 'instagram',
              texto,
              url: edge.node?.shortcode ? `https://www.instagram.com/p/${edge.node.shortcode}/` : undefined,
              metadata: { hashtag },
            })
          }
        }
      } catch { /* ignora */ }
    }
  }

  return itens
}

async function coletarTwitter(hashtag: string): Promise<ItemColetado[]> {
  // Twitter/X requer autenticação para API v2 — usa Nitter como proxy público
  const url = `https://nitter.net/search?q=%23${encodeURIComponent(hashtag)}&lang=pt`
  const html = await fetch(url, { headers: HEADERS_HTTP }).then(r => r.text())
  const itens: ItemColetado[] = []

  // Extrai tweets do HTML do Nitter
  const tweets = html.matchAll(/<div class="tweet-content[^"]*"[^>]*>([\s\S]+?)<\/div>/g)
  for (const t of tweets) {
    const texto = t[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (texto.length > 15 && estaRelacionadoAFloricultura(texto)) {
      itens.push({
        fonte: `twitter_hashtag_${hashtag}`,
        tipo_fonte: 'twitter',
        texto,
        metadata: { hashtag },
      })
    }
  }

  return itens.slice(0, 20)
}

async function coletarGoogle(query: string): Promise<ItemColetado[]> {
  const q = encodeURIComponent(query)
  const url = `https://www.google.com/search?q=${q}&hl=pt-BR&gl=BR&num=10`
  const html = await fetch(url, { headers: HEADERS_HTTP }).then(r => r.text())
  const itens: ItemColetado[] = []

  // Extrai snippets dos resultados orgânicos
  const snippets = html.matchAll(/<div[^>]*class="[^"]*VwiC3b[^"]*"[^>]*>([\s\S]+?)<\/div>/g)
  for (const s of snippets) {
    const texto = s[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (texto.length > 30) {
      itens.push({
        fonte: `google_busca`,
        tipo_fonte: 'google',
        texto: `Busca: "${query}" | Resultado: ${texto}`,
        metadata: { query },
      })
    }
  }

  // Extrai posições de concorrentes (h3)
  const concorrentes = html.matchAll(/<h3[^>]*>([^<]{5,80})<\/h3>/g)
  let pos = 1
  for (const c of concorrentes) {
    const titulo = c[1].trim()
    if (pos <= 10 && titulo.toLowerCase().includes('flor')) {
      itens.push({
        fonte: 'google_concorrente',
        tipo_fonte: 'google',
        texto: `Posição ${pos} no Google para "${query}": ${titulo}`,
        metadata: { query, posicao: pos },
      })
    }
    pos++
  }

  return itens.slice(0, 15)
}

async function coletarPinterest(): Promise<ItemColetado[]> {
  const url = 'https://br.pinterest.com/search/pins/?q=decora%C3%A7%C3%A3o+floral+casamento'
  const html = await fetch(url, { headers: HEADERS_HTTP }).then(r => r.text())
  const itens: ItemColetado[] = []

  // Pinterest embede JSON com pins
  const jsonMatch = html.match(/\{"resourceDataCache":\[\{"data":(\{.+?\}),"name"/s)
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1])
      const pins = data?.results ?? []
      for (const pin of pins.slice(0, 20)) {
        const descricao = pin.description ?? pin.title ?? ''
        if (descricao.length > 10) {
          itens.push({
            fonte: 'pinterest_decoracao_floral',
            tipo_fonte: 'pinterest',
            texto: descricao,
            url: pin.link ?? `https://br.pinterest.com/pin/${pin.id}/`,
            metadata: { repins: pin.repin_count, saves: pin.save_count },
          })
        }
      }
    } catch { /* ignora */ }
  }

  return itens
}

async function coletarSiteNicho(url: string, tipo: ItemColetado['tipo_fonte']): Promise<ItemColetado[]> {
  const html = await fetch(url, { headers: HEADERS_HTTP }).then(r => r.text())
  const itens: ItemColetado[] = []

  // Extrai posts/tópicos de fóruns
  const topicos = html.matchAll(/<(?:h[1-6]|p|li)[^>]*>([^<]{30,300})<\/(?:h[1-6]|p|li)>/g)
  for (const t of topicos) {
    const texto = t[1].replace(/<[^>]+>/g, '').trim()
    if (estaRelacionadoAFloricultura(texto) && temIntencaoDeCompra(texto)) {
      itens.push({
        fonte: url,
        tipo_fonte: tipo,
        texto,
        url,
        metadata: { site: url },
      })
    }
  }

  return itens.slice(0, 10)
}

// ─── Classificação com IA ──────────────────────────────────────────────────

const SYSTEM_CLASSIFICACAO = `Você é especialista em identificar oportunidades de venda para uma FLORICULTURA.
Analise cada item coletado da internet e retorne JSON com classificação:
{
  "intencao": "urgente" | "alta" | "media" | "baixa" | "nenhuma",
  "segmento": "casamento" | "corporativo" | "batizado" | "aniversario" | "funebres" | "presente" | "decoracao" | "outro",
  "resumo": "resumo em até 100 chars do que a pessoa quer",
  "canal_resposta": "instagram_dm" | "instagram_comentario" | "whatsapp" | "email" | "nenhum",
  "mensagem_abordagem": "mensagem personalizada para abordar esta pessoa (máx 200 chars, tom natural, não spam)"
}

Critérios de intenção:
- urgente: precisa hoje, entrega urgente, evento em menos de 3 dias
- alta: evento confirmado, pedido de orçamento, intenção clara de compra
- media: pesquisando preços, comparando, dúvida sobre produto
- baixa: curiosidade, inspiração, sem intenção imediata
- nenhuma: conteúdo de marca, post de concorrente, notícia, sem relação com compra

RETORNE APENAS array JSON sem markdown: [{classificacao1}, {classificacao2}, ...]`

async function classificarLote(itens: ItemColetado[]): Promise<LeadClassificado[]> {
  if (!GROQ_API_KEY) return itens.map(item => ({
    item,
    intencao: temIntencaoDeCompra(item.texto) ? 'media' : 'nenhuma',
    segmento: detectarSegmento(item.texto),
    resumo: item.texto.slice(0, 100),
    canal_resposta: item.tipo_fonte === 'instagram' ? 'instagram_comentario' : 'nenhum',
    mensagem_abordagem: '',
  } as LeadClassificado))

  const input = itens.map((item, i) => `[${i}] Fonte: ${item.tipo_fonte} | Texto: ${item.texto.slice(0, 300)}`).join('\n---\n')

  const resposta = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 2048,
      messages: [
        { role: 'system', content: SYSTEM_CLASSIFICACAO },
        { role: 'user', content: input },
      ],
    }),
  })

  if (!resposta.ok) throw new Error(`Groq ${resposta.status}`)
  const data = await resposta.json()
  const texto = data.choices[0].message.content as string

  try {
    const jsonStr = texto.replace(/```json\n?|\n?```/g, '').trim()
    const classificacoes = JSON.parse(jsonStr) as Array<{
      intencao: LeadClassificado['intencao']
      segmento: string
      resumo: string
      canal_resposta: LeadClassificado['canal_resposta']
      mensagem_abordagem: string
    }>

    return itens.map((item, i) => ({
      item,
      intencao: classificacoes[i]?.intencao ?? 'nenhuma',
      segmento: classificacoes[i]?.segmento ?? 'outro',
      resumo: classificacoes[i]?.resumo ?? '',
      canal_resposta: classificacoes[i]?.canal_resposta ?? 'nenhum',
      mensagem_abordagem: classificacoes[i]?.mensagem_abordagem ?? '',
    } as LeadClassificado))
  } catch {
    // Fallback: classificação simples sem IA
    return itens.map(item => ({
      item,
      intencao: temIntencaoDeCompra(item.texto) ? 'media' : 'nenhuma',
      segmento: detectarSegmento(item.texto),
      resumo: item.texto.slice(0, 100),
      canal_resposta: 'nenhum' as const,
      mensagem_abordagem: '',
    } as LeadClassificado))
  }
}

// ─── Disparo do SDR ────────────────────────────────────────────────────────

async function dispararSDR(lead: LeadClassificado, workspace_id: string): Promise<void> {
  await fetch(ORQUESTRADOR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
    body: JSON.stringify({
      tipo: 'novo_lead_varredura',
      escopo: 'producao',
      urgencia: lead.intencao === 'urgente' ? 'critical' : 'normal',
      task_id: crypto.randomUUID(),
      workspace_id,
      payload: {
        origem: 'varredura_automatica',
        canal: lead.item.tipo_fonte,
        mensagem: lead.item.texto.slice(0, 500),
        url_origem: lead.item.url,
        autor: lead.item.autor,
        segmento: lead.segmento,
        intencao: lead.intencao,
        resumo: lead.resumo,
        mensagem_abordagem: lead.mensagem_abordagem,
        canal_resposta: lead.canal_resposta,
      },
    }),
  })
}

// ─── Deduplicação ─────────────────────────────────────────────────────────

async function deduplicar(
  sb: ReturnType<typeof createClient>,
  itens: ItemColetado[]
): Promise<ItemColetado[]> {
  if (itens.length === 0) return []

  // Busca hashes já processados nas últimas 48h
  const { data: recentes } = await sb
    .from('varredura_hashes')
    .select('hash')
    .gt('criado_em', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
    .limit(5000)

  const hashesConhecidos = new Set((recentes ?? []).map((r: { hash: string }) => r.hash))
  const novosItens: ItemColetado[] = []
  const novosHashes: string[] = []

  for (const item of itens) {
    const hash = await digestHash(item.texto)
    if (!hashesConhecidos.has(hash)) {
      novosItens.push(item)
      novosHashes.push(hash)
      hashesConhecidos.add(hash)
    }
  }

  // Salva novos hashes em lote
  if (novosHashes.length > 0) {
    await sb.from('varredura_hashes').insert(
      novosHashes.map(hash => ({ hash, criado_em: new Date().toISOString() }))
    ).then()
  }

  return novosItens
}

async function digestHash(texto: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(texto.slice(0, 200).toLowerCase().replace(/\s+/g, ' ').trim())
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

// ─── Utilitários ──────────────────────────────────────────────────────────

function estaRelacionadoAFloricultura(texto: string): boolean {
  const lower = texto.toLowerCase()
  return PALAVRAS_FLORICULTURA.some(p => lower.includes(p))
}

function temIntencaoDeCompra(texto: string): boolean {
  const sinais = [
    'quero', 'preciso', 'quanto custa', 'preço', 'preco', 'orçamento', 'orcamento',
    'comprar', 'encomendar', 'pedir', 'onde acho', 'alguém indica', 'alguem indica',
    'indica uma', 'boa floricultura', 'entrega', 'hoje', 'urgente',
  ]
  const lower = texto.toLowerCase()
  return sinais.some(s => lower.includes(s))
}

function detectarSegmento(texto: string): string {
  const lower = texto.toLowerCase()
  if (lower.match(/casamento|noiva|noivo|noivado|buqu[eê]/)) return 'casamento'
  if (lower.match(/corporativ|empresa|escritório|evento de empresa/)) return 'corporativo'
  if (lower.match(/batizado|batismo|crisma/)) return 'batizado'
  if (lower.match(/aniversário|aniversario|festa|birthday/)) return 'aniversario'
  if (lower.match(/falecid|funeral|velório|luto|cemitério|defunto/)) return 'funebres'
  if (lower.match(/presente|presente para|mimo|surpresa/)) return 'presente'
  if (lower.match(/decoração|decora|arranjo/)) return 'decoracao'
  return 'outro'
}

function criarLotes<T>(arr: T[], tamanho: number): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < arr.length; i += tamanho) lotes.push(arr.slice(i, i + tamanho))
  return lotes
}
