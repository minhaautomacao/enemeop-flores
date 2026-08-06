/**
 * estorno-decisao.ts — decide se um estorno pode ser executado, sem tocar
 * rede/DB (puro, testável com node:test/tsx). A execução real (Edge
 * Function pagamento-estornar) só segue o veredito daqui.
 *
 * Nunca permite estornar um pagamento que não está 'approved', nunca
 * duplica um evento de estorno já ativo pro mesmo pedido (mesmo raciocínio
 * do índice único parcial em pedidos_estorno_eventos), e recusa qualquer
 * estorno parcial na v1 (decisão D3 do plano — parcial fica desenhado no
 * schema mas não liberado até haver uma regra de negócio clara).
 */

export interface PagamentoParaEstorno {
  /** Status real do pagamento, sempre obtido via buscarPagamentoReal — nunca do corpo de uma notificação de webhook. */
  status: string;
  valor: number;
}

/** Só o campo que importa pra decisão — status de um evento de estorno já existente pro mesmo pedido, se houver. */
export interface EventoEstornoExistente {
  status: string;
}

/** Espelha exatamente os status "ativos" do índice único parcial pedidos_estorno_eventos_ativo_por_pedido (202608060002_cancelamento_pedido_estorno.sql). */
const STATUS_EVENTO_ATIVO = new Set(['pendente_autorizacao', 'autorizado', 'processando', 'concluido']);

// Mesma tolerância de valoresDivergem (webhook-mercadopago/logica.ts) —
// nunca recusa por diferença de centavos de arredondamento, mas nunca
// aceita um valor genuinamente diferente do pago.
const TOLERANCIA_VALOR = 0.01;

export type DecisaoEstorno =
  | { pode: true }
  | { pode: false; motivo: 'pagamento_nao_aprovado' | 'evento_ja_ativo' | 'valor_invalido' | 'estorno_parcial_nao_suportado' };

export function decidirEstorno(
  pagamento: PagamentoParaEstorno,
  eventoAtivoExistente: EventoEstornoExistente | null,
  valorSolicitado: number,
  tipo: 'total' | 'parcial' = 'total',
): DecisaoEstorno {
  if (pagamento.status !== 'approved') return { pode: false, motivo: 'pagamento_nao_aprovado' };
  if (eventoAtivoExistente && STATUS_EVENTO_ATIVO.has(eventoAtivoExistente.status)) return { pode: false, motivo: 'evento_ja_ativo' };
  if (tipo === 'parcial') return { pode: false, motivo: 'estorno_parcial_nao_suportado' };
  if (!(valorSolicitado > 0)) return { pode: false, motivo: 'valor_invalido' };
  if (Math.abs(valorSolicitado - pagamento.valor) > TOLERANCIA_VALOR) return { pode: false, motivo: 'valor_invalido' };
  return { pode: true };
}
