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

// Mensagens fixas usadas pelo webhook-meta quando fora do horário comercial.
// Extraídas aqui (em vez de strings soltas no handler) para serem testáveis.

export function mensagemAvisoForaDoHorario(): string {
  return 'Estamos fora do horário da loja agora, mas posso já ir adiantando seu atendimento por aqui. ';
}

export function mensagemConfirmacaoForaDoHorario(): string {
  return 'Estamos fora do horário da loja agora. Deixei tudo pronto por aqui — assim que reabrirmos, confirmamos a disponibilidade e o pagamento com você.';
}
