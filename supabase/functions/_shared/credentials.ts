/**
 * credentials.ts — Busca e descriptografa credenciais do workspace.
 *
 * Compatível com o formato AES-256-GCM do src/lib/crypto.ts (Node.js):
 *   encrypt() → { ciphertext: hex(encrypted+tag), iv: hex(12 bytes) }
 *
 * Usa Web Crypto API (Deno) — sem dependências externas.
 *
 * Chaves padronizadas por tipo:
 *   evolution:    api_url, api_key, instance
 *   whatsapp:     instance_id, token, client_token (Z-API)
 *   email:        api_key, from
 *   mercadopago:  access_token, public_key
 *   stripe:       secret_key, webhook_secret
 *   logistica:    melhor_envio_token, cep_origem
 *   openbanking:  (livre por provedor)
 */

import { getSupabaseAdmin } from './supabase.ts';

// ── Utilitário hex ────────────────────────────────────────────────────────────

function fromHex(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) throw new Error(`Hex inválido (length=${clean.length})`);
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

// ── Descriptografia AES-256-GCM ───────────────────────────────────────────────

async function descriptografar(ciphertext: string, iv: string): Promise<string> {
  if (iv === 'plain') return ciphertext;

  const keyHex = Deno.env.get('CREDENTIAL_ENCRYPTION_KEY') ?? '';
  if (!keyHex) throw new Error('CREDENTIAL_ENCRYPTION_KEY não configurada nas Edge Function secrets');

  const keyBytes = fromHex(keyHex);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );

  // O Node.js armazena: concat(encrypted, auth_tag_16bytes)
  // Web Crypto espera exatamente o mesmo formato com tagLength=128
  const combined  = fromHex(ciphertext);
  const ivBytes   = fromHex(iv);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes, tagLength: 128 },
    key,
    combined,
  );

  return new TextDecoder().decode(plaintext);
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Busca e descriptografa uma credencial específica do workspace.
 * Retorna null se não encontrada, inativa ou workspaceId ausente.
 */
export async function buscarCredencial(
  workspaceId: string | undefined,
  tipo: string,
  chave: string,
): Promise<string | null> {
  if (!workspaceId) return null;

  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from('workspace_credentials')
    .select('valor, iv')
    .eq('workspace_id', workspaceId)
    .eq('tipo', tipo)
    .eq('chave', chave)
    .eq('ativo', true)
    .maybeSingle();

  if (!data) return null;

  try {
    return await descriptografar(data.valor, data.iv);
  } catch {
    return null;
  }
}

/**
 * Busca e descriptografa TODAS as credenciais de um tipo para o workspace.
 * Retorna Record<chave, valor_descriptografado>.
 * Ignora silenciosamente credenciais corrompidas.
 */
export async function buscarTodasCredenciais(
  workspaceId: string | undefined,
  tipo: string,
): Promise<Record<string, string>> {
  if (!workspaceId) return {};

  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from('workspace_credentials')
    .select('chave, valor, iv')
    .eq('workspace_id', workspaceId)
    .eq('tipo', tipo)
    .eq('ativo', true);

  if (!data || data.length === 0) return {};

  const resultado: Record<string, string> = {};
  await Promise.all(
    data.map(async (row) => {
      try {
        resultado[row.chave] = await descriptografar(row.valor, row.iv);
      } catch { /* ignora corrompida */ }
    }),
  );
  return resultado;
}
