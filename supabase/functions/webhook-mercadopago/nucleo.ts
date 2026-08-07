/**
 * nucleo.ts — idempotência (mercadopago_eventos) + atualização do pedido a
 * partir de um pagamento já resolvido (ambiente + dados reais já obtidos via
 * resolverPagamentoEAmbiente, ver ../_shared/resolucao-ambiente.ts).
 *
 * Extraído de index.ts pra ser testável com node:test/tsx sem precisar do
 * runtime Deno nem de rede/DB reais (mesmo espírito de
 * _shared/pedido-repositorio.ts): `db` e os efeitos colaterais reais
 * (notificar cliente, processar logística, criar alerta) são sempre
 * injetados — index.ts (a casca HTTP) passa as implementações de verdade,
 * os testes passam fakes/stubs.
 *
 * Nunca importa nada de logistica-processamento.ts / mercadopago.ts como
 * VALOR (só tipos) — esses módulos puxam credentials.ts -> supabase.ts ->
 * "npm:@supabase/supabase-js", que só resolve em runtime Deno. Por isso a
 * consulta ao pedido por external_reference e a lista de colunas que ela
 * precisa também são injetadas (buscarPedidoPorExternalReference), nunca
 * construídas aqui.
 */

import type { PagamentoReal, AmbienteMercadoPago } from '../_shared/mercadopago.ts';
import { mapearStatusPagamento, valoresDivergem, decidirAgendamentoPagamento, mensagemPagamentoNaoAprovado, pedidoAmbienteCompativel, statusPagamentoRegrideDePago } from './logica.ts';
import { decidirProcessamentoEvento, type EventoExistente } from '../_shared/pagamento-evento-decisao.ts';
import { camposBRT } from '../_shared/horario-comercial.ts';
import type { PeriodoEntrega, DataCalendario } from '../_shared/agendamento-entrega.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

export interface PedidoRowNucleo {
  id: string;
  canal: string;
  canal_id: string | null;
  cliente_telefone: string | null;
  valor: number;
  external_reference: string | null;
  mp_ambiente: string | null;
  data_entrega_solicitada: string | null;
  periodo_entrega: string | null;
  entrega_prometida_em: string | null;
  logistica_executar_em: string | null;
  link_pagamento: string | null;
  status_logistica?: string | null;
  // Demais colunas exigidas por processarLogisticaAposPagamento/
  // processarCancelamentoLogistica (SELECT_PEDIDO_PARA_LOGISTICA, definida
  // em _shared/logistica-processamento.ts) passam por aqui sem serem
  // conhecidas por este módulo.
  [coluna: string]: unknown;
}

export interface ResultadoLogistica {
  status: string;
  motivo?: string;
}

export interface DependenciasNucleo {
  /** index.ts injeta a consulta real (SELECT external_reference = ..., com a lista de colunas de produção); testes injetam uma busca no banco fake. */
  buscarPedidoPorExternalReference: (db: Db, externalReference: string) => Promise<PedidoRowNucleo | null>;
  notificarCliente: (pedido: PedidoRowNucleo, texto: string) => Promise<void>;
  processarLogisticaAposPagamento: (db: Db, pedido: PedidoRowNucleo & { status: string }) => Promise<ResultadoLogistica>;
  processarCancelamentoLogistica: (db: Db, pedido: PedidoRowNucleo) => Promise<unknown>;
  criarAlertaOperacional: (db: Db, pedido: PedidoRowNucleo, motivoSanitizado: string) => Promise<void>;
  leadTimeMinutos: number;
}

export type ResultadoProcessamentoEvento =
  | { status: 'evento_ignorado_ja_processado' }
  | { status: 'pedido_nao_encontrado' }
  | { status: 'ambiente_divergente' }
  | { status: 'divergencia_de_valor' }
  | { status: 'falha_ao_marcar_pago' }
  | { status: 'falha_ao_agendar_logistica' }
  | { status: 'pago_confirmado' }
  | { status: 'status_atualizado'; statusMapeado: string }
  | { status: 'status_desconhecido_ignorado' }
  | { status: 'falha_ao_atualizar_status' };

function textoJanelaPrometida(entregaPrometidaEm: Date, agora: Date): string {
  const campoAgora = camposBRT(agora);
  const campoPrometida = camposBRT(entregaPrometidaEm);
  const horaTexto = `${String(campoPrometida.hora).padStart(2, '0')}h`;
  const mesmoDia = campoAgora.ano === campoPrometida.ano && campoAgora.mes === campoPrometida.mes && campoAgora.dia === campoPrometida.dia;
  if (mesmoDia) return `ainda hoje, a partir das ${horaTexto}`;
  const diasSemana = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const dataTexto = `${String(campoPrometida.dia).padStart(2, '0')}/${String(campoPrometida.mes + 1).padStart(2, '0')}`;
  return `${diasSemana[campoPrometida.diaSemana]} (${dataTexto}), a partir das ${horaTexto}`;
}

/**
 * Reivindica/registra o evento em mercadopago_eventos (payment_id, status,
 * ambiente) — chave de idempotência real. Grava sempre o `ambiente`
 * RESOLVIDO pela API (nunca pedido.mp_ambiente, que pode ser exatamente o
 * campo divergente que a checagem abaixo existe pra pegar).
 */
async function reivindicarEvento(
  db: Db,
  paymentId: string,
  pagamento: PagamentoReal,
  ambienteResolvido: AmbienteMercadoPago,
): Promise<{ eventoExistente: EventoExistente | null; reivindicadoAgora: boolean }> {
  let eventoExistente: EventoExistente | null = null;
  let reivindicadoAgora = false;

  const { error: eventoError } = await db.from('mercadopago_eventos').insert({
    payment_id: paymentId,
    status: pagamento.status,
    ambiente: ambienteResolvido,
    external_reference: pagamento.externalReference,
    valor: pagamento.valor,
    processamento_status: 'processando',
    tentativas: 1,
  });

  if (!eventoError) return { eventoExistente: null, reivindicadoAgora: false };

  if (eventoError.code !== '23505') {
    console.error('[webhook-mp/nucleo] falha ao registrar evento:', eventoError.message);
    return { eventoExistente: null, reivindicadoAgora: false };
  }

  const { data: existente } = await db.from('mercadopago_eventos')
    .select('processamento_status, tentativas')
    .eq('payment_id', paymentId).eq('status', pagamento.status).eq('ambiente', ambienteResolvido)
    .maybeSingle();
  eventoExistente = (existente as EventoExistente | null) ?? null;

  if (eventoExistente?.processamento_status === 'erro') {
    const { data: claim } = await db.from('mercadopago_eventos')
      .update({ processamento_status: 'processando', tentativas: eventoExistente.tentativas + 1 })
      .eq('payment_id', paymentId).eq('status', pagamento.status).eq('ambiente', ambienteResolvido)
      .eq('processamento_status', 'erro')
      .select('tentativas')
      .maybeSingle();
    reivindicadoAgora = !!claim;
  }
  return { eventoExistente, reivindicadoAgora };
}

export async function processarEventoPagamento(
  db: Db,
  paymentId: string,
  pagamento: PagamentoReal,
  ambienteResolvido: AmbienteMercadoPago,
  deps: DependenciasNucleo,
  agora: Date = new Date(),
): Promise<ResultadoProcessamentoEvento> {
  const statusMapeado = mapearStatusPagamento(pagamento.status);
  if (!statusMapeado) {
    console.log('[webhook-mp/nucleo] status sem mapeamento conhecido, ignorado:', pagamento.status);
    return { status: 'status_desconhecido_ignorado' };
  }
  if (!pagamento.externalReference) {
    console.error('[webhook-mp/nucleo] pagamento sem external_reference, impossivel localizar o pedido. paymentId=', paymentId);
    return { status: 'pedido_nao_encontrado' };
  }

  const { eventoExistente, reivindicadoAgora } = await reivindicarEvento(db, paymentId, pagamento, ambienteResolvido);
  const decisaoEvento = decidirProcessamentoEvento(eventoExistente, reivindicadoAgora);

  async function marcarEventoOk(): Promise<void> {
    const { error } = await db.from('mercadopago_eventos').update({ processamento_status: 'ok' })
      .eq('payment_id', paymentId).eq('status', pagamento.status).eq('ambiente', ambienteResolvido);
    if (error) console.error(`[webhook-mp/nucleo] falha ao marcar evento como ok: ${error.message} payment=${paymentId}`);
  }
  async function marcarEventoErro(motivoSanitizado: string): Promise<void> {
    const { error } = await db.from('mercadopago_eventos').update({ processamento_status: 'erro', erro_sanitizado: motivoSanitizado })
      .eq('payment_id', paymentId).eq('status', pagamento.status).eq('ambiente', ambienteResolvido);
    if (error) console.error(`[webhook-mp/nucleo] falha ao marcar evento como erro: ${error.message} payment=${paymentId}`);
  }

  const pedido = await deps.buscarPedidoPorExternalReference(db, pagamento.externalReference);
  if (!pedido) {
    console.error('[webhook-mp/nucleo] pedido nao encontrado para external_reference:', pagamento.externalReference);
    if (decisaoEvento.acao === 'processar_completo') await marcarEventoErro('pedido nao encontrado para external_reference');
    return { status: 'pedido_nao_encontrado' };
  }

  // Decisão de segurança central (D4): nunca atualiza o pedido se o
  // ambiente que a API confirmou não bater com o ambiente gravado nele.
  if (!pedidoAmbienteCompativel(pedido.mp_ambiente, ambienteResolvido)) {
    const motivo = `Pagamento (${paymentId}) resolvido em ambiente '${ambienteResolvido}' mas pedido está marcado como '${pedido.mp_ambiente ?? 'producao'}' — nunca atualizado automaticamente, requer revisão humana.`;
    console.error(`[webhook-mp/nucleo] AMBIENTE DIVERGENTE: ${motivo} pedido=${pedido.id}`);
    if (decisaoEvento.acao === 'processar_completo') await marcarEventoErro(`ambiente divergente: pedido=${pedido.mp_ambiente ?? 'producao'} resolvido=${ambienteResolvido}`);
    await deps.criarAlertaOperacional(db, pedido, motivo);
    return { status: 'ambiente_divergente' };
  }

  if (pagamento.status === 'approved') {
    const valorPedido = Number(pedido.valor ?? 0);
    if (valoresDivergem(valorPedido, pagamento.valor)) {
      if (decisaoEvento.acao === 'processar_completo') {
        console.error(`[webhook-mp/nucleo] valor aprovado (R$ ${pagamento.valor}) diverge do valor do pedido (R$ ${valorPedido}) — pagamento NAO confirmado automaticamente, escalando pra humano. pedido=${pedido.id} payment=${paymentId}`);
        const { error: handoffError } = await db.from('atendimentos_humanos').insert({
          canal: pedido.canal,
          canal_cliente_id: pedido.canal_id ?? pedido.cliente_telefone ?? 'desconhecido',
          telefone: pedido.cliente_telefone,
          origem_handoff: 'pagamento',
          motivo_transferencia: `Pagamento aprovado (${paymentId}) com valor R$ ${pagamento.valor} divergente do pedido R$ ${valorPedido}`,
          dados_pedido: { pedido_id: pedido.id, payment_id: paymentId, valor_aprovado: pagamento.valor, valor_pedido: valorPedido },
        });
        if (handoffError) {
          console.error('[webhook-mp/nucleo] falha ao criar handoff de divergencia de valor:', handoffError.message);
          await marcarEventoErro('falha ao criar handoff de divergencia de valor');
          return { status: 'divergencia_de_valor' };
        }
        await marcarEventoOk();
      } else {
        console.log('[webhook-mp/nucleo] evento de divergencia de valor ja processado antes — nao duplica handoff:', paymentId);
      }
      return { status: 'divergencia_de_valor' };
    }

    const { error: marcarPagoError } = await db.from('pedidos').update({
      status: 'pago',
      mp_payment_id: paymentId,
      pago_em: new Date().toISOString(),
    }).eq('id', pedido.id);
    if (marcarPagoError) {
      console.error(`[webhook-mp/nucleo] FALHA CRITICA ao marcar pedido como pago: ${marcarPagoError.message} pedido=${pedido.id} payment=${paymentId}`);
      if (decisaoEvento.acao === 'processar_completo') await marcarEventoErro(`falha ao marcar pedido pago: ${marcarPagoError.message}`.slice(0, 200));
      await deps.criarAlertaOperacional(db, pedido, `Pagamento aprovado (${paymentId}) mas falha ao marcar o pedido como pago: ${marcarPagoError.message}`);
      return { status: 'falha_ao_marcar_pago' };
    }

    const dataEntregaTipada: DataCalendario | null = pedido.data_entrega_solicitada
      ? (([ano, mes, dia]) => ({ ano, mes: mes - 1, dia }))((pedido.data_entrega_solicitada as string).split('-').map(Number) as [number, number, number])
      : null;
    const periodoEntregaTipado = (pedido.periodo_entrega as PeriodoEntrega | null) ?? null;

    const agendamento = decidirAgendamentoPagamento({
      entregaPrometidaFixadaISO: pedido.entrega_prometida_em,
      despachoFixadoISO: pedido.logistica_executar_em,
      dataEntregaTipada,
      periodoEntregaTipado,
      leadTimeMinutos: deps.leadTimeMinutos,
    }, agora);

    const foraDoHorarioPagamento = !agendamento.imediato;
    let logisticaAgendadaOk = true;

    if (foraDoHorarioPagamento) {
      const { data: agendado, error: agendarError } = await db.from('pedidos')
        .update({
          status_logistica: 'agendada',
          logistica_executar_em: agendamento.despachoEm.toISOString(),
          entrega_prometida_em: agendamento.entregaPrometidaEm.toISOString(),
        })
        .eq('id', pedido.id)
        .or('status_logistica.is.null,status_logistica.eq.erro_logistica')
        .select('id')
        .maybeSingle();
      if (agendarError) {
        console.error(`[webhook-mp/nucleo] FALHA ao agendar logistica: ${agendarError.message} pedido=${pedido.id}`);
        logisticaAgendadaOk = false;
      } else {
        console.log(agendado
          ? `[webhook-mp/nucleo] pagamento aprovado — logistica agendada para ${agendamento.despachoEm.toISOString()} (entrega prometida ${agendamento.entregaPrometidaEm.toISOString()}). pedido=${pedido.id}`
          : `[webhook-mp/nucleo] logistica ja criada/agendada/em revisao — nao reagenda. pedido=${pedido.id}`);
      }
    } else {
      const { error: entregaPrometidaError } = await db.from('pedidos')
        .update({ entrega_prometida_em: agendamento.entregaPrometidaEm.toISOString() })
        .eq('id', pedido.id);
      if (entregaPrometidaError) console.error(`[webhook-mp/nucleo] falha ao gravar entrega_prometida_em (nao critico): ${entregaPrometidaError.message} pedido=${pedido.id}`);
    }

    if (!logisticaAgendadaOk) {
      if (decisaoEvento.acao === 'processar_completo') await marcarEventoErro('pagamento marcado mas falha ao agendar logistica');
      await deps.criarAlertaOperacional(db, pedido, `Pagamento aprovado (${paymentId}) e marcado, mas falha ao agendar a logistica — corrida nunca foi criada.`);
      return { status: 'falha_ao_agendar_logistica' };
    }

    if (decisaoEvento.acao === 'processar_completo') {
      const { error: concluirConversaError } = await db.from('conversas').update({
        fase: 'concluido',
        atualizado_em: new Date().toISOString(),
      }).eq('canal', pedido.canal).eq('canal_id', pedido.canal_id);
      if (concluirConversaError) console.error(`[webhook-mp/nucleo] falha ao concluir conversa (nao critico): ${concluirConversaError.message} pedido=${pedido.id}`);

      const valorFormatado = `R$ ${pagamento.valor.toFixed(2).replace('.', ',')}`;
      const texto = foraDoHorarioPagamento
        ? `Recebemos o seu pagamento de ${valorFormatado}. Pagamento confirmado! A entrega segue ${textoJanelaPrometida(agendamento.entregaPrometidaEm, agora)}. Vamos preparar tudo com muito carinho.`
        : `Recebemos o seu pagamento de ${valorFormatado}. Seu pedido está confirmado e vamos preparar tudo com muito carinho. Em breve entraremos em contato com as informações de entrega.`;
      await deps.notificarCliente(pedido, texto);
      console.log(`[webhook-mp/nucleo] pagamento aprovado e confirmado. pedido=${pedido.id} payment=${paymentId} valor=${valorFormatado}`);
      await marcarEventoOk();
    } else {
      console.log(`[webhook-mp/nucleo] evento repetido — pulando nova notificacao ao cliente, so retomando logistica se necessario. pedido=${pedido.id}`);
    }

    if (!foraDoHorarioPagamento) {
      const resultadoLogistica = await deps.processarLogisticaAposPagamento(db, { ...pedido, status: 'pago' });
      console.log(`[webhook-mp/nucleo] resultado logistica: ${resultadoLogistica.status}${resultadoLogistica.motivo ? ` (${resultadoLogistica.motivo})` : ''} pedido=${pedido.id}`);
    }

    return { status: 'pago_confirmado' };
  }

  // pending/in_process/authorized/rejected/cancelled/refunded/charged_back
  if (statusPagamentoRegrideDePago(pedido.status as string | undefined, statusMapeado)) {
    console.log(`[webhook-mp/nucleo] evento atrasado (mp status=${pagamento.status}) ignorado — pedido ${pedido.id} já está 'pago', nunca regride para aguardando_pagamento. payment=${paymentId}`);
    // Registra o evento como processado (idempotência/auditoria) sem reduzir
    // o estado do pedido — se o mesmo evento atrasado chegar de novo, cai no
    // "evento já processado" em vez de reavaliar esta regra outra vez.
    if (decisaoEvento.acao === 'processar_completo') await marcarEventoOk();
    return { status: 'status_atualizado', statusMapeado: 'pago' };
  }

  const { error: statusUpdateError } = await db.from('pedidos').update({ status: statusMapeado, mp_payment_id: paymentId }).eq('id', pedido.id);
  if (statusUpdateError) {
    console.error(`[webhook-mp/nucleo] falha ao atualizar status do pedido para ${statusMapeado}: ${statusUpdateError.message} pedido=${pedido.id}`);
    if (decisaoEvento.acao === 'processar_completo') await marcarEventoErro(`falha ao atualizar status para ${statusMapeado}: ${statusUpdateError.message}`.slice(0, 200));
    return { status: 'falha_ao_atualizar_status' };
  }
  console.log(`[webhook-mp/nucleo] pedido ${pedido.id} atualizado para status=${statusMapeado} (mp status=${pagamento.status})`);

  if ((statusMapeado === 'cancelado' || statusMapeado === 'reembolsado') && pedido.status_logistica === 'criada') {
    try {
      await deps.processarCancelamentoLogistica(db, pedido);
    } catch (e) {
      console.error(`[webhook-mp/nucleo] falha ao tentar cancelar logistica apos ${statusMapeado} (nao critico): ${e instanceof Error ? e.message : String(e)} pedido=${pedido.id}`);
    }
  }

  if (decisaoEvento.acao === 'processar_completo') {
    if (statusMapeado === 'pagamento_recusado' || statusMapeado === 'cancelado') {
      await deps.notificarCliente(pedido, mensagemPagamentoNaoAprovado(pedido.link_pagamento));
    }
    await marcarEventoOk();
  }
  return { status: 'status_atualizado', statusMapeado };
}
