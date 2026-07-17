// Origem: recuperado da versão implantada no projeto Supabase da Fábrica
// (ebeapnydeiwuewxatuuw, slug renovar-token-instagram, v1) em 2026-07-10.
// Nunca esteve versionado em nenhum repositório Git antes desta migração.
// Sem alteração de lógica — só reposicionamento de repositório.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const GRAPH_URL = 'https://graph.facebook.com/v22.0';

async function getConfig(sb: ReturnType<typeof createClient>, chave: string): Promise<string | null> {
  const { data } = await sb.from('funcao_configs').select('valor').eq('chave', chave).single();
  return (data?.valor as string) ?? null;
}

async function setConfig(sb: ReturnType<typeof createClient>, chave: string, valor: string): Promise<void> {
  await sb.from('funcao_configs')
    .upsert({ chave, valor, atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const tokenAtual = await getConfig(sb, 'META_IG_ACCESS_TOKEN');
    if (!tokenAtual) throw new Error('META_IG_ACCESS_TOKEN nao encontrado em funcao_configs');

    // Renova o token Instagram (long-lived token refresh)
    const refreshUrl = `${GRAPH_URL}/refresh_access_token?grant_type=ig_refresh_token&access_token=${tokenAtual}`;
    const resp = await fetch(refreshUrl);
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Meta API ${resp.status}: ${errText}`);
    }

    const data = await resp.json() as { access_token?: string; expires_in?: number; error?: { message: string } };
    if (data.error) throw new Error(`Meta API erro: ${data.error.message}`);
    if (!data.access_token) throw new Error('Meta API nao retornou access_token');

    const novoToken = data.access_token;
    const expiresIn = data.expires_in ?? 5184000; // 60 dias
    const expiraEm = new Date(Date.now() + expiresIn * 1000).toISOString();

    await setConfig(sb, 'META_IG_ACCESS_TOKEN', novoToken);

    console.log(`[renovar-token-instagram] Token renovado com sucesso. Expira em: ${expiraEm}`);

    return new Response(JSON.stringify({
      sucesso: true,
      expira_em: expiraEm,
      expires_in_dias: Math.round(expiresIn / 86400),
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[renovar-token-instagram] Erro: ${msg}`);
    return new Response(JSON.stringify({ sucesso: false, erro: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
