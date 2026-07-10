/**
 * pagamento.ts — Implementa GeradorPagamento/DependenciasFunil.gerarPagamento
 * de lib/funil.ts usando a integração real (Cielo, ver lib/cielo.ts) e
 * registrando o link no pedido (ver lib/pedido.ts).
 *
 * Só é chamado pelo funil depois que o pedido provisório já existe e o
 * valor total já foi confirmado — nunca gera link antes disso (garantido
 * por funil.ts, não por este módulo).
 */

import { gerarLinkPagamentoCielo } from './cielo.js'
import { registrarLinkPagamento } from './pedido.js'

export async function gerarPagamentoReal(
  pedidoId: string,
  valorTotal: number,
): Promise<{ link: string; paymentId: string } | null> {
  const resultado = await gerarLinkPagamentoCielo({
    numeroPedido: pedidoId,
    item: { nome: 'Pedido Enemeop Flores', valorCentavos: Math.round(valorTotal * 100) },
    parcelasMax: 3,
    expiracaoDias: 1,
  })

  if (!resultado.criado || !resultado.link || !resultado.linkId) {
    console.error(`[Pagamento] Falha ao gerar link Cielo para pedido ${pedidoId}: ${resultado.erro}`)
    return null
  }

  await registrarLinkPagamento(pedidoId, resultado.link, resultado.linkId)
  return { link: resultado.link, paymentId: resultado.linkId }
}
