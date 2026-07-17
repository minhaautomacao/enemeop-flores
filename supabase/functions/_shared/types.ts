export type NomeAgente =
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
  | 'estoque'
  | 'agente-dev';

export type Urgencia = 'critical' | 'normal' | 'low';
export type Escopo = 'producao' | 'fabrica';

export interface OrquestradorPayload {
  tipo: string;
  escopo: Escopo;
  urgencia: Urgencia;
  task_id: string;
  payload: Record<string, unknown>;
  workspace_id?: string;
  timestamp?: string;
}

export interface AgentResult {
  agente: NomeAgente;
  task_id: string;
  sucesso: boolean;
  acoes_executadas: string[];
  duracao_ms: number;
  erro?: string;
}

export interface LogEventoParams {
  task_id: string;
  escopo: Escopo;
  agente: NomeAgente;
  tipo_evento: string;
  urgencia?: Urgencia;
  duracao_ms?: number;
  erro?: string;
  workspace_id?: string;
}
