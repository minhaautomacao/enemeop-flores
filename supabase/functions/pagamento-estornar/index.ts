/**
 * pagamento-estornar — estorno administrativo protegido de um pagamento
 * real aprovado, em duas etapas obrigatórias (nunca uma só chamada):
 *
 *   1. `confirmar` ausente/false — modo PREVIEW: só consulta o pagamento
 *      real (buscarPagamentoReal, nunca confia em dado local) e devolve
 *      exatamente o pedido/pagamento/valor que seriam afetados, sem gravar
 *      nada nem chamar o Mercado Pago. É a resposta que o painel
 *      administrativo mostra ANTES do clique de confirmação.
 *   2. `confirmar: true` — só então chama a API real de estorno. Exige
 *      `responsavel` (quem autorizou) no payload.
 *
 * Nunca estorna automaticamente a partir da conversa — a Flora só abre um
 * evento 'pendente_autorizacao' (ver _shared/cancelamento-pedido.ts); a
 * confirmação real é sempre uma ação humana explícita, por aqui.
 *
 * Protegido por Authorization: Bearer <FACTORY_SECRET> — mesmo padrão de
 * logistica-retry/pagamento-reconciliar. Publicada com --no-verify-jwt.
 *
 * Variáveis de ambiente:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injetados)
 *   SAAS_WORKSPACE_ID, FACTORY_SECRET
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { factorySecretValido } from '../_shared/auth-crm.ts';
import { buscarPagamentoReal, estornarPagamentoMercadoPago } from '../_shared/mercadopago.ts';
import { decidirEstorno, type EventoEstornoExistente } from '../_shared/estorno-decisao.ts';

const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const WORKSPACE_ID = Deno.env.get('SAAS_WORKSPACE_ID') ?? '';

function getDb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

function resposta(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
  }
  if (req.method !== 'POST') return resposta({ erro: 'metodo nao suportado' }, 405);
  if (!(await factorySecretValido(req))) return resposta({ erro: 'nao autorizado' }, 401);

  let payload: { pedido_id?: string; motivo?: string; responsavel?: string; confirmar?: boolean };
  try {
    payload = await req.json();
  } catch {
    return resposta({ erro: 'payload invalido' }, 400);
  }

  const pedidoId = payload.pedido_id;
  if (!pedidoId) return resposta({ erro: 'pedido_id obrigatorio' }, 400);
  const confirmar = payload.confirmar === true;

  const db = getDb();
  const { data: pedido, error: pedidoError } = await db
    .from('pedidos')
    .select('id, mp_payment_id, valor, estorno_status, mp_ambiente')
    .eq('id', pedidoId)
    .maybeSingle();

  if (pedidoError || !pedido) return resposta({ erro: 'pedido nao encontrado' }, 404);
  if (!pedido.mp_payment_id) return resposta({ erro: 'pedido sem pagamento identificado (mp_payment_id ausente)' }, 409);

  // Ambiente vem exclusivamente da coluna imutável do pedido — nunca do
  // payload da requisição, e NUNCA com fallback pro outro ambiente (D5 do
  // plano de separação teste/produção: um estorno de teste jamais pode
  // atingir um pagamento real). Se a busca não encontrar nada neste
  // ambiente específico, falha explicitamente.
  const ambiente = (pedido.mp_ambiente as 'producao' | 'teste' | null) ?? 'producao';

  // Nunca confia em status/valor salvos localmente — sempre a API real.
  const resultadoBusca = await buscarPagamentoReal(WORKSPACE_ID, pedido.mp_payment_id, ambiente);
  if (!resultadoBusca.ok) return resposta({ erro: `nao foi possivel confirmar o pagamento na API do Mercado Pago (ambiente=${ambiente}, motivo=${resultadoBusca.motivo})` }, 502);
  const pagamentoReal = resultadoBusca.pagamento;

  const { data: eventoExistente } = await db
    .from('pedidos_estorno_eventos')
    .select('status')
    .eq('pedido_id', pedidoId)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();

  const decisao = decidirEstorno(
    { status: pagamentoReal.status, valor: pagamentoReal.valor },
    (eventoExistente as EventoEstornoExistente | null) ?? null,
    pagamentoReal.valor,
    'total',
  );

  if (!confirmar) {
    // Modo preview — nunca grava nada, nunca chama o Mercado Pago.
    return resposta({
      pode_estornar: decisao.pode,
      motivo_bloqueio: decisao.pode ? undefined : decisao.motivo,
      pedido_id: pedidoId,
      payment_id: pedido.mp_payment_id,
      valor: pagamentoReal.valor,
      status_pagamento: pagamentoReal.status,
    });
  }

  if (!decisao.pode) return resposta({ erro: 'estorno nao permitido', motivo: decisao.motivo }, 409);
  if (!payload.responsavel) return resposta({ erro: 'responsavel obrigatorio para confirmar o estorno' }, 400);

  const { data: eventoCriado, error: insertError } = await db
    .from('pedidos_estorno_eventos')
    .insert({
      pedido_id: pedidoId,
      mp_payment_id: pedido.mp_payment_id,
      valor: pagamentoReal.valor,
      tipo: 'total',
      motivo: payload.motivo ?? null,
      responsavel: payload.responsavel,
      status: 'processando',
    })
    .select('id')
    .single();

  if (insertError) {
    // Índice único parcial (pedidos_estorno_eventos_ativo_por_pedido) —
    // outro evento ativo já existe (corrida entre dois cliques, ou o preview
    // ficou desatualizado). Nunca duplica.
    if (insertError.code === '23505') return resposta({ erro: 'ja existe um evento de estorno ativo para este pedido' }, 409);
    console.error(`[pagamento-estornar] falha ao registrar evento de estorno: ${insertError.message} pedido=${pedidoId}`);
    return resposta({ erro: 'falha ao registrar evento de estorno' }, 500);
  }

  const eventoId = eventoCriado.id as string;
  const resultado = await estornarPagamentoMercadoPago(WORKSPACE_ID, pedido.mp_payment_id, undefined, ambiente);

  if (!resultado.ok) {
    await db.from('pedidos_estorno_eventos').update({ status: 'erro', erro_sanitizado: resultado.erro, atualizado_em: new Date().toISOString() }).eq('id', eventoId);
    await db.from('pedidos').update({ estorno_status: 'erro' }).eq('id', pedidoId);
    console.error(`[pagamento-estornar] falha ao estornar: ${resultado.erro} pedido=${pedidoId} payment=${pedido.mp_payment_id}`);
    return resposta({ erro: 'falha ao processar estorno', detalhe: resultado.erro }, 502);
  }

  // 'approved' é o único status realmente concluído — 'pending'/'in_process'
  // (alguns métodos de pagamento) precisam de acompanhamento posterior via
  // webhook, nunca tratados como sucesso definitivo aqui.
  const concluido = resultado.status === 'approved';
  const statusEvento = concluido ? 'concluido' : 'pendente_mp';
  const statusPedidoEstorno = concluido ? 'concluido' : 'pendente_mp';

  await db.from('pedidos_estorno_eventos').update({ status: statusEvento, mp_refund_id: resultado.refundId, atualizado_em: new Date().toISOString() }).eq('id', eventoId);

  const updatePedido: Record<string, unknown> = { estorno_status: statusPedidoEstorno };
  if (concluido) updatePedido.status = 'reembolsado';
  await db.from('pedidos').update(updatePedido).eq('id', pedidoId);

  console.log(`[pagamento-estornar] estorno ${statusEvento}. pedido=${pedidoId} payment=${pedido.mp_payment_id} refund_id=${resultado.refundId} responsavel=${payload.responsavel}`);
  return resposta({ ok: true, status: statusEvento, refund_id: resultado.refundId });
});
