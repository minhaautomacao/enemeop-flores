/**
 * interpretador-chamador.ts — ponte fina entre `DependenciasFunil.interpretarIntencao`
 * (funil.ts) e `callClaude` já existente em `_shared/anthropic.ts` (Groq com
 * fallback Anthropic, já usado por whatsapp-sdr/logistica/agente-financeiro/
 * captacao-leads — nunca reimplementado aqui).
 *
 * Único trabalho deste arquivo: aplicar timeout e nunca deixar uma exceção
 * escapar — `callClaude` já lança se nenhuma credencial existir, e isso teria
 * que virar `null` aqui, nunca derrubar o funil (ver contrato de
 * `DependenciasFunil.interpretarIntencao` em funil.ts).
 */

import { callClaude } from './anthropic.ts';

export function criarChamadorInterpretacao(): (systemPrompt: string, mensagemCliente: string, timeoutMs: number) => Promise<string | null> {
  return async (systemPrompt: string, mensagemCliente: string, timeoutMs: number): Promise<string | null> => {
    try {
      const resultado = await Promise.race([
        callClaude(systemPrompt, mensagemCliente, 512),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      return resultado;
    } catch {
      return null;
    }
  };
}
