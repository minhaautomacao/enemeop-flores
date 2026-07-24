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

import { camposBRT, instanteDeBRT, dentroDoHorarioComercial, proximaAberturaComercial } from '../_shared/horario-comercial.ts';
import { calcularAgendamentoEntrega, type PeriodoEntrega, type DataCalendario } from '../_shared/agendamento-entrega.ts';

/** true quando `a` e `b` caem no mesmo dia de calendário em BRT. */
function mesmoDiaBRT(a: Date, b: Date): boolean {
  const ca = camposBRT(a);
  const cb = camposBRT(b);
  return ca.ano === cb.ano && ca.mes === cb.mes && ca.dia === cb.dia;
}

/**
 * Abertura do PRÓXIMO dia de funcionamento, nunca a de hoje — mesmo quando
 * `agora` for minutos antes de abrir hoje (ex.: 08h59 com abertura às 09h).
 * Diferente de proximaAberturaComercial(agora) sozinha, que devolve a
 * abertura de HOJE nesse caso (correto pra "já vai abrir, pode considerar
 * pronto"; errado pra "pagamento confirmado fora do horário nunca usa a
 * abertura do mesmo dia" — regra explícita do negócio). Mesmo truque já
 * usado em _shared/agendamento-entrega.ts (força o cálculo a partir da meia-
 * noite do dia seguinte, que sempre tem alguma janela comercial).
 */
function aberturaProximoDiaUtil(agora: Date): Date {
  const campos = camposBRT(agora);
  const meiaNoiteAmanha = instanteDeBRT(campos.ano, campos.mes, campos.dia + 1, 0, 0);
  return proximaAberturaComercial(meiaNoiteAmanha);
}

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
    // antes de agora nem fora do horário comercial. Pagamento confirmado
    // FORA do horário NUNCA usa a abertura do MESMO dia como despacho — nem
    // quando esse horário já ficou no passado (fechou e o cliente demorou
    // pra pagar), nem quando ainda está no futuro de hoje (confirmou minutos
    // antes de abrir): em ambos os casos pula direto pro próximo dia de
    // funcionamento (senão o próximo tick de logistica-agendada-processar
    // dispararia a corrida no mesmo dia, mesmo fora do expediente).
    const despachoBase = despachoFixado ?? proximaAberturaComercial(agora);
    const despachoNoMesmoDiaForaDoHorario = !dentroDoHorarioAgora && mesmoDiaBRT(despachoBase, agora);
    const despachoEm = despachoNoMesmoDiaForaDoHorario ? aberturaProximoDiaUtil(agora) : despachoBase;
    return {
      entregaPrometidaEm: entregaPrometidaFixada,
      despachoEm,
      imediato: despachoEm.getTime() <= agora.getTime() && dentroDoHorarioAgora,
    };
  }
  if (params.dataEntregaTipada) {
    const resultado = calcularAgendamentoEntrega(params.dataEntregaTipada, params.periodoEntregaTipado, agora, { leadTimeMinutos: params.leadTimeMinutos });
    // Mesma regra acima aplicada ao caminho legado (sem entrega_prometida_em/
    // logistica_executar_em persistidos): despacho não pode cair no mesmo
    // dia da confirmação quando o pagamento veio fora do horário.
    if (!dentroDoHorarioAgora && mesmoDiaBRT(resultado.despachoEm, agora)) {
      const proximaAbertura = aberturaProximoDiaUtil(agora);
      return { entregaPrometidaEm: proximaAbertura, despachoEm: proximaAbertura, imediato: false };
    }
    return resultado;
  }
  const despacho = dentroDoHorarioAgora ? agora : proximaAberturaComercial(agora);
  const despachoFinal = !dentroDoHorarioAgora && mesmoDiaBRT(despacho, agora) ? aberturaProximoDiaUtil(agora) : despacho;
  return { entregaPrometidaEm: despachoFinal, despachoEm: despachoFinal, imediato: dentroDoHorarioAgora };
}
