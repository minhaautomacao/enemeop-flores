/**
 * cancelamento-decisao.ts — decide o que é permitido cancelar em cada
 * estágio de um pedido, sem tocar rede/DB (puro, testável com
 * node:test/tsx). Mesmo espírito de logistica-decisao.ts: a Flora e o
 * painel administrativo só seguem o veredito daqui, nunca inventam uma
 * regra própria.
 *
 * Requisito central (achado real durante teste em produção): o gate de
 * cancelamento conversacional do funil hoje só reseta a conversa em
 * memória e diz "cancelado, sem custo nenhum" — sem nunca checar se o
 * pedido já foi pago, se a logística já foi solicitada, ou se a entrega já
 * saiu. Este módulo é a fonte de verdade que fecha essa lacuna: nunca
 * promete um cancelamento grátis depois do pagamento, nunca promete
 * estorno automático (isso sempre passa por autorização humana explícita
 * no painel — ver estorno-decisao.ts), e nunca promete cancelar uma
 * entrega que já saiu ou já foi concluída.
 */

export type EstagioPedido =
  | 'ja_cancelado_ou_estornado'
  | 'pre_pagamento'
  | 'pago_pre_logistica'
  | 'logistica_solicitada'
  | 'entrega_iniciada'
  | 'entrega_concluida';

export interface PedidoParaCancelamento {
  status: string;
  status_logistica: string | null;
  /** Workflow de produção/cozinha (novo/confirmado/preparando/pronto/saiu/entregue) — só
   * usado aqui como sinal aproximado de "a entrega já saiu/chegou" (ver
   * limitação documentada no cabeçalho de logistica-cancelamento.ts: não
   * existe rastreamento real do status do motorista na Lalamove). Nunca
   * tratado como fonte de verdade absoluta — qualquer cancelamento de
   * logística ainda tenta de verdade na Lalamove, que é quem sabe. */
  status_producao: string | null;
}

export type AcaoCancelamento =
  | 'ja_cancelado'
  | 'cancelar_direto'
  | 'cancelar_com_estorno_pendente'
  | 'tentar_cancelar_logistica_e_estornar'
  | 'escalar_humano_sem_prometer';

export interface DecisaoCancelamentoPedido {
  estagio: EstagioPedido;
  acaoRecomendada: AcaoCancelamento;
  /** true quando a Flora pode agir sozinha (marcar cancelado / abrir evento de
   * estorno pendente) — nunca significa "estorno já concluído": isso exige
   * sempre autorização humana explícita (ver D2 do plano). */
  podeCancelarAutomaticamente: boolean;
  precisaEstorno: boolean;
  precisaCancelarLogisticaAntes: boolean;
  motivo: string;
  /** Texto pronto pra Flora usar — nunca inventa a frase, nunca promete algo que este módulo não autorizou. */
  mensagemParaFlora: string;
}

/** Classifica o estágio real do pedido a partir dos dados já persistidos — nunca do texto da conversa. */
export function classificarEstagioPedido(pedido: PedidoParaCancelamento): EstagioPedido {
  if (pedido.status === 'cancelado' || pedido.status === 'reembolsado') return 'ja_cancelado_ou_estornado';
  if (pedido.status !== 'pago') return 'pre_pagamento';
  if (pedido.status_producao === 'entregue') return 'entrega_concluida';
  if (pedido.status_producao === 'saiu') return 'entrega_iniciada';
  if (pedido.status_logistica === 'criada') return 'logistica_solicitada';
  return 'pago_pre_logistica';
}

const MENSAGENS: Record<EstagioPedido, { motivo: string; texto: string }> = {
  ja_cancelado_ou_estornado: {
    motivo: 'pedido_ja_cancelado_ou_reembolsado',
    texto: 'Esse pedido já está cancelado — não tem nada pendente pra fazer.',
  },
  pre_pagamento: {
    motivo: 'nenhum_pagamento_realizado',
    texto: 'Você quer mesmo cancelar esse pedido? Nada foi cobrado ainda. Responda "sim" para cancelar, ou "não" para continuar de onde paramos.',
  },
  pago_pre_logistica: {
    motivo: 'pago_mas_entrega_ainda_nao_solicitada',
    texto: 'Você quer mesmo cancelar esse pedido? O pagamento já foi feito — vou registrar o cancelamento e nossa equipe confirma o estorno em breve.',
  },
  logistica_solicitada: {
    motivo: 'entrega_ja_solicitada',
    texto: 'A entrega já foi solicitada à transportadora. Vou tentar cancelar a coleta e providenciar o estorno — nossa equipe confirma em seguida (pode haver uma taxa de cancelamento da transportadora).',
  },
  entrega_iniciada: {
    motivo: 'entrega_ja_iniciada_ou_coletada',
    texto: 'Essa entrega já está a caminho — não consigo cancelar sozinha. Vou te transferir para nossa equipe resolver.',
  },
  entrega_concluida: {
    motivo: 'entrega_ja_concluida',
    texto: 'Essa entrega já foi concluída — não consigo cancelar sozinha. Vou te transferir para nossa equipe resolver.',
  },
};

/**
 * Nunca promete estorno automático (sempre passa por autorização humana),
 * nunca promete cancelar entrega já iniciada/concluída sem escalar, sempre
 * usa o texto pronto de MENSAGENS — a Flora nunca compõe essa frase sozinha.
 */
export function decidirCancelamentoPedido(pedido: PedidoParaCancelamento): DecisaoCancelamentoPedido {
  const estagio = classificarEstagioPedido(pedido);
  const { motivo, texto } = MENSAGENS[estagio];

  switch (estagio) {
    case 'ja_cancelado_ou_estornado':
      return { estagio, acaoRecomendada: 'ja_cancelado', podeCancelarAutomaticamente: false, precisaEstorno: false, precisaCancelarLogisticaAntes: false, motivo, mensagemParaFlora: texto };
    case 'pre_pagamento':
      return { estagio, acaoRecomendada: 'cancelar_direto', podeCancelarAutomaticamente: true, precisaEstorno: false, precisaCancelarLogisticaAntes: false, motivo, mensagemParaFlora: texto };
    case 'pago_pre_logistica':
      return { estagio, acaoRecomendada: 'cancelar_com_estorno_pendente', podeCancelarAutomaticamente: true, precisaEstorno: true, precisaCancelarLogisticaAntes: false, motivo, mensagemParaFlora: texto };
    case 'logistica_solicitada':
      return { estagio, acaoRecomendada: 'tentar_cancelar_logistica_e_estornar', podeCancelarAutomaticamente: true, precisaEstorno: true, precisaCancelarLogisticaAntes: true, motivo, mensagemParaFlora: texto };
    case 'entrega_iniciada':
    case 'entrega_concluida':
      return { estagio, acaoRecomendada: 'escalar_humano_sem_prometer', podeCancelarAutomaticamente: false, precisaEstorno: true, precisaCancelarLogisticaAntes: false, motivo, mensagemParaFlora: texto };
  }
}
