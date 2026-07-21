/**
 * logistica-retry — reprocessamento administrativo protegido da entrega
 * real de um pedido pago cuja logística ficou em erro (status_logistica
 * 'erro_logistica') ou nunca foi tentada.
 *
 * Nunca processa pedido não pago. Nunca processa pedido com
 * lalamove_order_id já preenchido (entrega já criada). Nunca faz retry
 * automático de um pedido em 'revisao_logistica' (estado ambíguo — precisa
 * de decisão humana fora deste endpoint, ex.: conferir manualmente no
 * painel da Lalamove antes de decidir).
 *
 * Protegido por Authorization: Bearer <FACTORY_SECRET> — mesmo padrão de
 * agente-logistica/leads-enemeop (ver _shared/auth-crm.ts). Publicada com
 * --no-verify-jwt (não roda sob autenticação de usuário Supabase).
 *
 * Variáveis de ambiente:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injetados)
 *   SAAS_WORKSPACE_ID, FACTORY_SECRET, STORE_PHONE
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { factorySecretValido } from '../_shared/auth-crm.ts';
import { processarLogisticaAposPagamento, SELECT_PEDIDO_PARA_LOGISTICA, type PedidoParaEntrega } from '../_shared/logistica-processamento.ts';

const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? '';
const WORKSPACE_ID  = Deno.env.get('SAAS_WORKSPACE_ID') ?? '';
const FACTORY_SECRET = Deno.env.get('FACTORY_SECRET') ?? '';
const STORE_PHONE   = Deno.env.get('STORE_PHONE') ?? '';
const STORE_NOME    = 'Enemeop Flores';

function getDb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

const CONFIG_LOGISTICA = {
  supabaseUrl: SUPABASE_URL,
  factorySecret: FACTORY_SECRET,
  workspaceId: WORKSPACE_ID,
  storePhone: STORE_PHONE,
  storeNome: STORE_NOME,
};

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
    .select(SELECT_PEDIDO_PARA_LOGISTICA)
    .eq('id', pedidoId)
    .maybeSingle();

  if (error || !pedido) {
    return new Response(JSON.stringify({ erro: 'pedido nao encontrado' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Nunca processa pedido sem pagamento confirmado — mesma regra de
  // decidirAcaoLogistica, checada explicitamente aqui também pra devolver
  // uma resposta clara em vez de um "pulado" genérico.
  if (pedido.status !== 'pago') {
    return new Response(JSON.stringify({ erro: 'pedido nao esta pago', status_atual: pedido.status }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log(`[logistica-retry] reprocessamento solicitado. pedido=${pedidoId} status_logistica_atual=${pedido.status_logistica}`);

  const resultado = await processarLogisticaAposPagamento(db, pedido as PedidoParaEntrega, CONFIG_LOGISTICA);

  // Resultado sanitizado — nunca expõe credenciais/URLs internas, só o
  // desfecho e o motivo (já sanitizado por logistica-processamento.ts).
  return new Response(JSON.stringify(resultado), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
