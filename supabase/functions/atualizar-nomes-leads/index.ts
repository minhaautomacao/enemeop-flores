// Backfill de nomes reais para leads/conversas do Instagram que ficaram
// sem nome. Usa a mesma chamada Graph API do webhook-meta
// (buscarNomeCliente: GET /v19.0/{canalId}?fields=name), com o token
// guardado em funcao_configs (o secret de ambiente META_IG_ACCESS_TOKEN
// estava desatualizado e a Graph API rejeitava com "Cannot parse access
// token" — corrigido também em webhook-meta v89).
//
// LIMITAÇÃO CONHECIDA (não é bug de código): o Meta App ainda não tem
// Advanced Access pra permissão instagram_manage_messages. Enquanto isso,
// a Graph API só retorna o nome de usuários que têm um papel no App (ex.:
// a própria conta de teste do desenvolvedor) — pra clientes reais, retorna
// 403 "App does not have Advanced Access...". Precisa de App Review no
// Meta for Developers pra resolver de verdade pra todo mundo.

import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (_req: Request) => {
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { data: cfg } = await sb.from('funcao_configs').select('valor').eq('chave', 'META_IG_ACCESS_TOKEN').single();
  const token = (cfg?.valor as string) ?? '';
  if (!token) return new Response(JSON.stringify({ erro: 'token nao encontrado em funcao_configs' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  async function buscarNome(canalId: string): Promise<string | null> {
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/${canalId}?fields=name&access_token=${token}`);
      if (!res.ok) return null;
      const data = await res.json();
      return (data.name as string) ?? null;
    } catch { return null; }
  }

  const { data: leads } = await sb.from('leads').select('id, canal_id').is('nome', null).not('canal_id', 'is', null).eq('canal', 'instagram');
  const { data: conversas } = await sb.from('conversas').select('id, canal_id').is('nome_cliente', null).eq('canal', 'instagram');

  const canalIds = new Set<string>();
  for (const l of leads ?? []) if (l.canal_id) canalIds.add(l.canal_id);
  for (const c of conversas ?? []) if (c.canal_id) canalIds.add(c.canal_id);

  let atualizados = 0;
  const detalhes: Array<{ canal_id: string; nome: string | null }> = [];

  for (const canalId of canalIds) {
    const nome = await buscarNome(canalId);
    detalhes.push({ canal_id: canalId, nome });
    if (nome) {
      await sb.from('leads').update({ nome }).eq('canal_id', canalId).is('nome', null);
      await sb.from('conversas').update({ nome_cliente: nome }).eq('canal_id', canalId).is('nome_cliente', null);
      atualizados++;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return new Response(
    JSON.stringify({ canais_tentados: canalIds.size, canais_com_nome_encontrado: atualizados, detalhes }, null, 2),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
