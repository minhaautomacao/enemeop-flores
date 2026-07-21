/**
 * Horário oficial de atendimento da Enemeop Flores (America/Sao_Paulo, UTC-3
 * o ano todo — Brasil aboliu horário de verão em 2019, então o offset fixo é
 * seguro sem precisar de biblioteca de timezone).
 *
 * Toda leitura de data/hora local passa por camposBRT() abaixo — NUNCA usa
 * métodos "locais" do Date (getHours/getDate/getDay/toDateString/...), que
 * dependem do fuso horário do processo que roda o código (em produção pode
 * ser UTC, em desenvolvimento pode ser qualquer coisa) e produziriam o dia
 * errado perto da virada da meia-noite em UTC. Só os métodos *UTC* do Date
 * são usados, com um deslocamento fixo de -3h aplicado manualmente — assim o
 * resultado é sempre o horário de Brasília, não importa onde o processo rode.
 *
 * Feriados nacionais fixos (MM-DD): mesma lista já usada em
 * functions/whatsapp-sdr/index.ts (FERIADOS) — reaproveitada aqui em vez de
 * duplicada com valores diferentes. Fonte: calendário nacional de feriados
 * fixos do Brasil.
 *
 * LIMITAÇÃO CONHECIDA: feriados MÓVEIS (Carnaval, Sexta-feira Santa, Corpus
 * Christi) NÃO estão cobertos — só feriados de data fixa. Nesses dias o
 * sistema vai tratar como dia útil normal (09h–19h) quando na prática a loja
 * pode ter horário reduzido ou estar fechada. Não afirmar em nenhum lugar
 * que "todos os feriados" são respeitados até isso ser implementado
 * (precisaria de uma tabela de datas por ano, não uma regra fixa).
 */

const FERIADOS_NACIONAIS = new Set([
  '01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25',
]);

const OFFSET_BRT_MS = 3 * 60 * 60_000; // America/Sao_Paulo = UTC-3, sem horário de verão desde 2019.

export interface CamposBRT {
  ano: number;
  mes: number; // 0-11, mesma convenção do Date
  dia: number;
  hora: number;
  minuto: number;
  diaSemana: number; // 0 = domingo
}

/** Lê os campos de data/hora no fuso America/Sao_Paulo a partir de um instante UTC real — nunca usa métodos locais do Date (ver cabeçalho do arquivo). */
export function camposBRT(instanteUtc: Date): CamposBRT {
  const deslocado = new Date(instanteUtc.getTime() - OFFSET_BRT_MS);
  return {
    ano: deslocado.getUTCFullYear(),
    mes: deslocado.getUTCMonth(),
    dia: deslocado.getUTCDate(),
    hora: deslocado.getUTCHours(),
    minuto: deslocado.getUTCMinutes(),
    diaSemana: deslocado.getUTCDay(),
  };
}

/** Converte campos de data/hora em BRT (horário de relógio de Brasília) de volta para o instante UTC real correspondente. Overflow de dia/mês/ano (ex.: dia=32) é normalizado automaticamente pelo próprio Date.UTC, cobrindo virada de mês/ano sem lógica extra. */
export function instanteDeBRT(ano: number, mes: number, dia: number, hora: number, minuto = 0): Date {
  return new Date(Date.UTC(ano, mes, dia, hora, minuto, 0) + OFFSET_BRT_MS);
}

function mmdd(campos: Pick<CamposBRT, 'mes' | 'dia'>): string {
  return `${String(campos.mes + 1).padStart(2, '0')}-${String(campos.dia).padStart(2, '0')}`;
}

/** Janela de horário do dia (em minutos desde 00:00, horário de Brasília) dado o tipo do dia. */
export function janelaDoDia(campos: CamposBRT): { aberturaMin: number; fechamentoMin: number } {
  const eFeriado = FERIADOS_NACIONAIS.has(mmdd(campos));
  const eDiaUtil = campos.diaSemana >= 1 && campos.diaSemana <= 5 && !eFeriado;
  return eDiaUtil ? { aberturaMin: 9 * 60, fechamentoMin: 19 * 60 } : { aberturaMin: 10 * 60, fechamentoMin: 18 * 60 };
}

/**
 * Seg–Sex: 09:00–19:00 | Sáb, Dom e feriados nacionais fixos: 10:00–18:00.
 */
export function dentroDoHorarioComercial(agora: Date = new Date()): boolean {
  const campos = camposBRT(agora);
  const minutosDoDia = campos.hora * 60 + campos.minuto;
  const { aberturaMin, fechamentoMin } = janelaDoDia(campos);
  return minutosDoDia >= aberturaMin && minutosDoDia < fechamentoMin;
}

const DIAS_SEMANA_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/**
 * Próximo instante, a partir de `agora`, em que a loja está dentro do
 * horário comercial (mesma fonte única de verdade de dentroDoHorarioComercial
 * acima). Cálculo direto, sem varredura em incrementos — todo dia do
 * calendário tem alguma janela de atendimento (seja 09–19h em dia útil, seja
 * 10–18h em fim de semana/feriado), então a próxima abertura nunca está a
 * mais de um dia de distância: ou é mais tarde hoje (se `agora` for antes da
 * abertura de hoje), ou é amanhã na abertura correspondente ao tipo de
 * amanhã (a virada de dia/mês/ano é resolvida pelo próprio Date.UTC).
 */
export function proximaAberturaComercial(agora: Date = new Date()): Date {
  const campos = camposBRT(agora);
  const minutosDoDia = campos.hora * 60 + campos.minuto;
  const { aberturaMin, fechamentoMin } = janelaDoDia(campos);

  if (minutosDoDia >= aberturaMin && minutosDoDia < fechamentoMin) {
    return agora; // já está dentro do horário — o próprio instante atual serve.
  }

  if (minutosDoDia < aberturaMin) {
    // Ainda não abriu hoje — abre mais tarde no mesmo dia.
    return instanteDeBRT(campos.ano, campos.mes, campos.dia, Math.floor(aberturaMin / 60), aberturaMin % 60);
  }

  // Já fechou hoje — abre no dia seguinte, na janela correspondente ao tipo
  // de amanhã (dia útil ou fim de semana/feriado).
  const meiaNoiteAmanha = instanteDeBRT(campos.ano, campos.mes, campos.dia + 1, 0, 0);
  const camposAmanha = camposBRT(meiaNoiteAmanha);
  const { aberturaMin: aberturaAmanhaMin } = janelaDoDia(camposAmanha);
  return instanteDeBRT(camposAmanha.ano, camposAmanha.mes, camposAmanha.dia, Math.floor(aberturaAmanhaMin / 60), aberturaAmanhaMin % 60);
}

/**
 * Texto pronto pra funil.ts usar quando precisa ajustar "hoje" pra "o
 * próximo dia útil" (Parte 4) — calculado aqui (fonte única do horário) e
 * injetado como string simples em avancarFunil, que nunca calcula horário
 * sozinho (é puro/zero-imports, ver cabeçalho de funil.ts).
 */
export function textoProximaAberturaComercial(agora: Date = new Date()): string {
  const proxima = proximaAberturaComercial(agora);
  const camposAgora = camposBRT(agora);
  const camposProxima = camposBRT(proxima);
  const horaTexto = `${String(camposProxima.hora).padStart(2, '0')}h`;
  const mesmoDia = camposAgora.ano === camposProxima.ano && camposAgora.mes === camposProxima.mes && camposAgora.dia === camposProxima.dia;
  if (mesmoDia) return `ainda hoje, a partir das ${horaTexto}`;
  // proximaAberturaComercial nunca pula mais de um dia (ver docstring acima)
  // — se não é hoje, é sempre amanhã.
  const diaSemana = DIAS_SEMANA_PT[camposProxima.diaSemana];
  return `amanhã (${diaSemana}), a partir das ${horaTexto}`;
}

// Mensagens fixas usadas pelo webhook-meta quando fora do horário comercial.
// Extraídas aqui (em vez de strings soltas no handler) para serem testáveis.
//
// @deprecated substituídas pelo fluxo com opt-in de funil.ts
// (mensagemAvisoForaDoHorarioComOpcao/mensagemAguardandoRespostaForaDoHorario,
// Parte 4) — mantidas só enquanto código antigo ainda as referenciar.

export function mensagemAvisoForaDoHorario(): string {
  return 'Estamos fora do horário da loja agora, mas posso já ir adiantando seu atendimento por aqui. ';
}

export function mensagemConfirmacaoForaDoHorario(): string {
  return 'Estamos fora do horário da loja agora. Deixei tudo pronto por aqui — assim que reabrirmos, confirmamos a disponibilidade e o pagamento com você.';
}
