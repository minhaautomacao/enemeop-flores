/**
 * webhook-mercadopago — notificações de pagamento (Checkout Pro).
 *
 * Nunca confia em status/valor vindos do corpo/query da notificação: sempre
 * busca o pagamento real via GET /v1/payments/{id} (ver _shared/mercadopago.ts)
 * antes de confirmar qualquer coisa. Localiza o pedido por external_reference
 * (nunca por telefone/canal — funciona pros três canais: whatsapp, instagram,
 * facebook).
 *
 * Idempotente via mercadopago_eventos(payment_id, status) + coluna
 * processamento_status ('processando'/'ok'/'erro'): a notificação ao
 * cliente e a criação de handoff de divergência de valor nunca se repetem
 * pra um evento já 'ok'. Mas uma notificação repetida NUNCA é só
 * descartada — se a logística real (Lalamove) ainda não foi criada
 * (status_logistica null/'erro_logistica' no pedido), ela é retomada mesmo
 * assim, sem duplicar a notificação nem cobrar de novo (ver
 * _shared/pagamento-evento-decisao.ts e _shared/logistica-processamento.ts).
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
import { buscarPagamentoReal, validarAssinaturaWebhookQualquerAmbiente } from '../_shared/mercadopago.ts';
import { enviarWhatsApp } from '../_shared/whatsapp.ts';
import { processarLogisticaAposPagamento, SELECT_PEDIDO_PARA_LOGISTICA, type PedidoParaEntrega } from '../_shared/logistica-processamento.ts';
import { processarCancelamentoLogistica, type PedidoParaCancelamentoEntrega } from '../_shared/logistica-cancelamento.ts';
import { resolverPagamentoEAmbiente, type BuscadorPagamento } from '../_shared/resolucao-ambiente.ts';
import { processarEventoPagamento, type PedidoRowNucleo, type DependenciasNucleo } from './nucleo.ts';

const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const WORKSPACE_ID = Deno.env.get('SAAS_WORKSPACE_ID') ?? '';
const IG_TOKEN      = Deno.env.get('META_IG_ACCESS_TOKEN') ?? '';
const PAGE_TOKEN    = Deno.env.get('META_PAGE_ACCESS_TOKEN') ?? '';
const FACTORY_SECRET = Deno.env.get('FACTORY_SECRET') ?? '';
// Telefone oficial da loja, exigido pela Lalamove como contato do
// remetente. Nunca inventado — sem essa secret, a entrega real fica
// bloqueada (status_logistica='erro_logistica'), mas a cotação e o
// pagamento continuam funcionando normalmente (ver Parte A.5).
const STORE_PHONE   = Deno.env.get('STORE_PHONE') ?? '';
const STORE_NOME    = 'Enemeop Flores';
// Quanto o preço operacional pode subir (R$) numa re-cotação pós-expiração
// antes de exigir revisão humana em vez de a loja absorver sozinha (Parte 3
// — ordem financeiramente segura). Default = markup padrão da cotação.
const LIMITE_AUMENTO_OPERACIONAL_REAIS = Number(Deno.env.get('LOGISTICA_LIMITE_AUMENTO_OPERACIONAL_REAIS') ?? '15');
// Minutos de antecedência necessários pra preparar/coletar o pedido antes do
// início da janela de entrega prometida (Parte 2 "agendar pela data
// prometida, não pelo horário do pagamento").
const LEAD_TIME_MINUTOS = Number(Deno.env.get('LOGISTICA_LEAD_TIME_MINUTOS') ?? '30');

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

interface PedidoRow extends PedidoParaEntrega, PedidoRowNucleo {
  canal: string;
  canal_id: string | null;
  cliente_telefone: string | null;
  valor: number;
  external_reference: string | null;
  mp_ambiente: string | null;
  data_entrega_solicitada: string | null; // AAAA-MM-DD, ver funil.ts dataCalendarioParaISO
  periodo_entrega: string | null;
  entrega_prometida_em: string | null;
  link_pagamento: string | null;
}

type Db = ReturnType<typeof getDb>;

const SELECT_PEDIDO_WEBHOOK = `canal, canal_id, cliente_telefone, valor, external_reference, mp_ambiente, data_entrega_solicitada, periodo_entrega, entrega_prometida_em, link_pagamento, ${SELECT_PEDIDO_PARA_LOGISTICA}`;

async function buscarPedidoPorExternalReference(db: Db, externalReference: string): Promise<PedidoRow | null> {
  const { data: pedido, error } = await db
    .from('pedidos')
    .select(SELECT_PEDIDO_WEBHOOK)
    .eq('external_reference', externalReference)
    .maybeSingle();
  if (error || !pedido) return null;
  return pedido as PedidoRow;
}

const CONFIG_LOGISTICA = {
  supabaseUrl: SUPABASE_URL,
  factorySecret: FACTORY_SECRET,
  workspaceId: WORKSPACE_ID,
  storePhone: STORE_PHONE,
  storeNome: STORE_NOME,
  limiteAumentoOperacionalReais: LIMITE_AUMENTO_OPERACIONAL_REAIS,
};

/** Alerta operacional sanitizado (Parte 4) — nunca deixa uma falha crítica pós-pagamento sem rastro pra revisão humana. Reaproveita atendimentos_humanos (mesmo padrão da divergência de valor, origem_handoff='logistica'). */
async function criarAlertaOperacional(db: Db, pedido: PedidoRow, motivoSanitizado: string): Promise<void> {
  const { error } = await db.from('atendimentos_humanos').insert({
    canal: pedido.canal,
    canal_cliente_id: pedido.canal_id ?? pedido.cliente_telefone ?? 'desconhecido',
    telefone: pedido.cliente_telefone,
    origem_handoff: 'logistica',
    motivo_transferencia: motivoSanitizado,
    dados_pedido: { pedido_id: pedido.id },
  });
  if (error) console.error(`[webhook-mp] falha ao criar alerta operacional (nao critico, so perde o registro de auditoria): ${error.message} pedido=${pedido.id}`);
}

async function notificarCliente(pedido: PedidoRow, texto: string): Promise<void> {
  if (pedido.canal === 'whatsapp') {
    const numero = pedido.cliente_telefone || pedido.canal_id;
    const resultado = await enviarWhatsApp(WORKSPACE_ID, numero, texto, 'transacional');
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

const buscadorPagamento: BuscadorPagamento = (ambiente, paymentId) => buscarPagamentoReal(WORKSPACE_ID, paymentId, ambiente);

const DEPENDENCIAS_NUCLEO: DependenciasNucleo = {
  buscarPedidoPorExternalReference,
  notificarCliente,
  processarLogisticaAposPagamento: (db, pedido) => processarLogisticaAposPagamento(db, pedido, CONFIG_LOGISTICA),
  processarCancelamentoLogistica: (db, pedido) => processarCancelamentoLogistica(db, pedido as unknown as PedidoParaCancelamentoEntrega, { workspaceId: WORKSPACE_ID }),
  criarAlertaOperacional: (db, pedido, motivo) => criarAlertaOperacional(db, pedido as PedidoRow, motivo),
  leadTimeMinutos: LEAD_TIME_MINUTOS,
};

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

  // Valida contra os dois segredos possíveis (produção e teste) — o
  // ambiente real só é confirmado depois, ao buscar o pagamento (ver
  // resolverPagamentoEAmbiente abaixo). Mantém a rejeição antecipada de
  // notificações forjadas ANTES de qualquer chamada à API do Mercado Pago.
  const xSignature = req.headers.get('x-signature');
  const xRequestId = req.headers.get('x-request-id');
  const { resultado: validacao } = await validarAssinaturaWebhookQualquerAmbiente(WORKSPACE_ID, xSignature, xRequestId, paymentId);
  if (validacao === 'invalida') {
    console.error('[webhook-mp] assinatura invalida, notificacao ignorada. paymentId=', paymentId);
    return new Response('ok', { status: 200 });
  }
  if (validacao === 'sem_segredo_configurado') {
    console.log('[webhook-mp] nenhum mp_webhook_secret configurado — seguindo so com a confirmacao via API real. paymentId=', paymentId);
  }

  // Nunca confia no status/valor do corpo da notificação — busca o
  // pagamento real na API do Mercado Pago (tenta produção, só tenta teste
  // se produção responder "não encontrado" — ver _shared/resolucao-ambiente.ts,
  // D4 do plano de separação teste/produção) antes de decidir qualquer coisa.
  const resolucao = await resolverPagamentoEAmbiente(paymentId, buscadorPagamento);
  if (!resolucao.resolvido) {
    console.error(`[webhook-mp] nao foi possivel confirmar o pagamento na API do Mercado Pago (motivo=${resolucao.motivo}):`, paymentId);
    return new Response('ok', { status: 200 });
  }

  const db = getDb();

  // Tudo daqui pra baixo (idempotência via mercadopago_eventos + localização
  // do pedido por external_reference + checagem de ambiente + atualização)
  // vive em nucleo.ts, testável com node:test/tsx sem Deno/DB reais. Uma
  // exceção não tratada aqui nunca deve travar a resposta ao Mercado Pago —
  // sempre 200, o evento fica registrado no log pra investigação manual.
  try {
    const resultado = await processarEventoPagamento(db, paymentId, resolucao.pagamento, resolucao.ambiente, DEPENDENCIAS_NUCLEO);
    console.log(`[webhook-mp] resultado=${resultado.status} paymentId=${paymentId} ambiente=${resolucao.ambiente}`);
  } catch (e) {
    console.error('[webhook-mp] excecao nao tratada durante processamento:', e);
  }
  return new Response('ok', { status: 200 });
});
