/**
 * Horário oficial de atendimento da Enemeop Flores (America/Sao_Paulo, UTC-3
 * o ano todo — Brasil aboliu horário de verão em 2019, então o offset fixo é
 * seguro sem precisar de biblioteca de timezone).
 *
 * Feriados nacionais fixos (MM-DD): mesma lista já usada em
 * functions/whatsapp-sdr/index.ts (FERIADOS) — reaproveitada aqui em vez de
 * duplicada com valores diferentes. Fonte: calendário nacional de feriados
 * fixos do Brasil.
 */

const FERIADOS_NACIONAIS = new Set([
  '01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25',
]);

function horarioLocal(agora: Date): { horaLocal: number; diaSemana: number; mmdd: string } {
  const horaLocal = (agora.getUTCHours() - 3 + 24) % 24;
  const diaSemana = agora.getUTCDay(); // 0 = domingo
  const mmdd = `${String(agora.getUTCMonth() + 1).padStart(2, '0')}-${String(agora.getUTCDate()).padStart(2, '0')}`;
  return { horaLocal, diaSemana, mmdd };
}

/**
 * Seg–Sex: 09:00–19:00 | Sáb, Dom e feriados nacionais: 10:00–18:00.
 */
export function dentroDoHorarioComercial(agora: Date = new Date()): boolean {
  const { horaLocal, diaSemana, mmdd } = horarioLocal(agora);
  if (FERIADOS_NACIONAIS.has(mmdd)) return horaLocal >= 10 && horaLocal < 18;
  const eDiaUtil = diaSemana >= 1 && diaSemana <= 5;
  return eDiaUtil ? (horaLocal >= 9 && horaLocal < 19) : (horaLocal >= 10 && horaLocal < 18);
}

const DIAS_SEMANA_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/**
 * Próximo instante, a partir de `agora`, em que a loja está dentro do
 * horário comercial (ver dentroDoHorarioComercial acima — mesma fonte
 * única de verdade pros dois cálculos). Nunca varre mais que 8 dias
 * (proteção contra config quebrada gerando um loop longo demais).
 */
export function proximaAberturaComercial(agora: Date = new Date()): Date {
  let candidato = new Date(agora);
  const limite = new Date(agora.getTime() + 8 * 24 * 60 * 60_000);
  while (candidato < limite) {
    if (dentroDoHorarioComercial(candidato)) return candidato;
    candidato = new Date(candidato.getTime() + 5 * 60_000);
  }
  return candidato;
}

/**
 * Texto pronto pra funil.ts usar quando precisa ajustar "hoje" pra "o
 * próximo dia útil" (Parte 4) — calculado aqui (fonte única do horário) e
 * injetado como string simples em avancarFunil, que nunca calcula horário
 * sozinho (é puro/zero-imports, ver cabeçalho de funil.ts).
 */
export function textoProximaAberturaComercial(agora: Date = new Date()): string {
  const proxima = proximaAberturaComercial(agora);
  const horaLocal = (proxima.getUTCHours() - 3 + 24) % 24;
  const horaTexto = `${String(horaLocal).padStart(2, '0')}h`;
  const mesmoDia = proxima.toDateString() === agora.toDateString();
  if (mesmoDia) return `ainda hoje, a partir das ${horaTexto}`;
  const amanha = new Date(agora.getTime() + 24 * 60 * 60_000).toDateString() === proxima.toDateString();
  const diaSemana = DIAS_SEMANA_PT[proxima.getUTCDay()];
  return amanha ? `amanhã (${diaSemana}), a partir das ${horaTexto}` : `${diaSemana}, a partir das ${horaTexto}`;
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
