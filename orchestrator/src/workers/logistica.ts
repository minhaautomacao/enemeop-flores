import type { Job } from 'bullmq'
import { criarWorker, despacharParaAgente, criarFila } from '../lib/queue.js'
import { log } from '../lib/supabase.js'
import { notificarEscalada } from '../lib/whatsapp.js'
import { getSupabase } from '../lib/supabase.js'
import { calcularFrete as calcularMelhorEnvio } from '../lib/melhor-envio.js'
import { getQuotation } from '../lib/lalamove.js'
import type { AgentJob, AgentResult } from '../types.js'
import { QUEUES } from '../types.js'

// ── Tipos internos ──────────────────────────────────────────────────

interface EnderecoFrete {
  cep: string
  logradouro?: string
  numero?: string
  complemento?: string
  bairro?: string
  cidade: string
  uf: string
}

interface ItemFrete {
  descricao: string
  peso_kg: number
  altura_cm: number
  largura_cm: number
  comprimento_cm: number
  quantidade: number
  valor_declarado: number
}

interface SolicitacaoFrete {
  lead_id: string
  pedido_id: string
  origem: EnderecoFrete
  destino: EnderecoFrete
  itens: ItemFrete[]
  horario_entrega_desejado?: string
  modalidade_preferida?: string
  callback_queue: string
}

interface OpcaoFrete {
  provedor: string
  transportadora: string
  modalidade: string
  valor: number
  prazo_dias: number
  prazo_horas?: number
  entrega_agendada_disponivel: boolean
  horario_entrega_confirmado?: string
  codigo_servico: string
}

// ── Cotação Melhor Envio ────────────────────────────────────────────

async function cotarMelhorEnvio(
  origem: EnderecoFrete,
  destino: EnderecoFrete,
  itens: ItemFrete[],
): Promise<OpcaoFrete[]> {
  const pesoTotal = itens.reduce((s, i) => s + i.peso_kg * i.quantidade, 0)
  const valorTotal = itens.reduce((s, i) => s + i.valor_declarado * i.quantidade, 0)

  const resultado = await calcularMelhorEnvio({
    from: {
      postal_code: origem.cep.replace('-', ''),
      city: origem.cidade,
      state_abbr: origem.uf,
    },
    to: {
      postal_code: destino.cep.replace('-', ''),
      city: destino.cidade,
      state_abbr: destino.uf,
    },
    package: {
      height: Math.max(...itens.map((i) => i.altura_cm)),
      width: Math.max(...itens.map((i) => i.largura_cm)),
      length: Math.max(...itens.map((i) => i.comprimento_cm)),
      weight: pesoTotal,
    },
    products: itens.map((item, idx) => ({
      id: String(idx + 1),
      width: item.largura_cm,
      height: item.altura_cm,
      length: item.comprimento_cm,
      weight: item.peso_kg,
      insurance_value: item.valor_declarado,
      quantity: item.quantidade,
    })),
  })

  return resultado
    .filter((op) => !op.error && Number(op.price) > 0)
    .map((op) => ({
      provedor: 'melhor-envio',
      transportadora: op.company.name,
      modalidade: op.name,
      valor: Number(op.price),
      prazo_dias: op.delivery_time,
      entrega_agendada_disponivel: false,
      codigo_servico: String(op.id),
    }))
}

// ── Geocodificação CEP → lat/lng (ViaCEP + Nominatim, sem chave) ────

interface ViaCEPResponse {
  logradouro: string
  bairro: string
  localidade: string
  uf: string
  erro?: boolean
}

async function cepParaCoordenadas(cep: string): Promise<{ lat: string; lng: string; endereco: string } | null> {
  const cepLimpo = cep.replace(/\D/g, '')
  const viaCep = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`).then((r) => r.json() as Promise<ViaCEPResponse>).catch(() => null)
  if (!viaCep || viaCep.erro) return null

  const query = encodeURIComponent(`${viaCep.logradouro}, ${viaCep.localidade}, ${viaCep.uf}, Brasil`)
  const nominatim = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`,
    { headers: { 'User-Agent': 'enemeop-flores/1.0' } },
  ).then((r) => r.json() as Promise<Array<{ lat: string; lon: string }>>).catch(() => null)

  if (!nominatim?.length) return null

  return {
    lat: nominatim[0].lat,
    lng: nominatim[0].lon,
    endereco: `${viaCep.logradouro}, ${viaCep.bairro}, ${viaCep.localidade}, ${viaCep.uf}`,
  }
}

// ── Cotação Lalamove ────────────────────────────────────────────────

// Ponto de coleta da loja — configurável por workspace (ver .env.example)
const LALAMOVE_ORIGEM = {
  lat: process.env.STORE_LATITUDE ?? '',
  lng: process.env.STORE_LONGITUDE ?? '',
  endereco: process.env.STORE_ADDRESS ?? '',
}

async function cotarLalamoveLocal(
  _origem: EnderecoFrete,
  destino: EnderecoFrete,
  _itens: ItemFrete[],
  _horario_entrega?: string,
): Promise<OpcaoFrete[]> {
  const coords = await cepParaCoordenadas(destino.cep)
  if (!coords) return []

  const resultado = await getQuotation({
    serviceType: 'LALABIKE',
    stops: [
      { coordinates: { lat: LALAMOVE_ORIGEM.lat, lng: LALAMOVE_ORIGEM.lng }, address: LALAMOVE_ORIGEM.endereco },
      { coordinates: { lat: coords.lat, lng: coords.lng }, address: coords.endereco },
    ],
    item: { quantity: '1', weight: 'LESS_THAN_3KG', categories: ['FLOWER'] },
  }) as { data?: { priceBreakdown?: { total: string }; distance?: { value: string } } }

  const preco = parseFloat(resultado?.data?.priceBreakdown?.total ?? '0')
  if (!preco) return []

  return [{
    provedor: 'lalamove',
    transportadora: 'Lalamove',
    modalidade: 'Moto',
    valor: preco,
    prazo_dias: 0,
    prazo_horas: 1,
    entrega_agendada_disponivel: true,
    codigo_servico: 'LALABIKE',
  }]
}

// ── Agendamento de alertas ──────────────────────────────────────────

async function agendarAlertasEntrega(
  despachoId: string,
  pedidoId: string,
  clienteNome: string,
  produto: string,
  horarioEntrega: string,
): Promise<void> {
  const horario = new Date(horarioEntrega).getTime()
  const agora = Date.now()

  const alertas: Array<{ antecedencia: number; tipo: string }> = [
    { antecedencia: 60, tipo: 'preparar' },
    { antecedencia: 30, tipo: 'embalar' },
    { antecedencia: 20, tipo: 'sair' },
    { antecedencia: 10, tipo: 'urgente' },
  ]

  for (const alerta of alertas) {
    const disparo = horario - alerta.antecedencia * 60_000
    const delay = Math.max(0, disparo - agora)
    if (delay > 0) {
      await despacharParaAgente(
        'whatsapp-sdr',
        {
          task_id: `alerta-${despachoId}-${alerta.tipo}`,
          urgencia: 'critical' as const,
          payload: {
            tipo: 'alerta-entrega',
            despacho_id: despachoId,
            pedido_id: pedidoId,
            cliente_nome: clienteNome,
            produto_descricao: produto,
            horario_entrega: horarioEntrega,
            tipo_alerta: alerta.tipo,
            antecedencia_minutos: alerta.antecedencia,
          },
          criado_em: new Date().toISOString(),
          timeout_ms: 30_000,
        },
        { delay },
      )
    }
  }
}

// ── Handler principal ───────────────────────────────────────────────

async function processarJob(job: Job<AgentJob>): Promise<void> {
  const { task_id, payload, lead_id, pedido_id, urgencia } = job.data
  const inicio = Date.now()
  const supabase = getSupabase()

  await log({
    task_id,
    escopo: 'producao',
    agente: 'logistica',
    tipo_evento: 'recebido',
    urgencia,
    fila: job.queueName,
    payload,
    lead_id,
  })

  try {
    const tipo = payload.tipo as string

    // ── Cotação de frete (acionado pelo SDR) ───────────────────────
    if (tipo === 'solicitacao-frete') {
      const req = payload as unknown as SolicitacaoFrete

      const [opcoesMe, opcoesLala] = await Promise.allSettled([
        cotarMelhorEnvio(req.origem, req.destino, req.itens),
        cotarLalamoveLocal(req.origem, req.destino, req.itens, req.horario_entrega_desejado),
      ])

      const opcoes: OpcaoFrete[] = [
        ...(opcoesMe.status === 'fulfilled' ? opcoesMe.value : []),
        ...(opcoesLala.status === 'fulfilled' ? opcoesLala.value : []),
      ]

      const provedoresFalha: string[] = []
      if (opcoesMe.status === 'rejected') {
        console.error('[Logistica] Melhor Envio falhou:', opcoesMe.reason)
        provedoresFalha.push('melhor-envio')
      }
      if (opcoesLala.status === 'rejected') {
        provedoresFalha.push('lalamove')
      }

      if (opcoes.length === 0) {
        await notificarEscalada(
          task_id,
          'sem-cobertura',
          `Nenhuma transportadora atendeu o CEP ${req.destino.cep} para pedido ${req.pedido_id}`,
        )
      }

      // Ordena: same-day por prazo, demais por custo
      opcoes.sort((a, b) =>
        a.prazo_dias === 0 && b.prazo_dias === 0
          ? (a.prazo_horas ?? 0) - (b.prazo_horas ?? 0)
          : a.prazo_dias === 0
          ? -1
          : b.prazo_dias === 0
          ? 1
          : a.valor - b.valor,
      )

      const resultado: AgentResult = {
        task_id,
        agente: 'logistica',
        escopo: 'producao',
        urgencia,
        status: opcoes.length > 0 ? 'concluido' : 'bloqueado',
        resultado: {
          pedido_id: req.pedido_id,
          opcoes,
          endereco_atendido: opcoes.length > 0,
          provedores_consultados: 2 - provedoresFalha.length,
          provedores_com_falha: provedoresFalha,
        },
        duracao_ms: Date.now() - inicio,
        lead_id,
        pedido_id,
        proximo_passo: opcoes.length > 0 ? 'apresentar-opcoes-ao-cliente' : 'aguardar-resolucao-manual',
        bloqueio: opcoes.length === 0
          ? { motivo: 'sem-cobertura', informacao_necessaria: 'CEP fora de cobertura — operador deve decidir' }
          : undefined,
      }

      await log({
        task_id,
        escopo: 'producao',
        agente: 'logistica',
        tipo_evento: 'concluido',
        urgencia,
        fila: job.queueName,
        payload: resultado.resultado ?? {},
        lead_id,
      })

      // Envia resultado de volta ao callback especificado
      const filaResultado = criarFila(req.callback_queue ?? QUEUES.RESULTS)
      await filaResultado.add(task_id, resultado)
      return
    }

    // ── Agendamento após pagamento confirmado ───────────────────────
    if (tipo === 'pedido-liberado') {
      const {
        pedido_id: pid,
        lead_id: lid,
        cliente_nome,
        cliente_telefone,
        canal_venda,
        produto_descricao,
        endereco_entrega,
        horario_entrega,
        transportadora,
        modalidade,
        codigo_servico,
      } = payload as Record<string, string>

      const despachoId = `D-${pid}-${Date.now()}`

      const { error } = await supabase.from('despachos_agendados').insert({
        id: despachoId,
        pedido_id: pid,
        lead_id: lid,
        cliente_nome,
        cliente_telefone,
        canal_venda: canal_venda ?? 'whatsapp',
        produto_descricao,
        endereco_entrega,
        horario_entrega,
        transportadora,
        status: 'agendado',
      })

      if (error) throw new Error(`Supabase insert despacho: ${error.message}`)

      await agendarAlertasEntrega(despachoId, pid, cliente_nome, produto_descricao, horario_entrega)

      const resultado: AgentResult = {
        task_id,
        agente: 'logistica',
        escopo: 'producao',
        urgencia,
        status: 'concluido',
        resultado: { despacho_id: despachoId, horario_entrega, transportadora },
        duracao_ms: Date.now() - inicio,
        lead_id,
        pedido_id,
        proximo_passo: 'notificar-operacional',
      }

      await log({
        task_id,
        escopo: 'producao',
        agente: 'logistica',
        tipo_evento: 'concluido',
        urgencia,
        fila: job.queueName,
        payload: resultado.resultado ?? {},
        lead_id,
      })

      const filaResultado = criarFila(QUEUES.RESULTS)
      await filaResultado.add(task_id, resultado)
      return
    }

    throw new Error(`Tipo de evento desconhecido: ${tipo}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Logistica] Erro em ${task_id}:`, msg)

    await log({
      task_id,
      escopo: 'producao',
      agente: 'logistica',
      tipo_evento: 'falhou',
      urgencia,
      fila: job.queueName,
      payload: { erro: msg },
      lead_id,
    })

    throw err
  }
}

export function iniciarWorkerLogistica(): void {
  criarWorker(QUEUES.AGENT_LOGISTICA, processarJob)
  console.log('[Logistica] Worker iniciado — ouvindo fila:', QUEUES.AGENT_LOGISTICA)
}
