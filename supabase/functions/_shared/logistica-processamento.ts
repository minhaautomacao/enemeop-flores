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
import { cotacaoExpirada, telefoneE164Valido } from './lalamove-config.ts';

export interface PedidoParaEntrega extends PedidoParaLogistica {
  id: string;
  nome_destinatario: string | null;
  telefone_destinatario: string | null;
  lalamove_quotation_id: string | null;
  lalamove_stop_id_origem: string | null;
  lalamove_stop_id_destino: string | null;
  frete_expires_at: string | null;
  frete_destino: { cep?: string } | null;
  frete_preco_real: number | null;
  logistica_tentativas: number | null;
}

export interface ConfigLogisticaProcessamento {
  supabaseUrl: string;
  factorySecret: string;
  workspaceId: string;
  storePhone: string;
  storeNome: string;
  // Quanto o preço operacional (Lalamove) pode subir, em reais, entre a
  // cotação original (cobrada do cliente) e uma re-cotação pós-expiração,
  // antes de exigir revisão humana em vez de a loja absorver a diferença
  // automaticamente (Parte 3 — ordem financeiramente segura).
  limiteAumentoOperacionalReais: number;
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
  const { error } = await db.from('pedidos').update({
    status_logistica: 'erro_logistica',
    logistica_resposta: { erro: motivoSanitizado },
    logistica_tentativas: tentativas + 1,
  }).eq('id', pedidoId);
  // Parte 4: nunca ignora silenciosamente — se nem isso persistir, o pedido
  // fica travado em 'pendente' (claim aberto) sem nenhum registro do que
  // aconteceu; só resta o log pra investigação manual.
  if (error) console.error(`[logistica] FALHA AO REGISTRAR erro_logistica (pedido pode ficar preso em 'pendente'): ${error.message} pedido=${pedidoId}`);
}

/** Estado ambíguo — não dá pra provar que a corrida não foi criada do lado da Lalamove. Nunca marcado como retriável automaticamente (ver statusLogisticaReivindicavel). */
async function marcarRevisaoLogistica(db: Db, pedidoId: string, tentativas: number, motivoSanitizado: string): Promise<void> {
  console.error(`[logistica] ESTADO AMBIGUO — revisao humana necessaria: ${motivoSanitizado} pedido=${pedidoId}`);
  const { error } = await db.from('pedidos').update({
    status_logistica: 'revisao_logistica',
    logistica_resposta: { erro: motivoSanitizado, ambiguo: true },
    logistica_tentativas: tentativas + 1,
  }).eq('id', pedidoId);
  if (error) console.error(`[logistica] FALHA AO REGISTRAR revisao_logistica (RISCO: pedido pode ficar preso em 'pendente' e nunca ser revisado): ${error.message} pedido=${pedidoId}`);
}

/** Re-cota o frete (mesmo caminho real usado durante a conversa) quando a cotação persistida no pedido já expirou — nunca cria a entrega com um quotationId vencido. */
async function reconsultarFrete(
  config: ConfigLogisticaProcessamento,
  cepDestino: string,
): Promise<{ quotationId: string; expiresAt: string | null; stopIdOrigem?: string; stopIdDestino?: string; precoReal: number | null } | null> {
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
      preco_real?: number;
      cotacao?: { quotationId?: string; expiresAt?: string | null; stopIdOrigem?: string; stopIdDestino?: string };
    };
    if (!data.disponivel || !data.cotacao?.quotationId) return null;
    return {
      quotationId: data.cotacao.quotationId,
      expiresAt: data.cotacao.expiresAt ?? null,
      stopIdOrigem: data.cotacao.stopIdOrigem,
      stopIdDestino: data.cotacao.stopIdDestino,
      precoReal: data.preco_real ?? null,
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
  // Nunca envia um STORE_PHONE mal formatado pra Lalamove — a API exige
  // E.164 com "+" (regex oficial ^\+[1-9]\d{1,14}$). Configurado mas
  // inválido é tratado igual a ausente: bloqueia com motivo claro, nunca
  // manda um telefone que a API vai rejeitar (ou pior, aceitar mal-parseado).
  const decisao = decidirAcaoLogistica(pedido, telefoneE164Valido(config.storePhone));

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

  // A condição de horário do agendamento entra na própria cláusula WHERE do
  // UPDATE atômico — nunca só numa leitura anterior (decidirAcaoLogistica,
  // acima, já bloqueou a maioria dos casos, mas essa checagem aqui é a
  // fonte real de verdade: mesmo que dois processos concorrentes
  // (logistica-agendada-processar e logistica-retry) cheguem os dois até
  // aqui pro mesmo pedido 'agendada' ainda não vencido, nenhum dos dois
  // UPDATEs bate a condição e nenhum reivindica antes da hora).
  const agoraIso = new Date().toISOString();
  const { data: claim } = await db.from('pedidos')
    .update({ status_logistica: 'pendente', logistica_pendente_desde: agoraIso })
    .eq('id', pedido.id)
    .or(`status_logistica.is.null,status_logistica.eq.erro_logistica,and(status_logistica.eq.agendada,logistica_executar_em.lte.${agoraIso})`)
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
  // Preço operacional (Lalamove) que efetivamente será usado pra criar a
  // corrida — registrado separado do preço cotado ao cliente (frete_preco_real,
  // travado desde o checkout e nunca cobrado de novo), pra nunca confundir
  // os dois quando a cotação expira e precisa ser refeita (Parte 3).
  let precoOperacionalFinal = pedido.frete_preco_real;

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

    // Nunca cobra o cliente de novo pela diferença — a loja absorve um
    // aumento operacional dentro do limite configurado; acima disso, nunca
    // decide sozinho, vai pra revisão humana (Parte 3).
    if (nova.precoReal != null && pedido.frete_preco_real != null) {
      const aumento = nova.precoReal - pedido.frete_preco_real;
      if (aumento > config.limiteAumentoOperacionalReais) {
        await marcarRevisaoLogistica(
          db, pedido.id, tentativas,
          `recotacao com aumento operacional acima do limite (aumento=${aumento.toFixed(2)}, limite=${config.limiteAumentoOperacionalReais})`,
        );
        return { status: 'revisao_logistica', motivo: 'aumento_operacional_acima_do_limite' };
      }
    }

    quotationId = nova.quotationId;
    expiresAt = nova.expiresAt;
    stopIdOrigem = nova.stopIdOrigem;
    stopIdDestino = nova.stopIdDestino;
    precoOperacionalFinal = nova.precoReal ?? pedido.frete_preco_real;
    const { error: cacheRecotacaoError } = await db.from('pedidos').update({
      lalamove_quotation_id: quotationId,
      frete_expires_at: expiresAt,
      lalamove_stop_id_origem: stopIdOrigem,
      lalamove_stop_id_destino: stopIdDestino,
    }).eq('id', pedido.id);
    // Não bloqueia a criação da entrega abaixo (os valores re-cotados já
    // estão em memória, nesta execução) — mas se isso não persistir, uma
    // execução futura pode re-cotar de novo sem necessidade. Só um log, não
    // é um dos casos "críticos" desta correção.
    if (cacheRecotacaoError) console.error(`[logistica] falha ao cachear nova cotacao (nao critico, corrida ainda sera criada com os valores desta execucao): ${cacheRecotacaoError.message} pedido=${pedido.id}`);
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

  const { error: persistirCriadaError } = await db.from('pedidos').update({
    status_logistica: 'criada',
    lalamove_order_id: resultado.orderId,
    logistica_criado_em: new Date().toISOString(),
    frete_preco_operacional_final: precoOperacionalFinal,
    logistica_resposta: {
      orderId: resultado.orderId, status: resultado.status,
      shareLink: resultado.shareLink, precoTotal: resultado.precoTotal, moeda: resultado.moeda,
    },
    logistica_tentativas: tentativas + 1,
  }).eq('id', pedido.id);

  if (persistirCriadaError) {
    // A Lalamove JÁ criou a corrida de verdade (temos orderId real) — se a
    // persistência falhar aqui, o pedido não pode voltar a ser
    // 'erro_logistica'/null (isso deixaria um retry futuro chamar
    // POST /v3/orders de novo e criar uma SEGUNDA corrida pro mesmo pedido).
    // Nunca repete cegamente um resultado ambíguo: força revisão humana,
    // registrando o orderId real no motivo pra quem for revisar já ter o
    // dado em mãos (Parte 4).
    console.error(`[logistica] FALHA CRITICA ao persistir entrega ja criada (orderId=${resultado.orderId}): ${persistirCriadaError.message} pedido=${pedido.id}`);
    await marcarRevisaoLogistica(db, pedido.id, tentativas, `corrida criada na Lalamove (orderId=${resultado.orderId}) mas falha ao persistir no pedido: ${persistirCriadaError.message}`);
    return { status: 'revisao_logistica', motivo: 'falha_ao_persistir_entrega_ja_criada' };
  }

  console.log(`[logistica] entrega real criada com sucesso. pedido=${pedido.id}`);
  return { status: 'criada', orderId: resultado.orderId };
}

export const SELECT_PEDIDO_PARA_LOGISTICA = `id, status, nome_destinatario, telefone_destinatario,
  lalamove_quotation_id, lalamove_order_id, lalamove_stop_id_origem, lalamove_stop_id_destino,
  frete_expires_at, frete_destino, frete_preco_real, status_logistica, logistica_pendente_desde,
  logistica_executar_em, logistica_tentativas`;
