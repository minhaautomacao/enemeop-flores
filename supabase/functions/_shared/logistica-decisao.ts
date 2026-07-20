/**
 * logistica-decisao.ts — decide se/como tentar criar a entrega real depois
 * de um pagamento aprovado, sem tocar rede/DB (puro, testável com
 * node:test/tsx). A execução real (webhook-mercadopago/index.ts) só segue
 * o veredito daqui.
 */

export interface PedidoParaLogistica {
  status: string;
  status_logistica: string | null;
  lalamove_order_id: string | null;
}

export type DecisaoLogistica =
  | { acao: 'pular'; motivo: 'nao_pago' | 'entrega_ja_criada' }
  | { acao: 'bloquear'; motivo: 'telefone_loja_ausente' }
  | { acao: 'criar' };

/**
 * Nunca cria uma segunda entrega pro mesmo pedido (idempotência), nunca
 * tenta criar entrega pra pedido não pago, e nunca inventa um telefone da
 * loja — sem STORE_PHONE configurado, bloqueia com motivo claro em vez de
 * chamar a API com um valor inventado (ver Parte A.5/H.3).
 */
export function decidirAcaoLogistica(
  pedido: PedidoParaLogistica,
  storePhoneConfigurado: boolean,
): DecisaoLogistica {
  if (pedido.status !== 'pago') return { acao: 'pular', motivo: 'nao_pago' };
  if (pedido.lalamove_order_id || pedido.status_logistica === 'criada') {
    return { acao: 'pular', motivo: 'entrega_ja_criada' };
  }
  if (!storePhoneConfigurado) return { acao: 'bloquear', motivo: 'telefone_loja_ausente' };
  return { acao: 'criar' };
}

/**
 * Condição do UPDATE atômico usado como claim de concorrência: só quem
 * conseguir essa atualização (0 ou 1 linha) tenta criar a entrega. Permite
 * retry depois de 'erro_logistica', mas nunca depois de 'criada'.
 */
export function statusLogisticaReivindicavel(statusAtual: string | null): boolean {
  return statusAtual === null || statusAtual === 'erro_logistica';
}
