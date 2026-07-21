/**
 * logistica-agendada-processar — job agendado (Parte 5) que cria a entrega
 * real na Lalamove para pedidos pagos cuja logística foi adiada por ter sido
 * aprovada fora do horário comercial (status_logistica='agendada', ver
 * webhook-mercadopago/index.ts e _shared/logistica-processamento.ts).
 *
 * Nunca processa pedido não pago. Nunca processa antes de
 * logistica_executar_em chegar. Nunca cria corrida duplicada — a
 * idempotência real vem do claim atômico em
 * processarLogisticaAposPagamento (mesmo mecanismo do logistica-retry),
 * este job só decide QUAIS pedidos tentar agora.
 *
 * Chamada por pg_cron via net.http_post (ver migration
 * 202607210004_logistica_agendada_cron.sql) — protegida por
 * "Authorization: Bearer <FACTORY_SECRET>", mesmo padrão de
 * agente-logistica/logistica-retry (ver _shared/auth-crm.ts). Publicada com
 * --no-verify-jwt (não roda sob autenticação de usuário Supabase). Também
 * pode ser chamada manualmente (POST sem corpo) para reprocessar o lote
 * pendente sob demanda.
 *
 * Variáveis de ambiente:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injetados)
 *   SAAS_WORKSPACE_ID, FACTORY_SECRET, STORE_PHONE,
 *   LOGISTICA_LIMITE_AUMENTO_OPERACIONAL_REAIS (opcional)
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
const LIMITE_AUMENTO_OPERACIONAL_REAIS = Number(Deno.env.get('LOGISTICA_LIMITE_AUMENTO_OPERACIONAL_REAIS') ?? '15');

// Nunca processa um lote maior que isso numa única invocação — protege
// contra um acúmulo anômalo de pedidos agendados travando a função além do
// timeout da Edge Function (execução real com rede externa por pedido).
const LOTE_MAXIMO = 25;

function getDb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

const CONFIG_LOGISTICA = {
  supabaseUrl: SUPABASE_URL,
  factorySecret: FACTORY_SECRET,
  workspaceId: WORKSPACE_ID,
  storePhone: STORE_PHONE,
  storeNome: STORE_NOME,
  limiteAumentoOperacionalReais: LIMITE_AUMENTO_OPERACIONAL_REAIS,
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

  const db = getDb();
  const agora = new Date().toISOString();

  // Só pedidos pagos, agendados, cuja hora já chegou — nunca processa
  // pedido não pago (status='pago' explícito na query, não só confiado ao
  // status_logistica) nem antes do horário combinado.
  const { data: pedidos, error } = await db
    .from('pedidos')
    .select(SELECT_PEDIDO_PARA_LOGISTICA)
    .eq('status', 'pago')
    .eq('status_logistica', 'agendada')
    .lte('logistica_executar_em', agora)
    .order('logistica_executar_em', { ascending: true })
    .limit(LOTE_MAXIMO);

  if (error) {
    console.error('[logistica-agendada] falha ao buscar pedidos agendados:', error.message);
    return new Response(JSON.stringify({ erro: 'falha ao buscar pedidos' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const fila = pedidos ?? [];
  console.log(`[logistica-agendada] ${fila.length} pedido(s) agendado(s) com horario ja chegado`);

  const resultados: Array<{ pedido_id: string; status: string; motivo?: string }> = [];
  for (const pedido of fila) {
    // Sequencial (não paralelo) — evita rajada simultânea de POSTs reais à
    // Lalamove e mantém o log de cada tentativa claro e sanitizado.
    const resultado = await processarLogisticaAposPagamento(db, pedido as PedidoParaEntrega, CONFIG_LOGISTICA);
    console.log(`[logistica-agendada] pedido=${pedido.id} resultado=${resultado.status}${'motivo' in resultado ? ` motivo=${resultado.motivo}` : ''}`);
    resultados.push({
      pedido_id: pedido.id,
      status: resultado.status,
      ...('motivo' in resultado ? { motivo: resultado.motivo } : {}),
    });
  }

  return new Response(JSON.stringify({ processados: resultados.length, resultados }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
