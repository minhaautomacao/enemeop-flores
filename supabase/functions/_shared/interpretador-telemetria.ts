/**
 * interpretador-telemetria.ts — registra eventos da camada de interpretação
 * contextual de intenção (ver funil.ts) na tabela `funil_interpretacao_eventos`
 * (migration 202608030001). Mesmo padrão fire-and-forget de `_shared/logger.ts`
 * (`logEvento`): nunca lança, nunca bloqueia nem atrasa a resposta ao
 * cliente — uma falha ao registrar telemetria nunca pode derrubar o
 * atendimento.
 *
 * Chamado pelo caller de `avancarFunil` (webhook-meta/webhook-whatsapp/
 * flora-internal-test/sdr.ts), nunca de dentro de funil.ts — o núcleo do
 * funil é zero-imports por design (ver cabeçalho de funil.ts) e nunca toca
 * banco diretamente.
 */

import { getSupabaseAdmin } from './supabase.ts';
import type { EstadoConversa, Fase, ResultadoEtapa } from './funil.ts';

/**
 * Fases cuja resposta pode passar pela camada de interpretação contextual
 * (ver funil.ts) — usada só pra decidir SE vale registrar telemetria desta
 * mensagem, nunca pra decidir o comportamento do funil em si. Estender esta
 * lista é o único passo necessário quando uma fatia futura migrar mais um
 * gate: nenhum outro ponto de wiring nos canais reais precisa mudar.
 */
const FASES_COM_INTERPRETACAO_CONTEXTUAL = new Set<Fase>([
  'retomada_apos_intervalo', 'aguardando_aprovacao_frete', 'confirmando_formulario', 'aguardando_reaproveitar_dados',
]);

/**
 * true quando esta mensagem plausivelmente passou por (ou pode ter aberto)
 * um gate da camada de interpretação contextual — cobre tanto a fase antes
 * quanto depois de avancarFunil (um gate pode ter resolvido e mudado de
 * fase), e também estados que carregam sinal de um gate pendente
 * (ultimaPergunta/tentativasInterpretacao), mesmo que a fase em si não seja
 * uma das listadas acima (ex.: confirmação de cancelamento, que não muda a
 * fase enquanto pendente). Fire-and-forget do lado de quem chama — este
 * helper só decide SE chama registrarEventoInterpretacao, nunca chama ele
 * mesmo.
 */
export function gateDeInterpretacaoEnvolvido(faseAntes: Fase, estadoDepois: EstadoConversa): boolean {
  return (
    FASES_COM_INTERPRETACAO_CONTEXTUAL.has(faseAntes) ||
    FASES_COM_INTERPRETACAO_CONTEXTUAL.has(estadoDepois.fase) ||
    !!estadoDepois.dados.ultimaPergunta ||
    !!estadoDepois.dados.tentativasInterpretacao
  );
}

export interface EventoInterpretacao {
  conversaId?: string;
  faseAnterior: string;
  fasePosterior: string;
  gate?: string;
  intencaoPrimaria?: string;
  intencoesSecundarias?: string[];
  confianca?: string;
  precisaEsclarecimento?: boolean;
  camposAlterados?: string[];
  avancou: boolean;
  motivo?: string;
  tentativaNumero?: number;
  fallbackAcionado?: boolean;
  duracaoMs?: number;
}

export async function registrarEventoInterpretacao(evento: EventoInterpretacao): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
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
    });
  } catch {
    // falha silenciosa no log de telemetria — nunca derruba o atendimento
  }
}

/**
 * Monta o EventoInterpretacao a partir do ResultadoEtapa que avancarFunil já
 * devolve — nunca lê `estado.dados` bruto (nome/telefone/endereço) fora do
 * que `diagnosticoInterpretacao` já expõe minimizado. Cada canal real só
 * precisa passar a fase de antes, o conversaId e a duração medida.
 */
export function eventoDoResultado(
  resultado: ResultadoEtapa,
  faseAnterior: Fase,
  conversaId: string | undefined,
  duracaoMs: number,
): EventoInterpretacao {
  const diag = resultado.diagnosticoInterpretacao;
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
  };
}
