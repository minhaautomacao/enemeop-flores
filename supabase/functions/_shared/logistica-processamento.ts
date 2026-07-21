/**
 * logistica-processamento.ts — cria a entrega real na Lalamove depois de um
 * pagamento aprovado e reconciliado. Compartilhado entre webhook-mercadopago
 * (aciona automaticamente após marcar o pedido como pago) e a Edge Function
 * logistica-retry (reprocessamento administrativo de um pedido específico)
 * — extraído pra um só lugar porque duplicar essa lógica entre os dois
 * arquivos arriscaria os dois nunca ficarem sincronizados nas mesmas regras
 * de idempotência/segurança.
 *
 * Idempotente via claim atômico (UPDATE condicional em
 * pedidos.status_logistica) e nunca faz retry cego de um resultado
 * ambíguo — ver _shared/logistica-decisao.ts e _shared/lalamove-orders.ts
 * pra o raciocínio completo.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { buscarTodasCredenciais } from './credentials.ts';
import { criarEntregaLalamove } from './lalamove-orders.ts';
import { decidirAcaoLogistica, statusLogisticaReivindicavel, type PedidoParaLogistica } from './logistica-decisao.ts';
import { cotacaoExpirada } from './lalamove-config.ts';

export interface PedidoParaEntrega extends PedidoParaLogistica {
  id: string;
  nome_destinatario: string | null;
  telefone_destinatario: string | null;
  lalamove_quotation_id: string | null;
  lalamove_stop_id_origem: string | null;
  lalamove_stop_id_destino: string | null;
  frete_expires_at: string | null;
  frete_destino: { cep?: string } | null;
  logistica_tentativas: number | null;
}

export interface ConfigLogisticaProcessamento {
  supabaseUrl: string;
  factorySecret: string;
  workspaceId: string;
  storePhone: string;
  storeNome: string;
}

export type ResultadoProcessamentoLogistica =
  | { status: 'pulado'; motivo: string }
  | { status: 'bloqueado'; motivo: string }
  | { status: 'revisao_logistica'; motivo: string }
  | { status: 'erro_logistica'; motivo: string }
  | { status: 'criada'; orderId: string };

// deno-lint-ignore no-explicit-any
type Db = SupabaseClient<any, any, any>;

async function marcarErroLogistica(db: Db, pedidoId: string, tentativas: number, motivoSanitizado: string): Promise<void> {
  console.error(`[logistica] falha recuperavel ao criar entrega real: ${motivoSanitizado} pedido=${pedidoId}`);
  await db.from('pedidos').update({
    status_logistica: 'erro_logistica',
    logistica_resposta: { erro: motivoSanitizado },
    logistica_tentativas: tentativas + 1,
  }).eq('id', pedidoId);
}

/** Estado ambíguo — não dá pra provar que a corrida não foi criada do lado da Lalamove. Nunca marcado como retriável automaticamente (ver statusLogisticaReivindicavel). */
async function marcarRevisaoLogistica(db: Db, pedidoId: string, tentativas: number, motivoSanitizado: string): Promise<void> {
  console.error(`[logistica] ESTADO AMBIGUO — revisao humana necessaria: ${motivoSanitizado} pedido=${pedidoId}`);
  await db.from('pedidos').update({
    status_logistica: 'revisao_logistica',
    logistica_resposta: { erro: motivoSanitizado, ambiguo: true },
    logistica_tentativas: tentativas + 1,
  }).eq('id', pedidoId);
}

/** Re-cota o frete (mesmo caminho real usado durante a conversa) quando a cotação persistida no pedido já expirou — nunca cria a entrega com um quotationId vencido. */
async function reconsultarFrete(
  config: ConfigLogisticaProcessamento,
  cepDestino: string,
): Promise<{ quotationId: string; expiresAt: string | null; stopIdOrigem?: string; stopIdDestino?: string } | null> {
  try {
    const res = await fetch(`${config.supabaseUrl}/functions/v1/agente-logistica`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.factorySecret}` },
      body: JSON.stringify({ endereco: { cep: cepDestino }, workspace_id: config.workspaceId }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      disponivel?: boolean;
      cotacao?: { quotationId?: string; expiresAt?: string | null; stopIdOrigem?: string; stopIdDestino?: string };
    };
    if (!data.disponivel || !data.cotacao?.quotationId) return null;
    return {
      quotationId: data.cotacao.quotationId,
      expiresAt: data.cotacao.expiresAt ?? null,
      stopIdOrigem: data.cotacao.stopIdOrigem,
      stopIdDestino: data.cotacao.stopIdDestino,
    };
  } catch (e) {
    console.error('[logistica] falha ao re-cotar frete antes da entrega:', e);
    return null;
  }
}

/**
 * Cria a entrega real na Lalamove. Falha nunca reverte o pagamento nem
 * cobra de novo — só deixa o pedido em 'erro_logistica' (recuperável) ou
 * 'revisao_logistica' (ambíguo, nunca retry automático) com alerta pra
 * revisão/retry manual.
 */
export async function processarLogisticaAposPagamento(
  db: Db,
  pedido: PedidoParaEntrega,
  config: ConfigLogisticaProcessamento,
): Promise<ResultadoProcessamentoLogistica> {
  const decisao = decidirAcaoLogistica(pedido, !!config.storePhone);

  if (decisao.acao === 'pular') return { status: 'pulado', motivo: decisao.motivo };

  if (decisao.acao === 'bloquear') {
    await marcarErroLogistica(db, pedido.id, pedido.logistica_tentativas ?? 0, 'STORE_PHONE nao configurado — corrida nao pode ser criada sem inventar um telefone da loja');
    return { status: 'bloqueado', motivo: decisao.motivo };
  }

  if (decisao.acao === 'marcar_ambiguo_por_timeout') {
    await marcarRevisaoLogistica(db, pedido.id, pedido.logistica_tentativas ?? 0, 'claim pendente expirou sem confirmacao — nao da pra provar que a corrida nao foi criada');
    return { status: 'revisao_logistica', motivo: 'claim_pendente_expirado' };
  }

  if (!statusLogisticaReivindicavel(pedido.status_logistica)) {
    return { status: 'pulado', motivo: 'nao_reivindicavel' };
  }

  const { data: claim } = await db.from('pedidos')
    .update({ status_logistica: 'pendente', logistica_pendente_desde: new Date().toISOString() })
    .eq('id', pedido.id)
    .or('status_logistica.is.null,status_logistica.eq.erro_logistica')
    .select('id')
    .maybeSingle();
  if (!claim) {
    // Outra execução concorrente já reivindicou — nunca cria uma segunda entrega.
    console.log(`[logistica] claim nao obtido (corrida concorrente ou ja criada). pedido=${pedido.id}`);
    return { status: 'pulado', motivo: 'claim_perdido_para_execucao_concorrente' };
  }

  const tentativas = pedido.logistica_tentativas ?? 0;

  let quotationId = pedido.lalamove_quotation_id;
  let expiresAt = pedido.frete_expires_at;
  let stopIdOrigem = pedido.lalamove_stop_id_origem;
  let stopIdDestino = pedido.lalamove_stop_id_destino;

  if (!quotationId || !stopIdOrigem || !stopIdDestino || cotacaoExpirada(expiresAt)) {
    const cepDestino = pedido.frete_destino?.cep;
    if (!cepDestino) {
      await marcarErroLogistica(db, pedido.id, tentativas, 'sem CEP de destino persistido para re-cotar o frete');
      return { status: 'erro_logistica', motivo: 'sem_cep_destino' };
    }
    const nova = await reconsultarFrete(config, cepDestino);
    if (!nova || !nova.stopIdOrigem || !nova.stopIdDestino) {
      await marcarErroLogistica(db, pedido.id, tentativas, 'falha ao re-cotar frete antes de criar a entrega');
      return { status: 'erro_logistica', motivo: 'falha_recotacao' };
    }
    quotationId = nova.quotationId;
    expiresAt = nova.expiresAt;
    stopIdOrigem = nova.stopIdOrigem;
    stopIdDestino = nova.stopIdDestino;
    await db.from('pedidos').update({
      lalamove_quotation_id: quotationId,
      frete_expires_at: expiresAt,
      lalamove_stop_id_origem: stopIdOrigem,
      lalamove_stop_id_destino: stopIdDestino,
    }).eq('id', pedido.id);
  }

  if (!pedido.nome_destinatario || !pedido.telefone_destinatario) {
    await marcarErroLogistica(db, pedido.id, tentativas, 'destinatario incompleto (nome/telefone ausente)');
    return { status: 'erro_logistica', motivo: 'destinatario_incompleto' };
  }

  const creds = await buscarTodasCredenciais(config.workspaceId, 'logistica');
  const apiKey = creds['lalamove_key'] || Deno.env.get('LALAMOVE_API_KEY') || '';
  const apiSecret = creds['lalamove_secret'] || Deno.env.get('LALAMOVE_API_SECRET') || '';
  if (!apiKey || !apiSecret) {
    await marcarErroLogistica(db, pedido.id, tentativas, 'credenciais Lalamove nao configuradas');
    return { status: 'erro_logistica', motivo: 'credenciais_ausentes' };
  }

  const resultado = await criarEntregaLalamove(apiKey, apiSecret, {
    quotationId: quotationId!,
    expiresAt,
    remetente: { stopId: stopIdOrigem!, nome: config.storeNome, telefone: config.storePhone },
    destinatario: { stopId: stopIdDestino!, nome: pedido.nome_destinatario, telefone: pedido.telefone_destinatario },
    pedidoId: pedido.id,
  });

  if (!resultado.ok) {
    if (resultado.motivo === 'ambiguo') {
      await marcarRevisaoLogistica(db, pedido.id, tentativas, resultado.erroSanitizado);
      return { status: 'revisao_logistica', motivo: resultado.erroSanitizado };
    }
    const motivo = resultado.motivo === 'cotacao_expirada' ? 'cotacao expirada mesmo apos re-cotar' : resultado.erroSanitizado;
    await marcarErroLogistica(db, pedido.id, tentativas, motivo);
    return { status: 'erro_logistica', motivo };
  }

  await db.from('pedidos').update({
    status_logistica: 'criada',
    lalamove_order_id: resultado.orderId,
    logistica_criado_em: new Date().toISOString(),
    logistica_resposta: {
      orderId: resultado.orderId, status: resultado.status,
      shareLink: resultado.shareLink, precoTotal: resultado.precoTotal, moeda: resultado.moeda,
    },
    logistica_tentativas: tentativas + 1,
  }).eq('id', pedido.id);
  console.log(`[logistica] entrega real criada com sucesso. pedido=${pedido.id}`);
  return { status: 'criada', orderId: resultado.orderId };
}

export const SELECT_PEDIDO_PARA_LOGISTICA = `id, status, nome_destinatario, telefone_destinatario,
  lalamove_quotation_id, lalamove_order_id, lalamove_stop_id_origem, lalamove_stop_id_destino,
  frete_expires_at, frete_destino, status_logistica, logistica_pendente_desde, logistica_tentativas`;
