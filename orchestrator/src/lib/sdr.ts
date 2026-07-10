import Groq from 'groq-sdk'
import { getRedis } from './redis.js'
import { getSupabase } from './supabase.js'
import { responderLead, notificarEscalada } from './whatsapp.js'
import { responderInstagram, salvarConversa, responderComentarioInstagram, responderComentarioFacebook } from './instagram.js'
import { searchLiveProductsFromSite, type LiveProduct, type SearchLiveProductsParams } from '../catalog/liveSiteCatalog.js'
import { randomUUID } from 'crypto'

// Fallback evita que a simples importação deste módulo quebre sem
// GROQ_API_KEY configurada (ex.: testes locais que só exercitam a lógica
// de composição de prompt). Uma chamada real à API sem chave válida
// continua falhando normalmente, com erro de autenticação do Groq.
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'not-configured' })

// Identidade e contato configuráveis por workspace — ver .env.example
const AGENT_NAME    = process.env.AGENT_NAME ?? 'Flora'
const WHATSAPP_LINK = process.env.STORE_WHATSAPP_LINK ?? ''
const PIX_KEY       = process.env.STORE_PIX_KEY ?? ''
const HUMAN_PHONE   = process.env.STORE_HUMAN_PHONE ?? ''

export function mensagemEscalada(): string {
  return HUMAN_PHONE
    ? `Um momento! Vou conectar você com nossa especialista. Ela entrará em contato em instantes pelo número ${HUMAN_PHONE}.`
    : 'Um momento! Vou conectar você com nossa especialista. Ela entrará em contato em instantes.'
}

// Instrução de primeira mensagem — cumprimenta pelo nome quando já conhecido
// (unifica o comportamento entre WhatsApp e Instagram, que antes divergiam),
// usando sempre AGENT_NAME em vez do nome fixo "Flora".
export function buildInstrucaoPrimeiraMensagem(primeiraMensagem: boolean, nomeCliente?: string | null): string {
  if (!primeiraMensagem) return ''
  if (nomeCliente) {
    return `\n\n## INSTRUÇÃO OBRIGATÓRIA\nVocê é ${AGENT_NAME.toUpperCase()}. O cliente se chama **${nomeCliente}**. Cumprimente pelo nome. NÃO peça o nome — você já sabe.`
  }
  return '\n\n## INSTRUÇÃO OBRIGATÓRIA\nPrimeira mensagem. COMECE pedindo o nome: "Oi, pode me dizer seu nome pra eu te atender melhor?"'
}

// Prompt base — sem catálogo. Produtos chegam como contexto injetado em tempo real.
const SYSTEM_PROMPT = `Você é a assistente virtual da **Enemeop Flores**, floricultura em São Paulo desde 1997.
Seu nome é **${AGENT_NAME}**. Atende pelo WhatsApp com missão de ajudar o cliente a escolher o presente perfeito e fechar a venda de forma natural, calorosa e eficiente.

## Sobre a Enemeop Flores
- Site oficial: www.enemeopflores.com.br
- Endereço: Rua Costa Aguiar, 1184 — São Paulo — SP
- Telefone: (11) 2272-3158 | WhatsApp: (11) 98282-9083
- Horário: Seg–Sex 9h–18h | Sáb–Dom e feriados 9h–14h
- Entrega no mesmo dia (pedido + pagamento confirmado até 15h)
- Frete calculado por CEP (geralmente R$15–40 dentro de SP)

## Regras de catálogo — OBRIGATÓRIO
- Você **não possui catálogo interno**. Nunca use produtos, preços, cores ou descrições de memória.
- Produtos são fornecidos a você em tempo real pelo sistema, lidos diretamente do site www.enemeopflores.com.br.
- **Só sugira produtos que aparecerem no bloco [PRODUTOS DISPONÍVEIS] abaixo.**
- Se o bloco estiver vazio ou ausente, não invente nada — use a mensagem de fallback.
- Sempre mencione: nome do produto, preço (se disponível), cores e flores da composição, e o link do site.
- Priorize as melhores 2 a 3 opções para a ocasião, orçamento, cor e destinatário do cliente.

## Tom e estilo
- Linguagem informal, direta, curta — conversa natural entre pessoas
- Sem emojis, sem excessos, sem frases longas
- Máximo 3 linhas por mensagem sempre que possível
- Nunca use saudações corporativas como "Olá! Tudo bem?" — seja direto

## Fluxo de atendimento
1. Se não souber o nome: "Oi, pode me dizer seu nome pra eu te atender melhor?"
2. Colete naturalmente: nome, ocasião, destinatário, data da entrega, orçamento, bairro/CEP
3. Quando tiver dados suficientes, apresente 2–3 opções do bloco [PRODUTOS DISPONÍVEIS]
4. Explique brevemente por que cada opção é adequada (ocasião + cor + preço)
5. Para fechar: confirme endereço completo + CEP, apresente resumo e informe PIX
6. Chave PIX: ${PIX_KEY}
7. Se o cliente pedir atendente humano: "Um momento! Vou conectar você com nossa especialista."
8. Após 3 trocas sem intenção de compra: "Se preferir, pode me chamar diretamente: ${WHATSAPP_LINK}"

## O que NUNCA fazer
- Inventar produto, cor, preço ou descrição que não esteja no bloco [PRODUTOS DISPONÍVEIS]
- Prometer entrega sem confirmar horário do pedido
- Tratar dois clientes como se fossem o mesmo
- Ser robótico — seja humano, caloroso, natural`

const ESCALADA_TRIGGERS = [
  'falar com pessoa', 'falar com humano', 'atendente', 'atendimento humano',
  'quero falar com alguém', 'fala comigo', 'assistente pessoal', 'gerente',
  'responsável', 'proprietário', 'dono', 'falar com carlos'
]

function deveEscalar(mensagem: string): boolean {
  const lower = mensagem.toLowerCase()
  return ESCALADA_TRIGGERS.some(t => lower.includes(t))
}

interface Mensagem {
  role: 'user' | 'assistant'
  content: string
}

const HISTORICO_MAX_MSGS = 20
const HISTORICO_TTL_S    = 86400 * 3  // 3 dias

async function carregarHistorico(numero: string): Promise<Mensagem[]> {
  const redis = getRedis()
  const raw = await redis.get(`sdr:hist:${numero}`)
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch (err) {
    console.error(`[SDR] Histórico corrompido para ${numero}:`, err)
    return []
  }
}

async function salvarHistorico(numero: string, historico: Mensagem[]): Promise<void> {
  const redis = getRedis()
  const recente = historico.slice(-HISTORICO_MAX_MSGS)
  await redis.setex(`sdr:hist:${numero}`, HISTORICO_TTL_S, JSON.stringify(recente))
}

// ── Detecção de intenção de produto ──────────────────────────────────────────

const PRODUTO_TRIGGERS = [
  'flores', 'flor', 'buquê', 'buque', 'bouquet', 'arranjo', 'ramalhete',
  'orquídea', 'orquidea', 'presente', 'gift', 'quero', 'preciso', 'gostaria',
  'tem', 'opção', 'opcao', 'quanto', 'custa', 'valor', 'preço', 'preco',
  'cor', 'cores', 'rosa', 'girassol', 'vermelho', 'branco', 'pink',
  'aniversário', 'aniversario', 'namorad', 'casament', 'mãe', 'mae',
  'noiva', 'luto', 'condolência', 'kit', 'maternidade', 'bebê', 'bebe',
]

function deveConsultarCatalogo(mensagem: string, historico: Mensagem[]): boolean {
  // Primeira mensagem: apenas pede nome, não busca produtos ainda
  if (historico.length <= 1) return false
  const lower = mensagem.toLowerCase()
  return PRODUTO_TRIGGERS.some(t => lower.includes(t))
}

// ── Extração de parâmetros de busca do contexto da conversa ──────────────────

function extrairParamsBusca(mensagem: string, historico: Mensagem[]): SearchLiveProductsParams {
  const textoTotal = [...historico.map(m => m.content), mensagem].join(' ').toLowerCase()

  let occasion: string | undefined
  if (/namorad|valentine|paixão|paixao/.test(textoTotal))              occasion = 'namorado'
  else if (/casament|noiv/.test(textoTotal))                           occasion = 'casamento'
  else if (/\bmãe\b|\bmae\b|mamã|mama/.test(textoTotal))              occasion = 'mae'
  else if (/maternidade|bebê|bebe|nasciment/.test(textoTotal))         occasion = 'maternidade'
  else if (/luto|faleciment|condolênc|saudade/.test(textoTotal))       occasion = 'luto'
  else if (/aniversário|aniversario|parabéns|parabens/.test(textoTotal)) occasion = 'aniversario'
  else if (/corporativo|empresa|escritório/.test(textoTotal))          occasion = 'corporativo'
  else if (/orquídea|orquidea/.test(textoTotal))                       occasion = 'orquidea'

  const budgetMatch = textoTotal.match(/r\$\s*(\d+(?:[.,]\d+)?)|(\d+)\s*(?:reais|conto|real)/)
  const budget = budgetMatch
    ? parseFloat((budgetMatch[1] ?? budgetMatch[2]).replace(',', '.'))
    : undefined

  const coresPt = ['branca', 'branco', 'vermelha', 'vermelho', 'rosa', 'pink', 'amarela', 'amarelo', 'laranja', 'lilás', 'lilas', 'roxa']
  const color = coresPt.find(c => textoTotal.includes(c))

  return { query: mensagem, occasion, budget, color, limit: 3 }
}

// ── Formata produtos ao vivo como bloco de contexto para o LLM ───────────────

function formatarContextoProdutos(produtos: LiveProduct[]): string {
  if (produtos.length === 0) return ''

  const linhas = produtos.map((p, i) => {
    const preco  = p.price != null ? `R$${p.price.toFixed(2).replace('.', ',')}` : 'consultar'
    const cores  = p.colors.length  ? p.colors.join(', ')  : 'não especificada'
    const flores = p.flowers.length ? p.flowers.join(', ') : 'não especificada'
    const desc   = p.description ? `\n   Descrição: ${p.description.substring(0, 200)}` : ''
    return `${i + 1}. **${p.name}**\n   Preço: ${preco}\n   Cores: ${cores}\n   Flores/composição: ${flores}${desc}\n   Link: ${p.url}`
  })

  return `\n\n## [PRODUTOS DISPONÍVEIS — lidos agora de www.enemeopflores.com.br]\n${linhas.join('\n\n')}\n\nApresente as melhores opções acima para o cliente. Mencione nome, preço, cores e flores de cada sugestão.`
}

// ── Processamento WhatsApp ────────────────────────────────────────────────────

export async function processarMensagemSDR(numero: string, textoCliente: string, nomeCliente?: string): Promise<void> {
  if (deveEscalar(textoCliente)) {
    await responderLead({
      numero,
      mensagem: mensagemEscalada(),
    })
    await notificarEscalada(
      randomUUID(),
      'escalada-whatsapp',
      `Cliente ${numero} pediu atendimento humano. Última mensagem: "${textoCliente}"`
    )
    console.log(`[SDR] Escalada solicitada por ${numero}`)
    return
  }

  const historico = await carregarHistorico(numero)
  const primeiraMensagem = historico.length === 0
  historico.push({ role: 'user', content: textoCliente })

  // Busca ao vivo quando o cliente demonstra interesse em produtos
  let contextoProdutos = ''
  if (deveConsultarCatalogo(textoCliente, historico)) {
    try {
      const params = extrairParamsBusca(textoCliente, historico)
      console.log(`[SDR] Consultando catálogo ao vivo — params:`, params)
      const produtos = await searchLiveProductsFromSite(params)

      if (produtos.length > 0) {
        contextoProdutos = formatarContextoProdutos(produtos)
        console.log(`[SDR] ${produtos.length} produto(s) encontrado(s) no site`)
      } else {
        // Site não retornou nada → escalada
        console.warn('[SDR] Catálogo ao vivo sem resultado — escalando')
        await notificarEscalada(
          randomUUID(),
          'catalogo-sem-resultado',
          `Cliente ${numero} pediu produto mas o site não retornou nada. Mensagem: "${textoCliente}"`
        )
        await responderLead({
          numero,
          mensagem: 'Vou confirmar as opções disponíveis no site e já te envio certinho. Um momento!',
        })
        await salvarHistorico(numero, historico)
        return
      }
    } catch (err) {
      // Erro na leitura do site → escalada
      console.error('[SDR] Erro ao consultar catálogo ao vivo:', err)
      await notificarEscalada(
        randomUUID(),
        'catalogo-erro',
        `Falha ao ler site para cliente ${numero}. Mensagem: "${textoCliente}". Erro: ${err instanceof Error ? err.message : String(err)}`
      )
      await responderLead({
        numero,
        mensagem: 'Vou confirmar as opções disponíveis no site e já te envio certinho. Um momento!',
      })
      await salvarHistorico(numero, historico)
      return
    }
  }

  // Monta system prompt final com contexto de produtos (se houver) e instruções de primeira mensagem
  const instrucoes = buildInstrucaoPrimeiraMensagem(primeiraMensagem, nomeCliente)

  const systemFinal = SYSTEM_PROMPT + contextoProdutos + instrucoes

  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: systemFinal },
      ...historico,
    ],
    temperature: 0.7,
    max_tokens: 400,
  })

  const resposta = response.choices[0]?.message?.content
    ?? 'Olá! Obrigada pelo contato com a Enemeop Flores. Como posso te ajudar?'

  historico.push({ role: 'assistant', content: resposta })
  await salvarHistorico(numero, historico)

  const nomeMatch = historico
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join(' ')
    .match(/(?:me\s+chamo|meu\s+nome\s+[eé]|sou\s+[oa]?\s*)([A-ZÁÉÍÓÚÂÊÎÔÛÃÕ][a-záéíóúâêîôûãõ]+)/i)

  if (nomeMatch?.[1]) {
    await getSupabase()
      .from('leads')
      .update({ nome: nomeMatch[1] })
      .eq('telefone', numero)
  }

  await responderLead({ numero, mensagem: resposta })
  console.log(`[SDR] Respondido ${numero}: ${resposta.substring(0, 80)}...`)
}

const SYSTEM_COMENTARIO = `Você é ${AGENT_NAME}, assistente da Enemeop Flores (floricultura em SP desde 1997).
Alguém comentou em uma publicação nossa. Responda de forma curta, calorosa e pública (máx 2 linhas).
Nunca peça dados pessoais — convide para o WhatsApp: ${WHATSAPP_LINK}
Tom: informal, direto, sem emojis excessivos.`

export async function processarComentarioSDR(
  canal: 'instagram' | 'facebook',
  commentId: string,
  textoComentario: string,
  nomeUsuario?: string
): Promise<void> {
  console.log(`[SDR/${canal}] Comentário de ${nomeUsuario ?? 'desconhecido'}: ${textoComentario.substring(0, 80)}`)

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: SYSTEM_COMENTARIO },
        { role: 'user', content: nomeUsuario ? `${nomeUsuario} comentou: "${textoComentario}"` : `Comentário: "${textoComentario}"` },
      ],
      temperature: 0.7,
      max_tokens: 150,
    })

    const resposta = response.choices[0]?.message?.content ?? `Obrigada pelo comentário! Fale com a gente no WhatsApp: ${WHATSAPP_LINK}`

    if (canal === 'instagram') {
      await responderComentarioInstagram(commentId, resposta)
    } else {
      await responderComentarioFacebook(commentId, resposta)
    }

    console.log(`[SDR/${canal}/Comentário] Respondido: ${resposta.substring(0, 80)}`)
  } catch (e) {
    console.error(`[SDR/${canal}/Comentário] Erro:`, e)
  }
}

export async function processarMensagemSDRInstagram(
  canalId: string,
  textoCliente: string,
  opts?: { leadId?: string; nomeExibido?: string }
): Promise<void> {
  if (deveEscalar(textoCliente)) {
    await responderInstagram(canalId, mensagemEscalada())
    await notificarEscalada(
      randomUUID(),
      'escalada-instagram',
      `Cliente Instagram (${canalId}) pediu atendimento humano. Última mensagem: "${textoCliente}"`
    )
    console.log(`[SDR/Instagram] Escalada solicitada por ${canalId}`)
    return
  }

  const chave = `ig:${canalId}`
  const historico = await carregarHistorico(chave)
  const primeiraMensagem = historico.length === 0
  historico.push({ role: 'user', content: textoCliente })

  // Busca ao vivo quando o cliente demonstra interesse em produtos
  let contextoProdutos = ''
  if (deveConsultarCatalogo(textoCliente, historico)) {
    try {
      const params = extrairParamsBusca(textoCliente, historico)
      console.log(`[SDR/Instagram] Consultando catálogo ao vivo — params:`, params)
      const produtos = await searchLiveProductsFromSite(params)

      if (produtos.length > 0) {
        contextoProdutos = formatarContextoProdutos(produtos)
      } else {
        console.warn('[SDR/Instagram] Catálogo ao vivo sem resultado — escalando')
        await notificarEscalada(
          randomUUID(),
          'catalogo-sem-resultado-instagram',
          `Cliente Instagram (${canalId}) pediu produto mas site não retornou nada. Mensagem: "${textoCliente}"`
        )
        await responderInstagram(canalId, 'Vou confirmar as opções disponíveis no site e já te envio certinho. Um momento!')
        await salvarHistorico(chave, historico)
        return
      }
    } catch (err) {
      console.error('[SDR/Instagram] Erro ao consultar catálogo ao vivo:', err)
      await notificarEscalada(
        randomUUID(),
        'catalogo-erro-instagram',
        `Falha ao ler site para cliente Instagram (${canalId}). Erro: ${err instanceof Error ? err.message : String(err)}`
      )
      await responderInstagram(canalId, 'Vou confirmar as opções disponíveis no site e já te envio certinho. Um momento!')
      await salvarHistorico(chave, historico)
      return
    }
  }

  // Cumprimenta pelo nome de exibição do Instagram quando disponível, em vez
  // de sempre pedir o nome de novo (antes divergia do comportamento do
  // WhatsApp, que já cumprimentava por nome quando conhecido).
  const instrucaoPrimeira = buildInstrucaoPrimeiraMensagem(primeiraMensagem, opts?.nomeExibido)

  const systemFinal = SYSTEM_PROMPT + contextoProdutos + instrucaoPrimeira

  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'system', content: systemFinal }, ...historico],
    temperature: 0.7,
    max_tokens: 400,
  })

  const resposta = response.choices[0]?.message?.content ?? 'Olá! Obrigada pelo contato com a Enemeop Flores. Como posso te ajudar?'
  historico.push({ role: 'assistant', content: resposta })
  await salvarHistorico(chave, historico)

  // Extrai nome do histórico
  const nomeMatch = historico
    .filter(m => m.role === 'user').map(m => m.content).join(' ')
    .match(/(?:me\s+chamo|meu\s+nome\s+[eé]|sou\s+[oa]?\s*|chamo\s+)([A-ZÁÉÍÓÚÂÊÎÔÛÃÕ][a-záéíóúâêîôûãõ]+)/i)
  const nome = nomeMatch?.[1] ?? opts?.nomeExibido ?? null

  // Salva conversa no Supabase para o Monitor Social
  if (opts?.leadId) {
    await salvarConversa({
      leadId: opts.leadId,
      canalId,
      canal: 'instagram',
      historico,
      nomeExibido: nome ?? undefined,
    })
    // Atualiza nome no lead se encontrado
    if (nome) {
      await getSupabase().from('leads').update({ nome, nome_exibido: nome }).eq('id', opts.leadId)
    }
  }

  await responderInstagram(canalId, resposta)
  console.log(`[SDR/Instagram] Respondido ${canalId}: ${resposta.substring(0, 80)}...`)
}
