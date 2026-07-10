import 'dotenv/config'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { iniciarWorkers } from './workers/orquestrador.js'
import { iniciarWorkerLogistica } from './workers/logistica.js'
import { getSupabase } from './lib/supabase.js'
import { processarMensagemSDR, processarMensagemSDRInstagram, processarComentarioSDR } from './lib/sdr.js'
import { extrairMensagemZApi } from './lib/whatsapp.js'

console.log('=== Fábrica de SaaS — Orquestrador Central ===')
console.log(`Ambiente: ${process.env.NODE_ENV ?? 'development'}`)
console.log(`Iniciando em: ${new Date().toLocaleString('pt-BR')}`)
console.log('')

if (process.env.WORKERS_ENABLED !== 'false') {
  iniciarWorkers()
  iniciarWorkerLogistica()
} else {
  console.log('[Orquestrador] WORKERS_ENABLED=false — workers BullMQ desativados (webhooks ativos)')
}

function lerBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
  })
}

const PORT = process.env.PORT ?? 3000
createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === 'POST' && req.url === '/webhook/whatsapp') {
    try {
      const raw = await lerBody(req)
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'invalid_json' }))
        return
      }

      // Z-API webhook: { type, phone, fromMe, text: { message }, senderName, ... }
      const msg = extrairMensagemZApi(parsed)
      if (msg) {
        const { numero, texto, nome } = msg
        console.log(`[Webhook/WhatsApp] Mensagem de ${nome ? nome + ' ' : ''}${numero}: ${texto.substring(0, 80)}`)

        const sb = getSupabase()
        const { data: leadExistente } = await sb
          .from('leads')
          .select('id')
          .eq('telefone', numero)
          .single()

        const { error } = await sb
          .from('leads')
          .upsert(
            {
              telefone: numero,
              canal: 'whatsapp',
              ultimo_contato: new Date().toISOString(),
              intencao: 'pesquisando',
              ...(nome ? { nome } : {}),
              ...(!leadExistente ? { mensagem_inicial: texto, status: 'novo' } : {}),
            },
            { onConflict: 'telefone' }
          )
        if (error) console.error('[Webhook/WhatsApp] Erro ao salvar lead:', error.message)

        processarMensagemSDR(numero, texto, nome).catch(e =>
          console.error('[Webhook/WhatsApp] Erro no SDR:', e)
        )
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ received: true }))
    } catch (err) {
      console.error('[Webhook/WhatsApp] Erro inesperado:', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'internal' }))
    }
    return
  }

  // ── Webhook Instagram / Meta ──────────────────────────────────────
  if (req.url?.startsWith('/webhook/instagram') || req.url?.startsWith('/webhook/meta')) {
    // Verificação do webhook (GET)
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost')
      const mode      = url.searchParams.get('hub.mode')
      const token     = url.searchParams.get('hub.verify_token')
      const challenge = url.searchParams.get('hub.challenge')
      const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN ?? ''
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        res.writeHead(200)
        res.end(challenge ?? '')
      } else {
        res.writeHead(403)
        res.end('Forbidden')
      }
      return
    }

    // Recebe DM do Instagram (POST)
    if (req.method === 'POST') {
      try {
        const raw = await lerBody(req)
        const payload = JSON.parse(raw)

        for (const entry of payload?.entry ?? []) {
          // ── DMs Instagram (messaging) ──
          for (const event of entry?.messaging ?? []) {
            const senderId = event?.sender?.id
            const texto    = event?.message?.text
            if (!senderId || !texto || event?.message?.is_echo) continue

            console.log(`[Webhook/Instagram] DM de ${senderId}: ${texto.substring(0, 80)}`)

            const sb = getSupabase()
            const { data: leadExistente } = await sb
              .from('leads')
              .select('id, nome_exibido')
              .eq('canal_id', senderId)
              .eq('canal', 'instagram')
              .single()

            let leadId = leadExistente?.id
            if (!leadId) {
              const { data: novoLead } = await sb.from('leads').insert({
                canal: 'instagram', canal_id: senderId,
                mensagem_inicial: texto, status: 'novo',
              }).select('id').single()
              leadId = novoLead?.id
            }

            processarMensagemSDRInstagram(senderId, texto, {
              leadId,
              nomeExibido: leadExistente?.nome_exibido ?? undefined,
            }).catch(e => console.error('[SDR/Instagram] Erro:', e.message))
          }

          // ── Comentários Instagram (changes) ──
          for (const change of entry?.changes ?? []) {
            if (change.field === 'comments') {
              const v = change.value
              // Ignora comentários próprios (da página)
              if (!v?.id || v?.from?.id === process.env.INSTAGRAM_PAGE_ID) continue
              const commentId = v.id as string
              const texto     = (v.text ?? '') as string
              const usuario   = (v.from?.username ?? v.from?.name ?? undefined) as string | undefined
              if (!texto) continue
              console.log(`[Webhook/Instagram] Comentário de ${usuario ?? 'anon'}: ${texto.substring(0, 80)}`)
              processarComentarioSDR('instagram', commentId, texto, usuario)
                .catch(e => console.error('[SDR/Instagram/Comentário] Erro:', e.message))
            }

            // ── Comentários Facebook (feed) ──
            if (change.field === 'feed') {
              const v = change.value
              if (v?.item !== 'comment' || v?.verb !== 'add') continue
              // Ignora comentários da própria página
              if (v?.from?.id === process.env.META_PAGE_ID) continue
              const commentId = v.comment_id as string
              const texto     = (v.message ?? '') as string
              const usuario   = (v.from?.name ?? undefined) as string | undefined
              if (!commentId || !texto) continue
              console.log(`[Webhook/Facebook] Comentário de ${usuario ?? 'anon'}: ${texto.substring(0, 80)}`)
              processarComentarioSDR('facebook', commentId, texto, usuario)
                .catch(e => console.error('[SDR/Facebook/Comentário] Erro:', e.message))
            }
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ received: true }))
      } catch (err) {
        console.error('[Webhook/Instagram] Erro:', err)
        res.writeHead(500)
        res.end(JSON.stringify({ error: 'internal' }))
      }
      return
    }
  }

  // Health check leve — usado pelo keep-alive do GitHub Actions
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"ok":true}')
    return
  }

  res.writeHead(404)
  res.end('')
}).listen(PORT, () => {
  console.log(`[Orquestrador] Servidor em http://0.0.0.0:${PORT}`)
  console.log(`[Orquestrador] Webhook WhatsApp (Z-API): POST /webhook/whatsapp`)
})

console.log('')
console.log('[Orquestrador] Aguardando eventos nas filas BullMQ...')
