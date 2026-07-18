/**
 * pedido.ts — Criação real do pedido (dois estágios, ver seção 11 do pedido
 * de integração):
 *
 *   1. Pedido provisório — criado ANTES do pagamento, status 'pendente'.
 *      É o que dá o pedidoId necessário para gerar o link de pagamento
 *      (funil.ts nunca gera link sem pedidoId real).
 *   2. Confirmação — feita exclusivamente pelo webhook do provedor de
 *      pagamento (ver supabase/functions/webhook-cielo), nunca por texto
 *      do cliente. Não é responsabilidade deste módulo: o orchestrator
 *      (Node) não recebe o webhook do Cielo diretamente.
 *
 * status usa os valores já aceitos pela constraint real da tabela
 * `pedidos` (ver supabase/migrations/202607100002_sync_pedidos_schema.sql)
 * — 'pendente' para provisório, 'confirmado' para pago.
 */

import { getSupabase } from './supabase.js'
import type { DadosPedido } from './funil.js'

const WORKSPACE_ID = process.env.SAAS_WORKSPACE_ID ?? 'enemeop-flores'

export interface DadosClientePedido {
  nome: string
  telefone?: string
  canal: 'whatsapp' | 'instagram'
  canalId?: string
}

/** Cria o pedido provisório (status 'pendente') a partir dos dados já
 * validados pelo funil (produto real do catálogo, frete calculado, valor
 * total definido). Nunca deve ser chamado sem produto/valorTotal — isso é
 * uma falha de uso do chamador, não um caso a tratar silenciosamente. */
export async function criarPedidoProvisorio(
  dados: DadosPedido,
  cliente: DadosClientePedido,
): Promise<{ pedidoId: string } | null> {
  const produto = dados.produto
  if (!produto || dados.valorTotal == null) {
    console.error('[Pedido] criarPedidoProvisorio chamado sem produto/valorTotal definidos — não deveria acontecer nesta fase do funil')
    return null
  }

  const enderecoTexto = dados.endereco
    ? [dados.endereco.rua, dados.endereco.numero, dados.endereco.bairro, dados.endereco.cidade]
        .filter(Boolean).join(', ')
    : null

  try {
    const { data, error } = await getSupabase()
      .from('pedidos')
      .insert({
        cliente_nome:      cliente.nome || 'Cliente',
        cliente_telefone:  cliente.telefone ?? '',
        canal:             cliente.canal,
        canal_id:          cliente.canalId ?? null,
        canal_origem:      cliente.canal,
        produto:           produto.nome,
        produtos:          [{
          nome: produto.nome, codigo: produto.codigo, woocommerce_product_id: produto.idExterno ?? null, preco: produto.preco,
          quantidade: produto.quantidade ?? 1, url: produto.url, origem: produto.origem,
        }],
        valor:             dados.valorTotal,
        status:            'pendente',
        horario_entrega:   produto.dataEntrega ?? null,
        nome_destinatario: dados.endereco?.nomeDestinatario ?? null,
        endereco_entrega:  enderecoTexto,
        bairro:            dados.endereco?.bairro ?? null,
        workspace_id:      WORKSPACE_ID,
      })
      .select('id')
      .single()

    if (error || !data) {
      console.error('[Pedido] Falha ao criar pedido provisório:', error?.message)
      return null
    }
    return { pedidoId: data.id as string }
  } catch (err) {
    console.error('[Pedido] Exceção ao criar pedido provisório:', err)
    return null
  }
}

/** Registra o link de pagamento gerado no pedido já criado — link_pagamento_id
 * é a chave que o webhook do provedor usa depois para casar a confirmação
 * (ver supabase/functions/webhook-cielo, que busca por link_pagamento_id). */
export async function registrarLinkPagamento(pedidoId: string, link: string, linkId: string): Promise<void> {
  try {
    const { error } = await getSupabase()
      .from('pedidos')
      .update({ link_pagamento: link, link_pagamento_id: linkId })
      .eq('id', pedidoId)
    if (error) console.error('[Pedido] Falha ao registrar link de pagamento:', error.message)
  } catch (err) {
    console.error('[Pedido] Exceção ao registrar link de pagamento:', err)
  }
}
