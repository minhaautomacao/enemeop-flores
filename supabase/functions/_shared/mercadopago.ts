/**
 * mercadopago.ts — Checkout Pro do Mercado Pago, produção E teste.
 *
 * Substitui Cielo no fluxo ativo da Flora: não existe nenhuma credencial
 * tipo='cielo' em workspace_credentials (só tipo='financeiro', mp_*, já
 * configurada). Ver docs/CURRENT_STATE.md para o achado completo.
 *
 * Ambiente ('producao' | 'teste', default 'producao' em toda função) decide
 * qual par de credenciais é usado — NUNCA inferido aqui, sempre recebido
 * como parâmetro explícito de quem chama. Isso é o que garante que o
 * ambiente nunca é escolhido pelo cliente/navegador: a decisão vive em
 * configuração de servidor (coluna pedidos.mp_ambiente, ou env var em
 * flora-internal-test), nunca em input de requisição HTTP.
 *
 * Credenciais usadas (workspace_credentials, tipo='financeiro'):
 *   mp_access_token         — produção, obrigatória, usada em toda chamada à API.
 *   mp_access_token_teste   — teste, mesmo papel, ambiente sandbox do Mercado Pago.
 *   mp_webhook_secret       — opcional hoje; valida a assinatura x-signature
 *     do webhook de produção. Sem ela, validarAssinaturaWebhook devolve
 *     'sem_segredo_configurado' — quem chama decide como agir (a segunda
 *     camada de defesa real é sempre buscar o pagamento na API do Mercado
 *     Pago antes de confiar em qualquer coisa vinda do corpo/query da
 *     notificação).
 *   mp_webhook_secret_teste — mesmo papel, ambiente teste. Se o Mercado Pago
 *     usar o mesmo secret pros dois modos, essa chave simplesmente nunca é
 *     configurada e a validação em ambiente teste sempre cai em
 *     'sem_segredo_configurado' (comportamento tolerante, igual ao de hoje).
 */

import { buscarCredencial } from './credentials.ts';
import { validarAssinaturaComSegredo } from './mercadopago-assinatura.ts';
import { montarRequisicaoEstorno } from './mercadopago-estorno-payload.ts';

export { validarAssinaturaComSegredo } from './mercadopago-assinatura.ts';
export { montarRequisicaoEstorno, type RequisicaoEstorno } from './mercadopago-estorno-payload.ts';

const API_BASE = 'https://api.mercadopago.com';

export type AmbienteMercadoPago = 'producao' | 'teste';

const CHAVE_ACCESS_TOKEN: Record<AmbienteMercadoPago, string> = {
  producao: 'mp_access_token',
  teste: 'mp_access_token_teste',
};
const CHAVE_WEBHOOK_SECRET: Record<AmbienteMercadoPago, string> = {
  producao: 'mp_webhook_secret',
  teste: 'mp_webhook_secret_teste',
};

async function buscarAccessToken(workspaceId: string | undefined, ambiente: AmbienteMercadoPago): Promise<string | null> {
  return buscarCredencial(workspaceId, 'financeiro', CHAVE_ACCESS_TOKEN[ambiente]);
}

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
  ambiente: AmbienteMercadoPago = 'producao',
): Promise<ResultadoPreferencia> {
  const accessToken = await buscarAccessToken(workspaceId, ambiente);
  if (!accessToken) {
    return { criado: false, erro: `Credenciais Mercado Pago (${CHAVE_ACCESS_TOKEN[ambiente]}) não configuradas.` };
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

export interface OpcoesPagamentoPix {
  /** Mesmo external_reference já usado na preference/pedido — nunca um novo, pra o webhook sempre localizar o mesmo pedido. */
  externalReference: string;
  valorTotal: number;
  descricao: string;
  notificationUrl: string;
}

export interface ResultadoPagamentoPix {
  criado: boolean;
  paymentId?: string;
  /** PNG em base64 retornado pela API — quem chama decide onde persistir/servir (ver pedido-repositorio.ts, que sobe pro Storage). */
  qrCodeBase64?: string;
  /** Código "Pix copia e cola" — enviado como texto junto da imagem do QR Code. */
  qrCodeCopiaCola?: string;
  /** Quando o QR Code expira, segundo o Mercado Pago. */
  expiraEm?: string;
  erro?: string;
}

/**
 * Cria um pagamento Pix real (Payments API — diferente da preference do
 * Checkout Pro criada por criarPreferenciaMercadoPago) para o MESMO pedido
 * (mesmo externalReference), pra o cliente pagar escaneando um QR Code
 * exibido na conversa em vez de abrir o link do Checkout Pro. Nunca cobra
 * nada sozinho: o Pix só é debitado quando o cliente escaneia e confirma no
 * app do banco dele — criar o pagamento aqui só gera a cobrança pendente.
 */
export async function criarPagamentoPixMercadoPago(
  workspaceId: string | undefined,
  opcoes: OpcoesPagamentoPix,
  ambiente: AmbienteMercadoPago = 'producao',
): Promise<ResultadoPagamentoPix> {
  const accessToken = await buscarAccessToken(workspaceId, ambiente);
  if (!accessToken) {
    return { criado: false, erro: `Credenciais Mercado Pago (${CHAVE_ACCESS_TOKEN[ambiente]}) não configuradas.` };
  }

  const payload = {
    transaction_amount: opcoes.valorTotal,
    description: opcoes.descricao,
    payment_method_id: 'pix',
    external_reference: opcoes.externalReference,
    notification_url: opcoes.notificationUrl,
    // payer.email é exigido pela API pra pagamento Pix direto — endereço
    // técnico no domínio real da loja, nunca exibido ao cliente nem usado
    // pra contato, só satisfaz o schema obrigatório do Mercado Pago.
    payer: { email: `pedido-${opcoes.externalReference}@enemeopflores.com.br` },
  };

  try {
    const resp = await fetch(`${API_BASE}/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        // Chave real de idempotência da API de pagamentos (diferente de
        // preferences, que não documenta isso) — reenviar a mesma chamada
        // (retry de rede) nunca cria um segundo pagamento Pix.
        'X-Idempotency-Key': `pix-${opcoes.externalReference}`,
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => String(resp.status));
      return { criado: false, erro: `HTTP ${resp.status}: ${err}` };
    }
    const data = await resp.json() as {
      id?: number;
      point_of_interaction?: { transaction_data?: { qr_code_base64?: string; qr_code?: string } };
      date_of_expiration?: string;
    };
    const qrBase64 = data.point_of_interaction?.transaction_data?.qr_code_base64;
    const copiaCola = data.point_of_interaction?.transaction_data?.qr_code;
    if (!data.id || !qrBase64 || !copiaCola) {
      return { criado: false, erro: 'Resposta da API sem QR Code Pix (id/qr_code_base64/qr_code ausente).' };
    }
    return { criado: true, paymentId: String(data.id), qrCodeBase64: qrBase64, qrCodeCopiaCola: copiaCola, expiraEm: data.date_of_expiration };
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
 * Resultado discriminado de buscarPagamentoReal — motivo importa: só
 * 'nao_encontrado' (HTTP 404) é elegível para o fallback produção→teste do
 * webhook (ver _shared/resolucao-ambiente.ts). Qualquer outro motivo
 * ('erro_transitorio': 401/500/timeout/rede, ou 'sem_credencial') precisa
 * propagar como falha real, nunca ser mascarado como "não encontrado neste
 * ambiente" — misturar os dois casos tornaria o fallback inseguro sob
 * instabilidade da API do Mercado Pago.
 */
export type ResultadoBuscaPagamento =
  | { ok: true; pagamento: PagamentoReal }
  | { ok: false; motivo: 'nao_encontrado' }
  | { ok: false; motivo: 'sem_credencial' }
  | { ok: false; motivo: 'erro_transitorio'; detalhe: string };

/**
 * Busca o pagamento DIRETO na API do Mercado Pago pelo id — nunca confia em
 * status/valor vindos do corpo da notificação do webhook.
 */
export async function buscarPagamentoReal(
  workspaceId: string | undefined,
  paymentId: string,
  ambiente: AmbienteMercadoPago = 'producao',
): Promise<ResultadoBuscaPagamento> {
  const accessToken = await buscarAccessToken(workspaceId, ambiente);
  if (!accessToken) return { ok: false, motivo: 'sem_credencial' };
  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
  } catch (e) {
    return { ok: false, motivo: 'erro_transitorio', detalhe: String(e) };
  }
  if (resp.status === 404) return { ok: false, motivo: 'nao_encontrado' };
  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    return { ok: false, motivo: 'erro_transitorio', detalhe: `HTTP ${resp.status}: ${err.slice(0, 200)}` };
  }
  try {
    const data = await resp.json() as {
      id: number;
      status: string;
      transaction_amount: number;
      payment_type_id: string;
      external_reference?: string;
    };
    return {
      ok: true,
      pagamento: {
        id: String(data.id),
        status: data.status,
        valor: data.transaction_amount,
        metodo: data.payment_type_id,
        externalReference: data.external_reference ?? null,
      },
    };
  } catch (e) {
    return { ok: false, motivo: 'erro_transitorio', detalhe: `resposta invalida: ${String(e)}` };
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
  ambiente: AmbienteMercadoPago = 'producao',
): Promise<PreferenciaExistente> {
  const accessToken = await buscarAccessToken(workspaceId, ambiente);
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

export interface ResultadoEstorno {
  ok: boolean;
  refundId?: string;
  /** Status devolvido pelo Mercado Pago para o estorno em si — 'approved' é
   * o único caso realmente concluído; 'pending'/'in_process' precisam de
   * acompanhamento posterior (nunca tratados como sucesso definitivo aqui). */
  status?: string;
  erro?: string;
}

/**
 * Estorna um pagamento real (total, ou parcial se `valorReais` for
 * informado). NUNCA chamada automaticamente a partir da conversa — só pela
 * Edge Function pagamento-estornar, depois de confirmação humana explícita
 * (ver _shared/estorno-decisao.ts). Nunca loga o access_token; só status
 * HTTP + trecho sanitizado do corpo de erro, mesmo padrão de
 * criarPreferenciaMercadoPago.
 */
export async function estornarPagamentoMercadoPago(
  workspaceId: string | undefined,
  paymentId: string,
  valorReais?: number,
  ambiente: AmbienteMercadoPago = 'producao',
): Promise<ResultadoEstorno> {
  const accessToken = await buscarAccessToken(workspaceId, ambiente);
  if (!accessToken) {
    return { ok: false, erro: `Credenciais Mercado Pago (${CHAVE_ACCESS_TOKEN[ambiente]}) não configuradas.` };
  }

  const requisicao = montarRequisicaoEstorno(paymentId, valorReais);

  try {
    const resp = await fetch(`${API_BASE}${requisicao.path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        // Chave real de idempotência da API de refunds — reenviar a mesma
        // chamada (retry de rede) nunca gera um segundo estorno.
        'X-Idempotency-Key': `refund-${paymentId}-${valorReais ?? 'total'}`,
      },
      body: requisicao.body ? JSON.stringify(requisicao.body) : undefined,
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => String(resp.status));
      return { ok: false, erro: `HTTP ${resp.status}: ${err.slice(0, 200)}` };
    }
    const data = await resp.json() as { id?: number; status?: string };
    if (!data.id) {
      return { ok: false, erro: 'Resposta da API sem id de estorno.' };
    }
    return { ok: true, refundId: String(data.id), status: data.status };
  } catch (e) {
    return { ok: false, erro: String(e) };
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
  ambiente: AmbienteMercadoPago = 'producao',
): Promise<'valida' | 'invalida' | 'sem_segredo_configurado'> {
  const secret = await buscarCredencial(workspaceId, 'financeiro', CHAVE_WEBHOOK_SECRET[ambiente]);
  if (!secret) return 'sem_segredo_configurado';
  return validarAssinaturaComSegredo(secret, xSignature, xRequestId, dataId);
}

/**
 * Valida contra os dois segredos possíveis (produção e teste), sem saber
 * ainda qual ambiente a notificação pertence (ver _shared/resolucao-ambiente.ts
 * — o ambiente só é confirmado depois de buscar o pagamento real). Mantém a
 * rejeição antecipada de notificações forjadas ANTES de qualquer chamada à
 * API do Mercado Pago. Se só um dos dois segredos estiver configurado
 * (provável: o Mercado Pago pode usar o mesmo secret pros dois modos),
 * valida só contra o que existir.
 */
export async function validarAssinaturaWebhookQualquerAmbiente(
  workspaceId: string | undefined,
  xSignature: string | null,
  xRequestId: string | null,
  dataId: string,
): Promise<{ resultado: 'valida' | 'invalida' | 'sem_segredo_configurado'; ambienteValidado: AmbienteMercadoPago | null }> {
  const producao = await validarAssinaturaWebhook(workspaceId, xSignature, xRequestId, dataId, 'producao');
  if (producao === 'valida') return { resultado: 'valida', ambienteValidado: 'producao' };

  const teste = await validarAssinaturaWebhook(workspaceId, xSignature, xRequestId, dataId, 'teste');
  if (teste === 'valida') return { resultado: 'valida', ambienteValidado: 'teste' };

  if (producao === 'sem_segredo_configurado' && teste === 'sem_segredo_configurado') {
    return { resultado: 'sem_segredo_configurado', ambienteValidado: null };
  }
  return { resultado: 'invalida', ambienteValidado: null };
}
