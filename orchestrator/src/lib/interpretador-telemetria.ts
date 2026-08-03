/**
 * interpretador-telemetria.ts — versão Node (orchestrator/SDR) de
 * `_shared/interpretador-telemetria.ts` (Deno) — mesma tabela
 * `funil_interpretacao_eventos` (migration 202608030001), mesmo contrato,
 * mesmo padrão fire-and-forget (nunca lança, nunca bloqueia a resposta ao
 * cliente).
 *
 * Ainda não conectado a nenhum call site em sdr.ts nesta fatia — a
 * referência de wiring está em flora-internal-test/index.ts (Deno). Ligar
 * aqui é mecânico (mesmos ~10 linhas: capturar fase antes, medir duração,
 * chamar depois de avancarFunil só quando o gate de retomada esteve
 * envolvido), deixado como próximo passo pra manter esta fatia pequena e
 * revisável.
 */

import { getSupabase } from './supabase.js'

export interface EventoInterpretacao {
  conversaId?: string
  fase: string
  ultimaPerguntaChave?: string
  ultimaPerguntaTexto?: string
  mensagemRecebida: string
  intencaoPrimaria?: string
  intencoesSecundarias?: string[]
  confianca?: string
  acaoTomada: string
  estadoAntes?: unknown
  estadoDepois?: unknown
  camposAlterados?: string[]
  avancou: boolean
  motivo?: string
  tentativaNumero?: number
  fallbackAcionado?: boolean
  duracaoMs?: number
}

export async function registrarEventoInterpretacao(evento: EventoInterpretacao): Promise<void> {
  try {
    const sb = getSupabase()
    await sb.from('funil_interpretacao_eventos').insert({
      conversa_id: evento.conversaId ?? null,
      fase: evento.fase,
      ultima_pergunta_chave: evento.ultimaPerguntaChave ?? null,
      ultima_pergunta_texto: evento.ultimaPerguntaTexto ?? null,
      mensagem_recebida: evento.mensagemRecebida,
      intencao_primaria: evento.intencaoPrimaria ?? null,
      intencoes_secundarias: evento.intencoesSecundarias ?? [],
      confianca: evento.confianca ?? null,
      acao_tomada: evento.acaoTomada,
      estado_antes: evento.estadoAntes ?? null,
      estado_depois: evento.estadoDepois ?? null,
      campos_alterados: evento.camposAlterados ?? [],
      avancou: evento.avancou,
      motivo: evento.motivo ?? null,
      tentativa_numero: evento.tentativaNumero ?? 0,
      fallback_acionado: evento.fallbackAcionado ?? false,
      duracao_ms: evento.duracaoMs ?? null,
    })
  } catch {
    // falha silenciosa no log de telemetria — nunca derruba o atendimento
  }
}
