/**
 * zapi-status — consulta status da instância Z-API e, sob pedido explícito,
 * busca um novo QR Code para vincular um número ao WhatsApp.
 *
 * Chamada só internamente (painel /dashboard/configuracoes/whatsapp, via
 * app/api/whatsapp/zapi/route.ts) — publicada com --no-verify-jwt (não roda
 * sob autenticação de usuário Supabase), mas exige
 * "Authorization: Bearer <FACTORY_SECRET>" (ver _shared/auth-crm.ts), mesmo
 * padrão de agente-logistica.
 *
 * IMPORTANTE — risco real de desconexão: pedir um QR Code novo a uma
 * instância Z-API JÁ conectada pode invalidar a sessão atual (comportamento
 * comum em pontes não oficiais de WhatsApp Web) e derrubar o número que já
 * está funcionando. Esta função nunca decide sozinha quando buscar um QR —
 * quem chama (o painel) deve mostrar o status atual e exigir confirmação
 * explícita do usuário antes de disparar action="qrcode". Nunca use
 * action="qrcode" contra o número oficial da loja nem sem confirmação
 * humana prévia.
 */

import { buscarCredencial } from '../_shared/credentials.ts';
import { factorySecretValido } from '../_shared/auth-crm.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const WORKSPACE_ID = Deno.env.get('SAAS_WORKSPACE_ID') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

interface CredenciaisZapi {
  instanceId: string;
  token: string;
  clientToken?: string;
}

async function carregarCredenciaisZapi(workspaceId: string): Promise<CredenciaisZapi | null> {
  const [instanceId, token, clientToken] = await Promise.all([
    buscarCredencial(workspaceId, 'whatsapp', 'instance_id'),
    buscarCredencial(workspaceId, 'whatsapp', 'token'),
    buscarCredencial(workspaceId, 'whatsapp', 'client_token'),
  ]);
  if (!instanceId || !token) return null;
  return { instanceId, token, clientToken: clientToken ?? undefined };
}

function headersZapi(creds: CredenciaisZapi): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (creds.clientToken) headers['Client-Token'] = creds.clientToken;
  return headers;
}

const TIMEOUT_ZAPI_MS = 15_000;

/** Consulta real de status — nunca altera a sessão, só lê. */
async function consultarStatus(creds: CredenciaisZapi): Promise<{ conectado: boolean; bruto: unknown } | { erro: string }> {
  const url = `https://api.z-api.io/instances/${creds.instanceId}/token/${creds.token}/status`;
  try {
    const resp = await fetch(url, { headers: headersZapi(creds), signal: AbortSignal.timeout(TIMEOUT_ZAPI_MS) });
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => resp.status.toString());
      return { erro: `HTTP ${resp.status}: ${corpo}` };
    }
    const data = await resp.json();
    // Campo real observado na documentação Z-API é "connected" — mas o
    // formato exato pode variar entre versões da API; nunca esconde o
    // corpo bruto, pra quem chama poder inspecionar se o campo divergir.
    const conectado = data?.connected === true || data?.smartphoneConnected === true;
    return { conectado, bruto: data };
  } catch (e) {
    const motivo = e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : String(e);
    return { erro: motivo };
  }
}

/**
 * Busca um QR Code novo direto na Z-API e persiste em qr_temp (mesma tabela
 * já usada pelo recebimento passivo de eventos em captura-qr/index.ts) —
 * nunca inventa um formato novo de armazenamento. Ver aviso de risco no
 * cabeçalho do arquivo antes de chamar.
 */
async function buscarQrCode(creds: CredenciaisZapi): Promise<{ qrCodeBase64: string } | { erro: string }> {
  const url = `https://api.z-api.io/instances/${creds.instanceId}/token/${creds.token}/qr-code/image`;
  try {
    const resp = await fetch(url, { headers: headersZapi(creds), signal: AbortSignal.timeout(TIMEOUT_ZAPI_MS) });
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => resp.status.toString());
      return { erro: `HTTP ${resp.status}: ${corpo}` };
    }
    const contentType = resp.headers.get('content-type') ?? '';
    let qrCodeBase64: string;
    if (contentType.includes('application/json')) {
      // Algumas contas/versões da Z-API devolvem JSON com o campo "value"
      // (data URI) em vez da imagem crua — cobre os dois formatos.
      const data = await resp.json();
      const valor = (data?.value ?? data?.qrcode ?? '') as string;
      if (!valor) return { erro: 'resposta da Z-API sem QR Code (campo value/qrcode ausente)' };
      qrCodeBase64 = valor.startsWith('data:') ? valor : `data:image/png;base64,${valor}`;
    } else {
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const base64 = btoa(bytes.reduce((s, b) => s + String.fromCharCode(b), ''));
      qrCodeBase64 = `data:image/png;base64,${base64}`;
    }

    if (SUPABASE_URL && SERVICE_KEY) {
      const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
      await db.from('qr_temp').insert({ nome: 'zapi-status-fetch-manual', base64: qrCodeBase64 });
    }

    return { qrCodeBase64 };
  } catch (e) {
    const motivo = e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : String(e);
    return { erro: motivo };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ erro: 'método não suportado' }), { status: 405 });
  }

  if (!(await factorySecretValido(req))) {
    return new Response(JSON.stringify({ erro: 'não autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: { action?: string; workspace_id?: string };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ erro: 'payload inválido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const workspaceId = payload.workspace_id ?? WORKSPACE_ID;
  const action = payload.action === 'qrcode' ? 'qrcode' : 'status';

  if (!workspaceId) {
    return new Response(JSON.stringify({ erro: 'workspace_id não informado' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const creds = await carregarCredenciaisZapi(workspaceId);
  if (!creds) {
    return new Response(JSON.stringify({ erro: 'Credenciais Z-API (instance_id/token) não configuradas para este workspace' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const resultado = action === 'qrcode' ? await buscarQrCode(creds) : await consultarStatus(creds);
  const status = 'erro' in resultado ? 502 : 200;
  return new Response(JSON.stringify(resultado), { status, headers: { 'Content-Type': 'application/json' } });
});
