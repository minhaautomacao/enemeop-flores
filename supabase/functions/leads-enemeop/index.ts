import { getSupabaseAdmin } from '../_shared/supabase.ts';
import { factorySecretValido } from '../_shared/auth-crm.ts';

// Retorna leads de Instagram, Facebook e WhatsApp da Enemeop Flores para o dashboard
// Protegido por Authorization: Bearer <FACTORY_SECRET>
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  if (!(await factorySecretValido(req))) {
    return new Response(JSON.stringify({ erro: 'não autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? '50');
  const intencao = url.searchParams.get('intencao') ?? null;

  const sb = getSupabaseAdmin();

  let query = sb
    .from('leads')
    .select('id, nome, canal, canal_id, intencao, status, notas, mensagem_inicial, criado_em, atualizado_em')
    .in('canal', ['instagram', 'facebook', 'whatsapp'])
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

  // O webhook do Meta não recebe nome do remetente em eventos de mensagem
  // (só em comentários), então muitos leads ficam com `nome` nulo mesmo já
  // tendo conversado com a Flora. A conversa em si já captura o nome real
  // do cliente (`conversas.nome_cliente`, preenchido via buscarNomeCliente).
  // `conversas.lead_id` não é preenchido no fluxo real — o vínculo confiável
  // entre lead e conversa é (canal, canal_id), o mesmo par usado em toda a
  // aplicação para identificar o remetente (ver funil.ts / webhook-meta.ts).
  const canalIds = [...new Set((data ?? []).map((l) => l.canal_id).filter(Boolean))];
  const nomeClienteMap: Record<string, string> = {};

  if (canalIds.length > 0) {
    const { data: conversas } = await sb
      .from('conversas')
      .select('canal, canal_id, nome_cliente, atualizado_em')
      .in('canal_id', canalIds)
      .not('nome_cliente', 'is', null)
      .order('atualizado_em', { ascending: false });

    for (const c of conversas ?? []) {
      const chave = `${c.canal}:${c.canal_id}`;
      if (!nomeClienteMap[chave]) nomeClienteMap[chave] = c.nome_cliente as string;
    }
  }

  const leads = (data ?? []).map((l) => ({
    ...l,
    nome_exibido: l.nome ?? nomeClienteMap[`${l.canal}:${l.canal_id}`] ?? null,
  }));

  return new Response(JSON.stringify({ leads, total: leads.length }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
});
