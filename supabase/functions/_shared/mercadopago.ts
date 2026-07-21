/**
 * mercadopago.ts — Checkout Pro do Mercado Pago (produção, nunca sandbox).
 *
 * Substitui Cielo no fluxo ativo da Flora: não existe nenhuma credencial
 * tipo='cielo' em workspace_credentials (só tipo='financeiro', mp_*, já
 * configurada). Ver docs/CURRENT_STATE.md para o achado completo.
 *
 * Credenciais usadas (workspace_credentials, tipo='financeiro'):
 *   mp_access_token   — obrigatória, usada em toda chamada à API.
 *   mp_webhook_secret — opcional hoje (ainda não configurada); usada só
 *     pra validar a assinatura x-signature do webhook. Sem ela,
 *     validarAssinaturaWebhook devolve 'sem_segredo_configurado' — quem
 *     chama decide como agir (a segunda camada de defesa real é sempre
 *     buscar o pagamento na API do Mercado Pago antes de confiar em
 *     qualquer coisa vinda do corpo/query da notificação).
 */

import { buscarCredencial } from './credentials.ts';
import { validarAssinaturaComSegredo } from './mercadopago-assinatura.ts';

export { validarAssinaturaComSegredo } from './mercadopago-assinatura.ts';

const API_BASE = 'https://api.mercadopago.com';

export interface ItemPreferencia {
  titulo: string;
  quantidade: number;
  precoUnitarioReais: number;
}

export interface OpcoesPreferencia {
  /** Único por pedido — nunca reaproveitado. Usado como external_reference
   * da preference e como chave de idempotência da chamada à API. */
  externalReference: string;
  itens: ItemPreferencia[];
  notificationUrl: string;
  backUrls: { success: string; failure: string; pending: string };
  metadata: Record<string, string>;
}

export interface ResultadoPreferencia {
  criado: boolean;
  preferenceId?: string;
  /** Sempre o link de produção (init_point) — nunca sandbox_init_point. */
  initPoint?: string;
  erro?: string;
}

/**
 * Cria uma preference real no Mercado Pago. Não decide idempotência aqui —
 * quem chama (webhook-meta) deve checar antes se o pedido já tem
 * mp_preference_id salvo e, se tiver, reusar o link existente em vez de
 * chamar esta função de novo.
 */
export async function criarPreferenciaMercadoPago(
  workspaceId: string | undefined,
  opcoes: OpcoesPreferencia,
): Promise<ResultadoPreferencia> {
  const accessToken = await buscarCredencial(workspaceId, 'financeiro', 'mp_access_token');
  if (!accessToken) {
    return { criado: false, erro: 'Credenciais Mercado Pago (mp_access_token) não configuradas.' };
  }
  if (opcoes.itens.length === 0) {
    return { criado: false, erro: 'Nenhum item pra cobrar — preference não deve ser criada sem produto real.' };
  }

  const payload = {
    items: opcoes.itens.map(i => ({
      title: i.titulo,
      quantity: i.quantidade,
      unit_price: i.precoUnitarioReais,
      currency_id: 'BRL',
    })),
    external_reference: opcoes.externalReference,
    notification_url: opcoes.notificationUrl,
    back_urls: opcoes.backUrls,
    auto_return: 'approved',
    metadata: opcoes.metadata,
  };

  try {
    const resp = await fetch(`${API_BASE}/checkout/preferences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        // A API de preferences não documenta idempotência por header do
        // mesmo jeito que /v1/payments — a idempotência real deste fluxo é
        // garantida pelo chamador (não cria preference nova se o pedido já
        // tem mp_preference_id). Header enviado mesmo assim, defensivo.
        'X-Idempotency-Key': opcoes.externalReference,
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => String(resp.status));
      return { criado: false, erro: `HTTP ${resp.status}: ${err}` };
    }
    const data = await resp.json() as { id?: string; init_point?: string };
    if (!data.id || !data.init_point) {
      return { criado: false, erro: 'Resposta da API sem id/init_point.' };
    }
    return { criado: true, preferenceId: data.id, initPoint: data.init_point };
  } catch (e) {
    return { criado: false, erro: String(e) };
  }
}

export interface PagamentoReal {
  id: string;
  /** 'approved' | 'pending' | 'in_process' | 'rejected' | 'cancelled' | 'refunded' | ... */
  status: string;
  valor: number;
  metodo: string;
  externalReference: string | null;
}

/**
 * Busca o pagamento DIRETO na API do Mercado Pago pelo id — nunca confia em
 * status/valor vindos do corpo da notificação do webhook.
 */
export async function buscarPagamentoReal(
  workspaceId: string | undefined,
  paymentId: string,
): Promise<PagamentoReal | null> {
  const accessToken = await buscarCredencial(workspaceId, 'financeiro', 'mp_access_token');
  if (!accessToken) return null;
  try {
    const resp = await fetch(`${API_BASE}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as {
      id: number;
      status: string;
      transaction_amount: number;
      payment_type_id: string;
      external_reference?: string;
    };
    return {
      id: String(data.id),
      status: data.status,
      valor: data.transaction_amount,
      metodo: data.payment_type_id,
      externalReference: data.external_reference ?? null,
    };
  } catch {
    return null;
  }
}

export interface PreferenciaExistente {
  encontrada: boolean;
  preferenceId?: string;
  initPoint?: string;
}

/**
 * Busca DIRETO na API do Mercado Pago se já existe uma preference criada
 * para este external_reference — nunca cria uma nova. Único uso: reconciliar
 * um pedido travado em mp_preference_status='criando' (a chamada de criação
 * pode ter tido sucesso do lado do Mercado Pago mesmo que a persistência
 * local tenha falhado) — ver função pagamento-reconciliar.
 */
export async function buscarPreferenciaPorExternalReference(
  workspaceId: string | undefined,
  externalReference: string,
): Promise<PreferenciaExistente> {
  const accessToken = await buscarCredencial(workspaceId, 'financeiro', 'mp_access_token');
  if (!accessToken) return { encontrada: false };
  try {
    const url = `${API_BASE}/checkout/preferences/search?external_reference=${encodeURIComponent(externalReference)}`;
    const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (!resp.ok) return { encontrada: false };
    const data = await resp.json() as { results?: Array<{ id?: string; init_point?: string }> };
    const primeira = data.results?.[0];
    if (!primeira?.id || !primeira?.init_point) return { encontrada: false };
    return { encontrada: true, preferenceId: primeira.id, initPoint: primeira.init_point };
  } catch {
    return { encontrada: false };
  }
}

/**
 * Valida a assinatura x-signature do webhook (ver algoritmo em
 * mercadopago-assinatura.ts). 'sem_segredo_configurado' quando a credencial
 * mp_webhook_secret ainda não existe — quem chama decide se prossegue
 * (sempre com a segunda camada de defesa: buscar o pagamento real via
 * buscarPagamentoReal antes de confiar em qualquer dado do webhook).
 */
export async function validarAssinaturaWebhook(
  workspaceId: string | undefined,
  xSignature: string | null,
  xRequestId: string | null,
  dataId: string,
): Promise<'valida' | 'invalida' | 'sem_segredo_configurado'> {
  const secret = await buscarCredencial(workspaceId, 'financeiro', 'mp_webhook_secret');
  if (!secret) return 'sem_segredo_configurado';
  return validarAssinaturaComSegredo(secret, xSignature, xRequestId, dataId);
}
