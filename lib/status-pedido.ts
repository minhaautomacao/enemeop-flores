// Fonte central dos status reais de pedido usados no frontend (painel de
// Produção e tela de Status dos Pedidos) — nunca duplicar strings/labels de
// status em mais de um lugar.
//
// `pedidos` tem DUAS colunas de status independentes, nunca reaproveitadas
// uma pela outra (ver comentário em app/api/producao/pedidos/route.ts):
//   - status: estado de pagamento real (aguardando_pagamento, pago,
//     pagamento_recusado, cancelado, reembolsado, ...).
//   - status_producao: workflow de cozinha, só tem sentido quando status
//     já é 'pago' — o valor default da coluna é 'novo', então um pedido
//     ainda não pago também teria status_producao='novo' se olhado sozinho;
//     por isso classificarParaProducao() SEMPRE checa `status` primeiro.

/** pedidos.status_producao — valores reais, iguais ao check constraint em supabase/migrations/202607200001_lalamove_producao.sql. */
export type StatusProducao = 'novo' | 'confirmado' | 'preparando' | 'pronto' | 'saiu' | 'entregue';

export const STATUS_PRODUCAO_LABEL: Record<StatusProducao, string> = {
  novo: 'Novo',
  confirmado: 'Confirmado',
  preparando: 'Preparando',
  pronto: 'Prontos',
  saiu: 'Saiu para Entrega',
  entregue: 'Entregue',
};

/** Filtro exibido no painel de Produção. 'em_atendimento' é derivado de pedidos.status (nunca de status_producao) — pedido criado mas ainda não pago, ainda no fluxo comercial/aguardando conclusão. */
export type FiltroProducao = 'em_atendimento' | StatusProducao;

export const FILTROS_PRODUCAO: { valor: FiltroProducao; label: string }[] = [
  { valor: 'em_atendimento', label: 'Pedido em Atendimento' },
  { valor: 'novo', label: STATUS_PRODUCAO_LABEL.novo },
  { valor: 'confirmado', label: STATUS_PRODUCAO_LABEL.confirmado },
  { valor: 'preparando', label: STATUS_PRODUCAO_LABEL.preparando },
  { valor: 'pronto', label: STATUS_PRODUCAO_LABEL.pronto },
  { valor: 'saiu', label: STATUS_PRODUCAO_LABEL.saiu },
];

export interface PedidoParaClassificar {
  /** pedidos.status — estado de pagamento real. */
  status: string;
  /** pedidos.status_producao — só é significativo quando status === 'pago'. */
  status_producao?: string | null;
}

const STATUS_PRODUCAO_VALIDOS = new Set<string>(Object.keys(STATUS_PRODUCAO_LABEL));

/**
 * Classifica um pedido num filtro de Produção a partir dos status reais do
 * banco. Pedido cancelado, recusado ou reembolsado nunca aparece em nenhum
 * filtro — não é "em atendimento" nem produção ativa.
 */
export function classificarParaProducao(pedido: PedidoParaClassificar): FiltroProducao | null {
  if (pedido.status === 'aguardando_pagamento') return 'em_atendimento';
  if (pedido.status !== 'pago') return null;
  const sp = pedido.status_producao ?? 'novo';
  return STATUS_PRODUCAO_VALIDOS.has(sp) ? (sp as StatusProducao) : 'novo';
}

/** Filtros da tela de Status dos Pedidos — só considera pedidos pagos (classificarParaProducao !== 'em_atendimento' e !== null). */
export type FiltroStatusPedidos = 'em_aberto' | 'preparando' | 'prontos' | 'entregues';

export const FILTROS_STATUS_PEDIDOS: { valor: FiltroStatusPedidos; label: string }[] = [
  { valor: 'em_aberto', label: 'Em aberto' },
  { valor: 'preparando', label: 'Preparando' },
  { valor: 'prontos', label: 'Prontos' },
  { valor: 'entregues', label: 'Entregues' },
];

/**
 * Filtros mutuamente exclusivos — cada status real pertence a NO MÁXIMO um
 * filtro desta tela, nunca aparece em mais de um ao mesmo tempo.
 * 'saiu' (saiu para entrega) não pertence a nenhum dos 4 filtros daqui —
 * essa tela é sobre produção (aberto/preparando/pronto/entregue), a
 * visualização de "saiu" continua no Painel de Produção.
 */
export function pedidoNoFiltroStatus(statusProducao: StatusProducao, filtro: FiltroStatusPedidos): boolean {
  switch (filtro) {
    case 'em_aberto': return statusProducao === 'novo' || statusProducao === 'confirmado';
    case 'preparando': return statusProducao === 'preparando';
    case 'prontos': return statusProducao === 'pronto';
    case 'entregues': return statusProducao === 'entregue';
  }
}

/** Nome do parâmetro de query string usado para persistir o filtro selecionado ao atualizar a página (Produção e Status dos Pedidos). */
export const PARAM_FILTRO_STATUS = 'status';

/** Lê o filtro do painel de Produção a partir de uma query string (ex.: window.location.search) — nunca aceita um valor fora da lista real, cai no padrão 'novo'. */
export function lerFiltroProducaoDaUrl(search: string): FiltroProducao {
  const valor = new URLSearchParams(search).get(PARAM_FILTRO_STATUS);
  return FILTROS_PRODUCAO.some(f => f.valor === valor) ? (valor as FiltroProducao) : 'novo';
}

/** Lê o filtro da tela de Status dos Pedidos a partir de uma query string — nunca aceita um valor fora da lista real, cai no padrão 'em_aberto'. */
export function lerFiltroStatusDaUrl(search: string): FiltroStatusPedidos {
  const valor = new URLSearchParams(search).get(PARAM_FILTRO_STATUS);
  return FILTROS_STATUS_PEDIDOS.some(f => f.valor === valor) ? (valor as FiltroStatusPedidos) : 'em_aberto';
}
