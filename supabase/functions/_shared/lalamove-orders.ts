/**
 * lalamove-orders.ts — Criação REAL da entrega (POST /v3/orders).
 *
 * Só deve ser chamado depois de: pagamento aprovado e reconciliado via API
 * real do Mercado Pago (nunca por texto do cliente), pedido completo,
 * endereço completo, contatos presentes, e nenhuma entrega já criada pra
 * esse pedido (idempotência é responsabilidade de quem chama — ver
 * logistica-decisao.ts, que faz o claim atômico via UPDATE condicional
 * antes de chamar esta função).
 *
 * Nunca chamado durante cotação nem em testes automatizados/sintéticos —
 * ver Parte H.8.
 *
 * IMPORTANTE sobre idempotência: a documentação oficial da Lalamove v3
 * NÃO especifica nenhuma chave de idempotência para POST /v3/orders — o
 * header Request-ID é documentado só como um nonce de diagnóstico ("share
 * the Request ID with us"), nunca como mecanismo de deduplicação. Este
 * arquivo NUNCA assume que reenviar a mesma requisição evita uma segunda
 * corrida — a segurança contra duplicidade vem inteiramente do claim
 * atômico de quem chama (nunca chama esta função duas vezes pro mesmo
 * pedido) e da distinção abaixo entre falha recuperável (nunca chegou a
 * criar corrida) e resultado ambíguo (não dá pra provar que não criou).
 */

import { chamarLalamove, type ConfigResolvida } from './lalamove.ts';
import { cotacaoExpirada, mascarar } from './lalamove-config.ts';

export interface ContatoEntrega {
  stopId: string;
  nome: string;
  telefone: string;
}

export interface CriarEntregaParams {
  quotationId: string;
  expiresAt: string | null;
  remetente: ContatoEntrega;
  destinatario: ContatoEntrega;
  /** Usado só em metadata (rastreabilidade do lado Lalamove) — nunca dados pessoais além do necessário para a entrega. */
  pedidoId: string;
}

/** Corpo exato de POST /v3/orders — só campos documentados oficialmente (quotationId, sender, recipients, metadata). Nunca inclui isPODEnabled/partner (não usados) nem nenhum campo fora do schema documentado. */
export interface PayloadCriarEntrega {
  data: {
    quotationId: string;
    sender: { stopId: string; name: string; phone: string };
    recipients: Array<{ stopId: string; name: string; phone: string }>;
    metadata: { pedidoId: string };
  };
}

/** Pura — monta o payload exato enviado a POST /v3/orders, sem tocar rede/Deno.env. Extraída só pra ser testável como contrato (Parte 4) sem precisar mockar fetch. */
export function montarPayloadCriarEntrega(params: CriarEntregaParams): PayloadCriarEntrega {
  return {
    data: {
      quotationId: params.quotationId,
      sender: {
        stopId: params.remetente.stopId,
        name: params.remetente.nome,
        phone: params.remetente.telefone,
      },
      recipients: [
        {
          stopId: params.destinatario.stopId,
          name: params.destinatario.nome,
          phone: params.destinatario.telefone,
        },
      ],
      metadata: { pedidoId: params.pedidoId },
    },
  };
}

export type ResultadoCriarEntrega =
  | { ok: true; orderId: string; status: string; shareLink?: string; precoTotal?: string; moeda?: string }
  | { ok: false; motivo: 'cotacao_expirada' }
  /** Falha ANTES/COM resposta HTTP clara de erro (4xx/5xx) — a Lalamove recusou o pedido, nunca criou corrida. Retry seguro depois de corrigir a causa. */
  | { ok: false; motivo: 'erro_api'; erroSanitizado: string }
  /** Timeout/falha de rede sem resposta, ou resposta 2xx sem orderId reconhecível — não dá pra provar que a corrida não foi criada do lado da Lalamove. NUNCA retry automático — precisa de revisão humana (ver Parte 3). */
  | { ok: false; motivo: 'ambiguo'; erroSanitizado: string };

/**
 * Cria a entrega real. Nunca usa uma cotação vencida — se `expiresAt` já
 * passou, devolve `cotacao_expirada` sem chamar a API (quem chama deve
 * cotar de novo e tentar com o quotationId/stopIds novos).
 *
 * `config` é OBRIGATÓRIO (nunca resolvido internamente via Deno.env) — o
 * ambiente de um pedido já criado é sempre conhecido
 * (pedidos.lalamove_ambiente, imutável), então não existe caso legítimo de
 * chamar esta função sem decidir o ambiente antes. Isso faz o compilador
 * recusar um call site que esqueceu de passar o ambiente certo, em vez de
 * depender só de revisão de código/convenção.
 */
export async function criarEntregaLalamove(
  apiKey: string,
  apiSecret: string,
  params: CriarEntregaParams,
  config: ConfigResolvida,
): Promise<ResultadoCriarEntrega> {
  if (cotacaoExpirada(params.expiresAt)) {
    return { ok: false, motivo: 'cotacao_expirada' };
  }

  const bodyObj = montarPayloadCriarEntrega(params);

  const resultado = await chamarLalamove(config, apiKey, apiSecret, 'POST', '/v3/orders', bodyObj, 10_000);
  if (!resultado.ok) {
    // status === 0 só acontece em falha de rede/timeout (ver chamarLalamove)
    // — nunca chegamos a receber uma resposta HTTP, então não dá pra provar
    // que a Lalamove não processou/criou a corrida antes de perdermos a
    // conexão. status > 0 é uma resposta HTTP real de erro — a Lalamove
    // recusou explicitamente, nunca criou corrida.
    if (resultado.status === 0) {
      return { ok: false, motivo: 'ambiguo', erroSanitizado: resultado.erroSanitizado };
    }
    return { ok: false, motivo: 'erro_api', erroSanitizado: resultado.erroSanitizado };
  }

  const data = resultado.data['data'] as {
    orderId?: string;
    status?: string;
    shareLink?: string;
    priceBreakdown?: { total: string; currency: string };
  } | undefined;

  if (!data?.orderId) {
    // Resposta HTTP 2xx (a requisição chegou e foi aceita) mas sem orderId
    // reconhecível — pode ser uma corrida real criada com um formato de
    // resposta inesperado. Tratado como ambíguo, nunca como "sem corrida".
    return { ok: false, motivo: 'ambiguo', erroSanitizado: 'resposta 2xx sem orderId reconhecivel' };
  }

  console.log(`[lalamove-orders] entrega criada orderId=${mascarar(data.orderId)} pedido=${params.pedidoId} ambiente=${config.ambiente}`);

  return {
    ok: true,
    orderId: data.orderId,
    status: data.status ?? 'desconhecido',
    shareLink: data.shareLink,
    precoTotal: data.priceBreakdown?.total,
    moeda: data.priceBreakdown?.currency,
  };
}

export type ResultadoCancelarEntrega =
  | { ok: true }
  /** A Lalamove recusou explicitamente (ex.: corrida já coletada pelo motorista, avançada demais para cancelar) — nunca retry automático (ver logistica-cancelamento-decisao.ts), sempre revisão humana. */
  | { ok: false; motivo: 'recusado_pela_transportadora'; erroSanitizado: string }
  /** Timeout/falha de rede sem resposta — não dá pra provar que a corrida NÃO foi cancelada do lado da Lalamove. NUNCA retry automático (o mesmo raciocínio de "ambíguo" usado em criarEntregaLalamove). */
  | { ok: false; motivo: 'ambiguo'; erroSanitizado: string };

/**
 * Cancela a entrega real (DELETE /v3/orders/{orderId}). Só deve ser chamado
 * depois que quem chama (logistica-cancelamento.ts) já reivindicou
 * atomicamente o cancelamento (mesmo padrão de claim de criarEntregaLalamove).
 *
 * NOTA: a documentação oficial da Lalamove v3 não foi verificada nesta
 * integração quanto ao formato exato da resposta de cancelamento (ex.: se
 * uma eventual taxa de cancelamento vem no corpo da resposta) — só o
 * endpoint/verbo documentado (DELETE /v3/orders/{orderId}) é assumido aqui.
 * Se a resposta real trouxer informação de taxa, `logistica-cancelamento.ts`
 * é o lugar certo pra capturar isso a partir do resultado, sem inventar um
 * campo que a API não confirma.
 *
 * `config` é OBRIGATÓRIO, mesmo raciocínio de criarEntregaLalamove acima —
 * nunca resolvido internamente via Deno.env.
 */
export async function cancelarEntregaLalamove(
  apiKey: string,
  apiSecret: string,
  orderId: string,
  config: ConfigResolvida,
): Promise<ResultadoCancelarEntrega> {
  const resultado = await chamarLalamove(config, apiKey, apiSecret, 'DELETE', `/v3/orders/${orderId}`, null, 10_000);

  if (!resultado.ok) {
    if (resultado.status === 0) {
      return { ok: false, motivo: 'ambiguo', erroSanitizado: resultado.erroSanitizado };
    }
    return { ok: false, motivo: 'recusado_pela_transportadora', erroSanitizado: resultado.erroSanitizado };
  }

  console.log(`[lalamove-orders] entrega cancelada orderId=${mascarar(orderId)} ambiente=${config.ambiente}`);
  return { ok: true };
}

export type ResultadoStatusEntrega =
  | { ok: true; status: string; driverId?: string; shareLink?: string; precoTotal?: string; moeda?: string }
  /** HTTP 404 — a Lalamove confirma que não existe corrida com esse orderId neste ambiente. */
  | { ok: false; motivo: 'nao_encontrado' }
  /** Qualquer outro status HTTP de erro, timeout ou falha de rede — nunca prova que a corrida não existe, então nunca deve ser tratado como "não encontrado" (mesmo raciocínio de ResultadoBuscaPagamento em _shared/mercadopago.ts). */
  | { ok: false; motivo: 'erro_transitorio'; erroSanitizado: string };

/**
 * Consulta o status real de uma corrida (GET /v3/orders/{orderId}) — nunca
 * existiu no pipeline real até agora (só existia um equivalente num
 * serviço Node separado, não conectado a este fluxo). `config` obrigatório,
 * mesmo padrão das duas funções acima — sem fallback de ambiente algum: o
 * pedido já sabe seu lalamove_ambiente, então nunca há necessidade
 * (nem permissão) de tentar o outro ambiente "por garantia".
 */
export async function consultarStatusEntregaLalamove(
  apiKey: string,
  apiSecret: string,
  orderId: string,
  config: ConfigResolvida,
): Promise<ResultadoStatusEntrega> {
  const resultado = await chamarLalamove(config, apiKey, apiSecret, 'GET', `/v3/orders/${orderId}`, null, 10_000);

  if (!resultado.ok) {
    if (resultado.status === 404) return { ok: false, motivo: 'nao_encontrado' };
    return { ok: false, motivo: 'erro_transitorio', erroSanitizado: resultado.erroSanitizado };
  }

  const data = resultado.data['data'] as {
    orderId?: string;
    status?: string;
    driverId?: string;
    shareLink?: string;
    priceBreakdown?: { total: string; currency: string };
  } | undefined;

  if (!data?.status) {
    return { ok: false, motivo: 'erro_transitorio', erroSanitizado: 'resposta 2xx sem status reconhecivel' };
  }

  return {
    ok: true,
    status: data.status,
    driverId: data.driverId,
    shareLink: data.shareLink,
    precoTotal: data.priceBreakdown?.total,
    moeda: data.priceBreakdown?.currency,
  };
}
