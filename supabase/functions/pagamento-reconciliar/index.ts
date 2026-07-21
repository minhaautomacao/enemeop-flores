/**
 * pagamento-reconciliar — reconciliação administrativa protegida de um
 * pedido travado em mp_preference_status='criando' (GO-LIVE Parte 1:
 * "fornecer mecanismo protegido de reconciliação pelo external_reference/
 * preference_id").
 *
 * Esse estado é ambíguo por natureza: significa que a chamada de criação de
 * preference pode ter tido sucesso do lado do Mercado Pago mesmo que a
 * persistência local do id/link tenha falhado (ver
 * _shared/pedido-repositorio.ts). Esta função NUNCA cria uma preference
 * nova — só consulta o Mercado Pago pelo external_reference do pedido e, se
 * encontrar uma preference já existente, persiste o que encontrar. Se não
 * encontrar nada, devolve o estado como está (segue ambíguo, precisa de
 * decisão humana antes de qualquer nova tentativa).
 *
 * Protegido por Authorization: Bearer <FACTORY_SECRET> — mesmo padrão de
 * logistica-retry. Publicada com --no-verify-jwt.
 *
 * Variáveis de ambiente:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injetados)
 *   SAAS_WORKSPACE_ID, FACTORY_SECRET
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { factorySecretValido } from '../_shared/auth-crm.ts';
import { buscarPreferenciaPorExternalReference } from '../_shared/mercadopago.ts';

const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const WORKSPACE_ID = Deno.env.get('SAAS_WORKSPACE_ID') ?? '';

function getDb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' },
    });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ erro: 'metodo nao suportado' }), { status: 405 });
  }
  if (!(await factorySecretValido(req))) {
    return new Response(JSON.stringify({ erro: 'nao autorizado' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  let payload: { pedido_id?: string };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ erro: 'payload invalido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const pedidoId = payload.pedido_id;
  if (!pedidoId) {
    return new Response(JSON.stringify({ erro: 'pedido_id obrigatorio' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const db = getDb();
  const { data: pedido, error } = await db
    .from('pedidos')
    .select('id, external_reference, mp_preference_id, link_pagamento, mp_preference_status')
    .eq('id', pedidoId)
    .maybeSingle();

  if (error || !pedido) {
    return new Response(JSON.stringify({ erro: 'pedido nao encontrado' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  if (pedido.mp_preference_id && pedido.link_pagamento) {
    return new Response(JSON.stringify({ ok: true, acao: 'ja_persistido', mp_preference_status: pedido.mp_preference_status }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (pedido.mp_preference_status !== 'criando') {
    return new Response(JSON.stringify({ ok: true, acao: 'nada_a_reconciliar', mp_preference_status: pedido.mp_preference_status }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  const externalReference = (pedido.external_reference as string | null) ?? `enemeop-${pedidoId}`;
  const encontrada = await buscarPreferenciaPorExternalReference(WORKSPACE_ID, externalReference);

  if (!encontrada.encontrada) {
    console.log(`[pagamento-reconciliar] nenhuma preference encontrada no Mercado Pago pedido=${pedidoId} external_reference=${externalReference} — segue ambiguo`);
    return new Response(JSON.stringify({ ok: true, acao: 'nao_encontrada_segue_ambiguo', external_reference: externalReference }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { error: persistError } = await db
    .from('pedidos')
    .update({
      mp_preference_id: encontrada.preferenceId,
      link_pagamento: encontrada.initPoint,
      link_pagamento_id: encontrada.preferenceId,
      mp_preference_status: 'criado',
    })
    .eq('id', pedidoId)
    .eq('mp_preference_status', 'criando');

  if (persistError) {
    console.error(`[pagamento-reconciliar] falha ao persistir preference reconciliada pedido=${pedidoId}: ${persistError.message}`);
    return new Response(JSON.stringify({ erro: 'falha ao persistir reconciliacao' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  console.log(`[pagamento-reconciliar] preference reconciliada pedido=${pedidoId} preference_id=${encontrada.preferenceId}`);
  return new Response(JSON.stringify({ ok: true, acao: 'reconciliado', preference_id: encontrada.preferenceId }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
