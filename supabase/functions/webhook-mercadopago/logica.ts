/**
 * logica.ts — decisões puras do webhook-mercadopago, sem I/O (sem Deno.serve,
 * sem Deno.env, sem fetch/DB). Separado de index.ts só pra ser testável com
 * node:test/tsx sem precisar do runtime Deno nem de rede/DB reais — mesmo
 * espírito de _shared/funil.ts em relação a webhook-meta/index.ts.
 *
 * dentroDoHorarioComercial/proximaAberturaComercial/calcularAgendamentoEntrega
 * (importados abaixo) também são puros (sem Deno.env/rede) — importá-los aqui
 * não quebra a testabilidade deste módulo com node:test/tsx.
 */

import { dentroDoHorarioComercial, proximaAberturaComercial } from '../_shared/horario-comercial.ts';
import { calcularAgendamentoEntrega, type PeriodoEntrega, type DataCalendario } from '../_shared/agendamento-entrega.ts';

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

// ── Quando despachar a corrida real após o pagamento confirmado ──────────
//
// Pagamento confirmado DENTRO do horário comercial: comportamento atual
// (despacho imediato quando a janela já chegou). Pagamento confirmado FORA
// do horário — depois de fechar OU antes de abrir — NUNCA despacha
// imediatamente: fica agendado pro próximo horário comercial, mesmo que a
// cotação/aprovação tenha acontecido dentro do horário (Parte 5).
//
// Extraído do handler pra ser puro e testável (node:test/tsx, sem Deno/DB) —
// nenhuma regra nova aqui além da que já existia inline em index.ts; só
// centralizada num único lugar reaproveitável, reusando dentroDoHorarioComercial/
// proximaAberturaComercial/calcularAgendamentoEntrega (fonte única de
// horário comercial) em vez de duplicar a decisão.

export interface ParametrosAgendamentoPagamento {
  /** entrega_prometida_em já persistido no pedido (ISO) — janela mostrada ao cliente na aprovação do frete, nunca recalculada silenciosamente depois do pagamento (Parte 4 GO-LIVE). */
  entregaPrometidaFixadaISO: string | null;
  /** logistica_executar_em já persistido no pedido (ISO), calculado junto com o campo acima. */
  despachoFixadoISO: string | null;
  /** Só usado quando o pedido não tem a janela acima persistida (legado/caminho sem data tipada). */
  dataEntregaTipada: DataCalendario | null;
  periodoEntregaTipado: PeriodoEntrega | null;
  leadTimeMinutos: number;
}

export interface ResultadoAgendamentoPagamento {
  entregaPrometidaEm: Date;
  despachoEm: Date;
  /** true quando a corrida pode ser criada agora mesmo (dentro do horário e a janela já chegou); false = nunca despachar agora, ver despachoEm. */
  imediato: boolean;
}

export function decidirAgendamentoPagamento(
  params: ParametrosAgendamentoPagamento,
  agora: Date,
): ResultadoAgendamentoPagamento {
  const entregaPrometidaFixada = params.entregaPrometidaFixadaISO ? new Date(params.entregaPrometidaFixadaISO) : null;
  const despachoFixado = params.despachoFixadoISO ? new Date(params.despachoFixadoISO) : null;
  const dentroDoHorarioAgora = dentroDoHorarioComercial(agora);

  if (entregaPrometidaFixada) {
    // despachoEm técnico: se por algum motivo não foi persistido junto (não
    // deveria acontecer — ver _shared/pedido-repositorio.ts), nunca despacha
    // antes de agora nem fora do horário comercial. Se o despacho persistido
    // já ficou no passado (cliente demorou pra pagar depois de cotar) e a
    // confirmação chegou fora do horário, nunca reaproveita esse horário
    // vencido como "pronto pra agora" — recalcula pro próximo horário
    // comercial (senão o próximo tick de logistica-agendada-processar
    // dispararia a corrida imediatamente, mesmo fora do expediente).
    const despachoBase = despachoFixado ?? proximaAberturaComercial(agora);
    const despachoVencidoForaDoHorario = !dentroDoHorarioAgora && despachoBase.getTime() <= agora.getTime();
    const despachoEm = despachoVencidoForaDoHorario ? proximaAberturaComercial(agora) : despachoBase;
    return {
      entregaPrometidaEm: entregaPrometidaFixada,
      despachoEm,
      imediato: despachoEm.getTime() <= agora.getTime() && dentroDoHorarioAgora,
    };
  }
  if (params.dataEntregaTipada) {
    return calcularAgendamentoEntrega(params.dataEntregaTipada, params.periodoEntregaTipado, agora, { leadTimeMinutos: params.leadTimeMinutos });
  }
  const despacho = dentroDoHorarioAgora ? agora : proximaAberturaComercial(agora);
  return { entregaPrometidaEm: despacho, despachoEm: despacho, imediato: dentroDoHorarioAgora };
}
