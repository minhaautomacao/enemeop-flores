import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq'
import { getRedis } from './redis.js'
import type { OrchestratorJob, AgentJob } from '../types.js'
import { QUEUES } from '../types.js'

// bullmq e ioredis têm versões internas diferentes do ioredis — cast necessário
function conexao(): ConnectionOptions {
  return getRedis() as unknown as ConnectionOptions
}

export function criarFila<T = unknown>(nome: string): Queue<T> {
  return new Queue<T>(nome, {
    connection: conexao(),
    defaultJobOptions: {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  })
}

export const filas = {
  fabricaCritical:  criarFila<OrchestratorJob>(QUEUES.FABRICA_CRITICAL),
  fabricaNormal:    criarFila<OrchestratorJob>(QUEUES.FABRICA_NORMAL),
  fabricaLow:       criarFila<OrchestratorJob>(QUEUES.FABRICA_LOW),
  producaoCritical: criarFila<OrchestratorJob>(QUEUES.PRODUCAO_CRITICAL),
  producaoNormal:   criarFila<OrchestratorJob>(QUEUES.PRODUCAO_NORMAL),
  producaoLow:      criarFila<OrchestratorJob>(QUEUES.PRODUCAO_LOW),
}

// Mapa de agente → nome da fila (lazy: Queue criada só ao despachar)
const AGENTE_PARA_FILA: Record<string, string> = {
  'captacao-leads': QUEUES.AGENT_CAPTACAO,
  'whatsapp-sdr':   QUEUES.AGENT_SDR,
  'financeiro':     QUEUES.AGENT_FINANCEIRO,
  'logistica':      QUEUES.AGENT_LOGISTICA,
  'conciliacao':    QUEUES.AGENT_CONCILIACAO,
  'operacional':    QUEUES.AGENT_OPERACIONAL,
  'rastreamento':   QUEUES.AGENT_RASTREAMENTO,
  'pos-venda':      QUEUES.AGENT_POS_VENDA,
  'marketing':      QUEUES.AGENT_MARKETING,
  'inteligencia':   QUEUES.AGENT_INTELIGENCIA,
  'agente-dev':     QUEUES.AGENT_DEV,
  'estoque':        QUEUES.AGENT_ESTOQUE,
}

// Cache lazy: instancia Queue<AgentJob> somente quando despachar pela primeira vez
const _filasAgentesCache = new Map<string, Queue<AgentJob>>()

function getFilaAgente(agente: string): Queue<AgentJob> {
  const cached = _filasAgentesCache.get(agente)
  if (cached) return cached
  const nomeFila = AGENTE_PARA_FILA[agente]
  if (!nomeFila) throw new Error(`Agente desconhecido: ${agente}`)
  const fila = criarFila<AgentJob>(nomeFila)
  _filasAgentesCache.set(agente, fila)
  return fila
}

export async function despacharParaAgente(
  agente: string,
  job: AgentJob,
  opcoes?: { priority?: number; delay?: number }
): Promise<void> {
  const fila = getFilaAgente(agente)
  await fila.add(job.task_id, job, {
    priority: opcoes?.priority,
    delay: opcoes?.delay,
  })
}

export function criarWorker<T>(
  nomeFila: string,
  handler: (job: Job<T>) => Promise<void>
): Worker<T> {
  return new Worker<T>(nomeFila, handler, {
    connection: conexao(),
    concurrency: 2,
    // Sem jobs na fila: aguarda 30s antes de re-poll (padrão é 5ms → 200x/seg)
    drainDelay: 30000,
    // Verifica jobs travados a cada 5 minutos (padrão 30s)
    stalledInterval: 300000,
    // Lock dura 60s (padrão 30s), reduz renovações
    lockDuration: 60000,
  })
}
