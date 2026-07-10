/**
 * webhook-mercadopago — Recebe notificações de pagamento do Mercado Pago
 *
 * Origem: recuperado da versão implantada no projeto Supabase da Enemeop
 * (gftnjvdvzgjkhwxnxnwl, slug webhook-mercadopago, v8) em 2026-07-10.
 * Nunca esteve versionado em nenhum repositório Git antes desta migração.
 *
 * SANITIZAÇÃO APLICADA: a versão implantada tinha ZAPI_INSTANCE_ID,
 * ZAPI_TOKEN e ZAPI_CLIENT_TOKEN reais como fallback hardcoded — removidos
 * e substituídos por string vazia. A função passa a depender
 * exclusivamente das env vars (ver .env.example). Não confirmado se esta
 * função ainda está em uso (ver docs/MISSING_SOURCE_FUNCTIONS.md) — o
 * projeto usa Cielo como meio de pagamento documentado, não Mercado Pago.
 *
 * Fluxo:
 *   1. MP envia POST com {type: 'payment', data: {id}}
 *   2. Consulta o pagamento via API
 *   3. Se aprovado: atualiza conversa no Supabase + envia confirmação WhatsApp
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const WORKSPACE_ID = Deno.env.get('SAAS_WORKSPACE_ID') ?? Deno.env.get('WORKSPACE_NAME') ?? '';
const ZAPI_INSTANCE = Deno.env.get('ZAPI_INSTANCE_ID') ?? '';
const ZAPI_TOKEN    = Deno.env.get('ZAPI_TOKEN') ?? '';
const ZAPI_CLIENT   = Deno.env.get('ZAPI_CLIENT_TOKEN') ?? '';

function getDb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function buscarCredencial(workspaceId: string, chave: string): Promise<string> {
  try {
    const { data } = await getDb()
      .from('workspace_credentials')
      .select('valor')
      .eq('workspace_id', workspaceId)
      .eq('tipo', 'financeiro')
      .eq('chave', chave)
      .single();
    return (data?.valor as string) ?? '';
  } catch { return ''; }
}

async function enviarTexto(phone: string, message: string): Promise<void> {
  if (!ZAPI_INSTANCE || !ZAPI_TOKEN || !ZAPI_CLIENT) {
    console.error('[zapi] credenciais nao configuradas — mensagem nao enviada');
    return;
  }
  await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT },
    body: JSON.stringify({ phone, message }),
  }).catch(e => console.error('[zapi] falha:', e));
}

async function verificarPagamento(paymentId: string, accessToken: string): Promise<{
  status: string;
  valor: number;
  metodo: string;
  metadata: Record<string, string>;
} | null> {
  try {
    const resp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      console.error('[webhook-mp] erro ao consultar pagamento:', resp.status);
      return null;
    }
    const data = await resp.json() as {
      status: string;
      transaction_amount: number;
      payment_type_id: string;
      metadata?: Record<string, string>;
    };
    return {
      status: data.status,
      valor: data.transaction_amount,
      metodo: data.payment_type_id,
      metadata: data.metadata ?? {},
    };
  } catch (e) {
    console.error('[webhook-mp] erro:', e);
    return null;
  }
}

const METODO_LABEL: Record<string, string> = {
  credit_card: 'cartão de crédito',
  debit_card:  'cartão de débito',
  pix:         'PIX',
  account_money: 'conta Mercado Pago',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'GET') return new Response('webhook-mercadopago ok', { status: 200 });
  if (req.method !== 'POST') return new Response('ok', { status: 200 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return new Response('ok', { status: 200 }); }

  const tipo = body['type'] as string | undefined;
  const paymentId = (body['data'] as Record<string, string> | undefined)?.['id'];

  // MP também envia eventos de outras categorias — ignorar o que não é pagamento
  if (tipo !== 'payment' || !paymentId) {
    console.log('[webhook-mp] evento ignorado:', tipo);
    return new Response('ok', { status: 200 });
  }

  const accessToken = await buscarCredencial(WORKSPACE_ID, 'mp_access_token')
    || Deno.env.get('MERCADOPAGO_ACCESS_TOKEN') || '';

  if (!accessToken) {
    console.error('[webhook-mp] access token não configurado');
    return new Response('ok', { status: 200 });
  }

  const pagamento = await verificarPagamento(paymentId, accessToken);
  if (!pagamento) return new Response('ok', { status: 200 });

  console.log(`[webhook-mp] payment ${paymentId} status=${pagamento.status} valor=R$${pagamento.valor}`);

  if (pagamento.status !== 'approved') {
    // Pagamento pendente ou rejeitado — nada a fazer por ora
    return new Response('ok', { status: 200 });
  }

  // Recupera o telefone do cliente via metadata da preference
  const phone = pagamento.metadata['phone'] ?? pagamento.metadata['canal_id'] ?? '';
  const workspaceId = pagamento.metadata['workspace_id'] ?? WORKSPACE_ID;
  const metodoLabel = METODO_LABEL[pagamento.metodo] ?? pagamento.metodo;
  const valorFormatado = `R$ ${pagamento.valor.toFixed(2).replace('.', ',')}` ;

  if (!phone) {
    console.error('[webhook-mp] phone não encontrado nos metadados do pagamento', pagamento.metadata);
    return new Response('ok', { status: 200 });
  }

  // Atualiza a conversa no banco
  const db = getDb();
  const { data: conversa } = await db
    .from('conversas')
    .select('id, pedido_info, fase')
    .eq('canal_id', phone)
    .eq('canal', 'whatsapp')
    .single();

  if (conversa) {
    const pedidoAtualizado = {
      ...(conversa.pedido_info as Record<string, unknown> ?? {}),
      pagamento: {
        status: 'aprovado',
        valor: pagamento.valor,
        metodo: pagamento.metodo,
        payment_id: paymentId,
        aprovado_em: new Date().toISOString(),
      },
    };
    await db.from('conversas').update({
      pedido_info: pedidoAtualizado,
      fase: 'concluido',
      atualizado_em: new Date().toISOString(),
    }).eq('id', conversa.id);
  }

  // Envia confirmação pelo WhatsApp
  const mensagem = `Recebemos o seu pagamento de ${valorFormatado} via ${metodoLabel}. Seu pedido esta confirmado e vamos preparar tudo com muito carinho. Em breve entraremos em contato com as informacoes de rastreio.`;
  await enviarTexto(phone, mensagem);

  console.log(`[webhook-mp] pagamento confirmado para ${phone} | ${valorFormatado} via ${metodoLabel}`);

  return new Response('ok', { status: 200 });
});
