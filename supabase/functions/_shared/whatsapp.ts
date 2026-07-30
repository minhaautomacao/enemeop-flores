/**
 * whatsapp.ts — Envio de mensagens WhatsApp.
 *
 * Suporta dois provedores (detectado automaticamente pelas credenciais):
 *   1. Evolution API (self-hosted) — tipo='evolution'
 *      Chaves: api_url, api_key, instance
 *   2. Z-API (cloud)              — tipo='whatsapp'
 *      Chaves: instance_id, token, client_token (opcional)
 *
 * Prioridade: Evolution API > Z-API
 * Se nenhum configurado: retorna { enviado: false, erro: '...' } sem lançar exceção.
 */

import { buscarTodasCredenciais } from './credentials.ts';
import { canSendWhatsAppMessage, type TipoMensagemWhatsApp } from './whatsapp-guard.ts';

export interface ResultadoEnvio {
  enviado: boolean;
  provedor?: string;
  erro?: string;
}

/**
 * Config de WHATSAPP_ACTIVE_NUMBER/WHATSAPP_OFFICIAL_NUMBER/etc. lida do
 * ambiente a cada chamada (nunca cacheada em módulo) — mesma fonte usada
 * por webhook-whatsapp/index.ts, garante os dois caminhos de envio
 * (funil da Flora e este SDR) obedecendo à mesma trava.
 */
function configEnvioWhatsApp() {
  return {
    numeroAtivo: Deno.env.get('WHATSAPP_ACTIVE_NUMBER') ?? '',
    numeroOficial: Deno.env.get('WHATSAPP_OFFICIAL_NUMBER') ?? '',
    numeroOficialBloqueado: (Deno.env.get('WHATSAPP_OFFICIAL_NUMBER_LOCKED') ?? 'true') !== 'false',
    marketingHabilitado: Deno.env.get('WHATSAPP_MARKETING_ENABLED') === 'true',
    safeStart: (Deno.env.get('WHATSAPP_SAFE_START') ?? 'true') !== 'false',
  };
}

// ── Normalizador de telefone ──────────────────────────────────────────────────

function normalizarTelefone(numero: string): string {
  const digits = numero.replace(/\D/g, '');
  // Garante código do país 55 para números brasileiros
  if (digits.length === 11 && !digits.startsWith('55')) return `55${digits}`;
  if (digits.length === 10 && !digits.startsWith('55')) return `55${digits}`;
  return digits;
}

// ── Evolution API ─────────────────────────────────────────────────────────────

async function enviarViaEvolution(
  creds: Record<string, string>,
  numero: string,
  mensagem: string,
): Promise<ResultadoEnvio> {
  const url = `${creds['api_url'].replace(/\/$/, '')}/message/sendText/${creds['instance']}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': creds['api_key'],
      },
      body: JSON.stringify({
        number: normalizarTelefone(numero),
        textMessage: { text: mensagem },
      }),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => resp.status.toString());
      return { enviado: false, provedor: 'evolution', erro: `HTTP ${resp.status}: ${err}` };
    }

    return { enviado: true, provedor: 'evolution' };
  } catch (e) {
    return { enviado: false, provedor: 'evolution', erro: String(e) };
  }
}

// ── Z-API ─────────────────────────────────────────────────────────────────────

async function enviarViaZapi(
  creds: Record<string, string>,
  numero: string,
  mensagem: string,
): Promise<ResultadoEnvio> {
  const url = `https://api.z-api.io/instances/${creds['instance_id']}/token/${creds['token']}/send-text`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (creds['client_token']) headers['Client-Token'] = creds['client_token'];

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ phone: normalizarTelefone(numero), message: mensagem }),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => resp.status.toString());
      return { enviado: false, provedor: 'zapi', erro: `HTTP ${resp.status}: ${err}` };
    }

    return { enviado: true, provedor: 'zapi' };
  } catch (e) {
    return { enviado: false, provedor: 'zapi', erro: String(e) };
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Envia mensagem WhatsApp usando as credenciais configuradas no workspace.
 * Tenta Evolution API primeiro, depois Z-API.
 * Nunca lança exceção — retorna { enviado: false, erro } se não conseguir.
 *
 * `tipo` é obrigatório (nunca tem default) — o chamador precisa decidir
 * explicitamente se é uma resposta dentro de atendimento em andamento
 * ('transacional') ou uma mensagem iniciada pela empresa/campanha/
 * reativação/abordagem fria ('iniciada_pela_empresa', só sai com
 * WHATSAPP_MARKETING_ENABLED=true). Achado de auditoria 2026-07-30: este é
 * o único caminho de envio do SDR (whatsapp-sdr) — sem essa trava, toda
 * mensagem recebida no WhatsApp disparava uma SEGUNDA mensagem
 * independente da resposta normal da Flora, risco real de banimento.
 */
export async function enviarWhatsApp(
  workspaceId: string | undefined,
  numero: string | undefined | null,
  mensagem: string,
  tipo: TipoMensagemWhatsApp,
): Promise<ResultadoEnvio> {
  if (!workspaceId) return { enviado: false, erro: 'workspace_id não informado' };
  if (!numero)      return { enviado: false, erro: 'Número de telefone não informado no payload' };
  if (!mensagem)    return { enviado: false, erro: 'Mensagem vazia' };

  const validacao = canSendWhatsAppMessage(configEnvioWhatsApp(), {
    tipo,
    // whatsapp-sdr opera sobre `leads`, não sobre a conversa da Flora
    // (`conversas`) — não tem visibilidade de handoff humano/opt-out/
    // duplicidade dessa camada; nunca finge que sabe algo que não sabe.
    // A proteção real contra esses casos, hoje, é o gate de marketing acima
    // (mensagem 'iniciada_pela_empresa' só sai com habilitação explícita).
    atendimentoHumanoAtivo: false,
    optOut: false,
    mensagemDuplicada: false,
  });
  if (!validacao.permitido) {
    console.error(`[whatsapp-guard] envio bloqueado: ${validacao.motivo}`);
    return { enviado: false, erro: `Envio bloqueado: ${validacao.motivo}` };
  }

  // Tenta Evolution API (banco ou env vars)
  const evoCreds = await buscarTodasCredenciais(workspaceId, 'evolution');
  const evo = {
    api_url:  evoCreds['api_url']  || Deno.env.get('EVOLUTION_API_URL')  || '',
    api_key:  evoCreds['api_key']  || Deno.env.get('EVOLUTION_API_KEY')  || '',
    instance: evoCreds['instance'] || Deno.env.get('EVOLUTION_INSTANCE') || '',
  };
  if (evo.api_url && evo.api_key && evo.instance) {
    return enviarViaEvolution(evo, numero, mensagem);
  }

  // Tenta Z-API (banco ou env vars)
  const zapiCreds = await buscarTodasCredenciais(workspaceId, 'whatsapp');
  const zapi = {
    instance_id:  zapiCreds['instance_id']  || Deno.env.get('ZAPI_INSTANCE_ID')  || '',
    token:        zapiCreds['token']        || Deno.env.get('ZAPI_TOKEN')        || '',
    client_token: zapiCreds['client_token'] || Deno.env.get('ZAPI_CLIENT_TOKEN') || '',
  };
  if (zapi.instance_id && zapi.token) {
    return enviarViaZapi(zapi, numero, mensagem);
  }

  return { enviado: false, erro: 'Nenhuma credencial WhatsApp configurada para este workspace' };
}
