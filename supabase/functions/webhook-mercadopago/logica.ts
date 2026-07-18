/**
 * logica.ts — decisões puras do webhook-mercadopago, sem I/O (sem Deno.serve,
 * sem Deno.env, sem fetch/DB). Separado de index.ts só pra ser testável com
 * node:test/tsx sem precisar do runtime Deno nem de rede/DB reais — mesmo
 * espírito de _shared/funil.ts em relação a webhook-meta/index.ts.
 */

// Mapeia status real do Mercado Pago -> status do pedido. Nunca inclui um
// status novo aqui sem decidir explicitamente o que ele significa pro
// pedido — um status desconhecido é ignorado (log), nunca tratado como
// aprovado por omissão.
const STATUS_MAP: Record<string, string> = {
  approved:     'pago',
  pending:      'aguardando_pagamento',
  in_process:   'aguardando_pagamento',
  authorized:   'aguardando_pagamento',
  rejected:     'pagamento_recusado',
  cancelled:    'cancelado',
  refunded:     'reembolsado',
  charged_back: 'reembolsado',
};

/** Status desconhecido devolve null (nunca aprovado por omissão). */
export function mapearStatusPagamento(statusMercadoPago: string): string | null {
  return STATUS_MAP[statusMercadoPago] ?? null;
}

/**
 * Tolerância de 1 centavo pra arredondamento de ponto flutuante; qualquer
 * coisa acima disso é tratada como divergência real (pagamento não deve ser
 * confirmado automaticamente).
 */
export function valoresDivergem(valorPedido: number, valorAprovado: number): boolean {
  return Math.abs(Number(valorPedido) - Number(valorAprovado)) > 0.01;
}
