/**
 * handoff.ts — criação/reuso de um ticket real em `atendimentos_humanos`,
 * compartilhado entre webhook-meta e webhook-whatsapp (GO-LIVE Parte 2:
 * "reutilizar o módulo compartilhado de handoff").
 *
 * Extraído de webhook-meta/index.ts (onde já funcionava corretamente) —
 * webhook-whatsapp antes só enviava mensagemTransferencia() e marcava
 * fase='transferido_humano' SEM nunca criar o INSERT em
 * atendimentos_humanos (o próprio código antigo documentava isso como
 * limitação conhecida). Isso era falso sucesso: o cliente achava que um
 * humano ia continuar, e não existia ticket nenhum pro atendente ver.
 *
 * Índice único parcial (conversa_id) WHERE status IN ('aguardando_humano',
 * 'em_atendimento') garante no banco que só existe um ticket aberto por
 * conversa (ver migration 202607170001_atendimento_humano.sql). Se duas
 * chamadas concorrentes tentarem criar ao mesmo tempo, a segunda recebe
 * violação de unicidade e cai no fallback: busca o ticket já aberto e reusa
 * o código — nunca gera um segundo ticket pro mesmo handoff ativo.
 */

// deno-lint-ignore no-explicit-any
type DbClient = any;

export type OrigemHandoff = 'cliente_solicitou' | 'flora_sem_confianca' | 'limite_tecnico';

export type ResultadoHandoff =
  | { ok: true; codigo: string | null }
  | { ok: false };

export async function criarOuReusarAtendimento(
  db: DbClient,
  conversaId: string,
  canal: string,
  canalId: string,
  nomeCliente: string | null,
  origem: OrigemHandoff,
  motivo: string,
  telefone: string | null | undefined,
  logPrefix: string,
): Promise<ResultadoHandoff> {
  const { data: inserted, error: insertError } = await db
    .from('atendimentos_humanos')
    .insert({
      conversa_id: conversaId,
      canal,
      canal_cliente_id: canalId,
      nome_cliente: nomeCliente,
      telefone: telefone ?? null,
      origem_handoff: origem,
      motivo_transferencia: motivo,
    })
    .select('codigo')
    .single();

  if (!insertError && inserted) return { ok: true, codigo: (inserted as { codigo: string }).codigo };

  // Conflito esperado quando já existe ticket aberto pra essa conversa
  // (índice único parcial) — busca e reaproveita em vez de tratar como
  // falha. Qualquer outro erro de insert também cai aqui só como
  // segurança extra (nunca perde um handoff só porque o insert teve um
  // erro transitório se já existir um ticket aberto de fato).
  const { data: existente, error: selectError } = await db
    .from('atendimentos_humanos')
    .select('codigo')
    .eq('conversa_id', conversaId)
    .in('status', ['aguardando_humano', 'em_atendimento'])
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existente) return { ok: true, codigo: (existente as { codigo: string }).codigo };

  console.error(`[${logPrefix}] falha ao criar/reaproveitar atendimento humano: insert="${insertError?.message}" select="${selectError?.message}"`);
  return { ok: false };
}
