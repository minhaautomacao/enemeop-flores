/**
 * webhook-cielo — Recebe notificações de pagamento da Cielo Link de Pagamento
 *
 * A Cielo envia um POST quando o status do pedido muda.
 * Payload (POST): { PaymentId, ChangeType }
 * ChangeType=3 → pagamento confirmado
 *
 * Configurar no backoffice Cielo:
 *   URL de Notificação      → https://ebeapnydeiwuewxatuuw.supabase.co/functions/v1/webhook-cielo
 *   URL de Mudança de Status → https://ebeapnydeiwuewxatuuw.supabase.co/functions/v1/webhook-cielo
 */

import { getSupabaseAdmin } from '../_shared/supabase.ts';
import { logEvento } from '../_shared/logger.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const inicio = Date.now();
  const sb = getSupabaseAdmin();

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return new Response('JSON inválido', { status: 400 }); }

  const paymentId  = body.PaymentId  as string | undefined;
  const changeType = body.ChangeType as number | undefined;

  // ChangeType 3 = pagamento confirmado/capturado
  if (!paymentId) {
    return new Response(JSON.stringify({ ignorado: true, motivo: 'sem PaymentId' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (changeType === 3) {
      // Pagamento confirmado — busca pedido pelo link_pagamento_id e atualiza status
      const { data: pedido } = await sb
        .from('pedidos')
        .select('id, cliente_nome, produto, valor, status')
        .eq('link_pagamento_id', paymentId)
        .maybeSingle();

      if (pedido && pedido.status !== 'confirmado') {
        await sb
          .from('pedidos')
          .update({ status: 'confirmado', atualizado_em: new Date().toISOString() })
          .eq('id', pedido.id);

        await logEvento({
          task_id: `cielo-${paymentId}`,
          escopo: 'financeiro',
          agente: 'webhook-cielo',
          tipo_evento: 'pagamento_confirmado',
          urgencia: 'alta',
          duracao_ms: Date.now() - inicio,
        });
      }
    }

    return new Response(JSON.stringify({ recebido: true, paymentId, changeType }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await logEvento({
      task_id: `cielo-${paymentId}`,
      escopo: 'financeiro',
      agente: 'webhook-cielo',
      tipo_evento: 'erro',
      urgencia: 'alta',
      duracao_ms: Date.now() - inicio,
      erro: msg,
    });
    return new Response(JSON.stringify({ erro: msg }), { status: 500 });
  }
});
