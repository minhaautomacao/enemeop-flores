import { getSupabaseAdmin } from '../_shared/supabase.ts';

// Retorna leads do Instagram da Enemeop Flores para o dashboard
// Sem auth — URL é o segredo (internal API)
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? '50');
  const intencao = url.searchParams.get('intencao') ?? null;

  const sb = getSupabaseAdmin();

  let query = sb
    .from('leads')
    .select('id, nome, canal, canal_id, intencao, status, notas, mensagem_inicial, criado_em, atualizado_em')
    .eq('canal', 'instagram')
    .order('criado_em', { ascending: false })
    .limit(limit);

  if (intencao) query = query.eq('intencao', intencao);

  const { data, error } = await query;

  if (error) {
    return new Response(JSON.stringify({ erro: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ leads: data, total: data?.length ?? 0 }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
});
