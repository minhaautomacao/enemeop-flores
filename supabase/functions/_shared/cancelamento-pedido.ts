/**
 * cancelamento-pedido.ts — persistência real do cancelamento de um pedido a
 * partir da conversa (Flora, via a dependência `cancelarPedido` injetada em
 * funil.ts) ou do painel administrativo. Único lugar que de fato marca
 * `pedidos.status='cancelado'` fora do caminho passivo do Mercado Pago
 * (webhook-mercadopago/logica.ts, que só reage a um `cancelled` já feito
 * fora do sistema).
 *
 * Nunca estorna de verdade — isso sempre passa por autorização humana
 * explícita (ver estorno-decisao.ts e a Edge Function pagamento-estornar,
 * D2 do plano de cancelamento/estorno). Quando o pedido já estava pago,
 * este módulo só REGISTRA um evento de estorno pendente de autorização e
 * escala pra atendimento humano — nunca chama o Mercado Pago.
 *
 * Tenta cancelar a logística (se já solicitada) de forma best-effort: uma
 * falha aqui nunca desfaz a marcação de cancelado nem impede a resposta ao
 * cliente — vira 'revisao_logistica' dentro do próprio
 * logistica-cancelamento.ts, nunca lançada daqui.
 */

// deno-lint-ignore no-explicit-any
type Db = any;

import { classificarEstagioPedido } from './cancelamento-decisao.ts';
import { processarCancelamentoLogistica, type PedidoParaCancelamentoEntrega } from './logistica-cancelamento.ts';

export interface PedidoParaExecutarCancelamento extends PedidoParaCancelamentoEntrega {
  status: string;
  status_producao: string | null;
  valor: number;
  mp_payment_id: string | null;
  canal: string;
  canal_id: string | null;
  cliente_telefone: string | null;
}

export interface ConfigExecutarCancelamento {
  workspaceId: string;
}

export type CanceladoPor = 'cliente_flora' | 'admin_painel' | 'sistema_mp';

export interface ResultadoExecutarCancelamento {
  cancelado: boolean;
  precisaEstorno: boolean;
}

/** Marca não nulo/vazio de responsável — este é sempre o valor usado quando o registro de estorno é aberto automaticamente pela Flora, nunca por um humano ainda (a autorização real acontece depois, no painel). */
const RESPONSAVEL_ABERTURA_AUTOMATICA = 'flora_automatico_pendente_revisao';

export async function executarCancelamentoPedido(
  db: Db,
  pedido: PedidoParaExecutarCancelamento,
  motivo: string,
  canceladoPor: CanceladoPor,
  config: ConfigExecutarCancelamento,
): Promise<ResultadoExecutarCancelamento> {
  const estagio = classificarEstagioPedido(pedido);

  // Já cancelado/reembolsado antes — nunca reabre, nunca duplica handoff/evento de estorno.
  if (estagio === 'ja_cancelado_ou_estornado') {
    return { cancelado: true, precisaEstorno: false };
  }

  const jaEstavaPago = pedido.status === 'pago';

  const { error: updateError } = await db.from('pedidos').update({
    status: 'cancelado',
    cancelado_em: new Date().toISOString(),
    cancelado_motivo: motivo,
    cancelado_por: canceladoPor,
  }).eq('id', pedido.id);

  if (updateError) {
    console.error(`[cancelamento-pedido] FALHA ao marcar pedido cancelado: ${updateError.message} pedido=${pedido.id}`);
    return { cancelado: false, precisaEstorno: jaEstavaPago };
  }

  if (pedido.status_logistica === 'criada') {
    try {
      await processarCancelamentoLogistica(db, pedido, config);
    } catch (e) {
      console.error(`[cancelamento-pedido] falha ao tentar cancelar logistica (nao critico, pedido ja marcado cancelado): ${e instanceof Error ? e.message : String(e)} pedido=${pedido.id}`);
    }
  }

  if (jaEstavaPago) {
    if (!pedido.mp_payment_id) {
      console.error(`[cancelamento-pedido] pedido pago sem mp_payment_id — nao foi possivel abrir evento de estorno automaticamente, precisa de revisao manual. pedido=${pedido.id}`);
    } else {
      const { error: estornoError } = await db.from('pedidos_estorno_eventos').insert({
        pedido_id: pedido.id,
        mp_payment_id: pedido.mp_payment_id,
        valor: pedido.valor,
        tipo: 'total',
        motivo,
        responsavel: RESPONSAVEL_ABERTURA_AUTOMATICA,
        status: 'pendente_autorizacao',
      });
      // Índice único parcial (pedidos_estorno_eventos_ativo_por_pedido) evita
      // duplicar um evento ativo pro mesmo pedido — um erro 23505 aqui
      // significa que já existe um evento pendente, não uma falha real.
      if (estornoError && estornoError.code !== '23505') {
        console.error(`[cancelamento-pedido] falha ao registrar evento de estorno pendente: ${estornoError.message} pedido=${pedido.id}`);
      }
    }

    const { error: handoffError } = await db.from('atendimentos_humanos').insert({
      canal: pedido.canal,
      canal_cliente_id: pedido.canal_id ?? pedido.cliente_telefone ?? 'desconhecido',
      telefone: pedido.cliente_telefone,
      origem_handoff: 'estorno',
      motivo_transferencia: `Cliente cancelou pedido já pago (${motivo}) — estorno pendente de autorização.`,
      dados_pedido: { pedido_id: pedido.id },
    });
    if (handoffError) console.error(`[cancelamento-pedido] falha ao criar handoff de estorno (nao critico, evento de estorno ja registrado): ${handoffError.message} pedido=${pedido.id}`);
  }

  console.log(`[cancelamento-pedido] pedido cancelado. pedido=${pedido.id} ja_estava_pago=${jaEstavaPago} cancelado_por=${canceladoPor}`);
  return { cancelado: true, precisaEstorno: jaEstavaPago };
}
