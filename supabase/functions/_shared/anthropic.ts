import { getSupabaseAdmin } from './supabase.ts';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Lê credencial da tabela funcao_configs (fallback quando env var não disponível)
async function getConfigDB(name: string): Promise<string | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb.from('funcao_configs').select('valor').eq('chave', name).single();
    return (data?.valor as string) ?? null;
  } catch {
    return null;
  }
}

// Chama Groq (OpenAI-compatible) — gratuito, 14.400 req/dia
async function callGroq(apiKey: string, systemPrompt: string, userMessage: string, maxTokens: number): Promise<string> {
  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });
  if (!response.ok) { const err = await response.text(); throw new Error(`Groq API ${response.status}: ${err}`); }
  const data = await response.json();
  return data.choices[0].message.content as string;
}

// Chama Anthropic — fallback quando Groq não disponível
async function callAnthropic(apiKey: string, systemPrompt: string, userMessage: string, maxTokens: number): Promise<string> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content: userMessage }] }),
  });
  if (!response.ok) { const err = await response.text(); throw new Error(`Anthropic API ${response.status}: ${err}`); }
  const data = await response.json();
  return data.content[0].text as string;
}

/**
 * callClaude — chama Groq (gratuito) com fallback para Anthropic
 * Ordem de prioridade:
 *   1. GROQ_API_KEY (env var ou Vault)
 *   2. ANTHROPIC_API_KEY (env var ou Vault)
 */
export async function callClaude(systemPrompt: string, userMessage: string, maxTokens = 2048): Promise<string> {
  const groqKey = Deno.env.get('GROQ_API_KEY') || await getConfigDB('GROQ_API_KEY');
  if (groqKey) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
        return await callGroq(groqKey, systemPrompt, userMessage, maxTokens);
      } catch (e) {
        const msg = String(e);
        if (!msg.includes('429')) { console.warn('[callClaude] Groq erro não-429:', msg); break; }
        console.warn('[callClaude] Groq rate limit, tentando novamente...');
      }
    }
  }

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') || await getConfigDB('ANTHROPIC_API_KEY');
  if (anthropicKey) {
    return callAnthropic(anthropicKey, systemPrompt, userMessage, maxTokens);
  }

  throw new Error('Nenhuma API key configurada (GROQ_API_KEY ou ANTHROPIC_API_KEY)');
}
