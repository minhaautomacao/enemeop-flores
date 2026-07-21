import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Só pedidos pagos entram na produção — status_producao (workflow de
// cozinha) é uma coluna separada de status (estado de pagamento: pago,
// aguardando_pagamento, pagamento_recusado, cancelado, reembolsado), então
// nunca reaproveita um valor de uma pela outra.
export async function GET() {
  const supabase = await createClient();

  // RLS já bloqueia a leitura de `pedidos` pra quem não está autenticado
  // (auth.role() = 'authenticated'), mas checar a sessão aqui explicitamente
  // (mesmo padrão de retry-logistica/route.ts) devolve 401 claro em vez de
  // uma lista vazia que parece só "nenhum pedido" — nunca confunde
  // "sem sessão" com "sem pedidos em aberto" (GO-LIVE Parte 7/8).
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

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
