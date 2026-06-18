'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { Database } from '@/types';

type PedidoInsert = Database['public']['Tables']['pedidos']['Insert'];

type InsertResult = { error: { message: string } | null };

function asInsertable(from: unknown): { insert(row: PedidoInsert): PromiseLike<InsertResult> } {
  return from as { insert(row: PedidoInsert): PromiseLike<InsertResult> };
}

export async function criarPedido(data: PedidoInsert) {
  const supabase = await createClient();
  const { error } = await asInsertable(supabase.from('pedidos')).insert(data);
  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/pedidos');
}
