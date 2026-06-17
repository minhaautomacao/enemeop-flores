'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { Database } from '@/types';

type PedidoInsert = Database['public']['Tables']['pedidos']['Insert'];

export async function criarPedido(data: PedidoInsert) {
  const supabase = await createClient();
  const { error } = await supabase.from('pedidos').insert(data);
  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/pedidos');
}
