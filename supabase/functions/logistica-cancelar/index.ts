/**
 * logistica-cancelar — solicitação administrativa/conversacional protegida
 * de cancelamento da entrega real de um pedido cuja corrida já foi criada
 * na Lalamove (status_logistica='criada').
 *
 * Nunca processa pedido sem entrega criada (lalamove_order_id ausente).
 * Nunca repete uma chamada real à Lalamove pra um pedido já
 * 'cancelada'/'cancelamento_negado' (ver _shared/logistica-cancelamento-decisao.ts).
 *
 * Protegido por Authorization: Bearer <FACTORY_SECRET> — mesmo padrão de
 * logistica-retry/agente-logistica (ver _shared/auth-crm.ts). Publicada com
 * --no-verify-jwt.
 *
 * Variáveis de ambiente:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injetados)
 *   SAAS_WORKSPACE_ID, FACTORY_SECRET
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { factorySecretValido } from '../_shared/auth-crm.ts';
import { processarCancelamentoLogistica, type PedidoParaCancelamentoEntrega } from '../_shared/logistica-cancelamento.ts';

const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? '';
const WORKSPACE_ID   = Deno.env.get('SAAS_WORKSPACE_ID') ?? '';

function getDb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

const SELECT_PEDIDO_PARA_CANCELAMENTO = `id, status_logistica, lalamove_order_id, logistica_cancelamento_pendente_desde, logistica_cancelamento_tentativas, lalamove_ambiente`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ erro: 'metodo nao suportado' }), { status: 405 });
  }

  if (!(await factorySecretValido(req))) {
    return new Response(JSON.stringify({ erro: 'nao autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: { pedido_id?: string };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ erro: 'payload invalido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const pedidoId = payload.pedido_id;
  if (!pedidoId) {
    return new Response(JSON.stringify({ erro: 'pedido_id obrigatorio' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = getDb();
  const { data: pedido, error } = await db
    .from('pedidos')
    .select(SELECT_PEDIDO_PARA_CANCELAMENTO)
    .eq('id', pedidoId)
    .maybeSingle();

  if (error || !pedido) {
    return new Response(JSON.stringify({ erro: 'pedido nao encontrado' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Pré-check com resposta clara (409) em vez de deixar cair no "pulado"
  // genérico do módulo de decisão — a garantia real contra corrida
  // concorrente/dupla continua sendo o claim atômico dentro de
  // processarCancelamentoLogistica.
  if (pedido.status_logistica !== 'criada') {
    return new Response(JSON.stringify({ erro: 'pedido sem entrega criada para cancelar', status_logistica_atual: pedido.status_logistica }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log(`[logistica-cancelar] cancelamento solicitado. pedido=${pedidoId} status_logistica_atual=${pedido.status_logistica}`);

  const resultado = await processarCancelamentoLogistica(db, pedido as PedidoParaCancelamentoEntrega, { workspaceId: WORKSPACE_ID });

  // Resultado sanitizado — nunca expõe credenciais, só o desfecho e o
  // motivo (já sanitizado por _shared/logistica-cancelamento.ts).
  return new Response(JSON.stringify(resultado), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
