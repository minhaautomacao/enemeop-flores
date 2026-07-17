import { getSupabaseAdmin } from './supabase.ts';
import type { LogEventoParams } from './types.ts';

export async function logEvento(params: LogEventoParams): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    await sb.from('orchestrator_logs').insert({
      task_id: params.task_id,
      escopo: params.escopo,
      agente: params.agente,
      tipo_evento: params.tipo_evento,
      urgencia: params.urgencia ?? 'normal',
      duracao_ms: params.duracao_ms,
      erro: params.erro,
      workspace_id: params.workspace_id,
    });
  } catch {
    // falha silenciosa no log para não derrubar o agente principal
  }
}
