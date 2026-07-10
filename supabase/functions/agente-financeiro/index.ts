/**
 * agente-financeiro — Gera link de pagamento Cielo e notifica cliente
 *
 * Fluxo:
 *   1. Busca dados do pedido no banco
 *   2. Claude gera mensagem personalizada com o link
 *   3. Gera link de pagamento Cielo (Pix + Crédito + Débito)
 *   4. Envia link ao cliente via WhatsApp ou Instagram
 *   5. Atualiza status do pedido para 'aguardando_pagamento'
 *
 * Payload esperado:
 *   pedido_id   — UUID do pedido (obrigatório)
 *   workspace_id
 */

import { callClaude } from '../_shared/anthropic.ts';
import { getSupabaseAdmin } from '../_shared/supabase.ts';
import { logEvento } from '../_shared/logger.ts';
import { enviarWhatsApp } from '../_shared/whatsapp.ts';
import { enviarDMInstagram } from '../_shared/instagram.ts';
import { gerarLinkPagamento } from '../_shared/cielo.ts';
import type { OrquestradorPayload } from '../_shared/types.ts';

const SYSTEM_PROMPT = `Você é o assistente financeiro da floricultura Enemeop Flores.
Sua função: redigir mensagem acolhedora enviando o link de pagamento ao cliente.
Retorne JSON:
{
  "mensagem": "texto da mensagem com o link já incluído via {{LINK}}",
  "acoes": ["ações executadas"]
}
Use tom gentil, profissional, 1-2 emojis de flores. Máximo 350 caracteres.
O placeholder {{LINK}} será substituído pelo link real antes do envio.
Português brasileiro.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  const inicio = Date.now();
  let body: OrquestradorPayload;
  try { body = await req.json(); } catch { return new Response('JSON inválido', { status: 400 }); }

  const { task_id, escopo, urgencia, payload, workspace_id } = body;
  const sb = getSupabaseAdmin();
  const acoes: string[] = [];

  try {
    const pedidoId = payload.pedido_id as string | undefined;
    if (!pedidoId) throw new Error('pedido_id obrigatório');

    // 1. Busca dados do pedido
    const { data: pedido, error } = await sb
      .from('pedidos')
      .select('id, produto, valor, cliente_nome, cliente_telefone, canal, canal_id, status')
      .eq('id', pedidoId)
      .single();

    if (error || !pedido) throw new Error(`Pedido não encontrado: ${pedidoId}`);

    acoes.push(`Pedido encontrado: ${pedido.produto} — R$ ${Number(pedido.valor).toFixed(2)}`);

    // 2. Gera link de pagamento Cielo
    const link = await gerarLinkPagamento(workspace_id, {
      numeroPedido: pedido.id,
      item: {
        nome: String(pedido.produto),
        valor: Math.round(Number(pedido.valor) * 100),
      },
      parcelasMax: 3,
      expiracaoDias: 1,
      softDescriptor: 'Enemeop Flores',
    });

    if (!link.criado) {
      acoes.push(`Link não gerado: ${link.erro}`);
    } else {
      acoes.push(`Link Cielo gerado: ${link.shortLink}`);
    }

    const linkUrl = link.shortLink ?? link.linkPagamento ?? '';

    // 3. Claude gera mensagem
    const contexto = JSON.stringify({
      cliente: pedido.cliente_nome,
      produto: pedido.produto,
      valor: `R$ ${Number(pedido.valor).toFixed(2)}`,
      link_disponivel: !!linkUrl,
    });

    const resposta = await callClaude(SYSTEM_PROMPT, `Contexto:\n${contexto}`);
    const jsonStr = resposta.replace(/```json\n?|\n?```/g, '').trim();
    const resultado = JSON.parse(jsonStr);
    const mensagemRaw: string = resultado.mensagem ?? '';
    const mensagem = linkUrl
      ? mensagemRaw.replace('{{LINK}}', linkUrl)
      : mensagemRaw.replace('{{LINK}}', '(link indisponível no momento)');

    acoes.push('Mensagem gerada pelo Claude');

    // 4. Envia ao cliente
    const isInstagram = String(pedido.canal ?? '').toLowerCase() === 'instagram';
    const canalId = pedido.canal_id as string | undefined;
    const telefone = pedido.cliente_telefone as string | undefined;

    if (isInstagram && canalId) {
      const envio = await enviarDMInstagram(canalId, mensagem);
      if (envio.enviado) acoes.push(`Instagram DM enviada para ${canalId}`);
      else acoes.push(`Instagram DM falhou: ${envio.erro}`);
    } else if (telefone) {
      const envio = await enviarWhatsApp(workspace_id, telefone, mensagem);
      if (envio.enviado) acoes.push(`WhatsApp enviado para ${telefone} via ${envio.provedor}`);
      else acoes.push(`WhatsApp falhou: ${envio.erro}`);
    } else {
      acoes.push('Nenhum canal disponível para envio');
    }

    // 5. Atualiza status do pedido
    if (link.criado) {
      await sb
        .from('pedidos')
        .update({ status: 'aguardando_pagamento' })
        .eq('id', pedidoId);
      acoes.push('Pedido atualizado: status → aguardando_pagamento');
    }

    await logEvento({
      task_id, escopo, agente: 'agente-financeiro',
      tipo_evento: 'concluido', urgencia,
      duracao_ms: Date.now() - inicio, workspace_id,
    });

    return new Response(
      JSON.stringify({ sucesso: true, mensagem, link_pagamento: linkUrl, acoes_executadas: acoes }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await logEvento({
      task_id, escopo, agente: 'agente-financeiro',
      tipo_evento: 'erro', urgencia,
      duracao_ms: Date.now() - inicio, erro: msg, workspace_id,
    });
    return new Response(JSON.stringify({ sucesso: false, erro: msg }), { status: 500 });
  }
});
