/**
 * lalamove-orders.ts — Criação REAL da entrega (POST /v3/orders).
 *
 * Só deve ser chamado depois de: pagamento aprovado e reconciliado via API
 * real do Mercado Pago (nunca por texto do cliente), pedido completo,
 * endereço completo, contatos presentes, e nenhuma entrega já criada pra
 * esse pedido (idempotência é responsabilidade de quem chama — ver
 * webhook-mercadopago/logistica.ts, que faz o claim atômico via UPDATE
 * condicional antes de chamar esta função).
 *
 * Nunca chamado durante cotação nem em testes automatizados/sintéticos —
 * ver Parte H.8.
 */

import { resolverConfig, chamarLalamove } from './lalamove.ts';
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
  /** Usado como Request-ID/metadata — garante rastreabilidade sanitizada, nunca dados do cliente no log. */
  pedidoId: string;
}

export type ResultadoCriarEntrega =
  | { ok: true; orderId: string; status: string; shareLink?: string; precoTotal?: string; moeda?: string }
  | { ok: false; motivo: 'cotacao_expirada' }
  | { ok: false; motivo: 'erro_api'; erroSanitizado: string };

/**
 * Cria a entrega real. Nunca usa uma cotação vencida — se `expiresAt` já
 * passou, devolve `cotacao_expirada` sem chamar a API (quem chama deve
 * cotar de novo e tentar com o quotationId/stopIds novos).
 */
export async function criarEntregaLalamove(
  apiKey: string,
  apiSecret: string,
  params: CriarEntregaParams,
): Promise<ResultadoCriarEntrega> {
  if (cotacaoExpirada(params.expiresAt)) {
    return { ok: false, motivo: 'cotacao_expirada' };
  }

  const config = resolverConfig();
  const bodyObj = {
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

  const resultado = await chamarLalamove(config, apiKey, apiSecret, 'POST', '/v3/orders', bodyObj, 10_000);
  if (!resultado.ok) {
    return { ok: false, motivo: 'erro_api', erroSanitizado: resultado.erroSanitizado };
  }

  const data = resultado.data['data'] as {
    orderId?: string;
    status?: string;
    shareLink?: string;
    priceBreakdown?: { total: string; currency: string };
  } | undefined;

  if (!data?.orderId) {
    return { ok: false, motivo: 'erro_api', erroSanitizado: 'resposta sem orderId' };
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
