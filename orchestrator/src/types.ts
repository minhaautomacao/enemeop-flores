export type Escopo = 'fabrica' | 'producao'
export type Urgencia = 'critical' | 'normal' | 'low'
export type TipoEvento =
  | 'recebido'
  | 'classificado'
  | 'despachado'
  | 'concluido'
  | 'falhou'
  | 'timeout'
  | 'acionado'
  | 'escalado'

export type NomeAgente =
  | 'orquestrador'
  | 'captacao-leads'
  | 'whatsapp-sdr'
  | 'financeiro'
  | 'logistica'
  | 'conciliacao'
  | 'operacional'
  | 'rastreamento'
  | 'pos-venda'
  | 'marketing'
  | 'inteligencia'
  | 'agente-dev'
  | 'estoque'

// Evento que chega na fila do orquestrador
export interface OrchestratorJob {
  task_id: string
  escopo: Escopo
  urgencia: Urgencia
  tipo: string                  // ex: 'novo-lead', 'bug-producao', 'criar-saas'
  payload: Record<string, unknown>
  lead_id?: string
  pedido_id?: string
  origem?: string               // qual sistema gerou o evento
  timestamp: string
}

// Evento que o orquestrador envia para filas de agentes
export interface AgentJob {
  task_id: string
  urgencia: Urgencia
  payload: Record<string, unknown>
  lead_id?: string
  pedido_id?: string
  timeout_ms: number
  criado_em: string
}

// Resposta que os agentes retornam para o orquestrador
export interface AgentResult {
  task_id: string
  agente: NomeAgente
  escopo: Escopo
  urgencia: Urgencia
  status: 'concluido' | 'bloqueado' | 'parcial'
  resultado?: Record<string, unknown>
  erro?: string
  duracao_ms: number
  lead_id?: string
  pedido_id?: string
  proximo_passo?: string
  // Se status === 'bloqueado', informa o que falta para continuar
  bloqueio?: {
    motivo: string
    informacao_necessaria: string
  }
}

// Mapa de timeouts por urgência (em ms)
export const TIMEOUTS: Record<Urgencia, number> = {
  critical: 30_000,    // 30s
  normal: 300_000,     // 5min
  low: 1_800_000,      // 30min
}

// Nomes das filas BullMQ (sem ":" — BullMQ não permite)
export const QUEUES = {
  // Filas de entrada do orquestrador (por escopo e urgência)
  FABRICA_CRITICAL: 'fabrica-critical',
  FABRICA_NORMAL:   'fabrica-normal',
  FABRICA_LOW:      'fabrica-low',
  PRODUCAO_CRITICAL: 'producao-critical',
  PRODUCAO_NORMAL:   'producao-normal',
  PRODUCAO_LOW:      'producao-low',

  // Filas de saída (por agente)
  AGENT_CAPTACAO:    'agent-captacao-leads',
  AGENT_SDR:         'agent-whatsapp-sdr',
  AGENT_FINANCEIRO:  'agent-financeiro',
  AGENT_LOGISTICA:   'agent-logistica',
  AGENT_CONCILIACAO: 'agent-conciliacao',
  AGENT_OPERACIONAL: 'agent-operacional',
  AGENT_RASTREAMENTO:'agent-rastreamento',
  AGENT_POS_VENDA:   'agent-pos-venda',
  AGENT_MARKETING:   'agent-marketing',
  AGENT_INTELIGENCIA:'agent-inteligencia',
  AGENT_DEV:         'agent-agente-dev',
  AGENT_ESTOQUE:     'agent-estoque',

  // Fila de resultados (agentes respondem aqui)
  RESULTS: 'results',
} as const
