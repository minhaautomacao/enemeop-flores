import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Proxy pro conversas-enemeop (protegido por FACTORY_SECRET) — nunca expõe
// o segredo ao navegador. Também usado pelo "Ver conversa" da tela de leads
// (antes chamava a Edge Function direto do cliente, sem header de
// autorização — sempre retornava 401 e ficava sempre vazio).
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const factorySecret = process.env.FACTORY_SECRET;
  if (!factorySecret) return NextResponse.json({ error: 'FACTORY_SECRET não configurado no servidor' }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const canalId = searchParams.get('canal_id');
  const limit = searchParams.get('limit') ?? '100';

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const qs = new URLSearchParams({ limit });
  if (canalId) qs.set('canal_id', canalId);

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/conversas-enemeop?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${factorySecret}` },
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ error: `Falha ao carregar conversas (HTTP ${res.status})` }, { status: 502 });
    const json = await res.json();
    return NextResponse.json({ conversas: json.conversas ?? [] });
  } catch {
    return NextResponse.json({ error: 'Falha de rede ao carregar conversas' }, { status: 502 });
  }
}
