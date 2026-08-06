/**
 * mercadopago-estorno-payload.ts — parte pura de estornarPagamentoMercadoPago
 * (mercadopago.ts), extraída pro mesmo motivo de mercadopago-assinatura.ts:
 * mercadopago.ts importa credentials.ts -> supabase.ts -> "npm:@supabase/supabase-js",
 * que só resolve em runtime Deno — este arquivo nunca importa nada disso,
 * pra poder ser testado com node:test/tsx sem precisar do runtime Deno.
 */

export interface RequisicaoEstorno {
  path: string;
  body?: { amount: number };
}

/**
 * Monta o path/body exatos de POST /v1/payments/{id}/refunds. Estorno
 * total: sem body (a API do Mercado Pago estorna o valor integral).
 * Estorno parcial: `{ amount }` no corpo, em reais (mesma unidade usada no
 * resto desta integração).
 */
export function montarRequisicaoEstorno(paymentId: string, valorReais?: number): RequisicaoEstorno {
  const path = `/v1/payments/${encodeURIComponent(paymentId)}/refunds`;
  return valorReais == null ? { path } : { path, body: { amount: valorReais } };
}
