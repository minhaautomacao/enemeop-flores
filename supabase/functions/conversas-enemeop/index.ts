// Origem: recuperado da versão implantada no projeto Supabase da Fábrica
// (ebeapnydeiwuewxatuuw, slug conversas-enemeop, v5) em 2026-07-10.
// Nunca esteve versionado em nenhum repositório Git antes desta migração.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { factorySecretValido } from '../_shared/auth-crm.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (!(await factorySecretValido(req))) {
    return new Response(JSON.stringify({ error: 'não autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '30'), 50);

  // Busca conversas com colunas corretas da tabela
  const { data: conversas, error } = await sb
    .from('conversas')
    .select('id, canal_id, canal, lead_id, fase, historico, pedido_info, criado_em, atualizado_em, nome_cliente')
    .order('atualizado_em', { ascending: false })
    .limit(limit);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  // Busca intenção dos leads relacionados
  const leadIds = [...new Set((conversas ?? []).map((c: { lead_id: string }) => c.lead_id).filter(Boolean))];
  const intencaoMap: Record<string, string | null> = {};
  const nomeMap: Record<string, string | null> = {};

  if (leadIds.length > 0) {
    const { data: leads } = await sb
      .from('leads')
      .select('id, intencao, nome')
      .in('id', leadIds);
    for (const l of leads ?? []) {
      intencaoMap[l.id] = l.intencao ?? null;
      nomeMap[l.id] = l.nome ?? null;
    }
  }

  // Mapeia para o formato esperado pelo monitor
  const result = (conversas ?? []).map((c: Record<string, unknown>) => {
    const historico = (c.historico as { role: string; content: string; ts?: string }[]) ?? [];
    const ultimaMsg = historico.length > 0 ? historico[historico.length - 1]?.content : null;
    return {
      id: c.id,
      canal: c.canal,
      canal_id: c.canal_id,
      lead_id: c.lead_id,
      fase: c.fase,
      nome: (c.nome_cliente as string) ?? nomeMap[c.lead_id as string] ?? null,
      nome_exibido: (c.nome_cliente as string) ?? nomeMap[c.lead_id as string] ?? null,
      intencao: intencaoMap[c.lead_id as string] ?? null,
      mensagens: historico,
      ultima_mensagem: ultimaMsg,
      criado_em: c.criado_em,
      atualizado_em: c.atualizado_em,
    };
  });

  return new Response(JSON.stringify({ conversas: result }), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
});
