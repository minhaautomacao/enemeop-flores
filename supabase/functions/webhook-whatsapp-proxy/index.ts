/**
 * webhook-whatsapp-proxy
 *
 * Proxy de webhook WhatsApp — recebe todas as mensagens e distribui para:
 *   1. Sistema antigo (SEMPRE, chamado primeiro, isolado)
 *   2. Fábrica de SaaS (somente se SAAS_WHATSAPP_ACTIVE=true)
 *
 * Variáveis de ambiente necessárias:
 *   WHATSAPP_OLD_SYSTEM_WEBHOOK  → URL webhook do sistema antigo (floricultura)
 *   SAAS_WHATSAPP_ACTIVE         → "true" para ativar Fábrica | "false" = modo seguro
 *   FACTORY_SECRET               → token do orquestrador
 *   SAAS_WORKSPACE_ID            → workspace_id da floricultura na Fábrica
 *   SUPABASE_URL                 → auto-injetado pelo Supabase
 *   SUPABASE_SERVICE_ROLE_KEY    → auto-injetado pelo Supabase
 */

const OLD_WEBHOOK   = Deno.env.get('WHATSAPP_OLD_SYSTEM_WEBHOOK') ?? '';
const SAAS_ACTIVE   = Deno.env.get('SAAS_WHATSAPP_ACTIVE') === 'true';
const FACTORY_SECRET = Deno.env.get('FACTORY_SECRET') ?? '';
const WORKSPACE_ID  = Deno.env.get('SAAS_WORKSPACE_ID') ?? '';
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? '';

// Timeout helpers
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)
    ),
  ]);
}

// Detecta se é mensagem real do usuário (não status, receipt, etc.)
function ehMensagemReal(body: Record<string, unknown>): boolean {
  // Evolution API
  if (body['event'] === 'messages.upsert') return true;
  if (body['event'] === 'message') return true;
  // Z-API
  if (body['type'] === 'ReceivedCallback') return true;
  // WhatsApp Cloud API (Meta)
  const entry = body['entry'];
  if (Array.isArray(entry) && entry.length > 0) return true;
  return false;
}

// Extrai texto da mensagem para log
function extrairTexto(body: Record<string, unknown>): string {
  try {
    // Evolution API
    const data = body['data'] as Record<string, unknown> | undefined;
    if (data) {
      const msg = data['message'] as Record<string, unknown> | undefined;
      if (msg?.['conversation']) return String(msg['conversation']).slice(0, 100);
      if (msg?.['extendedTextMessage']) {
        const ext = msg['extendedTextMessage'] as Record<string, unknown>;
        return String(ext['text'] ?? '').slice(0, 100);
      }
    }
    // Z-API
    if (body['text']) return String(body['text']).slice(0, 100);
  } catch { /* ignora */ }
  return '[mensagem não-textual]';
}

// Extrai número/ID do remetente para identificar o lead
function extrairRemetente(body: Record<string, unknown>): string {
  try {
    // Evolution API
    const data = body['data'] as Record<string, unknown> | undefined;
    if (data?.['key']) {
      const key = data['key'] as Record<string, unknown>;
      return String(key['remoteJid'] ?? '').replace('@s.whatsapp.net', '');
    }
    // Z-API
    if (body['phone']) return String(body['phone']);
    // WhatsApp Cloud API
    const entry = body['entry'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(entry) && entry[0]) {
      const changes = entry[0]['changes'] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(changes) && changes[0]) {
        const val = changes[0]['value'] as Record<string, unknown> | undefined;
        const msgs = val?.['messages'] as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(msgs) && msgs[0]) return String(msgs[0]['from'] ?? '');
      }
    }
  } catch { /* ignora */ }
  return '';
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  // Parse do body — em caso de erro, retorna 200 para não causar retry no WhatsApp
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response('ok', { status: 200 });
  }

  const ehReal = ehMensagemReal(body);
  console.log(`[proxy] mensagem recebida | real=${ehReal} | texto="${extrairTexto(body)}" | saas_ativo=${SAAS_ACTIVE}`);

  // ── PASSO 1: Sistema Antigo (SEMPRE, primeiro, isolado) ─────────────
  if (OLD_WEBHOOK) {
    try {
      const resp = await withTimeout(
        fetch(OLD_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        6000, // 6s timeout para o sistema antigo
      );
      console.log(`[proxy] sistema-antigo → ${resp.status}`);
    } catch (e) {
      // Loga mas NUNCA propaga — o WhatsApp não deve receber erro
      console.error(`[proxy] sistema-antigo erro (não crítico): ${e}`);
    }
  } else {
    console.warn('[proxy] WHATSAPP_OLD_SYSTEM_WEBHOOK não configurado — sistema antigo ignorado');
  }

  // ── PASSO 2: Fábrica de SaaS (somente se ativa) ─────────────────────
  if (SAAS_ACTIVE && ehReal && WORKSPACE_ID && FACTORY_SECRET) {
    try {
      const resp = await withTimeout(
        fetch(`${SUPABASE_URL}/functions/v1/orquestrador`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${FACTORY_SECRET}`,
          },
          body: JSON.stringify({
            tipo: 'novo-lead',
            task_id: crypto.randomUUID(),
            escopo: 'producao',
            urgencia: 'normal',
            workspace_id: WORKSPACE_ID,
            payload: {
              canal: 'whatsapp',
              mensagem: extrairTexto(body),
              canal_id: extrairRemetente(body),
              raw: body,
            },
          }),
        }),
        8000, // 8s timeout — falha silenciosa, sistema antigo já foi servido
      );
      console.log(`[proxy] fabrica-saas → ${resp.status}`);
    } catch (e) {
      console.error(`[proxy] fabrica-saas erro (não crítico, sistema antigo ok): ${e}`);
    }
  } else if (SAAS_ACTIVE && !ehReal) {
    console.log('[proxy] fabrica-saas ignorada — não é mensagem real (status/receipt)');
  } else if (!SAAS_ACTIVE) {
    console.log('[proxy] fabrica-saas desativada (SAAS_WHATSAPP_ACTIVE=false) — modo seguro');
  }

  // Sempre retorna 200 para o WhatsApp não reenviar
  return new Response('ok', { status: 200 });
});
