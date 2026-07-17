import type { Job } from 'bullmq'
import { criarWorker, despacharParaAgente, filas } from '../lib/queue.js'
import { log } from '../lib/supabase.js'
import { notificarEscalada } from '../lib/whatsapp.js'
import type { OrchestratorJob, AgentJob, AgentResult, Urgencia } from '../types.js'
import { TIMEOUTS, QUEUES } from '../types.js'

// Mapa de roteamento: tipo de evento → agente responsável
// Segue a lógica do .claude/agents/orquestrador.md
const ROTEAMENTO: Record<string, string[]> = {
  // Escopo Produção — ciclo de captação e venda
  'novo-lead':               ['captacao-leads'],
  'lead-qualificado':        ['whatsapp-sdr'],
  'solicitacao-frete':       ['logistica'],           // SDR solicita cotação via orquestrador
  'pagamento-gerado':        ['conciliacao'],
  'pagamento-expirado':      ['whatsapp-sdr'],        // PIX expirou — SDR reaborda cliente
  'pagamento-confirmado':    ['operacional', 'financeiro'],
  'pedido-confirmado':       ['estoque'],             // baixa no estoque após confirmação
  'pedido-liberado':         ['logistica'],
  'pedido-despachado':       ['rastreamento'],
  'tentativa-entrega-falha': ['rastreamento'],        // rastreamento reativa monitoramento
  'entrega-concluida':       ['pos-venda', 'estoque'],// pós-venda + confirmar baixa estoque
  'reclamacao-recebida':     ['pos-venda'],
  'devolucao-solicitada':    ['logistica', 'financeiro'], // logística reversa + estorno
  'cliente-inativo-detectado': ['marketing'],         // marketing reativa clientes inativos
  'analise-periodica':       ['inteligencia'],
  'ruptura-estoque':         ['estoque'],             // estoque detecta e gera OC
  'mercadoria-recebida':     ['estoque'],             // entrada de mercadoria — atualiza saldo

  // Escopo Fábrica
  'criar-saas':              ['inteligencia', 'agente-dev'],
  'nova-feature':            ['agente-dev'],
  'bug-producao':            ['agente-dev'],
  'nova-migration':          ['agente-dev'],
  'campanha-lancamento':     ['marketing'],
  'setup-cobranca':          ['financeiro'],
}

// Situações de escalada para humano (Carlos)
// IMPORTANTE: estes tipos devem estar ausentes do ROTEAMENTO — o orquestrador
// intercepta antes de tentar rotear, garantindo que escaladas críticas nunca passem despercebidas.
const REQUER_ESCALADA = new Set([
  'divergencia-financeira-alta',
  'acao-irreversivel',
  'reclamacao-grave',
])

async function processarJob(job: Job<OrchestratorJob>): Promise<void> {
  const evento = job.data
  const inicio = Date.now()

  await log({
    task_id: evento.task_id,
    escopo: evento.escopo,
    agente: 'orquestrador',
    tipo_evento: 'recebido',
    urgencia: evento.urgencia,
    fila: job.queueName,
    payload: evento.payload,
    lead_id: evento.lead_id,
    pedido_id: evento.pedido_id,
  })

  // Verificar se precisa de escalada humana
  if (REQUER_ESCALADA.has(evento.tipo)) {
    await escalar(evento)
    return
  }

  // Resolver agentes responsáveis pelo tipo do evento
  const agentes = ROTEAMENTO[evento.tipo]
  if (!agentes || agentes.length === 0) {
    await log({
      task_id: evento.task_id,
      escopo: evento.escopo,
      agente: 'orquestrador',
      tipo_evento: 'falhou',
      urgencia: evento.urgencia,
      erro: `Tipo de evento sem roteamento configurado: ${evento.tipo}`,
      duracao_ms: Date.now() - inicio,
    })
    return
  }

  await log({
    task_id: evento.task_id,
    escopo: evento.escopo,
    agente: 'orquestrador',
    tipo_evento: 'classificado',
    urgencia: evento.urgencia,
    payload: { agentes_destino: agentes, tipo: evento.tipo },
    lead_id: evento.lead_id,
  })

  // Despachar para cada agente (em paralelo se múltiplos)
  const agentJob: AgentJob = {
    task_id: evento.task_id,
    urgencia: evento.urgencia,
    payload: evento.payload,
    lead_id: evento.lead_id,
    pedido_id: evento.pedido_id,
    timeout_ms: TIMEOUTS[evento.urgencia],
    criado_em: new Date().toISOString(),
  }

  await Promise.all(
    agentes.map(async (agente) => {
      await despacharParaAgente(agente, agentJob, {
        priority: evento.urgencia === 'critical' ? 1
                : evento.urgencia === 'normal'   ? 5
                : 10,
      })

      await log({
        task_id: evento.task_id,
        escopo: evento.escopo,
        agente,
        tipo_evento: 'despachado',
        urgencia: evento.urgencia,
        fila: `queue:agent:${agente}`,
        lead_id: evento.lead_id,
        pedido_id: evento.pedido_id,
        duracao_ms: Date.now() - inicio,
      })
    })
  )
}

// Processa respostas dos agentes — escuta queue:results
async function processarResultado(job: Job<AgentResult>): Promise<void> {
  const resultado = job.data

  await log({
    task_id: resultado.task_id,
    escopo: resultado.escopo,
    agente: resultado.agente,
    tipo_evento: resultado.status === 'concluido' ? 'concluido' : 'falhou',
    urgencia: resultado.urgencia,
    resultado: resultado.resultado,
    erro: resultado.erro,
    duracao_ms: resultado.duracao_ms,
    lead_id: resultado.lead_id,
    pedido_id: resultado.pedido_id,
  })

  // Agente bloqueado → escalar para Carlos
  if (resultado.status === 'bloqueado') {
    await log({
      task_id: resultado.task_id,
      escopo: resultado.escopo,
      agente: 'orquestrador',
      tipo_evento: 'escalado',
      urgencia: resultado.urgencia,
      payload: {
        agente_bloqueado: resultado.agente,
        motivo: resultado.bloqueio?.motivo ?? resultado.erro ?? 'motivo desconhecido',
        informacao_necessaria: resultado.bloqueio?.informacao_necessaria,
      },
      lead_id: resultado.lead_id,
      pedido_id: resultado.pedido_id,
    })
    await notificarEscalada(
      resultado.task_id,
      `bloqueio-agente-${resultado.agente}`,
      resultado.bloqueio?.motivo ?? resultado.erro ?? 'Agente bloqueado sem motivo definido'
    )
    console.warn(
      `[Orquestrador] BLOQUEADO — agente: ${resultado.agente} task: ${resultado.task_id}`,
      resultado.bloqueio?.motivo
    )
    return
  }

  // Resultado parcial → apenas registrar (agente tratará internamente)
  if (resultado.status === 'parcial') {
    console.log(
      `[Orquestrador] PARCIAL — agente: ${resultado.agente} task: ${resultado.task_id}`,
      resultado.proximo_passo
    )
  }
}

async function escalar(evento: OrchestratorJob): Promise<void> {
  await log({
    task_id: evento.task_id,
    escopo: evento.escopo,
    agente: 'orquestrador',
    tipo_evento: 'escalado',
    urgencia: evento.urgencia,
    payload: {
      motivo: evento.tipo,
      mensagem: 'Requer aprovação humana — notificando Carlos via WhatsApp',
    },
    lead_id: evento.lead_id,
    pedido_id: evento.pedido_id,
  })

  await notificarEscalada(evento.task_id, evento.tipo, `Evento ${evento.tipo} requer aprovação humana`)
  console.warn(`[Orquestrador] ESCALADO para humano — task_id: ${evento.task_id} tipo: ${evento.tipo}`)
}

// Workers — um por fila de entrada
export function iniciarWorkers(): void {
  const handlers: Array<[string, Urgencia]> = [
    [QUEUES.FABRICA_CRITICAL,  'critical'],
    [QUEUES.FABRICA_NORMAL,    'normal'],
    [QUEUES.FABRICA_LOW,       'low'],
    [QUEUES.PRODUCAO_CRITICAL, 'critical'],
    [QUEUES.PRODUCAO_NORMAL,   'normal'],
    [QUEUES.PRODUCAO_LOW,      'low'],
  ]

  for (const [nomeFila] of handlers) {
    const worker = criarWorker<OrchestratorJob>(nomeFila, processarJob)

    worker.on('completed', (job) => {
      console.log(`[Orquestrador] ✓ ${job.data.task_id} — ${job.data.tipo}`)
    })

    worker.on('failed', (job, err) => {
      console.error(`[Orquestrador] ✗ ${job?.data.task_id} — ${err.message}`)
    })

    console.log(`[Orquestrador] Worker iniciado: ${nomeFila}`)
  }

  // Worker de resultados — processa respostas de todos os agentes
  const resultWorker = criarWorker<AgentResult>(QUEUES.RESULTS, processarResultado)

  resultWorker.on('completed', (job) => {
    console.log(`[Orquestrador] Resultado processado: ${job.data.task_id} — ${job.data.agente} → ${job.data.status}`)
  })

  resultWorker.on('failed', (job, err) => {
    console.error(`[Orquestrador] Falha ao processar resultado: ${job?.data.task_id} — ${err.message}`)
  })

  console.log(`[Orquestrador] Worker de resultados iniciado: ${QUEUES.RESULTS}`)
}
