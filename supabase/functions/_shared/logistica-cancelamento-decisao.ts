/**
 * logistica-cancelamento-decisao.ts — decide se/como tentar cancelar uma
 * entrega real já criada na Lalamove, sem tocar rede/DB (puro, testável com
 * node:test/tsx). Espelha exatamente logistica-decisao.ts (mesmo raciocínio
 * de claim atômico e de nunca assumir sucesso/falha sem prova), só que para
 * o lado do cancelamento.
 *
 * status_logistica relevantes aqui (ver 202608060001_logistica_cancelamento.sql):
 *   'criada'                  — única origem válida pra tentar cancelar.
 *   'cancelamento_solicitado' — claim atômico em andamento.
 *   'cancelada'               — a Lalamove já confirmou o cancelamento.
 *   'cancelamento_negado'     — a Lalamove já recusou antes — nunca retry
 *                                automático, só revisão humana.
 */

// Mesmo raciocínio/valor de LIMITE_PENDENTE_AMBIGUO_MS em logistica-decisao.ts.
export const LIMITE_PENDENTE_CANCELAMENTO_AMBIGUO_MS = 90_000;

export interface PedidoParaCancelamentoLogistica {
  status_logistica: string | null;
  lalamove_order_id: string | null;
  /** Quando o claim 'cancelamento_solicitado' atual foi feito — usado só quando status_logistica === 'cancelamento_solicitado'. */
  logistica_cancelamento_pendente_desde?: string | null;
}

export type DecisaoCancelamentoLogistica =
  | { acao: 'pular'; motivo: 'nao_criada' | 'ja_cancelada' | 'cancelamento_negado_anteriormente' | 'claim_em_andamento' }
  | { acao: 'marcar_ambiguo_por_timeout' }
  | { acao: 'cancelar' };

/**
 * Nunca tenta cancelar uma entrega que não foi criada, nunca repete um
 * cancelamento já concluído, nunca tenta de novo automaticamente depois de
 * uma recusa explícita da transportadora, e nunca faz retry cego de um claim
 * 'cancelamento_solicitado' velho (estado ambíguo).
 */
export function decidirAcaoCancelamentoLogistica(
  pedido: PedidoParaCancelamentoLogistica,
  agora: Date = new Date(),
): DecisaoCancelamentoLogistica {
  if (pedido.status_logistica === 'cancelada') return { acao: 'pular', motivo: 'ja_cancelada' };
  if (pedido.status_logistica === 'cancelamento_negado') return { acao: 'pular', motivo: 'cancelamento_negado_anteriormente' };

  if (pedido.status_logistica === 'cancelamento_solicitado') {
    const desde = pedido.logistica_cancelamento_pendente_desde ? new Date(pedido.logistica_cancelamento_pendente_desde).getTime() : NaN;
    const recente = !Number.isNaN(desde) && (agora.getTime() - desde) < LIMITE_PENDENTE_CANCELAMENTO_AMBIGUO_MS;
    return recente ? { acao: 'pular', motivo: 'claim_em_andamento' } : { acao: 'marcar_ambiguo_por_timeout' };
  }

  if (pedido.status_logistica !== 'criada' || !pedido.lalamove_order_id) {
    return { acao: 'pular', motivo: 'nao_criada' };
  }

  return { acao: 'cancelar' };
}

/** Condição do UPDATE atômico usado como claim — só quem conseguir essa atualização tenta cancelar. */
export function statusCancelamentoLogisticaReivindicavel(statusAtual: string | null): boolean {
  return statusAtual === 'criada';
}
