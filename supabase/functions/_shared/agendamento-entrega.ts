/**
 * agendamento-entrega.ts — calcula QUANDO despachar a corrida real (Lalamove)
 * a partir da data/período de entrega prometidos ao cliente (Parte 2 da
 * correção "fechar bloqueios do agendamento"), nunca do horário em que o
 * pagamento foi aprovado.
 *
 * Reaproveita horario-comercial.ts como fonte única de verdade pro horário
 * de funcionamento e pro cálculo de próxima abertura — este módulo só
 * adiciona a camada de "janela prometida ao cliente" + "lead time
 * operacional" em cima disso, puro e testável (sem Deno.env/rede).
 */

import { camposBRT, instanteDeBRT, janelaDoDia, dentroDoHorarioComercial, proximaAberturaComercial } from './horario-comercial.ts';

export type PeriodoEntrega = 'manha' | 'tarde' | 'noite';

export interface DataCalendario {
  ano: number;
  mes: number; // 0-11
  dia: number;
}

// Hora de início (BRT) de cada período — clampada pra dentro do horário de
// funcionamento real do dia em questão (nunca promete entrega fora do
// expediente, mesmo que o período pedido caia antes da abertura/depois do
// fechamento daquele tipo de dia).
const INICIO_PERIODO_HORA: Record<PeriodoEntrega, number> = { manha: 9, tarde: 13, noite: 18 };

// Horário operacional seguro usado quando NENHUM período foi informado
// (distinto de "manhã" informada explicitamente — mesma hora por
// coincidência hoje, mas semanticamente uma config própria, ajustável sem
// afetar o significado de "manhã").
const HORA_PADRAO_SEM_PERIODO = 9;

export interface ConfigAgendamentoEntrega {
  /** Minutos de antecedência necessários pra preparar/coletar o pedido antes do início da janela prometida ao cliente. */
  leadTimeMinutos: number;
}

export interface ResultadoAgendamentoEntrega {
  /** Início real da janela prometida ao cliente (já clampado pro horário de funcionamento do dia solicitado). */
  entregaPrometidaEm: Date;
  /** Quando a corrida real deve ser criada (chamada POST /v3/orders) — nunca antes disso. */
  despachoEm: Date;
  /** true quando despachoEm já chegou (pode criar a corrida imediatamente após o pagamento); false quando precisa ficar agendado. */
  imediato: boolean;
}

/** Início da janela prometida (BRT), já clampado pro horário de funcionamento do dia — nunca promete um horário em que a loja está fechada. */
function inicioJanelaPrometida(data: DataCalendario, periodo: PeriodoEntrega | null): Date {
  const horaAlvo = periodo ? INICIO_PERIODO_HORA[periodo] : HORA_PADRAO_SEM_PERIODO;
  const bruto = instanteDeBRT(data.ano, data.mes, data.dia, horaAlvo, 0);
  const campos = camposBRT(bruto);
  const { aberturaMin, fechamentoMin } = janelaDoDia(campos);
  const minutosAlvo = horaAlvo * 60;
  const minutosClampado = Math.min(Math.max(minutosAlvo, aberturaMin), fechamentoMin - 1);
  return instanteDeBRT(campos.ano, campos.mes, campos.dia, Math.floor(minutosClampado / 60), minutosClampado % 60);
}

/**
 * Calcula quando despachar a corrida real e a janela prometida ao cliente, a
 * partir da data/período de entrega já validados (nunca de texto livre — ver
 * normalizarDataEntregaTexto em funil.ts, chamado antes disso, na
 * confirmação do formulário).
 *
 * Regras (Parte 2): "hoje" fora do horário já vira o próximo dia útil antes
 * de chegar aqui (Parte 4, funil.ts) — este cálculo nunca precisa saber
 * disso, só recebe a data já corrigida. Data futura nunca cria corrida antes
 * da janela planejada, mesmo que o pagamento seja feito dentro do horário
 * hoje. Pedido pra hoje dentro do horário pode despachar imediatamente após
 * o pagamento.
 */
export function calcularAgendamentoEntrega(
  dataEntrega: DataCalendario,
  periodoEntrega: PeriodoEntrega | null,
  agora: Date,
  config: ConfigAgendamentoEntrega,
): ResultadoAgendamentoEntrega {
  const entregaPrometidaEm = inicioJanelaPrometida(dataEntrega, periodoEntrega);

  const despachoBruto = new Date(entregaPrometidaEm.getTime() - config.leadTimeMinutos * 60_000);
  const despachoCandidato = despachoBruto.getTime() > agora.getTime() ? despachoBruto : agora;
  // O despacho em si também precisa cair dentro do horário comercial — não
  // dá pra despachar um motorista fora do expediente da loja, mesmo que o
  // lead time sozinho apontasse pra um horário fechado.
  const despachoEm = proximaAberturaComercial(despachoCandidato);

  const imediato = despachoEm.getTime() <= agora.getTime() && dentroDoHorarioComercial(agora);
  return { entregaPrometidaEm, despachoEm: imediato ? agora : despachoEm, imediato };
}
