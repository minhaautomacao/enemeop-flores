import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Proxy autenticado para a edge function zapi-status — mantém FACTORY_SECRET
 * só no servidor (mesmo padrão de app/api/atendimento/conversas/[id]/mensagens/route.ts).
 * action="qrcode" pode desconectar uma sessão Z-API já vinculada — o painel
 * (não esta rota) é responsável por exigir confirmação explícita do usuário
 * antes de chamar com esse action.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = body.action === 'qrcode' ? 'qrcode' : 'status';

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.FACTORY_SECRET ?? '';
  if (!supabaseUrl || !secret) {
    return NextResponse.json({ error: 'FACTORY_SECRET não configurado no servidor' }, { status: 500 });
  }

  const edge = await fetch(`${supabaseUrl}/functions/v1/zapi-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ action }),
  });
  const json = await edge.json().catch(() => ({}));
  if (!edge.ok) return NextResponse.json({ error: json.erro ?? 'Falha ao consultar Z-API' }, { status: edge.status });
  return NextResponse.json(json);
}
