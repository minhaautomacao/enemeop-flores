import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'N?o autenticado' }, { status: 401 });
  const { data, error } = await (supabase as any).from('conversas')
    .update({ modo_atendimento: 'flora', status_atendimento: 'flora_atendendo', atendente_id: null, assumido_em: null, atualizado_em: new Date().toISOString() } as any)
    .eq('id', params.id).eq('atendente_id', user.id).select('id').single();
  if (error || !data) return NextResponse.json({ error: 'Somente o atendente respons?vel pode devolver esta conversa' }, { status: 403 });
  return NextResponse.json({ conversa: data });
}
