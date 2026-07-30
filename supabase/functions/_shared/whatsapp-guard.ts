/**
 * whatsapp-guard.ts — validação central de envio de WhatsApp, sem tocar
 * rede/DB (puro, testável com node:test/tsx, mesmo padrão de
 * pagamento-evento-decisao.ts).
 *
 * Contexto (2026-07-30): o número anterior usado nos testes foi banido.
 * O canal WhatsApp aqui é Z-API/Evolution — uma ponte NÃO OFICIAL de
 * WhatsApp Web, sujeita a banimento por comportamento de bot (ao contrário
 * da Cloud API oficial da Meta, que não corre esse risco). canSendWhatsApp
 * Message() é o único ponto de decisão "pode enviar ou não" — TODO envio
 * real (funil da Flora e o SDR separado em whatsapp-sdr) deve passar por
 * aqui antes de chamar a API do provedor.
 *
 * Achado de auditoria que motivou este módulo: toda mensagem recebida no
 * WhatsApp disparava, em paralelo à resposta normal da Flora, uma SEGUNDA
 * mensagem independente gerada por um bot separado (whatsapp-sdr, incluindo
 * "abordagem_inicial" — contato frio não solicitado). Duas mensagens
 * automáticas por interação, uma delas potencialmente fora de contexto, é
 * exatamente o tipo de comportamento que o WhatsApp penaliza — provável
 * contribuinte para o banimento anterior. canSendWhatsAppMessage() bloqueia
 * isso por padrão (WHATSAPP_MARKETING_ENABLED=false).
 */

export interface ConfigEnvioWhatsApp {
  /** WHATSAPP_ACTIVE_NUMBER — único número autorizado a enviar nesta fase. */
  numeroAtivo: string
  /** WHATSAPP_OFFICIAL_NUMBER — número oficial da loja, protegido/bloqueado nesta fase. */
  numeroOficial: string
  /** WHATSAPP_OFFICIAL_NUMBER_LOCKED — quando true, o número oficial nunca pode ser o número ativo. */
  numeroOficialBloqueado: boolean
  /** WHATSAPP_MARKETING_ENABLED — quando false, nenhuma mensagem de campanha/abordagem fria é enviada. */
  marketingHabilitado: boolean
}

/**
 * 'transacional' — resposta dentro de um atendimento já em andamento
 *   (inclusive confirmação de pedido, cotação, notificação de entrega): o
 *   cliente já iniciou ou já está em conversa ativa, sempre permitida
 *   (sujeita às outras checagens: opt-out, humano, duplicada).
 * 'iniciada_pela_empresa' — primeiro contato/reativação/campanha (ex.:
 *   "abordagem_inicial" do SDR pra um lead que nunca mandou mensagem no
 *   WhatsApp): só permitida com marketingHabilitado=true.
 */
export type TipoMensagemWhatsApp = 'transacional' | 'iniciada_pela_empresa'

export interface ContextoEnvioWhatsApp {
  tipo: TipoMensagemWhatsApp
  /** Ticket de atendimento humano ativo para esta conversa — Flora nunca envia enquanto um humano está responsável. */
  atendimentoHumanoAtivo: boolean
  /** Cliente já pediu para não receber mais mensagens automáticas (ver mensagemDeOptOut). */
  optOut: boolean
  /** Mesma mensagem/mid já processado antes (ver _shared/dedup.ts) — nunca reenviar. */
  mensagemDuplicada: boolean
}

export interface ResultadoValidacaoEnvio {
  permitido: boolean
  /** Motivo legível só para log — nunca exibido ao cliente. */
  motivo?: string
}

/**
 * Único ponto de decisão "pode enviar" — nenhuma mensagem deve sair sem
 * passar por aqui. Ordem das checagens é a de maior risco primeiro (número
 * oficial nunca pode vazar, mesmo que todo o resto esteja ok).
 */
export function canSendWhatsAppMessage(
  config: ConfigEnvioWhatsApp,
  contexto: ContextoEnvioWhatsApp,
): ResultadoValidacaoEnvio {
  if (config.numeroOficialBloqueado && !!config.numeroAtivo && config.numeroAtivo === config.numeroOficial) {
    return { permitido: false, motivo: 'numero_oficial_bloqueado: numero ativo nao pode ser o numero oficial protegido' }
  }
  if (!config.numeroAtivo) {
    return { permitido: false, motivo: 'numero_ativo_nao_configurado' }
  }
  if (contexto.mensagemDuplicada) {
    return { permitido: false, motivo: 'mensagem_duplicada' }
  }
  if (contexto.optOut) {
    return { permitido: false, motivo: 'cliente_optou_por_nao_receber' }
  }
  if (contexto.atendimentoHumanoAtivo) {
    return { permitido: false, motivo: 'atendimento_humano_ativo' }
  }
  if (contexto.tipo === 'iniciada_pela_empresa' && !config.marketingHabilitado) {
    return { permitido: false, motivo: 'marketing_desabilitado: mensagem iniciada pela empresa (campanha/abordagem fria) bloqueada' }
  }
  return { permitido: true }
}

const FRASES_OPT_OUT = [
  'pare', 'parar', 'nao quero receber', 'nao me envie mensagens',
  'remova meu numero', 'cancelar mensagens', 'descadastrar',
]

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** true quando a mensagem do cliente é um pedido explícito de opt-out — nunca por substring solta demais (ex.: "pare" isolado, não "pare de chover"). */
export function mensagemDeOptOut(mensagemCliente: string): boolean {
  const n = normalizar(mensagemCliente)
  if (n === 'pare' || n === 'parar' || n === 'para') return true
  return FRASES_OPT_OUT.some(f => n.includes(normalizar(f)))
}

/** Mensagem fixa de confirmação de opt-out — nunca gerada por IA, nunca envia mais que esta única mensagem. */
export function mensagemConfirmacaoOptOut(): string {
  return 'Certo. As mensagens automáticas foram interrompidas.'
}

/**
 * Janela de atendimento: true enquanto a última mensagem do cliente foi há
 * no máximo 24h — usada só para decidir se uma mensagem 'iniciada_pela_
 * empresa' pode ainda ser considerada continuação de um atendimento
 * recente. Sem última interação registrada, nunca está dentro da janela.
 */
export function dentroDaJanelaDeAtendimento(ultimaMensagemClienteEm: string | null | undefined, agora: Date): boolean {
  if (!ultimaMensagemClienteEm) return false
  const ultima = new Date(ultimaMensagemClienteEm).getTime()
  if (Number.isNaN(ultima)) return false
  const VINTE_QUATRO_HORAS_MS = 24 * 60 * 60 * 1000
  return agora.getTime() - ultima <= VINTE_QUATRO_HORAS_MS
}
