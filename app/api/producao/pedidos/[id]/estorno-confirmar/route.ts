import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Proxy autenticado (sessão do dashboard) para a Edge Function
// pagamento-estornar em modo CONFIRMAR — só chamada depois que a tela já
// mostrou o preview (pedido/pagamento/valor exatos) e o usuário clicou em
// confirmar. `responsavel` é sempre o e-mail da sessão autenticada, nunca
// um valor vindo do corpo da requisição — impossível confirmar um estorno
// sem um responsável real identificado.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.FACTORY_SECRET ?? '';
  if (!supabaseUrl || !secret) return NextResponse.json({ error: 'FACTORY_SECRET não configurado no servidor' }, { status: 500 });

  let motivo = '';
  try {
    const body = await req.json();
    motivo = typeof body?.motivo === 'string' ? body.motivo : '';
  } catch {
    // corpo vazio é aceitável — motivo é opcional
  }

  const edge = await fetch(`${supabaseUrl}/functions/v1/pagamento-estornar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ pedido_id: params.id, motivo, responsavel: user.email ?? user.id, confirmar: true }),
  });
  const json = await edge.json().catch(() => ({}));
  if (!edge.ok) return NextResponse.json({ error: json.erro ?? 'Falha ao confirmar estorno' }, { status: edge.status });
  return NextResponse.json(json);
}
