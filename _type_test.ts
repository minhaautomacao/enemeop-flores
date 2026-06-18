import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/types';

type Schema = Database['public'];
type Tables = Schema['Tables'];
type PedidosTable = Tables['pedidos'];
type PedidosInsert = PedidosTable['Insert'];

// Se estas linhas compilarem, o tipo está correto:
const _t1: PedidosInsert = {
  cliente_nome: 'teste',
  cliente_telefone: '11999999999',
  produto: 'Buque',
};

async function _test() {
  const supabase = await createClient();
  const q = supabase.from('pedidos');
  type InsertFn = typeof q.insert;
  const _t2: InsertFn = q.insert.bind(q);
}

// Replica exatamente o pedidos.ts
type PedidoInsert2 = Database['public']['Tables']['pedidos']['Insert'];
async function _test2(data: PedidoInsert2) {
  const supabase = await createClient();
  await supabase.from('pedidos').insert(data);
}

// Teste com objeto inline (sem tipo extraído)
async function _test3() {
  const supabase = await createClient();
  await supabase.from('pedidos').insert({ cliente_nome: 'a', cliente_telefone: 'b', produto: 'c' });
}
