/**
 * ia-interprete.ts — implementação Node de `DependenciasFunil.interpretarIntencao`
 * (funil.ts), usada pelo SDR/orchestrator. Comportamento equivalente ao
 * `callClaude` já existente em `supabase/functions/_shared/anthropic.ts`
 * (Groq primeiro, 1 retry em 429, fallback pra Anthropic, nunca lança —
 * timeout/indisponibilidade sempre viram `null`), só que usando os SDKs já
 * instalados (`groq-sdk`, `@anthropic-ai/sdk`) em vez de `fetch` cru, porque
 * o runtime Deno das Edge Functions não tem acesso a esses SDKs Node.
 *
 * Paridade comportamental (não textual) com `interpretador-chamador.ts` é
 * verificada por `ia-interprete.parity.test.ts`.
 */

import Groq from 'groq-sdk'
import Anthropic from '@anthropic-ai/sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'not-configured' })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'not-configured' })

async function callGroq(systemPrompt: string, userMessage: string, maxTokens: number): Promise<string> {
  const resp = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  })
  const conteudo = resp.choices[0]?.message?.content
  if (!conteudo) throw new Error('Groq: resposta sem conteúdo')
  return conteudo
}

async function callAnthropic(systemPrompt: string, userMessage: string, maxTokens: number): Promise<string> {
  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })
  const bloco = resp.content[0]
  if (!bloco || bloco.type !== 'text') throw new Error('Anthropic: resposta sem texto')
  return bloco.text
}

async function chamarModelo(systemPrompt: string, userMessage: string, maxTokens = 512): Promise<string> {
  if (process.env.GROQ_API_KEY) {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        if (tentativa > 0) await new Promise(r => setTimeout(r, 1500))
        return await callGroq(systemPrompt, userMessage, maxTokens)
      } catch (e) {
        const msg = String(e)
        if (!msg.includes('429')) break
      }
    }
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return callAnthropic(systemPrompt, userMessage, maxTokens)
  }
  throw new Error('Nenhuma API key configurada (GROQ_API_KEY ou ANTHROPIC_API_KEY)')
}

/**
 * Factory que devolve a função injetada em `DependenciasFunil.interpretarIntencao`.
 * Nunca lança — qualquer falha (credencial ausente, erro de rede, timeout)
 * vira `null`, que o gate chamador já trata como "sem sinal do interpretador"
 * (fallback determinístico).
 */
export function criarChamadorInterpretacao(): (systemPrompt: string, mensagemCliente: string, timeoutMs: number) => Promise<string | null> {
  return async (systemPrompt: string, mensagemCliente: string, timeoutMs: number): Promise<string | null> => {
    try {
      const resultado = await Promise.race([
        chamarModelo(systemPrompt, mensagemCliente),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ])
      return resultado
    } catch {
      return null
    }
  }
}
