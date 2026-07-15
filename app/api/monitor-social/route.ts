import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Msg = { role?: string; content?: string; ts?: string; autor_tipo?: string; status?: string };

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from('conversas')
    .select('id, canal, canal_id, nome_cliente, historico, fase, status_atendimento, modo_atendimento, atendente_id, atualizado_em, criado_em')
    .in('canal', ['instagram', 'facebook'])
    .order('atualizado_em', { ascending: false })
    .limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const conversas = (data ?? []).map((c: any) => {
    const historico = (c.historico ?? []) as Msg[];
    const ultima = historico[historico.length - 1] ?? null;
    return {
      id: c.id,
      canal: c.canal,
      canal_id: c.canal_id,
      nome: c.nome_cliente ?? null,
      nome_disponivel: Boolean(c.nome_cliente),
      mensagem: ultima?.content ?? '',
      tipo_interacao: 'dm',
      data_hora: c.atualizado_em ?? c.criado_em,
      status_atendimento: c.status_atendimento ?? 'flora_atendendo',
      respondido_por: ultima?.role === 'assistant' ? (ultima?.autor_tipo === 'humano' ? 'humano' : 'flora') : 'cliente',
      fase: c.fase,
      mensagens: historico,
    };
  });

  const unicos = new Map<string, any>();
  for (const c of conversas) {
    const key = `${c.canal}:${c.canal_id}`;
    if (!unicos.has(key)) unicos.set(key, c);
  }
  const leads = Array.from(unicos.values()).map((c: any) => ({
    id: `${c.canal}:${c.canal_id}`,
    canal: c.canal,
    canal_id: c.canal_id,
    nome: c.nome,
    nome_disponivel: c.nome_disponivel,
    criado_em: c.data_hora,
    status: c.status_atendimento,
  }));

  return NextResponse.json({ leads, interacoes: conversas });
}
