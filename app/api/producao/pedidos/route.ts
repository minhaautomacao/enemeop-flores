import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Só pedidos pagos entram na produção — status_producao (workflow de
// cozinha) é uma coluna separada de status (estado de pagamento: pago,
// aguardando_pagamento, pagamento_recusado, cancelado, reembolsado), então
// nunca reaproveita um valor de uma pela outra.
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('pedidos')
    .select(`numero_pedido, id, produto, produtos, valor, cliente_nome, cliente_telefone,
      status, status_producao, status_logistica, logistica_resposta, canal, criado_em,
      horario_entrega, data_agendada, nome_destinatario, bairro, endereco_entrega,
      mensagem_cartao, frete_transportadora`)
    .eq('status', 'pago')
    .order('numero_pedido', { ascending: true })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pedidos: data ?? [] });
}
