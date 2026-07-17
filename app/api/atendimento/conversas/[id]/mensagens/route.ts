import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const mensagem = String(body.mensagem ?? '').trim();
  const idempotencyKey = String(body.idempotency_key ?? crypto.randomUUID());
  if (!mensagem) return NextResponse.json({ error: 'Mensagem vazia' }, { status: 400 });
  const { data: conversa, error } = await (supabase as any).from('conversas')
    .select('id, canal, modo_atendimento, status_atendimento, atendente_id')
    .eq('id', params.id).single();
  if (error || !conversa) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 });
  if ((conversa as any).status_atendimento === 'concluida') return NextResponse.json({ error: 'Conversa concluída' }, { status: 409 });
  if ((conversa as any).modo_atendimento !== 'humano' || (conversa as any).atendente_id !== user.id) return NextResponse.json({ error: 'Assuma a conversa antes de responder' }, { status: 403 });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.FACTORY_SECRET ?? '';
  if (!supabaseUrl || !secret) return NextResponse.json({ error: 'FACTORY_SECRET não configurado no servidor' }, { status: 500 });
  const edge = await fetch(`${supabaseUrl}/functions/v1/webhook-meta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, 'x-flora-inbox-action': 'send-human-message' },
    body: JSON.stringify({ conversa_id: params.id, mensagem, autor_id: user.id, idempotency_key: idempotencyKey }),
  });
  const json = await edge.json().catch(() => ({}));
  if (!edge.ok) return NextResponse.json({ error: json.error ?? 'Falha ao enviar pelo canal Meta' }, { status: edge.status });
  return NextResponse.json(json);
}
