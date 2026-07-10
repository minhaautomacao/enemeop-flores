/**
 * Cliente WhatsApp via Z-API
 *
 * Variáveis de ambiente:
 *   ZAPI_INSTANCE_ID    Painel Z-API > Instância > ID
 *   ZAPI_TOKEN          Painel Z-API > Instância > Token
 *   ZAPI_CLIENT_TOKEN   Painel Z-API > Minha Conta > Client-Token
 *   CARLOS_WHATSAPP     Número do operador para escaladas (ex: 5511999999999)
 *   WHATSAPP_PROVIDER   Deve ser "zapi" (padrão)
 *
 * Preparado para futura migração à Meta Cloud API:
 * basta adicionar um novo provider e trocar WHATSAPP_PROVIDER.
 */

const ZAPI_BASE         = 'https://api.z-api.io'
const ZAPI_INSTANCE_ID  = process.env.ZAPI_INSTANCE_ID ?? ''
const ZAPI_TOKEN        = process.env.ZAPI_TOKEN ?? ''
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN ?? ''
const CARLOS            = process.env.CARLOS_WHATSAPP ?? ''

const TIMEOUT_MS  = 10_000
const MAX_RETRIES = 1

// ── Utilitários ───────────────────────────────────────────────────────────────

/**
 * Normaliza número de telefone para o formato esperado pela Z-API.
 * Remove +, espaços, traços e parênteses.
 * Ex: "+55 (11) 98282-9083" → "5511982829083"
 */
export function normalizarTelefone(numero: string): string {
  return numero.replace(/[^\d]/g, '')
}

function credenciaisOk(): boolean {
  return Boolean(ZAPI_INSTANCE_ID && ZAPI_TOKEN)
}

async function fetchComTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ── Payload da Z-API ─────────────────────────────────────────────────────────

interface ZApiSendResponse {
  zaapId?: string
  messageId?: string
  error?: string
  message?: string
}

// ── Envio de mensagem ─────────────────────────────────────────────────────────

export interface EnviarMensagemOpts {
  numero: string
  mensagem: string
}

export async function enviarMensagem(opts: EnviarMensagemOpts): Promise<boolean> {
  if (!credenciaisOk()) {
    console.warn('[WhatsApp] ZAPI_INSTANCE_ID ou ZAPI_TOKEN ausentes — mensagem ignorada')
    return false
  }

  const phone = normalizarTelefone(opts.numero)
  const url   = `${ZAPI_BASE}/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`
  const body  = JSON.stringify({ phone, message: opts.mensagem })
  const headers = {
    'Content-Type': 'application/json',
    'Client-Token': ZAPI_CLIENT_TOKEN,
  }

  for (let tentativa = 0; tentativa <= MAX_RETRIES; tentativa++) {
    try {
      const res = await fetchComTimeout(url, { method: 'POST', headers, body })

      if (res.status >= 500 && tentativa < MAX_RETRIES) {
        console.warn(`[WhatsApp] HTTP ${res.status} — tentando novamente...`)
        continue
      }

      if (!res.ok) {
        const texto = await res.text()
        console.error(`[WhatsApp] Erro HTTP ${res.status}: ${texto}`)
        return false
      }

      const data = await res.json() as ZApiSendResponse
      if (data.error || data.message === 'error') {
        console.error('[WhatsApp] Erro da API:', data.error ?? data.message)
        return false
      }

      const id = data.zaapId ?? data.messageId ?? 'N/A'
      console.log(`[WhatsApp] Enviado para ${phone} — id: ${id}`)
      return true

    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      if (isAbort) {
        console.error(`[WhatsApp] Timeout após ${TIMEOUT_MS}ms enviando para ${phone}`)
      } else {
        console.error('[WhatsApp] Falha na requisição:', err)
      }
      return false
    }
  }

  return false
}

// ── Escalada para humano ──────────────────────────────────────────────────────

export async function notificarEscalada(taskId: string, tipo: string, motivo: string): Promise<void> {
  // Fallback: grava no Supabase como escalada pendente (visível no dashboard)
  // independente de WhatsApp estar configurado ou não
  try {
    const { getSupabase } = await import('./supabase.js')
    await getSupabase().from('orchestrator_logs').insert({
      task_id: taskId,
      escopo: 'producao',
      agente: 'orquestrador',
      tipo_evento: 'escalada_pendente',
      urgencia: 'critical',
      payload: { tipo, motivo, requer_atencao_humana: true },
    })
  } catch (err) {
    console.error('[WhatsApp] Falha ao gravar escalada no Supabase:', err)
  }

  if (!CARLOS) {
    console.warn(`[WhatsApp] CARLOS_WHATSAPP não configurado — escalada registrada no Supabase: ${tipo}`)
    return
  }

  const mensagem = [
    'Escalada — requer sua atenção',
    '',
    `Tipo: ${tipo}`,
    `Motivo: ${motivo}`,
    `Task: ${taskId}`,
  ].join('\n')

  await enviarMensagem({ numero: CARLOS, mensagem })
}

// ── SDR responde lead via WhatsApp ────────────────────────────────────────────

export async function responderLead(opts: EnviarMensagemOpts): Promise<boolean> {
  return enviarMensagem(opts)
}

// ── Tipagem do webhook inbound (Z-API) ────────────────────────────────────────

export interface ZApiWebhookPayload {
  phone: string
  participantPhone?: string | null
  messageId?: string
  momment?: number
  status?: string
  chatName?: string
  senderName?: string
  type: string
  text?: { message: string }
  image?: { caption?: string; imageUrl?: string }
  audio?: { audioUrl?: string }
  instanceId?: string
  isStatusReply?: boolean
  fromMe?: boolean
}

/**
 * Extrai número e texto de um payload Z-API inbound.
 * Retorna null se o evento deve ser ignorado.
 */
export function extrairMensagemZApi(raw: unknown): { numero: string; texto: string; nome: string } | null {
  const p = raw as ZApiWebhookPayload

  // Ignorar eventos irrelevantes
  if (p.type !== 'ReceivedCallback') return null

  // Ignorar mensagens enviadas pelo próprio bot
  if (p.fromMe === true) return null

  // Ignorar status replies (respostas automáticas de status do WhatsApp)
  if (p.isStatusReply === true) return null

  const texto = p.text?.message ?? ''
  if (!texto.trim()) return null

  const numero = normalizarTelefone(p.phone ?? '')
  if (!numero) return null

  return { numero, texto: texto.trim(), nome: p.senderName ?? p.chatName ?? '' }
}
