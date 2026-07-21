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
 * GO-LIVE Parte 4 ("entrega agendada e promessa possível") — bug real
 * corrigido aqui: a versão anterior calculava `entregaPrometidaEm` uma única
 * vez (início do período pedido, já clampado pro horário de funcionamento)
 * e SEPARADAMENTE clampava `despachoEm` pro mesmo horário — se o lead time
 * não coubesse antes da abertura (ex.: janela pedida às 9h, loja abre às
 * 9h, lead time de 60min), o despacho ficava preso na mesma hora da
 * promessa (9h), tornando IMPOSSÍVEL entregar às 9h (a corrida nem foi
 * criada ainda). Agora, sempre que o lead time não cabe antes da janela
 * pedida, a PRÓPRIA promessa é deslocada pra frente o suficiente (despacho
 * viável + lead time) — nunca promete um horário que o despacho calculado
 * não consegue cumprir. Se o novo horário também não couber no expediente
 * do dia, desloca pro próximo dia útil (repete o ajuste; Parte 3 já garante
 * que todo dia tem alguma janela comercial, então converge em poucas
 * iterações mesmo com lead times grandes).
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
  const leadTimeMs = config.leadTimeMinutos * 60_000;
  let entregaPrometidaEm = inicioJanelaPrometida(dataEntrega, periodoEntrega);
  let despachoEm = agora;

  // No máximo 4 tentativas: cada volta só desloca a promessa pro próximo dia
  // útil quando o ajuste do lead time ultrapassa o fechamento do dia atual —
  // todo dia tem uma janela comercial (Parte 3), então sempre converge.
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const despachoIdeal = new Date(entregaPrometidaEm.getTime() - leadTimeMs);
    const pisoDespacho = despachoIdeal.getTime() > agora.getTime() ? despachoIdeal : agora;
    // O despacho em si também precisa cair dentro do horário comercial —
    // não dá pra despachar um motorista fora do expediente da loja.
    despachoEm = proximaAberturaComercial(pisoDespacho);

    const promessaViavel = new Date(despachoEm.getTime() + leadTimeMs);
    if (promessaViavel.getTime() <= entregaPrometidaEm.getTime()) {
      // O lead time cabe inteiro antes da janela pedida — cumpre a promessa
      // original tal como o cliente pediu.
      break;
    }
    // Não coube: a promessa real passa a ser despacho + lead time. Se isso
    // ainda cair dentro do horário comercial do dia do despacho, já
    // convergiu; senão, a próxima volta desloca pro dia seguinte.
    const camposPromessa = camposBRT(promessaViavel);
    const { fechamentoMin } = janelaDoDia(camposPromessa);
    const minutosPromessa = camposPromessa.hora * 60 + camposPromessa.minuto;
    if (minutosPromessa < fechamentoMin) {
      entregaPrometidaEm = promessaViavel;
      break;
    }
    entregaPrometidaEm = proximaAberturaComercial(instanteDeBRT(camposPromessa.ano, camposPromessa.mes, camposPromessa.dia + 1, 0, 0));
  }

  const imediato = despachoEm.getTime() <= agora.getTime() && dentroDoHorarioComercial(agora);
  return { entregaPrometidaEm, despachoEm: imediato ? agora : despachoEm, imediato };
}
