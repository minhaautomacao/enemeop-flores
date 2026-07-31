import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Proxy pro leads-enemeop (protegido por FACTORY_SECRET) — nunca expõe o
// segredo ao navegador. Permite ao dashboard fazer polling client-side pra
// atualização em tempo real, mantendo o segredo só no servidor.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const factorySecret = process.env.FACTORY_SECRET;
  if (!factorySecret) return NextResponse.json({ error: 'FACTORY_SECRET não configurado no servidor' }, { status: 500 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/leads-enemeop?limit=100`, {
      headers: { Authorization: `Bearer ${factorySecret}` },
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ error: `Falha ao carregar leads (HTTP ${res.status})` }, { status: 502 });
    const json = await res.json();
    return NextResponse.json({ leads: json.leads ?? [] });
  } catch {
    return NextResponse.json({ error: 'Falha de rede ao carregar leads' }, { status: 502 });
  }
}
