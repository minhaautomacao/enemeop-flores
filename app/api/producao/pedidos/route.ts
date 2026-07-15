import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('pedidos')
    .select('id, numero, produto, valor, cliente_nome, cliente_telefone, endereco, bairro, canal, status, criado_em, data_entrega, foto_url')
    .order('criado_em', { ascending: true })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pedidos: data ?? [] });
}
