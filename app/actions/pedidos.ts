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

type StatusPedido = Database['public']['Tables']['pedidos']['Row']['status'];

const PROXIMO_STATUS: Record<StatusPedido, StatusPedido | null> = {
  novo:       'confirmado',
  confirmado: 'preparando',
  preparando: 'saiu',
  saiu:       'entregue',
  entregue:   null,
  cancelado:  null,
};

export async function atualizarStatusPedido(id: string, statusAtual: StatusPedido) {
  const proximo = PROXIMO_STATUS[statusAtual];
  if (!proximo) throw new Error('Status já é final.');
  const supabase = await createClient();
  const { error } = await asUpdatable(supabase.from('pedidos')).update({ status: proximo }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/pedidos');
}
