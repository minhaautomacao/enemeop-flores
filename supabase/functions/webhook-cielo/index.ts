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
import { enviarWhatsApp } from '../_shared/whatsapp.ts';
import { enviarDMInstagram } from '../_shared/instagram.ts';

const WORKSPACE_ID = Deno.env.get('SAAS_WORKSPACE_ID') ?? Deno.env.get('WORKSPACE_NAME') ?? '';

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
      // Pagamento confirmado — busca pedido pelo link_pagamento_id e atualiza status.
      // A condição "status !== 'confirmado'" abaixo é o que garante idempotência:
      // o mesmo webhook (reenviado pela Cielo, ou entregue mais de uma vez) nunca
      // reprocessa nem manda uma segunda mensagem de confirmação ao cliente.
      const { data: pedido } = await sb
        .from('pedidos')
        .select('id, cliente_nome, cliente_telefone, canal, canal_id, produto, valor, status')
        .eq('link_pagamento_id', paymentId)
        .maybeSingle();

      if (pedido && pedido.status !== 'confirmado') {
        // Não existe coluna dedicada "pagamento_confirmado_em" no schema real
        // (confirmado via information_schema antes desta mudança) —
        // atualizado_em já registra o momento da confirmação.
        await sb
          .from('pedidos')
          .update({
            status: 'confirmado',
            atualizado_em: new Date().toISOString(),
          })
          .eq('id', pedido.id);

        // Confirmação real ao cliente — só chega aqui depois da confirmação
        // do provedor, nunca por mensagem do cliente (ver funil.ts,
        // confirmarPagamento). Falha de envio não impede o pedido de ficar
        // confirmado — fica registrada no log para acompanhamento manual.
        const valorFormatado = `R$ ${Number(pedido.valor).toFixed(2).replace('.', ',')}`;
        const mensagemCliente = `Pagamento de ${valorFormatado} confirmado! Seu pedido (${pedido.produto}) já está em preparo. Qualquer novidade, avisamos por aqui.`;

        const canal = String(pedido.canal ?? '').toLowerCase();
        const envio = canal === 'instagram' && pedido.canal_id
          ? await enviarDMInstagram(pedido.canal_id as string, mensagemCliente)
          : pedido.cliente_telefone
            ? await enviarWhatsApp(WORKSPACE_ID, pedido.cliente_telefone as string, mensagemCliente)
            : { enviado: false, erro: 'nenhum canal de contato disponível no pedido' };

        await logEvento({
          task_id: `cielo-${paymentId}`,
          escopo: 'financeiro',
          agente: 'webhook-cielo',
          tipo_evento: 'pagamento_confirmado',
          urgencia: 'alta',
          duracao_ms: Date.now() - inicio,
          erro: envio.enviado ? undefined : `Falha ao notificar cliente: ${envio.erro}`,
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
