import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  const { data, error } = await (supabase as any).from('conversas')
    .update({ modo_atendimento: 'flora', status_atendimento: 'concluida', atendente_id: null, assumido_em: null, atualizado_em: new Date().toISOString() } as any)
    .eq('id', params.id).eq('atendente_id', user.id).select('id').single();
  if (error || !data) return NextResponse.json({ error: 'Somente o atendente responsável pode concluir esta conversa' }, { status: 403 });

  await (supabase as any).from('atendimentos_humanos')
    .update({ status: 'concluido', concluido_em: new Date().toISOString(), atualizado_em: new Date().toISOString() } as any)
    .eq('conversa_id', params.id).eq('atendente_id', user.id).in('status', ['aguardando_humano', 'em_atendimento']);

  return NextResponse.json({ conversa: data });
}
