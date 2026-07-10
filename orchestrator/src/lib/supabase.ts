import { createClient } from '@supabase/supabase-js'

function criarClienteSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios')
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  })
}

let _supabase: ReturnType<typeof criarClienteSupabase> | null = null

export function getSupabase() {
  if (!_supabase) {
    _supabase = criarClienteSupabase()
  }
  return _supabase
}

// Registra uma entrada no log do orquestrador
export async function log(entrada: {
  task_id: string
  escopo: 'fabrica' | 'producao'
  agente: string
  tipo_evento: string
  urgencia?: string
  fila?: string
  payload?: Record<string, unknown>
  resultado?: Record<string, unknown>
  erro?: string
  duracao_ms?: number
  lead_id?: string
  pedido_id?: string
}) {
  const { error } = await getSupabase()
    .from('orchestrator_logs')
    .insert(entrada)

  if (error) {
    console.error('[Supabase] Falha ao gravar log:', error.message)
  }
}
