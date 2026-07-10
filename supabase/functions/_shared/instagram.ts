/**
 * instagram.ts — Envio de DM via Instagram Graph API
 *
 * Usa META_PAGE_ACCESS_TOKEN (env var ou funcao_configs).
 * Requer META_PAGE_ID configurado (ver .env.example).
 *
 * Docs: https://developers.facebook.com/docs/messenger-platform/instagram/
 */

import { getSupabaseAdmin } from './supabase.ts';

// Facebook Page ID conectada à conta do workspace (para Messenger API for Instagram)
const IG_PAGE_ID = Deno.env.get('META_PAGE_ID') ?? '';

async function getToken(): Promise<string> {
  // 1. Tenta env var (Supabase secret)
  const envToken = Deno.env.get('META_PAGE_ACCESS_TOKEN') ?? Deno.env.get('META_IG_ACCESS_TOKEN') ?? '';
  if (envToken) return envToken;

  // 2. Fallback: funcao_configs
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from('funcao_configs')
    .select('valor')
    .eq('chave', 'META_PAGE_ACCESS_TOKEN')
    .single();
  return (data?.valor as string) ?? '';
}

export interface ResultadoInstagram {
  enviado: boolean;
  erro?: string;
}

/**
 * Envia DM para um usuário Instagram que já iniciou conversa com @enemeopflores.
 * recipientId: Instagram Scoped User ID (canal_id do lead)
 */
export async function enviarDMInstagram(
  recipientId: string,
  mensagem: string,
): Promise<ResultadoInstagram> {
  if (!recipientId) return { enviado: false, erro: 'recipientId vazio' };
  if (!mensagem)    return { enviado: false, erro: 'mensagem vazia' };

  const token = await getToken();
  if (!token) return { enviado: false, erro: 'META_PAGE_ACCESS_TOKEN não configurado' };

  const url = `https://graph.facebook.com/v21.0/${IG_PAGE_ID}/messages`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: mensagem },
        messaging_type: 'RESPONSE',
      }),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => resp.status.toString());
      return { enviado: false, erro: `HTTP ${resp.status}: ${err}` };
    }

    return { enviado: true };
  } catch (e) {
    return { enviado: false, erro: String(e) };
  }
}
