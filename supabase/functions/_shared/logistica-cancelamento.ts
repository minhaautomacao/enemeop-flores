/**
 * logistica-cancelamento.ts — cancela a entrega real na Lalamove quando
 * solicitado (pela Flora, via funil.ts, ou pelo painel administrativo, via
 * a Edge Function logistica-cancelar). Espelha _shared/logistica-processamento.ts:
 * mesmo claim atômico via UPDATE condicional (nunca duas tentativas de
 * cancelamento concorrentes pro mesmo pedido) e o mesmo raciocínio de nunca
 * assumir sucesso/falha sem prova.
 *
 * Idempotente: chamar de novo para um pedido já 'cancelada'/'cancelamento_negado'
 * nunca repete a chamada real à Lalamove (ver logistica-cancelamento-decisao.ts).
 */

// deno-lint-ignore no-explicit-any
type Db = any;

import { buscarTodasCredenciais } from './credentials.ts';
import { cancelarEntregaLalamove } from './lalamove-orders.ts';
import {
  decidirAcaoCancelamentoLogistica,
  statusCancelamentoLogisticaReivindicavel,
  type PedidoParaCancelamentoLogistica,
} from './logistica-cancelamento-decisao.ts';

export interface PedidoParaCancelamentoEntrega extends PedidoParaCancelamentoLogistica {
  id: string;
  logistica_cancelamento_tentativas: number | null;
}

export interface ConfigLogisticaCancelamento {
  workspaceId: string;
}

export type ResultadoCancelamentoLogistica =
  | { status: 'pulado'; motivo: string }
  | { status: 'revisao_logistica'; motivo: string }
  /** A transportadora recusou explicitamente — nunca retry automático (ver decisao). */
  | { status: 'cancelamento_negado'; motivo: string }
  | { status: 'cancelada' };

async function marcarRevisaoCancelamento(db: Db, pedidoId: string, tentativas: number, motivoSanitizado: string): Promise<void> {
  console.error(`[logistica-cancelamento] ESTADO AMBIGUO — revisao humana necessaria: ${motivoSanitizado} pedido=${pedidoId}`);
  const { error } = await db.from('pedidos').update({
    status_logistica: 'revisao_logistica',
    logistica_cancelamento_resposta: { erro: motivoSanitizado, ambiguo: true },
    logistica_cancelamento_tentativas: tentativas + 1,
  }).eq('id', pedidoId);
  if (error) console.error(`[logistica-cancelamento] FALHA AO REGISTRAR revisao_logistica (RISCO: pedido pode ficar preso em 'cancelamento_solicitado'): ${error.message} pedido=${pedidoId}`);
}

async function marcarCancelamentoNegado(db: Db, pedidoId: string, tentativas: number, motivoSanitizado: string): Promise<void> {
  console.error(`[logistica-cancelamento] cancelamento negado pela transportadora: ${motivoSanitizado} pedido=${pedidoId}`);
  const { error } = await db.from('pedidos').update({
    status_logistica: 'cancelamento_negado',
    logistica_cancelamento_resposta: { erro: motivoSanitizado },
    logistica_cancelamento_tentativas: tentativas + 1,
  }).eq('id', pedidoId);
  if (error) console.error(`[logistica-cancelamento] FALHA AO REGISTRAR cancelamento_negado: ${error.message} pedido=${pedidoId}`);
}

export async function processarCancelamentoLogistica(
  db: Db,
  pedido: PedidoParaCancelamentoEntrega,
  config: ConfigLogisticaCancelamento,
): Promise<ResultadoCancelamentoLogistica> {
  const decisao = decidirAcaoCancelamentoLogistica(pedido);

  if (decisao.acao === 'pular') return { status: 'pulado', motivo: decisao.motivo };

  if (decisao.acao === 'marcar_ambiguo_por_timeout') {
    await marcarRevisaoCancelamento(db, pedido.id, pedido.logistica_cancelamento_tentativas ?? 0, 'claim de cancelamento pendente expirou sem confirmacao');
    return { status: 'revisao_logistica', motivo: 'claim_pendente_expirado' };
  }

  if (!statusCancelamentoLogisticaReivindicavel(pedido.status_logistica)) {
    return { status: 'pulado', motivo: 'nao_reivindicavel' };
  }

  // Reivindicação atômica: só quem ganhar esse UPDATE chama a Lalamove —
  // mesmo padrão de gerarOuReusarPreference/processarLogisticaAposPagamento.
  const agoraIso = new Date().toISOString();
  const { data: claim } = await db.from('pedidos')
    .update({ status_logistica: 'cancelamento_solicitado', logistica_cancelamento_pendente_desde: agoraIso })
    .eq('id', pedido.id)
    .eq('status_logistica', 'criada')
    .select('id')
    .maybeSingle();

  if (!claim) {
    console.log(`[logistica-cancelamento] claim nao obtido (corrida concorrente ou ja resolvido). pedido=${pedido.id}`);
    return { status: 'pulado', motivo: 'claim_perdido_para_execucao_concorrente' };
  }

  const tentativas = pedido.logistica_cancelamento_tentativas ?? 0;

  const creds = await buscarTodasCredenciais(config.workspaceId, 'logistica');
  const apiKey = creds['lalamove_key'] || Deno.env.get('LALAMOVE_API_KEY') || '';
  const apiSecret = creds['lalamove_secret'] || Deno.env.get('LALAMOVE_API_SECRET') || '';
  if (!apiKey || !apiSecret) {
    await marcarRevisaoCancelamento(db, pedido.id, tentativas, 'credenciais Lalamove nao configuradas');
    return { status: 'revisao_logistica', motivo: 'credenciais_ausentes' };
  }

  const resultado = await cancelarEntregaLalamove(apiKey, apiSecret, pedido.lalamove_order_id!);

  if (!resultado.ok) {
    if (resultado.motivo === 'ambiguo') {
      await marcarRevisaoCancelamento(db, pedido.id, tentativas, resultado.erroSanitizado);
      return { status: 'revisao_logistica', motivo: resultado.erroSanitizado };
    }
    await marcarCancelamentoNegado(db, pedido.id, tentativas, resultado.erroSanitizado);
    return { status: 'cancelamento_negado', motivo: resultado.erroSanitizado };
  }

  const { error: persistirError } = await db.from('pedidos').update({
    status_logistica: 'cancelada',
    logistica_cancelado_em: new Date().toISOString(),
    logistica_cancelamento_tentativas: tentativas + 1,
  }).eq('id', pedido.id);

  if (persistirError) {
    // A Lalamove JÁ cancelou de verdade — se a persistência falhar aqui,
    // nunca volta pra 'criada' sozinho (deixaria uma tentativa futura pensar
    // que ainda existe uma corrida ativa pra cancelar de novo). Força
    // revisão humana com o resultado real já registrado no motivo.
    console.error(`[logistica-cancelamento] FALHA CRITICA ao persistir cancelamento ja confirmado na Lalamove: ${persistirError.message} pedido=${pedido.id}`);
    await marcarRevisaoCancelamento(db, pedido.id, tentativas, `cancelamento confirmado na Lalamove mas falha ao persistir: ${persistirError.message}`);
    return { status: 'revisao_logistica', motivo: 'falha_ao_persistir_cancelamento_ja_confirmado' };
  }

  console.log(`[logistica-cancelamento] entrega cancelada com sucesso. pedido=${pedido.id}`);
  return { status: 'cancelada' };
}
