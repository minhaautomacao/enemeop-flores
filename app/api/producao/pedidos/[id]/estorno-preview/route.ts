import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Proxy autenticado (sessão do dashboard) para a Edge Function
// pagamento-estornar em modo PREVIEW (sem `confirmar`) — nunca grava nada,
// nunca chama o Mercado Pago. Mesmo padrão de retry-logistica/route.ts.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.FACTORY_SECRET ?? '';
  if (!supabaseUrl || !secret) return NextResponse.json({ error: 'FACTORY_SECRET não configurado no servidor' }, { status: 500 });

  const edge = await fetch(`${supabaseUrl}/functions/v1/pagamento-estornar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ pedido_id: params.id }),
  });
  const json = await edge.json().catch(() => ({}));
  if (!edge.ok) return NextResponse.json({ error: json.erro ?? 'Falha ao consultar estorno' }, { status: edge.status });
  return NextResponse.json(json);
}
