/**
 * pedido-repositorio.ts — criação/reuso idempotente de pedido provisório e
 * de preference de pagamento (Mercado Pago), compartilhado entre
 * webhook-meta e webhook-whatsapp (GO-LIVE Parte 1: "Meta, Instagram,
 * Facebook e WhatsApp devem usar a mesma implementação compartilhada").
 *
 * Duas garantias contra corrida (útil quando duas mensagens de aprovação
 * concorrentes chegam quase juntas — ex.: reentrega de webhook — antes da
 * primeira chamada terminar de salvar o novo estado da conversa):
 *
 *   1. pedidos.jornada_key tem índice único parcial — criarOuReusarPedido
 *      tenta INSERT; se colidir (23505), busca e devolve o pedido já criado
 *      por quem chegou primeiro. Nunca cria um segundo pedido pra mesma
 *      jornada.
 *
 *   2. gerarOuReusarPreference reivindica a criação com um UPDATE atômico
 *      (mp_preference_status null -> 'criando'); só quem ganha o claim chama
 *      o Mercado Pago. Se a chamada ao Mercado Pago falhar, o claim é
 *      liberado (nada foi criado externamente, seguro tentar de novo depois).
 *      Se a criação externa tiver sucesso mas a persistência do
 *      id/link falhar, o pedido fica travado em 'criando' — estado ambíguo
 *      permanente — e a função NUNCA tenta de novo sozinha nem devolve o
 *      link como sucesso; só reconciliação manual protegida resolve (ver
 *      função pagamento-reconciliar, que consulta o Mercado Pago pelo
 *      external_reference e persiste o que encontrar, sem nunca criar uma
 *      segunda preference).
 */

// deno-lint-ignore no-explicit-any
type DbClient = any;

// import type (nunca um import de valor) — mercadopago.ts importa
// credentials.ts -> supabase.ts -> "npm:@supabase/supabase-js", que só
// resolve em runtime Deno. Manter só o tipo aqui permite testar a lógica
// pura deste módulo com node:test/tsx (mesmo padrão de mercadopago.test.ts,
// que também nunca importa mercadopago.ts inteiro por esse motivo) —
// quem chama em produção (webhook-meta/webhook-whatsapp) injeta a função
// real via parâmetro.
import type { OpcoesPreferencia, ResultadoPreferencia } from './mercadopago.ts';
import { dataCalendarioParaISO, type DadosPedido } from './funil.ts';

export type CriadorPreferencia = (workspaceId: string | undefined, opcoes: OpcoesPreferencia) => Promise<ResultadoPreferencia>;

export interface DadosClientePedido {
  nome: string;
  telefone?: string;
  canal: string;
  canalId?: string;
  /** id (uuid) da linha em `conversas` — base da chave de jornada, estável mesmo se canalId mudar. */
  conversaId: string;
}

/** Chave estável da jornada comercial atual dentro de uma conversa — ver reiniciarJornada em funil.ts. */
export function chaveJornada(conversaId: string, jornadaIniciadaEm: string | undefined): string {
  return `${conversaId}:${jornadaIniciadaEm ?? 'inicial'}`;
}

export async function criarOuReusarPedido(
  db: DbClient,
  dados: DadosPedido,
  cliente: DadosClientePedido,
  workspaceId: string,
  logPrefix: string,
): Promise<{ pedidoId: string } | null> {
  const produto = dados.produto;
  if (!produto || dados.valorTotal == null) {
    console.error(`[${logPrefix}] criarOuReusarPedido chamado sem produto/valorTotal`);
    return null;
  }

  const jornadaKey = chaveJornada(cliente.conversaId, dados.jornadaIniciadaEm);
  const enderecoTexto = dados.endereco
    ? [dados.endereco.rua, dados.endereco.numero, dados.endereco.bairro, dados.endereco.cidade].filter(Boolean).join(', ')
    : null;
  // Gerado aqui (em vez de esperar o default do banco) porque o
  // external_reference enviado ao Mercado Pago precisa existir já na
  // criação do pedido.
  const pedidoId = crypto.randomUUID();

  const { data, error } = await db
    .from('pedidos')
    .insert({
      id: pedidoId,
      jornada_key: jornadaKey,
      cliente_nome: cliente.nome || 'Cliente',
      cliente_telefone: cliente.telefone ?? '',
      canal: cliente.canal,
      canal_id: cliente.canalId ?? null,
      canal_origem: cliente.canal,
      produto: produto.nome,
      produtos: [{ nome: produto.nome, codigo: produto.codigo, woocommerce_product_id: produto.idExterno ?? null, preco: produto.preco, quantidade: produto.quantidade ?? 1 }],
      valor: dados.valorTotal,
      valor_frete: dados.valorFrete ?? null,
      status: 'aguardando_pagamento',
      provedor_pagamento: 'mercadopago',
      external_reference: `enemeop-${pedidoId}`,
      horario_entrega: produto.dataEntrega ?? null,
      data_entrega_solicitada: dados.dataEntregaSolicitada ? dataCalendarioParaISO(dados.dataEntregaSolicitada) : null,
      periodo_entrega: dados.periodoEntrega ?? null,
      // Janela já corrigida/mostrada ao cliente na aprovação do frete (Parte
      // 4 GO-LIVE) — persistida junto do pedido pra webhook-mercadopago
      // nunca precisar recalcular (e por isso nunca alterar silenciosamente
      // a promessa) depois do pagamento.
      entrega_prometida_em: dados.entregaPrometidaEmISO ?? null,
      logistica_executar_em: dados.despachoEmISO ?? null,
      nome_destinatario: dados.endereco?.nomeDestinatario ?? null,
      telefone_destinatario: dados.endereco?.telefoneDestinatario ?? null,
      endereco_entrega: enderecoTexto,
      cep: dados.endereco?.cep ?? null,
      numero: dados.endereco?.numero ?? null,
      complemento: dados.endereco?.complemento ?? null,
      bairro: dados.endereco?.bairro ?? null,
      cidade: dados.endereco?.cidade ?? null,
      uf: dados.endereco?.uf ?? null,
      nome_comprador: dados.nomeComprador ?? null,
      mensagem_cartao: produto.mensagemCartao ?? null,
      workspace_id: workspaceId,
      lalamove_quotation_id: dados.freteDetalhes?.quotationId ?? null,
      frete_transportadora: dados.freteDetalhes?.transportadora ?? null,
      frete_servico: dados.freteDetalhes?.servico ?? null,
      frete_preco_real: dados.freteDetalhes?.precoReal ?? null,
      frete_markup: dados.freteDetalhes?.markup ?? null,
      frete_moeda: dados.freteDetalhes?.moeda ?? null,
      frete_expires_at: dados.freteDetalhes?.expiresAt ?? null,
      frete_cotado_em: dados.freteDetalhes?.cotadoEm ?? null,
      frete_ambiente: dados.freteDetalhes?.ambiente ?? null,
      frete_mercado: dados.freteDetalhes?.mercado ?? null,
      frete_origem: dados.freteDetalhes?.origem ?? null,
      frete_destino: dados.freteDetalhes?.destino ?? null,
      lalamove_stop_id_origem: dados.freteDetalhes?.stopIdOrigem ?? null,
      lalamove_stop_id_destino: dados.freteDetalhes?.stopIdDestino ?? null,
    })
    .select('id')
    .single();

  if (!error && data) return { pedidoId: data.id as string };

  if (error?.code === '23505') {
    // Colisão no índice único de jornada_key: outra chamada concorrente da
    // mesma jornada já criou o pedido primeiro — reaproveita em vez de
    // devolver erro ou criar um segundo.
    const { data: existente, error: erroSelect } = await db
      .from('pedidos').select('id').eq('jornada_key', jornadaKey).maybeSingle();
    if (existente) {
      console.log(`[${logPrefix}] pedido reaproveitado por jornada_key (corrida evitada) jornada_key=${jornadaKey}`);
      return { pedidoId: existente.id as string };
    }
    console.error(`[${logPrefix}] colisao de jornada_key mas pedido existente nao encontrado: ${erroSelect?.message}`);
    return null;
  }

  console.error(`[${logPrefix}] falha ao criar pedido: ${error?.message}`);
  return null;
}

async function liberarClaimPreference(db: DbClient, pedidoId: string, logPrefix: string): Promise<void> {
  const { error } = await db.from('pedidos')
    .update({ mp_preference_status: null })
    .eq('id', pedidoId)
    .eq('mp_preference_status', 'criando');
  if (error) {
    console.error(`[${logPrefix}] falha ao liberar claim de preference — pedido ${pedidoId} pode ficar preso em 'criando': ${error.message}`);
  }
}

export async function gerarOuReusarPreference(
  db: DbClient,
  pedidoId: string,
  workspaceId: string,
  supabaseUrl: string,
  logPrefix: string,
  // Quem chama em produção passa criarPreferenciaMercadoPago (mercadopago.ts)
  // — obrigatório aqui (sem default) pra este módulo nunca precisar importar
  // mercadopago.ts de verdade, só o tipo (ver comentário no topo do arquivo).
  criarPreferencia: CriadorPreferencia,
): Promise<{ link: string; paymentId: string } | null> {
  const { data: atual, error: erroLeitura } = await db
    .from('pedidos')
    .select('mp_preference_id, link_pagamento, mp_preference_status')
    .eq('id', pedidoId)
    .maybeSingle();
  if (erroLeitura) {
    console.error(`[${logPrefix}] gerarOuReusarPreference: falha ao ler pedido: ${erroLeitura.message}`);
    return null;
  }
  if (atual?.mp_preference_id && atual?.link_pagamento) {
    return { link: atual.link_pagamento as string, paymentId: atual.mp_preference_id as string };
  }

  // Reivindicação atômica: só quem ganhar esse UPDATE (nenhuma outra
  // chamada concorrente, e nenhuma tentativa anterior travada em estado
  // ambíguo) chama o Mercado Pago.
  const { data: claim, error: claimError } = await db
    .from('pedidos')
    .update({ mp_preference_status: 'criando' })
    .eq('id', pedidoId)
    .is('mp_preference_status', null)
    .is('mp_preference_id', null)
    .select('id')
    .maybeSingle();

  if (claimError) {
    console.error(`[${logPrefix}] falha ao reivindicar criacao de preference: ${claimError.message}`);
    return null;
  }

  if (!claim) {
    // Não ganhou o claim: outra chamada pode ter terminado com sucesso
    // entre a leitura acima e agora (relê), ou está ativamente criando a
    // preference agora mesmo ('criando') — nesse caso espera um pouco e
    // relê algumas vezes antes de desistir, pra duas aprovações concorrentes
    // legítimas (não um estado ambíguo travado de verdade) devolverem o
    // MESMO link em vez de uma delas falhar só por chegar um instante depois
    // da outra. Nunca tenta criar uma segunda cobrança sozinha em nenhum caso.
    const MAX_TENTATIVAS = 5;
    for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
      const { data: recheck } = await db
        .from('pedidos').select('mp_preference_id, link_pagamento, mp_preference_status').eq('id', pedidoId).maybeSingle();
      if (recheck?.mp_preference_id && recheck?.link_pagamento) {
        return { link: recheck.link_pagamento as string, paymentId: recheck.mp_preference_id as string };
      }
      if (recheck?.mp_preference_status !== 'criando' || tentativa === MAX_TENTATIVAS - 1) {
        console.error(`[${logPrefix}] preference nao reivindicada (corrida ou estado ambiguo) — pedido=${pedidoId} status=${recheck?.mp_preference_status ?? '(nulo)'}`);
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    return null;
  }

  const { data: pedido, error } = await db
    .from('pedidos').select('produtos, valor_frete, external_reference').eq('id', pedidoId).single();
  if (error || !pedido) {
    await liberarClaimPreference(db, pedidoId, logPrefix);
    return null;
  }

  const produtos = (pedido.produtos as Array<{ nome: string; preco: number; quantidade?: number }> | null) ?? [];
  const itens = produtos
    .filter(p => p.preco > 0)
    .map(p => ({ titulo: p.nome, quantidade: p.quantidade ?? 1, precoUnitarioReais: p.preco }));
  const frete = Number(pedido.valor_frete ?? 0);
  if (frete > 0) itens.push({ titulo: 'Frete', quantidade: 1, precoUnitarioReais: frete });
  if (itens.length === 0) {
    console.error(`[${logPrefix}] gerarOuReusarPreference: pedido sem itens cobraveis, preference nao criada`);
    await liberarClaimPreference(db, pedidoId, logPrefix);
    return null;
  }

  const externalReference = (pedido.external_reference as string | null) ?? `enemeop-${pedidoId}`;
  const resultado = await criarPreferencia(workspaceId, {
    externalReference,
    itens,
    notificationUrl: `${supabaseUrl}/functions/v1/webhook-mercadopago`,
    backUrls: {
      success: 'https://enemeopflores.com.br/pagamento/sucesso',
      failure: 'https://enemeopflores.com.br/pagamento/falha',
      pending: 'https://enemeopflores.com.br/pagamento/pendente',
    },
    metadata: { pedido_id: pedidoId, workspace_id: workspaceId },
  });

  if (!resultado.criado || !resultado.initPoint || !resultado.preferenceId) {
    console.error(`[${logPrefix}] falha ao criar preference Mercado Pago: ${resultado.erro}`);
    // Nada foi criado do lado do Mercado Pago — seguro liberar o claim pra
    // uma tentativa futura poder criar de verdade.
    await liberarClaimPreference(db, pedidoId, logPrefix);
    return null;
  }

  // A partir daqui a preference JÁ EXISTE no Mercado Pago — se a
  // persistência abaixo falhar, o claim NUNCA é liberado (isso permitiria
  // uma segunda chamada criar uma segunda cobrança pro mesmo pedido).
  const { error: persistError } = await db
    .from('pedidos')
    .update({
      mp_preference_id: resultado.preferenceId,
      external_reference: externalReference,
      link_pagamento: resultado.initPoint,
      link_pagamento_id: resultado.preferenceId,
      mp_preference_status: 'criado',
    })
    .eq('id', pedidoId)
    .eq('mp_preference_status', 'criando');

  if (persistError) {
    console.error(`[${logPrefix}] AMBIGUO: preference ${resultado.preferenceId} criada no Mercado Pago mas falhou ao persistir no pedido ${pedidoId}: ${persistError.message} — requer reconciliacao manual (funcao pagamento-reconciliar), nunca sera retentado automaticamente`);
    return null;
  }

  return { link: resultado.initPoint, paymentId: resultado.preferenceId };
}

/** Formas de pagamento realmente habilitadas agora — nunca inventa Pix/cartão sem credencial real configurada. */
export async function buscarFormasPagamentoReal(db: DbClient, workspaceId: string): Promise<string[]> {
  try {
    const { data } = await db
      .from('workspace_credentials')
      .select('chave')
      .eq('workspace_id', workspaceId)
      .eq('tipo', 'financeiro')
      .eq('ativo', true);
    const chaves = new Set((data ?? []).map((r: { chave: string }) => r.chave));
    return chaves.has('mp_access_token')
      ? ['Pix', 'cartão de crédito', 'cartão de débito']
      : [];
  } catch {
    return [];
  }
}
