/**
 * pagamento-evento-decisao.ts — decide como tratar uma notificação de
 * pagamento do Mercado Pago em relação ao registro já existente em
 * mercadopago_eventos (payment_id, status), sem tocar rede/DB (puro,
 * testável com node:test/tsx).
 *
 * mercadopago_eventos.processamento_status:
 *   'processando' — reivindicado por uma execução agora (recém-inserido, ou
 *                    reclamado depois de um 'erro' anterior).
 *   'ok'          — a confirmação de pagamento (+ notificação ao cliente,
 *                    quando aplicável) já foi concluída com sucesso.
 *   'erro'        — a tentativa anterior falhou antes de concluir — nunca
 *                    chegou a notificar o cliente (ou não se sabe se
 *                    chegou), então é seguro reprocessar do zero.
 *
 * A notificação ao cliente e a criação de handoff de divergência de valor
 * só acontecem quando a decisão é 'processar_completo'. A recuperação de
 * logística (ver logistica-decisao.ts) é sempre tentada de novo
 * independentemente dessa decisão — ela tem seu próprio mecanismo de
 * idempotência baseado em pedidos.status_logistica, não neste evento.
 */

export type StatusProcessamentoEvento = 'processando' | 'ok' | 'erro';

export interface EventoExistente {
  processamento_status: StatusProcessamentoEvento;
  tentativas: number;
}

export type DecisaoEvento =
  | { acao: 'processar_completo' }
  | { acao: 'retomar_logistica_apenas' };

/**
 * `evento` é null quando o INSERT inicial teve sucesso (evento
 * genuinamente novo). Quando há conflito (23505), `evento` é a linha já
 * existente e `reivindicadoAgora` indica se ESTA execução conseguiu
 * reivindicar um evento em 'erro' via UPDATE condicional (ver
 * webhook-mercadopago/index.ts) — só nesse caso é seguro reprocessar
 * por completo (incluindo notificar o cliente), porque a tentativa
 * anterior nunca confirmou sucesso.
 */
export function decidirProcessamentoEvento(
  evento: EventoExistente | null,
  reivindicadoAgora: boolean,
): DecisaoEvento {
  if (evento === null) return { acao: 'processar_completo' };
  if (evento.processamento_status === 'erro' && reivindicadoAgora) return { acao: 'processar_completo' };
  return { acao: 'retomar_logistica_apenas' };
}
