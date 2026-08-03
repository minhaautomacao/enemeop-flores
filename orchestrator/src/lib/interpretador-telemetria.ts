/**
 * interpretador-telemetria.ts — versão Node (orchestrator/SDR) de
 * `_shared/interpretador-telemetria.ts` (Deno) — mesma tabela
 * `funil_interpretacao_eventos` (migration 202608030001), mesmo contrato,
 * mesmo padrão fire-and-forget (nunca lança, nunca bloqueia a resposta ao
 * cliente).
 *
 * Schema minimizado de propósito (ver INTERPRETADOR_PRIVACIDADE.md): nunca
 * armazena o texto da mensagem do cliente nem o estado bruto do pedido —
 * só o diagnóstico que `funil.ts` já expõe em
 * `ResultadoEtapa.diagnosticoInterpretacao` (nomes de campos alterados,
 * nunca valores).
 */

import { getSupabase } from './supabase.js'
import type { EstadoConversa, Fase, ResultadoEtapa } from './funil.js'

/**
 * Fases cuja resposta pode passar pela camada de interpretação contextual
 * (ver funil.ts) — usada só pra decidir SE vale registrar telemetria desta
 * mensagem, nunca pra decidir o comportamento do funil em si. Mesma lista
 * de _shared/interpretador-telemetria.ts (Deno) — estender aqui quando uma
 * fatia futura migrar mais um gate, sem precisar mudar nenhum call site.
 */
const FASES_COM_INTERPRETACAO_CONTEXTUAL = new Set<Fase>([
  'retomada_apos_intervalo', 'aguardando_aprovacao_frete', 'confirmando_formulario', 'aguardando_reaproveitar_dados',
])

/** Mesma lógica de gateDeInterpretacaoEnvolvido (Deno) — ver comentário lá. */
export function gateDeInterpretacaoEnvolvido(faseAntes: Fase, estadoDepois: EstadoConversa): boolean {
  return (
    FASES_COM_INTERPRETACAO_CONTEXTUAL.has(faseAntes) ||
    FASES_COM_INTERPRETACAO_CONTEXTUAL.has(estadoDepois.fase) ||
    !!estadoDepois.dados.ultimaPergunta ||
    !!estadoDepois.dados.tentativasInterpretacao
  )
}

export interface EventoInterpretacao {
  conversaId?: string
  faseAnterior: string
  fasePosterior: string
  gate?: string
  intencaoPrimaria?: string
  intencoesSecundarias?: string[]
  confianca?: string
  precisaEsclarecimento?: boolean
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
      gate: evento.gate ?? null,
      fase_anterior: evento.faseAnterior,
      fase_posterior: evento.fasePosterior,
      intencao_primaria: evento.intencaoPrimaria ?? null,
      intencoes_secundarias: evento.intencoesSecundarias ?? [],
      confianca: evento.confianca ?? null,
      precisa_esclarecimento: evento.precisaEsclarecimento ?? false,
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

/**
 * Monta o EventoInterpretacao a partir do ResultadoEtapa que avancarFunil
 * já devolve — nunca lê `estado.dados` bruto (nome/telefone/endereço) fora
 * do que `diagnosticoInterpretacao` já expõe minimizado. Cada canal real só
 * precisa passar a fase de antes, o conversaId (se existir) e a duração
 * medida — reduz o wiring de cada canal a uma chamada, sem duplicar a
 * lógica de "o que vai em cada coluna" quatro vezes.
 */
export function eventoDoResultado(
  resultado: ResultadoEtapa,
  faseAnterior: Fase,
  conversaId: string | undefined,
  duracaoMs: number,
): EventoInterpretacao {
  const diag = resultado.diagnosticoInterpretacao
  return {
    conversaId,
    faseAnterior,
    fasePosterior: resultado.estado.fase,
    gate: diag?.gate,
    intencaoPrimaria: diag?.intencaoPrimaria,
    intencoesSecundarias: diag?.intencoesSecundarias,
    confianca: diag?.confianca,
    precisaEsclarecimento: diag?.precisaEsclarecimento,
    camposAlterados: diag?.camposAlterados,
    avancou: resultado.estado.fase !== faseAnterior,
    motivo: diag?.motivo,
    tentativaNumero: diag?.tentativaNumero,
    fallbackAcionado: diag?.fallbackAcionado,
    duracaoMs,
  }
}
