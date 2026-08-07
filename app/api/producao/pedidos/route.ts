import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Pedidos pagos (produção) + pedidos aguardando pagamento (ainda no fluxo
// comercial, exibidos como "Pedido em Atendimento" — nunca confundidos com
// produção real). status_producao (workflow de cozinha) é uma coluna
// separada de status (estado de pagamento: pago, aguardando_pagamento,
// pagamento_recusado, cancelado, reembolsado), então nunca reaproveita um
// valor de uma pela outra — a classificação fica em lib/status-pedido.ts.
// Pagamento recusado/cancelado/reembolsado nunca entra aqui.
export async function GET() {
  const supabase = await createClient();

  // RLS já bloqueia a leitura de `pedidos` pra quem não está autenticado
  // (auth.role() = 'authenticated'), mas checar a sessão aqui explicitamente
  // (mesmo padrão de retry-logistica/route.ts) devolve 401 claro em vez de
  // uma lista vazia que parece só "nenhum pedido" — nunca confunde
  // "sem sessão" com "sem pedidos em aberto" (GO-LIVE Parte 7/8).
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  // select() pede colunas fora do Database hand-rolado (types/index.ts só
  // modela um subconjunto de pedidos) — mesmo padrão de cast já usado em
  // app/api/monitor-social/route.ts pra tabelas/colunas fora desse tipo.
  const { data, error } = await (supabase as any)
    .from('pedidos')
    .select(`numero_pedido, id, produto, produtos, valor, cliente_nome, cliente_telefone,
      status, status_producao, status_logistica, logistica_resposta, canal, criado_em,
      horario_entrega, data_agendada, nome_destinatario, bairro, endereco_entrega,
      mensagem_cartao, frete_transportadora, mp_ambiente`)
    .in('status', ['pago', 'aguardando_pagamento'])
    // 'internal_test' é o canal usado só pra validar a Flora em ambiente
    // controlado (ver supabase/functions/flora-internal-test) — nunca deve
    // aparecer misturado com pedidos reais no Painel de Produção.
    .neq('canal', 'internal_test')
    .order('numero_pedido', { ascending: true })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // catalogo_produtos é o catálogo real já sincronizado com o WooCommerce
  // (fonte da foto principal do produto) — reaproveitado aqui também como
  // segundo critério de pedido de teste: um pedido cujo produto não existe
  // (ou não está ativo) no catálogo real referencia um item que nunca
  // poderia ter sido vendido pelo fluxo normal (a Flora só deixa comprar
  // produto validado no catálogo/WooCommerce), então só chega a esse estado
  // via um teste que pulou essa validação. Pedido sem código de produto
  // conhecido nunca é excluído por essa regra — dúvida sempre mantém visível.
  const codigos = [...new Set(
    (data ?? [])
      .map((p: any) => (p.produtos as Array<{ codigo?: string }> | null)?.[0]?.codigo)
      .filter((c: string | undefined): c is string => !!c)
  )];

  const fotoPorCodigo: Record<string, string> = {};
  const catalogoAtivo = new Set<string>();
  if (codigos.length > 0) {
    const { data: catalogo } = await (supabase as any)
      .from('catalogo_produtos')
      .select('codigo, foto_url, ativo')
      .in('codigo', codigos);
    for (const c of catalogo ?? []) {
      if (c.foto_url) fotoPorCodigo[c.codigo] = c.foto_url;
      if (c.ativo) catalogoAtivo.add(c.codigo);
    }
  }

  const pedidos = (data ?? [])
    .filter((p: any) => {
      const codigo = (p.produtos as Array<{ codigo?: string }> | null)?.[0]?.codigo;
      return !codigo || catalogoAtivo.has(codigo);
    })
    .map((p: any) => {
      const item = (p.produtos as Array<{ codigo?: string; fotoUrl?: string }> | null)?.[0];
      const foto_url = item?.fotoUrl || (item?.codigo ? fotoPorCodigo[item.codigo] ?? null : null);
      return { ...p, foto_url };
    });

  return NextResponse.json({ pedidos });
}
