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
 *   'agendada'         — pagamento aprovado fora do horário comercial (Parte
 *                        5): nunca chama o motorista na hora, fica agendado
 *                        pra logistica_executar_em (próximo horário/data
 *                        prometida ao cliente). Só reivindicável quando
 *                        logistica_executar_em já chegou — nunca antes,
 *                        mesmo via chamada administrativa (logistica-retry)
 *                        ou execução antecipada do job agendado. Essa
 *                        condição de horário é reforçada duas vezes: aqui
 *                        (leitura, usada pra decidir a resposta/log) e de
 *                        novo dentro do UPDATE atômico do claim em
 *                        logistica-processamento.ts (a fonte real de
 *                        verdade, imune a corrida entre execuções
 *                        concorrentes — ver Correção P0 "fechar bloqueios do
 *                        agendamento").
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
  /** Quando a logística agendada (status_logistica='agendada') pode ser reivindicada — null nunca é considerado vencido. */
  logistica_executar_em?: string | null;
}

/**
 * True quando um pedido 'agendada' já pode ser reivindicado
 * (logistica_executar_em no passado ou exatamente agora). Pedidos que não
 * estão 'agendada' sempre retornam true (a condição não se aplica a eles) —
 * usada tanto por decidirAcaoLogistica quanto pelo pré-check de
 * logistica-retry (resposta 409 sem nem chegar a tentar o claim).
 */
export function agendamentoVencido(
  pedido: Pick<PedidoParaLogistica, 'status_logistica' | 'logistica_executar_em'>,
  agora: Date = new Date(),
): boolean {
  if (pedido.status_logistica !== 'agendada') return true;
  const executarEm = pedido.logistica_executar_em ? new Date(pedido.logistica_executar_em).getTime() : NaN;
  return !Number.isNaN(executarEm) && executarEm <= agora.getTime();
}

export type DecisaoLogistica =
  | { acao: 'pular'; motivo: 'nao_pago' | 'entrega_ja_criada' | 'em_revisao' | 'claim_em_andamento' | 'agendada_nao_vencida' }
  | { acao: 'bloquear'; motivo: 'telefone_loja_ausente' }
  | { acao: 'marcar_ambiguo_por_timeout' }
  | { acao: 'criar' };

/**
 * Nunca cria uma segunda entrega pro mesmo pedido (idempotência), nunca
 * tenta criar entrega pra pedido não pago, nunca inventa um telefone da
 * loja, nunca faz retry cego de um claim 'pendente' velho (estado ambíguo),
 * e nunca reivindica um pedido agendado antes de logistica_executar_em
 * chegar — mesmo por chamada administrativa (ver cabeçalho do arquivo).
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
  if (pedido.status_logistica === 'agendada' && !agendamentoVencido(pedido, agora)) {
    return { acao: 'pular', motivo: 'agendada_nao_vencida' };
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
  return statusAtual === null || statusAtual === 'erro_logistica' || statusAtual === 'agendada';
}
