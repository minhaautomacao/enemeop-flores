/**
 * webhook-mercadopago — notificações de pagamento (Checkout Pro).
 *
 * Nunca confia em status/valor vindos do corpo/query da notificação: sempre
 * busca o pagamento real via GET /v1/payments/{id} (ver _shared/mercadopago.ts)
 * antes de confirmar qualquer coisa. Localiza o pedido por external_reference
 * (nunca por telefone/canal — funciona pros três canais: whatsapp, instagram,
 * facebook). Idempotente via mercadopago_eventos(payment_id, status): a
 * mesma notificação repetida pra um status já processado é ignorada (a
 * inserção na tabela é a própria trava de concorrência — dois deliveries
 * simultâneos da mesma notificação nunca processam side effects duas vezes).
 *
 * Se o valor aprovado não bater com o valor do pedido, o pagamento NUNCA é
 * confirmado automaticamente — escala pra atendimento humano.
 *
 * Variáveis de ambiente:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injetados)
 *   SAAS_WORKSPACE_ID
 *   META_IG_ACCESS_TOKEN, META_PAGE_ACCESS_TOKEN, META_INSTAGRAM_ID — só
 *     usadas pra confirmar pagamento de pedidos vindos de Instagram/Facebook.
 *     enviarTextoInstagramOuFacebook abaixo é réplica mínima e deliberada
 *     das mesmas funções em webhook-meta/index.ts — mesmo padrão de
 *     duplicação documentado em orchestrator/src/lib/cielo.ts. Cada Edge
 *     Function é publicada isoladamente, então não há import direto entre
 *     webhook-meta e webhook-mercadopago.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { buscarPagamentoReal, validarAssinaturaWebhook } from '../_shared/mercadopago.ts';
import { enviarWhatsApp } from '../_shared/whatsapp.ts';
import { mapearStatusPagamento, valoresDivergem } from './logica.ts';

const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const WORKSPACE_ID = Deno.env.get('SAAS_WORKSPACE_ID') ?? '';
const IG_TOKEN      = Deno.env.get('META_IG_ACCESS_TOKEN') ?? '';
const PAGE_TOKEN    = Deno.env.get('META_PAGE_ACCESS_TOKEN') ?? '';

function getDb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function buscarConfigDB(chave: string): Promise<string> {
  try {
    const { data } = await getDb().from('funcao_configs').select('valor').eq('chave', chave).single();
    return (data?.valor as string) ?? '';
  } catch { return ''; }
}

async function enviarTextoInstagramOuFacebook(canal: string, canalId: string, texto: string): Promise<boolean> {
  const pageToken = PAGE_TOKEN || await buscarConfigDB('META_PAGE_ACCESS_TOKEN');
  const igId = Deno.env.get('META_INSTAGRAM_ID') || await buscarConfigDB('META_INSTAGRAM_ID');
  const isInstagram = canal === 'instagram' && !!igId && !!IG_TOKEN;
  const endpoint = isInstagram
    ? `https://graph.instagram.com/v21.0/${igId}/messages`
    : `https://graph.facebook.com/v21.0/me/messages`;
  const token = isInstagram ? IG_TOKEN : (pageToken || IG_TOKEN);

  try {
    const res = await fetch(`${endpoint}?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: canalId },
        message: { text: texto },
        messaging_type: 'RESPONSE',
      }),
    });
    if (!res.ok) {
      const erroBody = await res.text().catch(() => '');
      console.error(`[webhook-mp] erro DM status=${res.status} canal=${canal} corpo=${erroBody}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[webhook-mp] falha DM: ${e}`);
    return false;
  }
}

interface PedidoRow {
  id: string;
  canal: string;
  canal_id: string | null;
  cliente_telefone: string | null;
  valor: number;
  status: string;
  external_reference: string | null;
}

async function notificarCliente(pedido: PedidoRow, texto: string): Promise<void> {
  if (pedido.canal === 'whatsapp') {
    const numero = pedido.cliente_telefone || pedido.canal_id;
    const resultado = await enviarWhatsApp(WORKSPACE_ID, numero, texto);
    if (!resultado.enviado) console.error('[webhook-mp] falha ao notificar cliente via whatsapp:', resultado.erro);
    return;
  }
  if ((pedido.canal === 'instagram' || pedido.canal === 'facebook') && pedido.canal_id) {
    const ok = await enviarTextoInstagramOuFacebook(pedido.canal, pedido.canal_id, texto);
    if (!ok) console.error('[webhook-mp] falha ao notificar cliente via', pedido.canal);
    return;
  }
  console.error('[webhook-mp] canal desconhecido/sem canal_id, nao foi possivel notificar. pedido=', pedido.id, 'canal=', pedido.canal);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'GET') return new Response('webhook-mercadopago ok', { status: 200 });
  if (req.method !== 'POST') return new Response('ok', { status: 200 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* alguns formatos do MP vêm só via query string */ }

  const url = new URL(req.url);
  const dataObj = body['data'] as Record<string, unknown> | undefined;
  const tipo = (body['type'] as string | undefined) ?? (body['topic'] as string | undefined)
    ?? url.searchParams.get('type') ?? url.searchParams.get('topic') ?? '';
  const paymentId = (dataObj?.['id'] as string | undefined)
    ?? url.searchParams.get('data.id') ?? url.searchParams.get('id') ?? '';

  // MP também envia eventos de outras categorias (merchant_order etc.) —
  // ignora o que não é notificação de pagamento.
  if (tipo !== 'payment' || !paymentId) {
    console.log('[webhook-mp] evento ignorado, tipo=', tipo);
    return new Response('ok', { status: 200 });
  }

  const xSignature = req.headers.get('x-signature');
  const xRequestId = req.headers.get('x-request-id');
  const validacao = await validarAssinaturaWebhook(WORKSPACE_ID, xSignature, xRequestId, paymentId);
  if (validacao === 'invalida') {
    console.error('[webhook-mp] assinatura invalida, notificacao ignorada. paymentId=', paymentId);
    return new Response('ok', { status: 200 });
  }
  if (validacao === 'sem_segredo_configurado') {
    console.log('[webhook-mp] mp_webhook_secret nao configurado — seguindo so com a confirmacao via API real. paymentId=', paymentId);
  }

  // Nunca confia no status/valor do corpo da notificação — busca o
  // pagamento real na API do Mercado Pago antes de decidir qualquer coisa.
  const pagamento = await buscarPagamentoReal(WORKSPACE_ID, paymentId);
  if (!pagamento) {
    console.error('[webhook-mp] nao foi possivel confirmar o pagamento na API do Mercado Pago:', paymentId);
    return new Response('ok', { status: 200 });
  }

  const statusMapeado = mapearStatusPagamento(pagamento.status);
  if (!statusMapeado) {
    console.log('[webhook-mp] status sem mapeamento conhecido, ignorado:', pagamento.status);
    return new Response('ok', { status: 200 });
  }
  if (!pagamento.externalReference) {
    console.error('[webhook-mp] pagamento sem external_reference, impossivel localizar o pedido. paymentId=', paymentId);
    return new Response('ok', { status: 200 });
  }

  const db = getDb();

  // Idempotência: o pedido é sempre criado antes da preference (ver
  // webhook-meta/index.ts, criarPedidoProvisorio -> gerarPagamentoReal), ou
  // seja, external_reference já existe em `pedidos` bem antes de qualquer
  // webhook poder chegar aqui. A inserção abaixo é a trava de concorrência:
  // se essa exata combinação (payment_id, status) já foi registrada — retry
  // do MP reenviando a mesma notificação —, a violação de unicidade (23505)
  // interrompe o processamento antes de qualquer side effect duplicado.
  const { error: eventoError } = await db.from('mercadopago_eventos').insert({
    payment_id: paymentId,
    status: pagamento.status,
    external_reference: pagamento.externalReference,
    valor: pagamento.valor,
  });
  if (eventoError) {
    if (eventoError.code === '23505') {
      console.log('[webhook-mp] notificacao duplicada, ja processada:', paymentId, pagamento.status);
    } else {
      console.error('[webhook-mp] falha ao registrar evento:', eventoError.message);
    }
    return new Response('ok', { status: 200 });
  }

  const { data: pedido, error: pedidoError } = await db
    .from('pedidos')
    .select('id, canal, canal_id, cliente_telefone, valor, status, external_reference')
    .eq('external_reference', pagamento.externalReference)
    .maybeSingle();

  if (pedidoError || !pedido) {
    // Nunca cria um pedido a partir de uma notificação — o pedido tem que
    // já existir. O evento já foi registrado acima (audit trail); se isso
    // acontecer é uma anomalia real de dados, não um caso esperado.
    console.error('[webhook-mp] pedido nao encontrado para external_reference:', pagamento.externalReference);
    return new Response('ok', { status: 200 });
  }

  if (pagamento.status === 'approved') {
    const valorPedido = Number(pedido.valor ?? 0);
    if (valoresDivergem(valorPedido, pagamento.valor)) {
      console.error(`[webhook-mp] valor aprovado (R$ ${pagamento.valor}) diverge do valor do pedido (R$ ${valorPedido}) — pagamento NAO confirmado automaticamente, escalando pra humano. pedido=${pedido.id} payment=${paymentId}`);
      const { error: handoffError } = await db.from('atendimentos_humanos').insert({
        canal: pedido.canal,
        canal_cliente_id: pedido.canal_id ?? pedido.cliente_telefone ?? 'desconhecido',
        telefone: pedido.cliente_telefone,
        origem_handoff: 'pagamento',
        motivo_transferencia: `Pagamento aprovado (${paymentId}) com valor R$ ${pagamento.valor} divergente do pedido R$ ${valorPedido}`,
        dados_pedido: { pedido_id: pedido.id, payment_id: paymentId, valor_aprovado: pagamento.valor, valor_pedido: valorPedido },
      });
      if (handoffError) console.error('[webhook-mp] falha ao criar handoff de divergencia de valor:', handoffError.message);
      return new Response('ok', { status: 200 });
    }

    await db.from('pedidos').update({
      status: 'pago',
      mp_payment_id: paymentId,
      pago_em: new Date().toISOString(),
    }).eq('id', pedido.id);

    await db.from('conversas').update({
      fase: 'concluido',
      atualizado_em: new Date().toISOString(),
    }).eq('canal', pedido.canal).eq('canal_id', pedido.canal_id);

    const valorFormatado = `R$ ${pagamento.valor.toFixed(2).replace('.', ',')}`;
    const texto = `Recebemos o seu pagamento de ${valorFormatado}. Seu pedido está confirmado e vamos preparar tudo com muito carinho. Em breve entraremos em contato com as informações de entrega.`;
    await notificarCliente(pedido as PedidoRow, texto);

    console.log(`[webhook-mp] pagamento aprovado e confirmado. pedido=${pedido.id} payment=${paymentId} valor=${valorFormatado}`);
    return new Response('ok', { status: 200 });
  }

  // pending/in_process/authorized/rejected/cancelled/refunded/charged_back
  // — só atualiza o status do pedido, sem confirmação nem notificação.
  await db.from('pedidos').update({ status: statusMapeado, mp_payment_id: paymentId }).eq('id', pedido.id);
  console.log(`[webhook-mp] pedido ${pedido.id} atualizado para status=${statusMapeado} (mp status=${pagamento.status})`);
  return new Response('ok', { status: 200 });
});
