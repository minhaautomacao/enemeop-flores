/**
 * logistica-decisao.ts — decide se/como tentar criar a entrega real depois
 * de um pagamento aprovado, sem tocar rede/DB (puro, testável com
 * node:test/tsx). A execução real (webhook-mercadopago/index.ts,
 * logistica-retry/index.ts) só segue o veredito daqui.
 *
 * status_logistica possíveis:
 *   null              — ainda não tentado.
 *   'pendente'        — claim atômico em andamento (ver statusLogisticaReivindicavel).
 *   'criada'          — entrega real criada, lalamove_order_id preenchido.
 *   'erro_logistica'  — falha ANTES de qualquer chamada real a POST /v3/orders
 *                        ter sido enviada (ou com resposta HTTP de erro clara)
 *                        — nunca criou corrida, retry seguro.
 *   'revisao_logistica' — estado ambíguo: não dá pra provar que a corrida NÃO
 *                        foi criada (timeout/falha de rede depois de enviar a
 *                        requisição, ou resposta 2xx sem orderId). Nunca
 *                        retry automático — só revisão humana.
 */

// Depois desse tempo sem resolução, um claim 'pendente' deixa de ser
// considerado "execução recente em andamento" e passa a ser ambíguo (a
// execução original provavelmente crashou/travou sem nunca confirmar se
// chegou a chamar a Lalamove) — nunca reivindicado automaticamente de novo,
// só marcado pra revisão humana.
export const LIMITE_PENDENTE_AMBIGUO_MS = 90_000;

export interface PedidoParaLogistica {
  status: string;
  status_logistica: string | null;
  lalamove_order_id: string | null;
  /** Quando o claim 'pendente' atual foi feito — usado só quando status_logistica === 'pendente'. */
  logistica_pendente_desde?: string | null;
}

export type DecisaoLogistica =
  | { acao: 'pular'; motivo: 'nao_pago' | 'entrega_ja_criada' | 'em_revisao' | 'claim_em_andamento' }
  | { acao: 'bloquear'; motivo: 'telefone_loja_ausente' }
  | { acao: 'marcar_ambiguo_por_timeout' }
  | { acao: 'criar' };

/**
 * Nunca cria uma segunda entrega pro mesmo pedido (idempotência), nunca
 * tenta criar entrega pra pedido não pago, nunca inventa um telefone da
 * loja, e nunca faz retry cego de um claim 'pendente' velho (estado
 * ambíguo — ver cabeçalho do arquivo).
 */
export function decidirAcaoLogistica(
  pedido: PedidoParaLogistica,
  storePhoneConfigurado: boolean,
  agora: Date = new Date(),
): DecisaoLogistica {
  if (pedido.status !== 'pago') return { acao: 'pular', motivo: 'nao_pago' };
  if (pedido.lalamove_order_id || pedido.status_logistica === 'criada') {
    return { acao: 'pular', motivo: 'entrega_ja_criada' };
  }
  if (pedido.status_logistica === 'revisao_logistica') {
    return { acao: 'pular', motivo: 'em_revisao' };
  }
  if (pedido.status_logistica === 'pendente') {
    const desde = pedido.logistica_pendente_desde ? new Date(pedido.logistica_pendente_desde).getTime() : NaN;
    const recente = !Number.isNaN(desde) && (agora.getTime() - desde) < LIMITE_PENDENTE_AMBIGUO_MS;
    return recente ? { acao: 'pular', motivo: 'claim_em_andamento' } : { acao: 'marcar_ambiguo_por_timeout' };
  }
  if (!storePhoneConfigurado) return { acao: 'bloquear', motivo: 'telefone_loja_ausente' };
  return { acao: 'criar' };
}

/**
 * Condição do UPDATE atômico usado como claim de concorrência: só quem
 * conseguir essa atualização (0 ou 1 linha) tenta criar a entrega. Permite
 * retry depois de 'erro_logistica' (falha recuperável, comprovadamente sem
 * corrida criada), mas nunca depois de 'criada', 'pendente' ou
 * 'revisao_logistica'.
 */
export function statusLogisticaReivindicavel(statusAtual: string | null): boolean {
  return statusAtual === null || statusAtual === 'erro_logistica';
}
