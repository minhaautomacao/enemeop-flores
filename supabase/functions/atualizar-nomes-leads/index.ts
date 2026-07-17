// Origem: recuperado da versão implantada no projeto Supabase da Fábrica
// (ebeapnydeiwuewxatuuw, slug atualizar-nomes-leads, v3) em 2026-07-10.
// Nunca esteve versionado em nenhum repositório Git antes desta migração.
// Sanitização aplicada: IG_PAGE_ID hardcoded movido para env var
// META_INSTAGRAM_ID (ver .env.example) — sem alteração de comportamento
// quando a env var está configurada com o mesmo valor.

import { createClient } from 'npm:@supabase/supabase-js@2';

const PAGE_ID = Deno.env.get('META_INSTAGRAM_ID') ?? '';

async function getVaultSecret(sb: ReturnType<typeof createClient>, name: string): Promise<string | null> {
  try {
    const { data } = await sb.rpc('get_vault_secret', { secret_name: name });
    return data as string | null;
  } catch { return null; }
}

async function buscarNomeViaConversas(canalId: string, igToken: string): Promise<string | null> {
  // Tenta via endpoint de conversas (retorna participantes com nome)
  try {
    const url = `https://graph.facebook.com/v19.0/me/conversations?user_id=${canalId}&fields=participants&access_token=${igToken}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const conversations = data.data as Array<{participants: {data: Array<{name: string; id: string}>}}>;
    if (!conversations?.length) return null;
    // Pega o participante que NÃO é a página (id diferente de canal_id da página)
    const participantes = conversations[0]?.participants?.data ?? [];
    const cliente = participantes.find((p) => p.id !== PAGE_ID);
    return cliente?.name ?? null;
  } catch { return null; }
}

Deno.serve(async (_req: Request) => {
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const igToken = Deno.env.get('META_IG_ACCESS_TOKEN') || await getVaultSecret(sb, 'META_IG_ACCESS_TOKEN') || '';
  if (!igToken) return new Response(JSON.stringify({ erro: 'token nao encontrado' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const { data: leads } = await sb
    .from('leads')
    .select('id, canal_id')
    .is('nome', null)
    .not('canal_id', 'is', null);

  if (!leads || leads.length === 0) {
    return new Response(JSON.stringify({ mensagem: 'Nenhum lead sem nome', atualizados: 0 }), { headers: { 'Content-Type': 'application/json' } });
  }

  const porId = new Map<string, string[]>();
  for (const l of leads) {
    if (!l.canal_id) continue;
    if (!porId.has(l.canal_id)) porId.set(l.canal_id, []);
    porId.get(l.canal_id)!.push(l.id);
  }

  let totalAtualizados = 0;
  const detalhes: Array<{ canal_id: string; nome: string | null; leads: number }> = [];

  for (const [canalId, ids] of porId.entries()) {
    const nome = await buscarNomeViaConversas(canalId, igToken);

    if (nome) {
      await sb.from('leads').update({ nome }).in('id', ids);
      // Atualiza também em conversas
      await sb.from('conversas').update({ nome_cliente: nome }).eq('canal_id', canalId);
      totalAtualizados += ids.length;
    }

    detalhes.push({ canal_id: canalId, nome, leads: ids.length });
    await new Promise(r => setTimeout(r, 300));
  }

  return new Response(
    JSON.stringify({ atualizados: totalAtualizados, total_leads: leads.length, detalhes }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
