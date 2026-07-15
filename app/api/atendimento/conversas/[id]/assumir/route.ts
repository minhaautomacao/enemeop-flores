import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'N?o autenticado' }, { status: 401 });
  const { data, error } = await (supabase as any).from('conversas')
    .update({ modo_atendimento: 'humano', status_atendimento: 'humano_atendendo', atendente_id: user.id, assumido_em: new Date().toISOString(), atualizado_em: new Date().toISOString() } as any)
    .eq('id', params.id).in('canal', ['instagram', 'facebook']).or(`atendente_id.is.null,atendente_id.eq.${user.id}`).neq('status_atendimento', 'concluida')
    .select('id, atendente_id').single();
  if (error || !data) return NextResponse.json({ error: 'Conversa j? assumida por outro atendente ou indispon?vel' }, { status: 409 });
  return NextResponse.json({ conversa: data });
}
