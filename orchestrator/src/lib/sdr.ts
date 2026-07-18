import Groq from 'groq-sdk'
import { getRedis } from './redis.js'
import { getSupabase } from './supabase.js'
import { responderLead, notificarEscalada, enviarImagem } from './whatsapp.js'
import { responderInstagram, responderInstagramComFoto, salvarConversa, responderComentarioInstagram, responderComentarioFacebook } from './instagram.js'
import { searchLiveProductsFromSite, listCategoriesFromSite, fetchProductsByCategoryFromSite, revalidateProductFromSite } from '../catalog/liveSiteCatalog.js'
import { calcularFreteReal } from './frete.js'
import { gerarPagamentoReal } from './pagamento.js'
import { criarPedidoProvisorio } from './pedido.js'
import { randomUUID } from 'crypto'
import {
  classificarIntencao,
  intencaoInterrompeFluxo,
  mensagemForaDeEscopo,
  mensagemTransferencia,
  avancarFunil,
  estadoInicial,
  type EstadoConversa,
  type DependenciasFunil,
  type ProdutoCatalogo,
} from './funil.js'

// Fallback evita que a simples importação deste módulo quebre sem
// GROQ_API_KEY configurada (ex.: testes locais que só exercitam a lógica
// de composição de prompt). Uma chamada real à API sem chave válida
// continua falhando normalmente, com erro de autenticação do Groq.
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'not-configured' })

// Identidade e contato configuráveis por workspace — ver .env.example
const AGENT_NAME    = process.env.AGENT_NAME ?? 'Flora'
const WHATSAPP_LINK = process.env.STORE_WHATSAPP_LINK ?? ''

// Workspace atual — isola estado/histórico entre instâncias da fábrica que
// eventualmente compartilhem o mesmo Redis (ver seção 3 do pedido de
// integração: chave conceitual workspace:canal:cliente:estado).
const WORKSPACE_ID = process.env.SAAS_WORKSPACE_ID ?? 'enemeop-flores'

// Versão do formato do estado — incrementar sempre que EstadoConversa mudar
// de forma incompatível, para permitir migração/descarte controlado de
// estados antigos em vez de quebrar silenciosamente na leitura.
const ESTADO_VERSAO = 1

// Transferência para atendimento humano usa mensagemTransferencia() de
// lib/funil.ts (texto fixo "WhatsApp final 9083", sem expor o número
// completo em texto de cliente — ver HUMAN_SUPPORT_WHATSAPP no .env.example
// para o roteamento interno real da escalada).

// Instrução de primeira mensagem para composição de prompt — mantida e
// testada (sdr.test.ts) para documentar a regra de saudação por nome, mas
// não é mais usada para gerar a saudação real (ver processarMensagemSDR):
// desde a integração do funil determinístico, a saudação da primeira
// mensagem também é texto fixo, não gerada por LLM.
export function buildInstrucaoPrimeiraMensagem(primeiraMensagem: boolean, nomeCliente?: string | null): string {
  if (!primeiraMensagem) return ''
  if (nomeCliente) {
    return `\n\n## INSTRUÇÃO OBRIGATÓRIA\nVocê é ${AGENT_NAME.toUpperCase()}. O cliente se chama **${nomeCliente}**. Cumprimente pelo nome. NÃO peça o nome — você já sabe.`
  }
  return '\n\n## INSTRUÇÃO OBRIGATÓRIA\nPrimeira mensagem. COMECE pedindo o nome: "Oi, pode me dizer seu nome pra eu te atender melhor?"'
}

const SAUDACAO_SEM_NOME = 'Oi! Pode me dizer seu nome pra eu te atender melhor?'

interface Mensagem {
  role: 'user' | 'assistant'
  content: string
}

const HISTORICO_MAX_MSGS = 20
const HISTORICO_TTL_S    = 86400 * 3  // 3 dias

export type CanalAtendimento = 'whatsapp' | 'instagram'

/** Chave conceitual workspace:canal:cliente:tipo:versao — isola por canal,
 * cliente e workspace, e nunca colide entre "5511999999999" (WhatsApp) e
 * um canal_id numérico do Instagram que coincida por acaso.
 * Exportada só para teste de isolamento de estado (ver sdr.test.ts). */
export function chaveBase(canal: CanalAtendimento, clienteId: string, tipo: 'estado' | 'historico'): string {
  return `${WORKSPACE_ID}:${canal}:${clienteId}:${tipo}:v${ESTADO_VERSAO}`
}

// Chaves do formato anterior (sdr:hist:<numero> / sdr:estado:<chave>, onde
// <chave> era "ig:<canalId>" para Instagram) — lidas uma única vez como
// fallback para não perder conversas em andamento na troca de esquema.
function chaveLegado(canal: CanalAtendimento, clienteId: string, tipo: 'estado' | 'historico'): string {
  const idLegado = canal === 'instagram' ? `ig:${clienteId}` : clienteId
  return tipo === 'historico' ? `sdr:hist:${idLegado}` : `sdr:estado:${idLegado}`
}

async function carregarHistorico(canal: CanalAtendimento, clienteId: string): Promise<Mensagem[]> {
  try {
    const redis = getRedis()
    const raw = await redis.get(chaveBase(canal, clienteId, 'historico'))
    if (raw) return JSON.parse(raw)

    // Fallback: formato legado (uma leitura só, sem migração de dado além disso)
    const legado = await redis.get(chaveLegado(canal, clienteId, 'historico'))
    if (legado) return JSON.parse(legado)

    return []
  } catch (err) {
    // Redis indisponível ou dado corrompido — degrada para conversa nova em
    // vez de deixar a mensagem do cliente sem resposta alguma.
    console.error(`[SDR] Falha ao carregar histórico (${canal}:${clienteId}):`, err)
    return []
  }
}

async function salvarHistorico(canal: CanalAtendimento, clienteId: string, historico: Mensagem[]): Promise<void> {
  try {
    const redis = getRedis()
    const recente = historico.slice(-HISTORICO_MAX_MSGS)
    await redis.setex(chaveBase(canal, clienteId, 'historico'), HISTORICO_TTL_S, JSON.stringify(recente))
  } catch (err) {
    console.error(`[SDR] Falha ao salvar histórico (${canal}:${clienteId}):`, err)
  }
}

// ── Estado do funil (fase + dados coletados) — ver lib/funil.ts ─────────────
// Persistido separado do histórico de mensagens para não misturar o
// controle de etapas com o conteúdo da conversa.

async function carregarEstadoFunil(canal: CanalAtendimento, clienteId: string): Promise<EstadoConversa> {
  try {
    const redis = getRedis()
    const raw = await redis.get(chaveBase(canal, clienteId, 'estado'))
    if (raw) return JSON.parse(raw)

    const legado = await redis.get(chaveLegado(canal, clienteId, 'estado'))
    if (legado) return JSON.parse(legado)

    return estadoInicial()
  } catch (err) {
    console.error(`[SDR] Falha ao carregar estado do funil (${canal}:${clienteId}) — reiniciando conversa:`, err)
    return estadoInicial()
  }
}

async function salvarEstadoFunil(canal: CanalAtendimento, clienteId: string, estado: EstadoConversa): Promise<void> {
  try {
    const redis = getRedis()
    await redis.setex(chaveBase(canal, clienteId, 'estado'), HISTORICO_TTL_S, JSON.stringify(estado))
  } catch (err) {
    console.error(`[SDR] Falha ao salvar estado do funil (${canal}:${clienteId}):`, err)
  }
}

// ── Catálogo real → ProdutoCatalogo (nunca inventado, sempre rastreável) ───

async function buscarCatalogoParaFunil(params: {
  query: string
  occasion?: string
  budget?: number
  color?: string
}): Promise<ProdutoCatalogo[]> {
  const produtos = await searchLiveProductsFromSite({ ...params, limit: 3 })
  // O catálogo ao vivo já filtra por status=publish (API) ou pela página
  // pública do site (scraping) — todo produto retornado está disponível.
  return produtos.map(p => ({
    nome:      p.name,
    preco:     p.price,
    descricao: p.description,
    fotoUrl:   p.image,
    disponivel: true,
    codigo:    p.id,
    url:       p.url,
    origem:    p.origem,
  }))
}

async function buscarCategoriasParaFunil(): Promise<{ id: string; nome: string }[]> {
  const categorias = await listCategoriesFromSite()
  return categorias.map(c => ({ id: c.id, nome: c.name }))
}

async function buscarProdutosPorCategoriaParaFunil(categoriaId: string): Promise<ProdutoCatalogo[]> {
  const produtos = await fetchProductsByCategoryFromSite(categoriaId)
  return produtos.map(p => ({
    nome: p.name,
    preco: p.price,
    descricao: p.description,
    fotoUrl: p.image,
    disponivel: true,
    codigo: p.id,
    url: p.url,
    origem: p.origem,
  }))
}

// ── Dependências reais do funil (frete, pagamento, pedido) — ver seção 3 ───
// dos adaptadores em lib/frete.ts, lib/pagamento.ts e lib/pedido.ts.

/** Formas de pagamento realmente habilitadas agora — checa a mesma
 * configuração que lib/cielo.ts usa de verdade pra gerar o link (nunca
 * inventa Pix/cartão/dinheiro sem uma integração real configurada). */
async function buscarFormasPagamentoReal(): Promise<string[]> {
  const configurado = !!process.env.CIELO_CLIENT_ID && !!process.env.CIELO_CLIENT_SECRET
  return configurado ? ['Pix', 'cartão de crédito', 'cartão de débito'] : []
}

function construirDependenciasFunil(opts: {
  estado: EstadoConversa
  cliente: { nome: string; telefone?: string; canal: CanalAtendimento; canalId?: string }
}): DependenciasFunil {
  const valorProduto = opts.estado.dados.produto?.preco ?? 0
  return {
    buscarCatalogo: buscarCatalogoParaFunil,
    buscarCategorias: buscarCategoriasParaFunil,
    buscarProdutosPorCategoria: buscarProdutosPorCategoriaParaFunil,
    revalidarProduto: revalidateProductFromSite,
    calcularFrete: (cep: string) => calcularFreteReal(cep, valorProduto),
    gerarPagamento: gerarPagamentoReal,
    criarPedido: (dados) => criarPedidoProvisorio(dados, opts.cliente),
    buscarFormasPagamento: buscarFormasPagamentoReal,
  }
}

/** Extrai o primeiro nome próprio mencionado nas mensagens do cliente — usado
 * só para atualizar o cadastro do lead, nunca para alterar fatos comerciais. */
function extrairNomeDoHistorico(historico: Mensagem[]): string | null {
  const texto = historico.filter(m => m.role === 'user').map(m => m.content).join(' ')
  const match = texto.match(/(?:me\s+chamo|meu\s+nome\s+[eé]|sou\s+[oa]?\s*|chamo\s+)([A-ZÁÉÍÓÚÂÊÎÔÛÃÕ][a-záéíóúâêîôûãõ]+)/i)
  return match?.[1] ?? null
}

// ── Processamento WhatsApp ────────────────────────────────────────────────────

export async function processarMensagemSDR(numero: string, textoCliente: string, nomeCliente?: string): Promise<void> {
  // Portão de escopo — roda ANTES de qualquer chamada de IA generativa ou
  // avanço do funil. A Flora é uma agente de vendas, não uma assistente
  // geral: assunto fora do escopo comercial, reclamação e pedido de
  // atendimento humano nunca chegam ao funil — a resposta é sempre fixa.
  let estadoFunil = await carregarEstadoFunil('whatsapp', numero)
  const intencao = classificarIntencao(textoCliente, estadoFunil.fase)

  if (intencaoInterrompeFluxo(intencao)) {
    if (intencao === 'assunto_fora_escopo') {
      await responderLead({ numero, mensagem: mensagemForaDeEscopo() })
      // Fase e dados coletados NÃO mudam — o cliente pode voltar ao fluxo
      // comercial na próxima mensagem sem perder o que já foi coletado.
      console.log(`[SDR] Assunto fora de escopo de ${numero} — redirecionado`)
      return
    }
    // reclamacao ou atendimento_humano → transferência real, com motivo e dados preservados
    await responderLead({ numero, mensagem: mensagemTransferencia() })
    estadoFunil = { ...estadoFunil, fase: 'transferido_humano', dados: { ...estadoFunil.dados, motivoTransferencia: `${intencao}: "${textoCliente}"` } }
    await salvarEstadoFunil('whatsapp', numero, estadoFunil)
    await notificarEscalada(
      randomUUID(),
      `escalada-whatsapp-${intencao}`,
      `Cliente ${numero} — ${intencao}. Última mensagem: "${textoCliente}"`
    )
    console.log(`[SDR] Transferência (${intencao}) solicitada por ${numero}`)
    return
  }

  const historico = await carregarHistorico('whatsapp', numero)
  const primeiraMensagem = historico.length === 0
  historico.push({ role: 'user', content: textoCliente })

  // Primeira mensagem sem nome conhecido: pergunta determinística, sem
  // avançar o funil ainda (mesma regra da versão anterior, sem depender do Groq).
  if (primeiraMensagem && !nomeCliente) {
    historico.push({ role: 'assistant', content: SAUDACAO_SEM_NOME })
    await salvarHistorico('whatsapp', numero, historico)
    await responderLead({ numero, mensagem: SAUDACAO_SEM_NOME })
    return
  }

  const deps = construirDependenciasFunil({
    estado: estadoFunil,
    cliente: { nome: nomeCliente ?? 'Cliente', telefone: numero, canal: 'whatsapp', canalId: numero },
  })

  const resultado = await avancarFunil(estadoFunil, textoCliente, intencao, deps)
  estadoFunil = resultado.estado
  await salvarEstadoFunil('whatsapp', numero, estadoFunil)

  const mensagemFinal = primeiraMensagem && nomeCliente ? `Oi, ${nomeCliente}! ${resultado.mensagem}` : resultado.mensagem

  if (resultado.fotoUrl) {
    const enviado = await enviarImagem({ numero, imagemUrl: resultado.fotoUrl, legenda: mensagemFinal })
    if (!enviado) {
      // Regra explícita: se o envio de mídia falhar definitivamente, não
      // finge que funcionou — encaminha para atendimento humano.
      await responderLead({ numero, mensagem: mensagemTransferencia() })
      await notificarEscalada(randomUUID(), 'falha-envio-foto-whatsapp', `Falha ao enviar foto de produto para ${numero}`)
    }
  } else {
    await responderLead({ numero, mensagem: mensagemFinal })
  }

  historico.push({ role: 'assistant', content: mensagemFinal })
  await salvarHistorico('whatsapp', numero, historico)

  const nomeDetectado = extrairNomeDoHistorico(historico)
  if (nomeDetectado) {
    await getSupabase().from('leads').update({ nome: nomeDetectado }).eq('telefone', numero)
  }

  console.log(`[SDR] Respondido ${numero}: ${mensagemFinal.substring(0, 80)}...`)
}

const SYSTEM_COMENTARIO = `Você é ${AGENT_NAME}, assistente da Enemeop Flores (floricultura em SP desde 1997).
Alguém comentou em uma publicação nossa. Responda de forma curta, calorosa e pública (máx 2 linhas).
Nunca peça dados pessoais — convide para o WhatsApp: ${WHATSAPP_LINK}
Tom: informal, direto, sem emojis excessivos.`

export async function processarComentarioSDR(
  canal: 'instagram' | 'facebook',
  commentId: string,
  textoComentario: string,
  nomeUsuario?: string
): Promise<void> {
  console.log(`[SDR/${canal}] Comentário de ${nomeUsuario ?? 'desconhecido'}: ${textoComentario.substring(0, 80)}`)

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: SYSTEM_COMENTARIO },
        { role: 'user', content: nomeUsuario ? `${nomeUsuario} comentou: "${textoComentario}"` : `Comentário: "${textoComentario}"` },
      ],
      temperature: 0.7,
      max_tokens: 150,
    })

    const resposta = response.choices[0]?.message?.content ?? `Obrigada pelo comentário! Fale com a gente no WhatsApp: ${WHATSAPP_LINK}`

    if (canal === 'instagram') {
      await responderComentarioInstagram(commentId, resposta)
    } else {
      await responderComentarioFacebook(commentId, resposta)
    }

    console.log(`[SDR/${canal}/Comentário] Respondido: ${resposta.substring(0, 80)}`)
  } catch (e) {
    console.error(`[SDR/${canal}/Comentário] Erro:`, e)
  }
}

export async function processarMensagemSDRInstagram(
  canalId: string,
  textoCliente: string,
  opts?: { leadId?: string; nomeExibido?: string }
): Promise<void> {
  // Portão de escopo — mesma regra do WhatsApp (ver processarMensagemSDR).
  let estadoFunil = await carregarEstadoFunil('instagram', canalId)
  const intencao = classificarIntencao(textoCliente, estadoFunil.fase)

  if (intencaoInterrompeFluxo(intencao)) {
    if (intencao === 'assunto_fora_escopo') {
      await responderInstagram(canalId, mensagemForaDeEscopo())
      console.log(`[SDR/Instagram] Assunto fora de escopo de ${canalId} — redirecionado`)
      return
    }
    await responderInstagram(canalId, mensagemTransferencia())
    estadoFunil = { ...estadoFunil, fase: 'transferido_humano', dados: { ...estadoFunil.dados, motivoTransferencia: `${intencao}: "${textoCliente}"` } }
    await salvarEstadoFunil('instagram', canalId, estadoFunil)
    await notificarEscalada(
      randomUUID(),
      `escalada-instagram-${intencao}`,
      `Cliente Instagram (${canalId}) — ${intencao}. Última mensagem: "${textoCliente}"`
    )
    console.log(`[SDR/Instagram] Transferência (${intencao}) solicitada por ${canalId}`)
    return
  }

  const historico = await carregarHistorico('instagram', canalId)
  const primeiraMensagem = historico.length === 0
  historico.push({ role: 'user', content: textoCliente })

  const nomeConhecido = opts?.nomeExibido ?? null
  if (primeiraMensagem && !nomeConhecido) {
    historico.push({ role: 'assistant', content: SAUDACAO_SEM_NOME })
    await salvarHistorico('instagram', canalId, historico)
    await responderInstagram(canalId, SAUDACAO_SEM_NOME)
    return
  }

  const deps = construirDependenciasFunil({
    estado: estadoFunil,
    cliente: { nome: nomeConhecido ?? 'Cliente', canal: 'instagram', canalId },
  })

  const resultado = await avancarFunil(estadoFunil, textoCliente, intencao, deps)
  estadoFunil = resultado.estado
  await salvarEstadoFunil('instagram', canalId, estadoFunil)

  const mensagemFinal = primeiraMensagem && nomeConhecido ? `Oi, ${nomeConhecido}! ${resultado.mensagem}` : resultado.mensagem

  if (resultado.fotoUrl) {
    const enviado = await responderInstagramComFoto(canalId, resultado.fotoUrl)
    if (enviado) {
      await responderInstagram(canalId, mensagemFinal)
    } else {
      await responderInstagram(canalId, mensagemTransferencia())
      await notificarEscalada(randomUUID(), 'falha-envio-foto-instagram', `Falha ao enviar foto de produto para ${canalId}`)
    }
  } else {
    await responderInstagram(canalId, mensagemFinal)
  }

  historico.push({ role: 'assistant', content: mensagemFinal })
  await salvarHistorico('instagram', canalId, historico)

  const nomeDetectado = extrairNomeDoHistorico(historico) ?? opts?.nomeExibido ?? null

  // Salva conversa no Supabase para o Monitor Social
  if (opts?.leadId) {
    await salvarConversa({
      leadId: opts.leadId,
      canalId,
      canal: 'instagram',
      historico,
      fase: estadoFunil.fase,
      intencao,
      nomeExibido: nomeDetectado ?? undefined,
    })
    if (nomeDetectado) {
      await getSupabase().from('leads').update({ nome: nomeDetectado, nome_exibido: nomeDetectado }).eq('id', opts.leadId)
    }
  }

  console.log(`[SDR/Instagram] Respondido ${canalId}: ${mensagemFinal.substring(0, 80)}...`)
}
