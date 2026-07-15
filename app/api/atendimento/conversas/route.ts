import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  const { data, error } = await supabase
    .from('conversas' as any)
    .select('id, canal_id, canal, fase, historico, pedido_info, nome_cliente, modo_atendimento, status_atendimento, motivo_handoff, handoff_em, resumo, proximo_passo, atendente_id, assumido_em, atualizado_em, workspace_id')
    .in('canal', ['instagram', 'facebook'])
    .order('atualizado_em', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversas: data ?? [] });
}

