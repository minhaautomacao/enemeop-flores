/**
 * Instagram Graph API — envio de mensagens DM e salvamento de conversas
 *
 * Variáveis necessárias:
 *   INSTAGRAM_ACCESS_TOKEN   token de acesso do app Meta (Page/User token com instagram_manage_messages)
 *   INSTAGRAM_PAGE_ID        ID da página do Instagram (ex: 17841402064363907)
 */

import { getSupabase } from './supabase.js'

const ACCESS_TOKEN    = process.env.INSTAGRAM_ACCESS_TOKEN ?? ''
const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN ?? ''
const PAGE_ID         = process.env.INSTAGRAM_PAGE_ID ?? ''
const FB_PAGE_ID      = process.env.META_PAGE_ID ?? ''

export async function responderInstagram(recipientId: string, texto: string): Promise<boolean> {
  if (!ACCESS_TOKEN) {
    console.warn('[Instagram] INSTAGRAM_ACCESS_TOKEN não configurado — resposta não enviada')
    return false
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${PAGE_ID}/messages?access_token=${ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: texto },
          messaging_type: 'RESPONSE',
        }),
      }
    )
    const data = await res.json() as { message_id?: string; error?: { message: string } }
    if (data.error) {
      console.error('[Instagram] Erro Graph API:', data.error.message)
      return false
    }
    console.log(`[Instagram] ✓ Respondido ${recipientId} — id: ${data.message_id}`)
    return true
  } catch (e) {
    console.error('[Instagram] Falha ao enviar:', e)
    return false
  }
}

/**
 * Envia uma foto real de produto via Instagram DM (Graph API attachment de
 * imagem). Nunca deve ser chamada com uma URL inventada — o chamador
 * (funil.ts, responderPedidoDeFoto) só produz fotoUrl quando existe uma
 * URL real vinda do catálogo.
 */
export async function responderInstagramComFoto(recipientId: string, imagemUrl: string): Promise<boolean> {
  if (!ACCESS_TOKEN) {
    console.warn('[Instagram] INSTAGRAM_ACCESS_TOKEN não configurado — foto não enviada')
    return false
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${PAGE_ID}/messages?access_token=${ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { attachment: { type: 'image', payload: { url: imagemUrl, is_reusable: true } } },
          messaging_type: 'RESPONSE',
        }),
      }
    )
    const data = await res.json() as { message_id?: string; error?: { message: string } }
    if (data.error) {
      console.error('[Instagram] Erro Graph API ao enviar foto:', data.error.message)
      return false
    }
    console.log(`[Instagram] ✓ Foto enviada para ${recipientId} — id: ${data.message_id}`)
    return true
  } catch (e) {
    console.error('[Instagram] Falha ao enviar foto:', e)
    return false
  }
}

export async function responderComentarioInstagram(commentId: string, texto: string): Promise<boolean> {
  const token = ACCESS_TOKEN || PAGE_ACCESS_TOKEN
  if (!token) {
    console.warn('[Instagram] Token não configurado — comentário não respondido')
    return false
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${commentId}/replies?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: texto }),
      }
    )
    const data = await res.json() as { id?: string; error?: { message: string } }
    if (data.error) {
      console.error('[Instagram/Comentário] Erro:', data.error.message)
      return false
    }
    console.log(`[Instagram/Comentário] ✓ Respondido comentário ${commentId}`)
    return true
  } catch (e) {
    console.error('[Instagram/Comentário] Falha:', e)
    return false
  }
}

export async function responderComentarioFacebook(commentId: string, texto: string): Promise<boolean> {
  if (!PAGE_ACCESS_TOKEN) {
    console.warn('[Facebook] META_PAGE_ACCESS_TOKEN não configurado')
    return false
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${commentId}/comments?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: texto }),
      }
    )
    const data = await res.json() as { id?: string; error?: { message: string } }
    if (data.error) {
      console.error('[Facebook/Comentário] Erro:', data.error.message)
      return false
    }
    console.log(`[Facebook/Comentário] ✓ Respondido comentário ${commentId}`)
    return true
  } catch (e) {
    console.error('[Facebook/Comentário] Falha:', e)
    return false
  }
}

export async function salvarConversa(opts: {
  leadId: string
  canalId: string
  canal: 'instagram' | 'facebook' | 'whatsapp'
  historico: { role: string; content: string }[]
  fase?: string
  intencao?: string
  nomeExibido?: string
}): Promise<void> {
  const { leadId, canalId, canal, historico, fase, intencao, nomeExibido } = opts
  const sb = getSupabase()

  const { error } = await sb.from('conversas').upsert({
    lead_id:      leadId,
    canal_id:     canalId,
    canal,
    mensagens:    historico,
    fase:         fase ?? 'descoberta',
    intencao,
    nome_exibido: nomeExibido,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'canal_id' })

  if (error) console.error('[Instagram] Erro ao salvar conversa:', error.message)
}
