/**
 * dedup.ts — decisão pura de mensagem duplicada (sem I/O), separada de
 * index.ts só pra ser testável com node:test/tsx sem precisar do runtime
 * Deno (mesmo motivo de webhook-mercadopago/logica.ts).
 *
 * Duas fontes de duplicata cobertas:
 *   1. Evento Meta repetido — mesmo `mid` já visto no histórico da conversa
 *      (reentrega de webhook).
 *   2. Mensagem duplicada por conversa/conteúdo — o último item do
 *      histórico já é essa mesma mensagem do cliente, chegada há pouco
 *      tempo (double-submit do cliente, ou webhook duplicado sem mid).
 */

export interface MensagemHistorico {
  role: 'user' | 'assistant' | 'human';
  content: string;
  ts: string;
  mid?: string;
}

const JANELA_DUPLICATA_MS = 120_000;

export function mensagemDuplicada(
  historico: MensagemHistorico[],
  mensagemCliente: string,
  mid: string | undefined,
  agora: Date = new Date(),
): boolean {
  if (mid && historico.some(m => m.mid === mid)) return true;

  const ultima = historico[historico.length - 1];
  if (!ultima || ultima.role !== 'user') return false;
  if (ultima.content !== mensagemCliente) return false;

  const idadeMs = agora.getTime() - new Date(ultima.ts).getTime();
  return idadeMs >= 0 && idadeMs < JANELA_DUPLICATA_MS;
}
