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

export interface EventoInterpretacao {
  conversaId?: string;
  fase: string;
  ultimaPerguntaChave?: string;
  ultimaPerguntaTexto?: string;
  mensagemRecebida: string;
  intencaoPrimaria?: string;
  intencoesSecundarias?: string[];
  confianca?: string;
  acaoTomada: string;
  estadoAntes?: unknown;
  estadoDepois?: unknown;
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
    });
  } catch {
    // falha silenciosa no log de telemetria — nunca derruba o atendimento
  }
}
