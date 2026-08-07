/**
 * resolucao-ambiente.ts — resolve a qual ambiente (produção ou teste) um
 * pagamento pertence quando isso é genuinamente desconhecido a priori (o
 * único caso real: webhook-mercadopago, que só recebe um payment_id — a
 * notificação nunca diz de qual ambiente).
 *
 * Regra (D4 do plano de separação teste/produção): tenta produção primeiro;
 * só tenta teste se a resposta for exatamente "não encontrado" (HTTP 404) —
 * nunca em caso de erro transitório (401/500/timeout/rede), que precisa
 * propagar como erro real. Misturar os dois casos tornaria o fallback
 * inseguro: um 401 (token revogado) ou 500 (instabilidade do Mercado Pago)
 * nunca deve ser mascarado como "esse pagamento é de outro ambiente".
 *
 * Fora do webhook (pagamento-estornar, pagamento-reconciliar), o ambiente já
 * é conhecido via pedido.mp_ambiente — essas funções NUNCA devem usar este
 * módulo nem repetir esse fallback; usam exclusivamente o ambiente já
 * gravado, sem tentar o outro "por garantia".
 */

import type { AmbienteMercadoPago, PagamentoReal, ResultadoBuscaPagamento } from './mercadopago.ts';

export type BuscadorPagamento = (ambiente: AmbienteMercadoPago, paymentId: string) => Promise<ResultadoBuscaPagamento>;

export type ResultadoResolucaoAmbiente =
  | { resolvido: true; ambiente: AmbienteMercadoPago; pagamento: PagamentoReal }
  | { resolvido: false; motivo: 'nao_encontrado_em_nenhum_ambiente' }
  | { resolvido: false; motivo: 'erro_transitorio'; detalhe: string }
  | { resolvido: false; motivo: 'sem_credencial' };

export async function resolverPagamentoEAmbiente(
  paymentId: string,
  buscar: BuscadorPagamento,
): Promise<ResultadoResolucaoAmbiente> {
  const producao = await buscar('producao', paymentId);
  if (producao.ok) return { resolvido: true, ambiente: 'producao', pagamento: producao.pagamento };
  if (producao.motivo === 'erro_transitorio') return { resolvido: false, motivo: 'erro_transitorio', detalhe: producao.detalhe };
  if (producao.motivo === 'sem_credencial') return { resolvido: false, motivo: 'sem_credencial' };

  // Só chega aqui se producao.motivo === 'nao_encontrado'.
  const teste = await buscar('teste', paymentId);
  if (teste.ok) return { resolvido: true, ambiente: 'teste', pagamento: teste.pagamento };
  if (teste.motivo === 'erro_transitorio') return { resolvido: false, motivo: 'erro_transitorio', detalhe: teste.detalhe };
  if (teste.motivo === 'sem_credencial') return { resolvido: false, motivo: 'sem_credencial' };

  return { resolvido: false, motivo: 'nao_encontrado_em_nenhum_ambiente' };
}
