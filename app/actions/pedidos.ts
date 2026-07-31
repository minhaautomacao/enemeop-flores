'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { Database } from '@/types';

type PedidoInsert = Database['public']['Tables']['pedidos']['Insert'];

type PedidoUpdate = Database['public']['Tables']['pedidos']['Update'];
type MutateResult = { error: { message: string } | null };

function asInsertable(from: unknown): { insert(row: PedidoInsert): PromiseLike<MutateResult> } {
  return from as { insert(row: PedidoInsert): PromiseLike<MutateResult> };
}

function asUpdatable(from: unknown): { update(row: PedidoUpdate): { eq(col: string, val: string): PromiseLike<MutateResult> } } {
  return from as { update(row: PedidoUpdate): { eq(col: string, val: string): PromiseLike<MutateResult> } };
}

export async function criarPedido(data: PedidoInsert) {
  const supabase = await createClient();
  const { error } = await asInsertable(supabase.from('pedidos')).insert(data);
  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/pedidos');
}

type StatusPedido    = Database['public']['Tables']['pedidos']['Row']['status'];
type StatusProducao  = Database['public']['Tables']['pedidos']['Row']['status_producao'];

// Só se aplica ao fluxo manual antigo (criado via "+ Novo pedido", `status`
// aqui é o próprio ciclo de vida do pedido). Pedidos reais da Flora usam
// `status` para PAGAMENTO — nunca avançados por aqui, ver
// avancarStatusProducao abaixo.
const PROXIMO_STATUS: Partial<Record<StatusPedido, StatusPedido | null>> = {
  novo:       'confirmado',
  confirmado: 'preparando',
  preparando: 'saiu',
  saiu:       'entregue',
  entregue:   null,
  cancelado:  null,
};

export async function atualizarStatusPedido(id: string, statusAtual: StatusPedido) {
  const proximo = PROXIMO_STATUS[statusAtual];
  if (proximo === undefined) throw new Error('Este pedido usa o fluxo real (pagamento) — use avancarStatusProducao.');
  if (!proximo) throw new Error('Status já é final.');
  const supabase = await createClient();
  const { error } = await asUpdatable(supabase.from('pedidos')).update({ status: proximo }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/pedidos');
}

// Pedidos reais (criados pela Flora): `status` é o pagamento — só o webhook
// real do Mercado Pago confirma isso, NUNCA esta tela. O que a equipe avança
// manualmente aqui é a produção (status_producao), e só depois que o
// pagamento já foi confirmado de verdade.
const PROXIMO_STATUS_PRODUCAO: Record<StatusProducao, StatusProducao | null> = {
  novo:       'confirmado',
  confirmado: 'preparando',
  preparando: 'pronto',
  pronto:     'saiu',
  saiu:       'entregue',
  entregue:   null,
};

export async function avancarStatusProducao(id: string, statusPagamento: StatusPedido, statusProducaoAtual: StatusProducao) {
  if (statusPagamento !== 'pago') {
    throw new Error('Pedido ainda não foi pago — a produção só avança depois da confirmação real do pagamento.');
  }
  const proximo = PROXIMO_STATUS_PRODUCAO[statusProducaoAtual];
  if (!proximo) throw new Error('Produção já está no status final.');
  const supabase = await createClient();
  const { error } = await asUpdatable(supabase.from('pedidos')).update({ status_producao: proximo }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/pedidos');
}
