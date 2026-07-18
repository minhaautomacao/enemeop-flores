/**
 * funil.ts — Restrição de escopo, classificação de intenção e funil de
 * vendas da Flora (agente comercial da Enemeop Flores).
 *
 * A Flora não é uma assistente geral. Toda mensagem passa primeiro pelo
 * classificador de intenção; assuntos fora do escopo comercial e pedidos
 * de atendimento humano/reclamação são interceptados ANTES de qualquer
 * chamada de IA generativa — a resposta nesses casos é sempre fixa e
 * determinística, não gerada por LLM (não pode "improvisar").
 *
 * Todo este módulo é puro/injetável (sem chamada de rede direta) para
 * ser testável localmente sem depender de Groq, Meta, WhatsApp, Redis,
 * Supabase ou dos agentes de logística/financeiro reais.
 */

// ── Fases do funil ────────────────────────────────────────────────────────

export type Fase =
  | 'inicio'
  | 'qualificacao'
  | 'escolha_categoria'
  | 'catalogo_completo'
  | 'recomendacao'
  | 'produto_selecionado'
  | 'aguardando_endereco'
  | 'calculando_frete'
  | 'aguardando_confirmacao'
  | 'aguardando_pagamento'
  | 'pagamento_confirmado'
  | 'pedido_criado'
  | 'transferido_humano'
  | 'encerrado_sem_venda'

export type Intencao =
  | 'compra_produto'
  | 'recomendacao'
  | 'disponibilidade'
  | 'foto_produto'
  | 'frete'
  | 'pagamento'
  | 'status_pedido'
  | 'pos_venda'
  | 'reclamacao'
  | 'assunto_fora_escopo'
  | 'atendimento_humano'

// ── Dados coletados durante a conversa ───────────────────────────────────

export interface ProdutoSelecionado {
  nome: string
  preco?: number
  /** Código comercial — o que a produção usa pra montar o arranjo. Nunca o ID do WooCommerce. */
  codigo?: string
  /** ID do WooCommerce — identificador técnico interno, usado só pra revalidar preço/estoque/nome/foto na fonte. */
  idExterno?: string
  url?: string
  origem?: string
  fotoUrl?: string
  quantidade?: number
  tamanho?: string
  cor?: string
  mensagemCartao?: string
  dataEntrega?: string
}

export interface EnderecoEntrega {
  cep: string
  rua?: string
  numero?: string
  complemento?: string
  bairro?: string
  cidade?: string
  referencia?: string
  nomeDestinatario?: string
  telefoneDestinatario?: string
}

export interface DadosPedido {
  ocasiao?: string
  destinatario?: string
  orcamento?: number
  dataEntrega?: string
  bairroOuCep?: string
  corPreferida?: string
  produto?: ProdutoSelecionado
  endereco?: EnderecoEntrega
  valorFrete?: number
  valorTotal?: number
  linkPagamento?: string
  paymentId?: string
  pagamentoConfirmado?: boolean
  pedidoId?: string
  motivoTransferencia?: string
  /** Últimas opções apresentadas — usado para detectar a escolha do cliente na próxima mensagem. */
  opcoesRecomendadas?: ProdutoCatalogo[]
  /** true assim que as opções acima foram apresentadas — impede reapresentar
   * o catálogo enquanto o cliente ainda não escolheu (ver etapaRecomendacao). */
  recomendacaoApresentada?: boolean
  /** Categoria real (WooCommerce) escolhida pelo cliente para a recomendação atual. */
  categoriaEscolhida?: { id: string; nome: string }
  /** IDs das categorias já apresentadas nesta conversa — nunca reapresentadas do zero. */
  categoriasApresentadas?: string[]
  /** Códigos de produtos já apresentados nesta conversa (recomendação normal + catálogo completo) — nunca repetidos. */
  produtosApresentadosCodigos?: string[]
  /** Cursor de paginação do "catálogo completo": índice da categoria atual. */
  catalogoCompletoIndiceCategoria?: number
  /** true quando o cliente já confirmou o resumo do pedido nesta troca. */
  resumoConfirmado?: boolean
}

export interface EstadoConversa {
  fase: Fase
  dados: DadosPedido
  perguntasFeitas: string[]
}

export function estadoInicial(): EstadoConversa {
  return { fase: 'inicio', dados: {}, perguntasFeitas: [] }
}

// ── Classificador de intenção (determinístico, sem LLM) ──────────────────
//
// Uma regra de negócio como "nunca sair do escopo comercial" não pode
// depender de um modelo de linguagem "se lembrar" de seguir a instrução —
// por isso o gate é uma checagem determinística de palavras-chave, testável
// sem rede, que roda ANTES de qualquer chamada de IA generativa.

const PALAVRAS_ATENDIMENTO_HUMANO = [
  'falar com pessoa', 'falar com humano', 'atendente', 'atendimento humano',
  'quero falar com alguem', 'fala comigo', 'falar com uma pessoa',
  'falar com um humano', 'falar com uma humana', 'quero uma pessoa',
  'assistente pessoal', 'gerente', 'responsavel',
  'proprietario', 'dono', 'falar com carlos',
]

const PALAVRAS_RECLAMACAO = [
  'reclamacao', 'reclamar', 'insatisfeit', 'pessimo',
  'terrivel', 'veio errado', 'pedido errado', 'cancelar',
  'cancelamento', 'nao chegou', 'esta atrasado',
  'chegou atrasado', 'chegou quebrado', 'quebrado', 'estragado', 'decepcionad',
  'muito ruim', 'horrivel', 'nao gostei',
]

const PALAVRAS_FORA_ESCOPO = [
  'politica', 'eleicao', 'presidente do brasil',
  'governo', 'religiao', 'deus existe', 'igreja', 'biblia',
  'noticia', 'futebol', 'campeonato', 'novela', 'musica', 'filme', 'serie',
  'seu conselho', 'me da um conselho',
  'o que voce acha de', 'sua opiniao sobre',
  'me ajuda com meu trabalho', 'programacao',
  'escreva um codigo', 'receita de bolo',
  'conta uma piada', 'horoscopo', 'previsao do tempo',
]

// Sinais de que a mensagem tem intenção comercial clara — usados para não
// deixar uma palavra fora de escopo, dita de passagem, interromper uma
// venda em andamento (ver classificarIntencao).
const SINAIS_COMERCIAIS = [
  'flor', 'flores', 'buque', 'arranjo', 'ramalhete', 'orquidea', 'presente',
  'comprar', 'quero', 'preciso', 'gostaria', 'preco', 'valor', 'orcamento',
  'entrega', 'pedido', 'cotacao', 'cor', 'quanto custa',
]

const PALAVRAS_FOTO = [
  'foto', 'fotos', 'imagem', 'imagens', 'manda uma foto', 'me mostra',
  'consigo ver', 'tem foto',
]

const PALAVRAS_FRETE = [
  'frete', 'taxa de entrega', 'quanto custa a entrega', 'valor da entrega',
  'chega quando', 'prazo de entrega',
]

const PALAVRAS_PAGAMENTO = [
  'pagamento', 'pagar', 'pix', 'cartao', 'link de pagamento',
  'como eu pago', 'como pago', 'forma de pagamento',
]

const PALAVRAS_STATUS_PEDIDO = [
  'status do meu pedido', 'status do pedido', 'meu pedido ja saiu',
  'onde esta meu pedido',
  'ja foi entregue', 'rastrear pedido',
  'codigo do pedido',
]

const PALAVRAS_DISPONIBILIDADE = [
  'tem disponivel', 'tem em estoque', 'ainda tem',
  'esta disponivel',
]

/** Remove acentos e normaliza para minúsculas — evita que "reclamação" x
 * "reclamacao" ou "está" x "esta" sejam tratados como palavras diferentes. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Distância de edição (Levenshtein), limitada — usada só para tolerar
 * pequenos erros de digitação em palavras-chave de uma palavra só. */
function distanciaEdicao(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

/** Verifica se a mensagem contém a palavra/frase, com tolerância a erro de
 * digitação de até 1 caractere para palavras-chave de uma única palavra
 * (frases de múltiplas palavras usam apenas correspondência exata, já
 * normalizada). */
function contemAlguma(mensagem: string, palavras: string[]): boolean {
  const lower = normalizar(mensagem)
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean)
  return palavras.some(p => {
    const pNorm = normalizar(p)
    if (lower.includes(pNorm)) return true
    // Tolerância a digitação: só para palavras-chave de um único token e
    // com tamanho suficiente para não gerar falso positivo.
    if (!pNorm.includes(' ') && pNorm.length >= 5) {
      return tokens.some(t => t.length >= 4 && distanciaEdicao(t, pNorm) <= 1)
    }
    return false
  })
}

function contemSinalComercial(mensagem: string): boolean {
  return contemAlguma(mensagem, SINAIS_COMERCIAIS)
}

const FASES_COMPRA_EM_ANDAMENTO: Fase[] = [
  'produto_selecionado', 'aguardando_endereco', 'calculando_frete',
  'aguardando_confirmacao', 'aguardando_pagamento',
]

// Saudação "pura": a mensagem inteira (sem outro conteúdo) é só um
// cumprimento — usada para detectar que o cliente voltou depois de um
// intervalo sem trazer informação nova, e portanto a resposta deve retomar
// o contexto real em vez de tratar como mensagem nova.
const REGEX_SAUDACAO_SIMPLES = /^(oi+|ola|bom\s?dia|boa\s?tarde|boa\s?noite|e\s?ai|eae+|opa|hey)[\s!?.,]*$/

export function pareceSaudacaoSimples(mensagem: string): boolean {
  return REGEX_SAUDACAO_SIMPLES.test(normalizar(mensagem))
}

// Pergunta direta de disponibilidade por nome de produto — "tem girassol?",
// "vocês tem lírios pra hoje", "tem rosas aí?". Diferente de
// PALAVRAS_DISPONIBILIDADE (frases fixas genéricas): aqui extraímos o termo
// do produto perguntado, pra consultar o catálogo real por ele — nunca cai
// no fallback de "compra_produto"/fase antiga.
const REGEX_PERGUNTA_DISPONIBILIDADE = /^(?:voces?\s+)?tem\s+(.+?)\s*(?:pra\s?hoje|para\s?hoje|hoje|a[íi]|dispon[íi]vel)?[\s?.!]*$/

export function extrairTermoDisponibilidade(mensagem: string): string | null {
  const m = normalizar(mensagem).match(REGEX_PERGUNTA_DISPONIBILIDADE)
  const termo = m?.[1]?.trim()
  return termo && termo.length > 1 ? termo : null
}

/**
 * Classifica a intenção da mensagem. A ordem importa: escalonamento
 * (atendimento humano / reclamação) é checado antes de qualquer intenção
 * comercial, porque deve interromper o fluxo normal independente da fase
 * atual da conversa. Assunto fora de escopo também interrompe — exceto
 * quando a própria mensagem carrega um sinal comercial claro (ex.: "quero
 * flores e também queria saber sobre futebol") ou a conversa já está no
 * meio de uma compra: nesses casos a venda tem prioridade e a parte fora
 * de escopo é simplesmente ignorada.
 */
export function classificarIntencao(mensagem: string, faseAtual: Fase): Intencao {
  if (contemAlguma(mensagem, PALAVRAS_ATENDIMENTO_HUMANO)) return 'atendimento_humano'
  if (contemAlguma(mensagem, PALAVRAS_RECLAMACAO)) return 'reclamacao'

  if (contemAlguma(mensagem, PALAVRAS_FORA_ESCOPO)) {
    const emMeioDeCompra = FASES_COMPRA_EM_ANDAMENTO.includes(faseAtual)
    const sinalComercialNaMensagem = contemSinalComercial(mensagem)
    if (!emMeioDeCompra && !sinalComercialNaMensagem) return 'assunto_fora_escopo'
    // Sinal misto: ignora a parte fora de escopo e classifica pelo restante
    // da mensagem/fase, para nunca interromper uma venda válida.
  }

  if (contemAlguma(mensagem, PALAVRAS_FOTO)) return 'foto_produto'
  if (contemAlguma(mensagem, PALAVRAS_STATUS_PEDIDO)) return 'status_pedido'
  if (contemAlguma(mensagem, PALAVRAS_FRETE)) return 'frete'
  if (contemAlguma(mensagem, PALAVRAS_PAGAMENTO)) return 'pagamento'
  if (contemAlguma(mensagem, PALAVRAS_DISPONIBILIDADE) || extrairTermoDisponibilidade(mensagem)) return 'disponibilidade'
  if (
    faseAtual === 'inicio' || faseAtual === 'qualificacao' || faseAtual === 'recomendacao' ||
    faseAtual === 'escolha_categoria' || faseAtual === 'catalogo_completo'
  ) {
    return 'recomendacao'
  }
  return 'compra_produto'
}

export function intencaoInterrompeFluxo(intencao: Intencao): boolean {
  return intencao === 'assunto_fora_escopo' || intencao === 'reclamacao' || intencao === 'atendimento_humano'
}

// ── Mensagens fixas (nunca geradas por LLM) ──────────────────────────────

export function mensagemForaDeEscopo(): string {
  return 'Posso te ajudar com flores, presentes, pedidos e entregas da Enemeop Flores. Para outros assuntos, fale com nossa equipe pelo WhatsApp final 9083.'
}

export function mensagemTransferencia(): string {
  return 'Vou te transferir para nossa equipe! Pode continuar por aqui mesmo.'
}

/**
 * Só para quando uma limitação técnica real impede continuar no canal atual
 * (ex.: falha ao enviar mídia pela API do Instagram/Facebook) — nunca como
 * oferta padrão de handoff. Sempre com link clicável, nunca só "final 9083".
 */
export function mensagemTransferenciaLimitacaoTecnica(): string {
  return 'No momento não consigo continuar por aqui devido a uma limitação técnica. Fale com nossa equipe pelo WhatsApp oficial: https://wa.me/5511982829083'
}

export function mensagemFinalizacao(): string {
  return 'Pagamento confirmado. Seu pedido foi registrado e será preparado para entrega. Qualquer atualização será enviada por aqui.'
}

/**
 * Retomada de contexto — cliente voltou só com uma saudação enquanto havia
 * um pedido em andamento. Cita apenas fatos presentes em `dados` (nunca
 * inventa produto/endereço/pagamento que não estejam realmente registrados)
 * e sempre termina perguntando se o cliente quer continuar. Se não houver
 * nada de concreto em `dados` (estado inconsistente), admite isso e pergunta
 * objetivamente se o cliente quer retomar ou começar um novo pedido.
 */
export function montarMensagemRetomada(fase: Fase, dados: DadosPedido): string {
  const assunto = dados.produto?.nome
    ? `o pedido do ${dados.produto.nome}`
    : (fase === 'recomendacao' || fase === 'qualificacao' || fase === 'escolha_categoria' || fase === 'catalogo_completo') ? 'a escolha do buquê' : null

  if (!assunto) {
    return 'Não encontrei um atendimento em andamento pra retomar. Quer começar um novo pedido?'
  }

  const local = [dados.endereco?.bairro, dados.endereco?.cidade].filter(Boolean).join(', ')
  const complementoLocal = local ? ` para entrega em ${local}` : ''
  const complementoPagamento = fase === 'aguardando_pagamento' ? ' — o pagamento ainda está pendente' : ''
  return `Podemos continuar de onde paramos: estávamos com ${assunto}${complementoLocal}${complementoPagamento}. Você quer seguir com essa opção?`
}

/**
 * Resposta da fase `aguardando_pagamento` — nunca afirma ter enviado um
 * link sem um link real em `dados.linkPagamento`. Se o link existe,
 * reenvia-o explicitamente em vez de só dizer "já enviei". Se não existe
 * (estado inconsistente — fase avançou sem o link ter sido persistido),
 * admite isso e oferece gerar de novo ou recomeçar.
 */
export function montarMensagemAguardandoPagamento(dados: DadosPedido): string {
  if (dados.linkPagamento) {
    return `Retomando o pagamento do seu pedido: segue novamente o link — ${dados.linkPagamento}\nAssim que identificarmos o pagamento, seu pedido é confirmado automaticamente.`
  }
  return 'Não encontrei um link de pagamento válido registrado para esse pedido. Quer que eu gere um novo link, ou prefere recomeçar o pedido?'
}

// ── Etapa 1 — Qualificação (uma pergunta por vez, sem repetir) ───────────

const CAMPOS_QUALIFICACAO: { campo: keyof DadosPedido; pergunta: string }[] = [
  { campo: 'ocasiao', pergunta: 'Pra qual ocasião é o presente?' },
  { campo: 'destinatario', pergunta: 'É pra quem? (esposa, mãe, amigo...)' },
  { campo: 'orcamento', pergunta: 'Você tem uma faixa de orçamento em mente?' },
  { campo: 'dataEntrega', pergunta: 'Pra quando você precisa da entrega?' },
  { campo: 'bairroOuCep', pergunta: 'Qual o bairro ou CEP de entrega?' },
]

/** Extrai dados de qualificação da mensagem, sem sobrescrever o que já foi coletado. */
export function extrairDadosQualificacao(mensagem: string, dadosAtuais: DadosPedido): DadosPedido {
  const lower = mensagem.toLowerCase()
  const dados: DadosPedido = { ...dadosAtuais }

  if (!dados.ocasiao) {
    if (/namorad|valentine/.test(lower)) dados.ocasiao = 'namorado'
    else if (/casament|noiv/.test(lower)) dados.ocasiao = 'casamento'
    else if (/\bmãe\b|\bmae\b|mamã|mama/.test(lower)) dados.ocasiao = 'mae'
    else if (/anivers|parabéns|parabens/.test(lower)) dados.ocasiao = 'aniversario'
    else if (/luto|faleciment|condolênc|condolenc|pêsames|pesames/.test(lower)) dados.ocasiao = 'luto'
    else if (/corporativ|escritório|escritorio/.test(lower)) dados.ocasiao = 'corporativo'
  }

  if (dados.orcamento == null) {
    const m = lower.match(/r\$\s*(\d+(?:[.,]\d+)?)|(\d+)\s*(?:reais|conto)/)
    if (m) dados.orcamento = parseFloat((m[1] ?? m[2]).replace(',', '.'))
  }

  if (!dados.bairroOuCep) {
    const cepMatch = mensagem.match(/\d{5}-?\d{3}/)
    if (cepMatch) dados.bairroOuCep = cepMatch[0]
  }

  if (!dados.corPreferida) {
    const cores = ['branca', 'branco', 'vermelha', 'vermelho', 'rosa', 'pink', 'amarela', 'amarelo', 'lilás', 'lilas']
    const cor = cores.find(c => lower.includes(c))
    if (cor) dados.corPreferida = cor
  }

  if (!dados.destinatario) {
    const dest = ['esposa', 'marido', 'namorada', 'namorado', 'mãe', 'mae', 'pai', 'amiga', 'amigo', 'avó', 'avo', 'irmã', 'irma']
    const found = dest.find(d => lower.includes(d))
    if (found) dados.destinatario = found
  }

  return dados
}

/** Retorna a próxima pergunta de qualificação a fazer, ou null se já há dados suficientes. Nunca repete uma pergunta já feita. */
export function proximaPerguntaQualificacao(dados: DadosPedido, perguntasFeitas: string[]): { campo: string; pergunta: string } | null {
  for (const { campo, pergunta } of CAMPOS_QUALIFICACAO) {
    if (dados[campo] == null && !perguntasFeitas.includes(campo)) {
      return { campo, pergunta }
    }
  }
  return null
}

// ── Etapa 2 — Recomendação (catálogo real, máx. 3 opções) ────────────────

export interface ProdutoCatalogo {
  nome: string
  preco?: number
  descricao?: string
  fotoUrl?: string
  disponivel: boolean
  /** Código comercial — o que a produção usa pra montar o arranjo (nunca o ID do WooCommerce, nunca inventado). */
  codigo?: string
  /** ID do WooCommerce — identificador técnico interno, usado pra revalidar preço/estoque/nome/foto direto na fonte. */
  idExterno?: string
  /** URL real do produto no site — nunca inventada. */
  url?: string
  /** De onde este produto veio (ex.: "woocommerce_api", "scraping_fallback"). */
  origem?: string
}

export interface Recomendacao {
  principal: ProdutoCatalogo | null
  alternativas: ProdutoCatalogo[]
}

/** Nunca inventa produto: só considera o que veio do catálogo real (produtos já injetados pelo chamador). Limita a 3 no total (1 principal + até 2 alternativas). */
export function selecionarRecomendacoes(produtosDoCatalogo: ProdutoCatalogo[]): Recomendacao {
  const disponiveis = produtosDoCatalogo.filter(p => p.disponivel)
  if (disponiveis.length === 0) return { principal: null, alternativas: [] }
  const [principal, ...resto] = disponiveis
  return { principal, alternativas: resto.slice(0, 2) }
}

function formatarPreco(preco?: number): string {
  return preco != null ? `R$ ${preco.toFixed(2).replace('.', ',')}` : 'consultar'
}

export function montarMensagemRecomendacao(rec: Recomendacao, ocasiao?: string): string {
  if (!rec.principal) {
    return 'No momento não encontrei opções disponíveis para o que você pediu. Me conta melhor o que você tem em mente (cor, estilo, ocasião) que eu vejo outras alternativas.'
  }
  const p = rec.principal
  let msg = `Para ${ocasiao ?? 'essa ocasião'}, recomendo o ${p.nome}${p.descricao ? ` — ${p.descricao}` : ''}. Está disponível por ${formatarPreco(p.preco)}.${p.url ? ` Link: ${p.url}` : ''}`
  if (rec.alternativas.length > 0) {
    const alts = rec.alternativas.map(a => `${a.nome} (${formatarPreco(a.preco)})`).join(', ')
    msg += ` Também tenho estas opções: ${alts}.`
  }
  return msg
}

// ── Etapa 3 — Envio de foto real ──────────────────────────────────────────

export interface RespostaFoto {
  mensagem: string
  fotoUrl: string | null
}

/** Nunca afirma ter enviado foto sem uma URL real — se o produto não tem foto, oferece alternativa em vez de inventar uma URL. */
export function responderPedidoDeFoto(produto: ProdutoCatalogo | undefined): RespostaFoto {
  if (!produto) {
    return { mensagem: 'Qual produto você quer ver a foto?', fotoUrl: null }
  }
  if (produto.fotoUrl) {
    return { mensagem: `Aqui está a foto do ${produto.nome}:`, fotoUrl: produto.fotoUrl }
  }
  return {
    mensagem: `Ainda não tenho uma foto do ${produto.nome} aqui, mas posso te mostrar outra opção com foto disponível.`,
    fotoUrl: null,
  }
}

// ── Etapa 4 — Confirmação do produto ──────────────────────────────────────

export function produtoTemDadosMinimos(produto?: ProdutoSelecionado): boolean {
  if (!produto) return false
  return !!(produto.nome && produto.quantidade && produto.dataEntrega)
}

// ── Etapa 5 — Frete (nunca estimado — vem do agente logístico ou falha) ──

export type ResultadoFrete = { ok: true; valor: number } | { ok: false }
export type CalculadorFrete = (cep: string) => Promise<ResultadoFrete>

export interface RespostaFrete {
  mensagem: string
  valor: number | null
  falhou: boolean
}

export async function calcularFreteEtapa(cep: string, calcular: CalculadorFrete): Promise<RespostaFrete> {
  const resultado = await calcular(cep)
  if (!resultado.ok) {
    return { mensagem: mensagemTransferencia(), valor: null, falhou: true }
  }
  return {
    mensagem: `O frete para ${cep} fica em ${formatarPreco(resultado.valor)}.`,
    valor: resultado.valor,
    falhou: false,
  }
}

// ── Etapa 6 — Resumo do pedido ────────────────────────────────────────────

export function montarResumoPedido(dados: DadosPedido): string {
  const p = dados.produto
  const linhas = [
    'Resumo do seu pedido:',
    p ? `- Produto: ${p.nome}${p.quantidade ? ` x${p.quantidade}` : ''}${p.tamanho ? ` (${p.tamanho})` : ''}${p.cor ? ` — cor ${p.cor}` : ''}` : null,
    p?.preco != null ? `- Valor do produto: ${formatarPreco(p.preco)}` : null,
    dados.valorFrete != null ? `- Frete: ${formatarPreco(dados.valorFrete)}` : null,
    dados.valorTotal != null ? `- Total: ${formatarPreco(dados.valorTotal)}` : null,
    dados.endereco ? `- Entrega: ${[dados.endereco.rua, dados.endereco.numero, dados.endereco.bairro, dados.endereco.cidade].filter(Boolean).join(', ')}` : null,
    p?.dataEntrega ? `- Data: ${p.dataEntrega}` : null,
    dados.endereco?.nomeDestinatario ? `- Destinatário: ${dados.endereco.nomeDestinatario}` : null,
    p?.mensagemCartao ? `- Mensagem do cartão: "${p.mensagemCartao}"` : null,
    '',
    'Posso confirmar e gerar o pagamento?',
  ].filter((l): l is string => l !== null)
  return linhas.join('\n')
}

// ── Etapa 7 — Pagamento (só depois de resumo confirmado) ──────────────────

export type GeradorPagamento = (valorTotal: number) => Promise<{ link: string; paymentId: string } | null>

export interface RespostaPagamento {
  mensagem: string
  link: string | null
  paymentId: string | null
}

export async function gerarPagamentoEtapa(dados: DadosPedido, gerar: GeradorPagamento): Promise<RespostaPagamento> {
  if (dados.valorTotal == null) {
    throw new Error('gerarPagamentoEtapa: valorTotal ausente — nao deve gerar link antes de confirmar produto, entrega e valor total')
  }
  const resultado = await gerar(dados.valorTotal)
  if (!resultado) {
    return { mensagem: mensagemTransferencia(), link: null, paymentId: null }
  }
  return {
    mensagem: `Segue o link de pagamento: ${resultado.link}\nO pagamento é processado no ambiente seguro do Mercado Pago. O link fica válido por algumas horas.`,
    link: resultado.link,
    paymentId: resultado.paymentId,
  }
}

// ── Etapa 8 — Confirmação de pagamento (só via provedor, nunca por texto do cliente) ──

/**
 * Só o provedor de pagamento (webhook do Cielo/Mercado Pago) pode confirmar
 * um pagamento — o texto do cliente dizendo "já paguei" nunca é suficiente.
 * Lança erro se o paymentId não corresponder ao pedido em andamento.
 */
export function confirmarPagamento(estado: EstadoConversa, paymentIdConfirmadoPeloProvedor: string): EstadoConversa {
  if (!estado.dados.paymentId || estado.dados.paymentId !== paymentIdConfirmadoPeloProvedor) {
    throw new Error('confirmarPagamento: paymentId nao corresponde ao pedido em andamento — confirmacao rejeitada')
  }
  return {
    ...estado,
    fase: 'pagamento_confirmado',
    dados: { ...estado.dados, pagamentoConfirmado: true },
  }
}

// ── Etapa 9 — Criação do pedido (só depois de pagamento_confirmado) ──────

export type CriadorPedido = (dados: DadosPedido) => Promise<{ pedidoId: string } | null>

export async function criarPedidoEtapa(estado: EstadoConversa, criar: CriadorPedido): Promise<EstadoConversa> {
  if (estado.fase !== 'pagamento_confirmado') {
    throw new Error('criarPedidoEtapa: pedido so pode ser criado depois da fase pagamento_confirmado')
  }
  const resultado = await criar(estado.dados)
  if (!resultado) {
    throw new Error('criarPedidoEtapa: falha ao criar pedido')
  }
  return { ...estado, fase: 'pedido_criado', dados: { ...estado.dados, pedidoId: resultado.pedidoId } }
}

// ── Transferência para humano (reclamação / atendimento_humano / falha) ──

export function transferirParaHumano(estado: EstadoConversa, motivo: string): EstadoConversa {
  return {
    ...estado,
    fase: 'transferido_humano',
    dados: { ...estado.dados, motivoTransferencia: motivo },
  }
}

// ── Anti-repetição ─────────────────────────────────────────────────────────

export function jaPerguntado(campo: string, perguntasFeitas: string[]): boolean {
  return perguntasFeitas.includes(campo)
}

export function registrarPergunta(campo: string, perguntasFeitas: string[]): string[] {
  return jaPerguntado(campo, perguntasFeitas) ? perguntasFeitas : [...perguntasFeitas, campo]
}

// ── Dispatcher — avança o funil uma etapa por mensagem ────────────────────
//
// Função pura: recebe o estado atual + a mensagem do cliente + dependências
// injetadas (catálogo, frete, pagamento, pedido) e devolve o novo estado +
// a mensagem a enviar. Nenhuma chamada de rede acontece aqui — quem chama
// (sdr.ts) fornece as implementações reais. Isso permite testar o funil
// inteiro localmente com dependências fake.

export interface DependenciasFunil {
  buscarCatalogo: (params: { query: string; occasion?: string; budget?: number; color?: string }) => Promise<ProdutoCatalogo[]>
  /** Categorias reais e não vazias da loja agora — nunca uma lista fixa. */
  buscarCategorias: () => Promise<CategoriaCatalogo[]>
  /** Produtos publicados/disponíveis/com preço e foto reais de UMA categoria, ao vivo. */
  buscarProdutosPorCategoria: (categoriaId: string) => Promise<ProdutoCatalogo[]>
  /** Revalida preço/estoque/nome/foto de um produto direto na fonte pelo ID técnico (idExterno) — nunca pelo código comercial, que pode ser duplicado. Sempre chamado antes de criar o pedido. */
  revalidarProduto: (idExterno: string) => Promise<{ disponivel: boolean; preco?: number; fotoUrl?: string; nome?: string } | null>
  calcularFrete: CalculadorFrete
  /** Recebe o pedido já criado (pedidoId) e o valor total, devolve link + identificador de pagamento. */
  gerarPagamento: (pedidoId: string, valorTotal: number) => Promise<{ link: string; paymentId: string } | null>
  /** Cria o registro do pedido (rascunho, ainda sem pagamento) e devolve o id. */
  criarPedido: CriadorPedido
  /** Formas de pagamento realmente habilitadas na configuração/integração de
   * produção agora — [] quando não há como confirmar (nunca inventa Pix/
   * cartão/dinheiro sem uma fonte real por trás). */
  buscarFormasPagamento: () => Promise<string[]>
}

export interface ResultadoEtapa {
  estado: EstadoConversa
  mensagem: string
  fotoUrl?: string | null
  /** Uma foto por produto apresentado (recomendação com 2-3 opções) — cada
   * uma amarrada ao código/ID do produto real, nunca por posição. Quando
   * presente, tem prioridade sobre `fotoUrl` no envio. */
  fotos?: { codigo?: string; nome: string; url: string }[]
}

const PALAVRAS_ESCOLHA_PRIMEIRA_OPCAO = ['primeira opção', 'primeira opcao', 'a primeira', 'o primeiro', 'esse mesmo', 'esse aí', 'esse ai', 'esse mesmo aí', 'fico com esse', 'quero esse', 'vou querer esse']
const PALAVRAS_ESCOLHA_SEGUNDA_OPCAO = ['segunda opção', 'segunda opcao', 'a segunda', 'o segundo']
const PALAVRAS_ESCOLHA_TERCEIRA_OPCAO = ['terceira opção', 'terceira opcao', 'a terceira', 'o terceiro']
const PALAVRAS_CONFIRMACAO = ['sim', 'confirmo', 'confirmado', 'pode gerar', 'isso mesmo', 'pode confirmar', 'tá certo', 'ta certo', 'correto', 'perfeito']
const PALAVRAS_NEGACAO = ['não', 'nao', 'errado', 'quero mudar', 'na verdade']

/** Extrai números (inteiros ou decimais com vírgula) de um texto — usado
 * pra casar "no valor de 560" com o preço de uma opção, ou "24 rosas" com
 * um número embutido no nome de uma opção. */
function extrairNumeros(texto: string): number[] {
  return (texto.match(/\d+(?:[.,]\d+)?/g) ?? []).map(n => parseFloat(n.replace(',', '.')))
}

/**
 * Identifica qual produto já apresentado o cliente está se referindo —
 * nunca por posição fixa (índice 0): tenta, em ordem, nome completo,
 * ordinal ("a segunda"), preço mencionado ("no valor de 560"), número
 * embutido no nome ("24 rosas" -> "Buquê de 24 Rosas"), "mais barato"/
 * "mais caro", e só por último a frase ambígua de "esse mesmo" (índice 0,
 * único caso em que a posição é usada, por falta de outro sinal).
 */
function detectarProdutoEscolhido(mensagem: string, opcoes?: ProdutoCatalogo[]): ProdutoCatalogo | null {
  if (!opcoes || opcoes.length === 0) return null
  const lower = mensagem.toLowerCase()
  const normalizado = normalizar(mensagem)

  const porNome = opcoes.find(o => lower.includes(o.nome.toLowerCase()))
  if (porNome) return porNome

  // Código exato como token isolado da mensagem (ex.: "quero o código 002",
  // "manda o M08") — nunca por substring solta, pra não confundir "0" de
  // quantidade com o código "010" de outro produto.
  const tokensMensagem = lower.split(/[^a-z0-9]+/i).filter(Boolean)
  const porCodigo = opcoes.find(o => o.codigo && tokensMensagem.includes(o.codigo.toLowerCase()))
  if (porCodigo) return porCodigo

  if (PALAVRAS_ESCOLHA_SEGUNDA_OPCAO.some(p => normalizado.includes(normalizar(p))) && opcoes[1]) return opcoes[1]
  if (PALAVRAS_ESCOLHA_TERCEIRA_OPCAO.some(p => normalizado.includes(normalizar(p))) && opcoes[2]) return opcoes[2]

  const numerosMensagem = extrairNumeros(mensagem)
  if (numerosMensagem.length > 0) {
    const porPreco = opcoes.find(o => o.preco != null && numerosMensagem.some(n => Math.round(n) === Math.round(o.preco!)))
    if (porPreco) return porPreco
    const porNumeroNoNome = opcoes.find(o => extrairNumeros(o.nome).some(nn => numerosMensagem.includes(nn)))
    if (porNumeroNoNome) return porNumeroNoNome
  }

  if (/mais barat/.test(normalizado)) {
    return opcoes.reduce<ProdutoCatalogo | null>((min, o) => (o.preco != null && (min?.preco == null || o.preco < min.preco) ? o : min), null)
  }
  if (/mais car[oa]/.test(normalizado)) {
    return opcoes.reduce<ProdutoCatalogo | null>((max, o) => (o.preco != null && (max?.preco == null || o.preco > max.preco) ? o : max), null)
  }

  if (PALAVRAS_ESCOLHA_PRIMEIRA_OPCAO.some(p => lower.includes(p))) return opcoes[0]
  return null
}

function pareceConfirmacao(mensagem: string): boolean {
  const lower = mensagem.toLowerCase().trim()
  if (PALAVRAS_NEGACAO.some(p => lower.includes(p))) return false
  return PALAVRAS_CONFIRMACAO.some(p => lower === p || lower.startsWith(p + ' ') || lower.includes(` ${p} `) || lower.endsWith(` ${p}`))
}

// ── Catálogo conversacional dinâmico (categorias reais, ao vivo) ──────────

export interface CategoriaCatalogo { id: string; nome: string }

function pedeCatalogoCompleto(mensagem: string): boolean {
  const n = normalizar(mensagem)
  return /cat[aá]logo\s*(completo|inteiro|todo)|ver\s+tudo|todas?\s+as?\s+op[cç][oõ]es|todos?\s+os?\s+produtos/.test(n)
}

/** Mesma lógica de detectarProdutoEscolhido, mas para categorias (nome, posição/ordinal, número da lista). */
function detectarCategoriaEscolhida(mensagem: string, categorias?: CategoriaCatalogo[]): CategoriaCatalogo | null {
  if (!categorias || categorias.length === 0) return null
  const lower = mensagem.toLowerCase()
  const normalizado = normalizar(mensagem)

  const porNome = categorias.find(c => lower.includes(c.nome.toLowerCase()))
  if (porNome) return porNome

  if (PALAVRAS_ESCOLHA_SEGUNDA_OPCAO.some(p => normalizado.includes(normalizar(p))) && categorias[1]) return categorias[1]
  if (PALAVRAS_ESCOLHA_TERCEIRA_OPCAO.some(p => normalizado.includes(normalizar(p))) && categorias[2]) return categorias[2]

  const numeros = extrairNumeros(mensagem)
  if (numeros.length > 0) {
    const idx = Math.round(numeros[0]) - 1
    if (idx >= 0 && idx < categorias.length) return categorias[idx]
  }

  if (PALAVRAS_ESCOLHA_PRIMEIRA_OPCAO.some(p => lower.includes(p))) return categorias[0]
  return null
}

const TAMANHO_PAGINA_CATALOGO = 3

/** Entra na fase de recomendação com produtos reais de UMA categoria — nunca reaproveita fotos/produtos de outra. */
async function iniciarRecomendacaoPorCategoria(
  estado: EstadoConversa,
  categoria: CategoriaCatalogo,
  deps: DependenciasFunil,
): Promise<ResultadoEtapa> {
  const produtos = await deps.buscarProdutosPorCategoria(categoria.id)
  const rec = selecionarRecomendacoes(produtos)
  if (!rec.principal) {
    return {
      estado: { ...estado, fase: 'escolha_categoria', dados: { ...estado.dados, categoriaEscolhida: undefined } },
      mensagem: `No momento não encontrei produtos disponíveis em ${categoria.nome}. Quer ver outra categoria?`,
    }
  }
  const opcoes = [rec.principal, ...rec.alternativas]
  const jaMostrados = estado.dados.produtosApresentadosCodigos ?? []
  const novosCodigos = opcoes.filter((p): p is ProdutoCatalogo & { codigo: string } => !!p.codigo).map(p => p.codigo)
  const novoEstado: EstadoConversa = {
    ...estado,
    fase: 'recomendacao',
    dados: {
      ...estado.dados,
      categoriaEscolhida: categoria,
      opcoesRecomendadas: opcoes,
      recomendacaoApresentada: true,
      produtosApresentadosCodigos: [...new Set([...jaMostrados, ...novosCodigos])],
    },
  }
  const fotos = opcoes
    .filter((p): p is ProdutoCatalogo & { fotoUrl: string } => !!p.fotoUrl)
    .map(p => ({ codigo: p.codigo, nome: p.nome, url: p.fotoUrl }))
  return {
    estado: novoEstado,
    mensagem: `Na categoria ${categoria.nome}, encontrei:\n${montarMensagemRecomendacao(rec)}`,
    fotos: fotos.length > 0 ? fotos : undefined,
  }
}

/** Apresenta uma escolha de categorias reais (WooCommerce) adequadas ao que já se sabe da conversa. */
async function etapaEscolhaCategoria(estado: EstadoConversa, mensagemCliente: string, deps: DependenciasFunil): Promise<ResultadoEtapa> {
  const idsJaMostrados = estado.dados.categoriasApresentadas
  if (idsJaMostrados && idsJaMostrados.length > 0) {
    const todas = await deps.buscarCategorias()
    const apresentadas = todas.filter(c => idsJaMostrados.includes(c.id))
    const escolhida = detectarCategoriaEscolhida(mensagemCliente, apresentadas)
    if (escolhida) return iniciarRecomendacaoPorCategoria(estado, escolhida, deps)
    if (pedeCatalogoCompleto(mensagemCliente)) return iniciarCatalogoCompleto(estado, deps)
    // Nunca reapresenta a lista de categorias sozinha — só pergunta qual delas.
    return { estado, mensagem: 'Qual dessas categorias você prefere? Pode me dizer o nome ou o número.' }
  }

  if (pedeCatalogoCompleto(mensagemCliente)) return iniciarCatalogoCompleto(estado, deps)

  const categorias = await deps.buscarCategorias()
  if (categorias.length === 0) {
    // Sem categorias reais no momento — cai pro fluxo de busca direta por texto.
    return etapaRecomendacao({ ...estado, fase: 'recomendacao' }, mensagemCliente, deps)
  }
  const novoEstado: EstadoConversa = {
    ...estado,
    fase: 'escolha_categoria',
    dados: { ...estado.dados, categoriasApresentadas: categorias.map(c => c.id) },
  }
  const lista = categorias.map((c, i) => `${i + 1}. ${c.nome}`).join('\n')
  return {
    estado: novoEstado,
    mensagem: `Temos estas categorias:\n${lista}\n\nQual te interessa? (nome, número, ou peça "catálogo completo" pra ver tudo aos poucos)`,
  }
}

async function iniciarCatalogoCompleto(estado: EstadoConversa, deps: DependenciasFunil): Promise<ResultadoEtapa> {
  const categorias = await deps.buscarCategorias()
  if (categorias.length === 0) {
    return { estado, mensagem: 'No momento não consegui carregar o catálogo completo. Me conta o que você procura (cor, estilo, ocasião) que eu busco pra você.' }
  }
  return apresentarPaginaCatalogoCompleto(
    { ...estado, fase: 'catalogo_completo', dados: { ...estado.dados, catalogoCompletoIndiceCategoria: 0 } },
    categorias,
    deps,
  )
}

async function apresentarPaginaCatalogoCompleto(
  estado: EstadoConversa,
  categorias: CategoriaCatalogo[],
  deps: DependenciasFunil,
): Promise<ResultadoEtapa> {
  const indice = estado.dados.catalogoCompletoIndiceCategoria ?? 0
  if (indice >= categorias.length) {
    return {
      estado: { ...estado, fase: 'escolha_categoria', dados: { ...estado.dados, categoriasApresentadas: categorias.map(c => c.id) } },
      mensagem: 'Esse foi todo o nosso catálogo! Quer escolher uma dessas opções, ou prefere que eu te ajude por categoria de novo?',
    }
  }
  const categoria = categorias[indice]
  // Nunca usa um cursor numérico absoluto: os já mostrados sempre saem da
  // lista antes de fatiar, então a "página seguinte" é sempre o começo do
  // que ainda não foi apresentado — imune a mudanças no catálogo ao vivo
  // entre uma mensagem e outra.
  const jaMostrados = new Set(estado.dados.produtosApresentadosCodigos ?? [])
  const produtos = (await deps.buscarProdutosPorCategoria(categoria.id)).filter(p => p.disponivel)
  const restantes = produtos.filter(p => !p.codigo || !jaMostrados.has(p.codigo))
  const pagina = restantes.slice(0, TAMANHO_PAGINA_CATALOGO)

  if (pagina.length === 0) {
    return apresentarPaginaCatalogoCompleto(
      { ...estado, dados: { ...estado.dados, catalogoCompletoIndiceCategoria: indice + 1 } },
      categorias,
      deps,
    )
  }

  const novosCodigos = pagina.filter((p): p is ProdutoCatalogo & { codigo: string } => !!p.codigo).map(p => p.codigo)
  const temMaisNestaCategoria = restantes.length > pagina.length
  const novoEstado: EstadoConversa = {
    ...estado,
    fase: 'catalogo_completo',
    dados: {
      ...estado.dados,
      opcoesRecomendadas: pagina,
      recomendacaoApresentada: true,
      produtosApresentadosCodigos: [...jaMostrados, ...novosCodigos],
    },
  }
  const lista = pagina.map(p => `- ${p.nome} (${formatarPreco(p.preco)})`).join('\n')
  const pergunta = temMaisNestaCategoria
    ? `Quer ver mais opções de ${categoria.nome}, ou já posso passar pra outra categoria?`
    : 'Quer ver a próxima categoria?'
  const fotos = pagina
    .filter((p): p is ProdutoCatalogo & { fotoUrl: string } => !!p.fotoUrl)
    .map(p => ({ codigo: p.codigo, nome: p.nome, url: p.fotoUrl }))
  return {
    estado: novoEstado,
    mensagem: `${categoria.nome}:\n${lista}\n\n${pergunta}`,
    fotos: fotos.length > 0 ? fotos : undefined,
  }
}

async function etapaCatalogoCompleto(estado: EstadoConversa, mensagemCliente: string, deps: DependenciasFunil): Promise<ResultadoEtapa> {
  const escolhido = detectarProdutoEscolhido(mensagemCliente, estado.dados.opcoesRecomendadas)
  if (escolhido) {
    const novoEstado: EstadoConversa = {
      ...estado,
      fase: 'produto_selecionado',
      dados: { ...estado.dados, produto: { nome: escolhido.nome, preco: escolhido.preco, codigo: escolhido.codigo, idExterno: escolhido.idExterno, url: escolhido.url, origem: escolhido.origem, fotoUrl: escolhido.fotoUrl } },
    }
    return { estado: novoEstado, mensagem: `Ótima escolha! O ${escolhido.nome} fica por ${formatarPreco(escolhido.preco)}. Quantas unidades você quer, e pra quando precisa da entrega?` }
  }
  if (pareceConfirmacao(mensagemCliente)) {
    const categorias = await deps.buscarCategorias()
    return apresentarPaginaCatalogoCompleto(estado, categorias, deps)
  }
  if (PALAVRAS_NEGACAO.some(p => normalizar(mensagemCliente).includes(normalizar(p)))) {
    return { estado: { ...estado, fase: 'escolha_categoria' }, mensagem: 'Sem problemas! Me conta o que você procura (cor, estilo, ocasião) que eu te ajudo a encontrar.' }
  }
  // Mensagem ambígua durante a paginação — nunca despeja o catálogo de novo sozinho, só pergunta.
  return { estado, mensagem: 'Você quer ver mais opções, ou já escolheu algum item? Pode me dizer o nome, código ou preço.' }
}

async function etapaRecomendacao(estado: EstadoConversa, mensagemCliente: string, deps: DependenciasFunil): Promise<ResultadoEtapa> {
  // Cliente pode estar escolhendo uma opção já apresentada.
  const escolhido = detectarProdutoEscolhido(mensagemCliente, estado.dados.opcoesRecomendadas)
  if (escolhido) {
    const novoEstado: EstadoConversa = {
      ...estado,
      fase: 'produto_selecionado',
      dados: { ...estado.dados, produto: { nome: escolhido.nome, preco: escolhido.preco, codigo: escolhido.codigo, idExterno: escolhido.idExterno, url: escolhido.url, origem: escolhido.origem, fotoUrl: escolhido.fotoUrl } },
    }
    return { estado: novoEstado, mensagem: `Ótima escolha! O ${escolhido.nome} fica por ${formatarPreco(escolhido.preco)}. Quantas unidades você quer, e pra quando precisa da entrega?` }
  }

  // Opções já foram apresentadas nesta conversa e o cliente ainda não
  // escolheu (a mensagem não bateu com nenhuma delas acima) — nunca
  // reapresenta o catálogo do zero; só pergunta objetivamente qual das
  // opções já mostradas ele quer.
  if (estado.dados.recomendacaoApresentada && estado.dados.opcoesRecomendadas?.length) {
    return {
      estado,
      mensagem: 'Qual das opções que te mostrei você prefere? Pode me dizer o nome, o código ou o preço.',
    }
  }

  const produtos = await deps.buscarCatalogo({
    query: [estado.dados.ocasiao, estado.dados.corPreferida].filter(Boolean).join(' ') || 'flores',
    occasion: estado.dados.ocasiao,
    budget: estado.dados.orcamento,
    color: estado.dados.corPreferida,
  })
  const rec = selecionarRecomendacoes(produtos)
  const novoEstado: EstadoConversa = {
    ...estado,
    fase: 'recomendacao',
    dados: {
      ...estado.dados,
      opcoesRecomendadas: rec.principal ? [rec.principal, ...rec.alternativas] : [],
      recomendacaoApresentada: !!rec.principal,
    },
  }
  // Uma foto por opção apresentada, amarrada ao código real do produto —
  // nunca reaproveita foto de outro item, nunca envia foto aproximada
  // quando o produto não tem uma.
  const todasAsOpcoes = rec.principal ? [rec.principal, ...rec.alternativas] : []
  const fotos = todasAsOpcoes
    .filter((p): p is ProdutoCatalogo & { fotoUrl: string } => !!p.fotoUrl)
    .map(p => ({ codigo: p.codigo, nome: p.nome, url: p.fotoUrl }))
  return { estado: novoEstado, mensagem: montarMensagemRecomendacao(rec, estado.dados.ocasiao), fotos: fotos.length > 0 ? fotos : undefined }
}

function etapaConfirmacaoDetalhesProduto(estado: EstadoConversa, mensagemCliente: string): ResultadoEtapa {
  const produto = { ...estado.dados.produto } as ProdutoSelecionado
  if (produto.quantidade == null) {
    const qtdMatch = mensagemCliente.match(/\b(\d{1,2})\b/)
    if (qtdMatch) produto.quantidade = parseInt(qtdMatch[1], 10)
  }
  if (!produto.dataEntrega && /hoje|amanh[ãa]|\d{1,2}\/\d{1,2}/i.test(mensagemCliente)) {
    produto.dataEntrega = mensagemCliente.trim()
  }
  const estadoAtualizado: EstadoConversa = { ...estado, dados: { ...estado.dados, produto } }

  if (!produtoTemDadosMinimos(produto)) {
    if (produto.quantidade == null) {
      return { estado: estadoAtualizado, mensagem: 'Quantas unidades você quer?' }
    }
    return { estado: estadoAtualizado, mensagem: 'Pra quando você precisa da entrega?' }
  }

  return {
    estado: { ...estadoAtualizado, fase: 'aguardando_endereco' },
    mensagem: 'Perfeito! Agora me passa o CEP e o endereço completo de entrega, com o nome de quem vai receber.',
  }
}

function etapaEndereco(estado: EstadoConversa, mensagemCliente: string): ResultadoEtapa {
  const cepMatch = mensagemCliente.match(/\d{5}-?\d{3}/)
  const endereco = { ...(estado.dados.endereco ?? { cep: '' }) }
  if (cepMatch) endereco.cep = cepMatch[0]
  if (!endereco.nomeDestinatario) {
    const nomeMatch = mensagemCliente.match(/(?:é para|entregar para|destinatári[oa][:\s]+)\s*([A-ZÁÉÍÓÚÂÊÎÔÛÃÕ][a-záéíóúâêîôûãõ]+)/i)
    if (nomeMatch) endereco.nomeDestinatario = nomeMatch[1]
  }
  const estadoAtualizado: EstadoConversa = { ...estado, dados: { ...estado.dados, endereco } }

  if (!endereco.cep) {
    return { estado: estadoAtualizado, mensagem: 'Preciso do CEP de entrega pra calcular o frete.' }
  }

  return { estado: { ...estadoAtualizado, fase: 'calculando_frete' }, mensagem: `Calculando o frete para ${endereco.cep}, um momento...` }
}

async function etapaCalculoFrete(estado: EstadoConversa, deps: DependenciasFunil): Promise<ResultadoEtapa> {
  const cep = estado.dados.endereco?.cep
  if (!cep) {
    return { estado: transferirParaHumano(estado, 'CEP ausente ao tentar calcular frete'), mensagem: mensagemTransferencia() }
  }
  const resultado = await calcularFreteEtapa(cep, deps.calcularFrete)
  if (resultado.falhou) {
    return { estado: transferirParaHumano(estado, `Falha no cálculo de frete para CEP ${cep}`), mensagem: resultado.mensagem }
  }
  const precoProduto = estado.dados.produto?.preco ?? 0
  const quantidade = estado.dados.produto?.quantidade ?? 1
  const valorFrete = resultado.valor ?? 0
  const valorTotal = precoProduto * quantidade + valorFrete
  const dados = { ...estado.dados, valorFrete, valorTotal }
  const novoEstado: EstadoConversa = { ...estado, fase: 'aguardando_confirmacao', dados }
  return { estado: novoEstado, mensagem: `${resultado.mensagem}\n\n${montarResumoPedido(dados)}` }
}

async function etapaConfirmacao(estado: EstadoConversa, mensagemCliente: string, deps: DependenciasFunil): Promise<ResultadoEtapa> {
  if (!pareceConfirmacao(mensagemCliente)) {
    return { estado, mensagem: `Sem problemas — me avisa quando quiser confirmar.\n\n${montarResumoPedido(estado.dados)}` }
  }

  // Revalida preço/estoque/nome/foto direto na fonte, sempre pelo ID técnico
  // (idExterno) — nunca pelo código comercial, que pode estar duplicado no
  // cadastro — antes de criar o pedido. Nunca cobra um valor que já mudou,
  // nem confirma um produto que saiu de disponibilidade entre a escolha e a
  // confirmação.
  const produtoAtual = estado.dados.produto
  if (produtoAtual?.idExterno) {
    const real = await deps.revalidarProduto(produtoAtual.idExterno)
    if (!real || !real.disponivel) {
      return {
        estado: { ...estado, fase: 'escolha_categoria', dados: { ...estado.dados, produto: undefined, valorTotal: undefined } },
        mensagem: `Poxa, o ${produtoAtual.nome} saiu de disponibilidade agora há pouco. Quer que eu te mostre outra opção parecida?`,
      }
    }
    const precoMudou = real.preco != null && real.preco !== produtoAtual.preco
    if (precoMudou) {
      const precoNovo = real.preco!
      const produtoAtualizado = { ...produtoAtual, preco: precoNovo, fotoUrl: real.fotoUrl ?? produtoAtual.fotoUrl, nome: real.nome ?? produtoAtual.nome }
      const valorTotalAtualizado = precoNovo * (produtoAtualizado.quantidade ?? 1) + (estado.dados.valorFrete ?? 0)
      return {
        estado: { ...estado, dados: { ...estado.dados, produto: produtoAtualizado, valorTotal: valorTotalAtualizado } },
        mensagem: `O preço do ${produtoAtual.nome} foi atualizado para ${formatarPreco(precoNovo)} — o novo total fica ${formatarPreco(valorTotalAtualizado)}. Confirma?`,
      }
    }
    if ((real.fotoUrl && real.fotoUrl !== produtoAtual.fotoUrl) || (real.nome && real.nome !== produtoAtual.nome)) {
      estado = { ...estado, dados: { ...estado.dados, produto: { ...produtoAtual, fotoUrl: real.fotoUrl ?? produtoAtual.fotoUrl, nome: real.nome ?? produtoAtual.nome } } }
    }
  }

  const criado = await deps.criarPedido(estado.dados)
  if (!criado) {
    return { estado: transferirParaHumano(estado, 'Falha ao criar pedido antes do pagamento'), mensagem: mensagemTransferencia() }
  }

  const dadosComPedido = { ...estado.dados, pedidoId: criado.pedidoId }
  const resultadoPagamento = await gerarPagamentoComPedido(dadosComPedido, deps)
  if (!resultadoPagamento.link) {
    return {
      estado: transferirParaHumano({ ...estado, dados: dadosComPedido }, 'Falha ao gerar link de pagamento'),
      mensagem: resultadoPagamento.mensagem,
    }
  }

  const novoEstado: EstadoConversa = {
    ...estado,
    fase: 'aguardando_pagamento',
    dados: { ...dadosComPedido, linkPagamento: resultadoPagamento.link, paymentId: resultadoPagamento.paymentId ?? criado.pedidoId },
  }
  return { estado: novoEstado, mensagem: resultadoPagamento.mensagem }
}

async function gerarPagamentoComPedido(
  dados: DadosPedido,
  deps: DependenciasFunil,
): Promise<{ mensagem: string; link: string | null; paymentId: string | null }> {
  if (dados.valorTotal == null) {
    throw new Error('gerarPagamentoComPedido: valorTotal ausente — nao deve gerar link antes de confirmar produto, entrega e valor total')
  }
  if (!dados.pedidoId) {
    throw new Error('gerarPagamentoComPedido: pedidoId ausente — o pedido precisa existir antes de gerar o link de pagamento')
  }
  const resultado = await deps.gerarPagamento(dados.pedidoId, dados.valorTotal)
  if (!resultado) {
    return { mensagem: mensagemTransferencia(), link: null, paymentId: null }
  }
  return {
    mensagem: `Segue o link de pagamento: ${resultado.link}\nO pagamento é processado no ambiente seguro do Mercado Pago. O link fica válido por algumas horas.`,
    link: resultado.link,
    paymentId: resultado.paymentId,
  }
}

/**
 * `fase` sozinha nunca é fonte de verdade: uma fase de compra em andamento
 * só é legítima se houver ao menos um produto escolhido em `dados` — é o
 * mínimo que só se obtém percorrendo o funil de verdade. Sem isso, é um
 * estado fantasma (dado antigo, migração, bug já corrigido) — nunca deve
 * travar o cliente numa fase que não reflete nada real. Falta só de um
 * detalhe posterior (ex.: link de pagamento sem ter sido gerado, com
 * produto e valor já reais) não conta como fantasma — esse caso tem
 * resposta própria e mais útil (ver `montarMensagemAguardandoPagamento`).
 */
export function estadoComPedidoInconsistente(estado: EstadoConversa): boolean {
  return FASES_COMPRA_EM_ANDAMENTO.includes(estado.fase) && !estado.dados.produto
}

/**
 * Avança o funil em uma mensagem. Deve ser chamado DEPOIS do portão de
 * escopo (classificarIntencao + intencaoInterrompeFluxo) — este dispatcher
 * assume que a mensagem já foi considerada dentro do escopo comercial.
 */
export async function avancarFunil(
  estadoRecebido: EstadoConversa,
  mensagemCliente: string,
  intencao: Intencao,
  deps: DependenciasFunil,
): Promise<ResultadoEtapa> {
  let estado: EstadoConversa = { ...estadoRecebido, dados: extrairDadosQualificacao(mensagemCliente, estadoRecebido.dados) }

  if (estadoComPedidoInconsistente(estado)) {
    // Cliente voltou só com uma saudação (sem informação nova) — pergunta
    // objetivamente se quer retomar ou começar de novo, em vez de inventar
    // continuidade ("já paguei"/"já enviei"/"pedido confirmado") sobre um
    // estado que não é real.
    if (pareceSaudacaoSimples(mensagemCliente)) {
      return { estado, mensagem: montarMensagemRetomada(estado.fase, estado.dados) }
    }
    // Qualquer outra mensagem (confirmação como "sim", ou intenção comercial
    // nova como "quais flores tem pra hoje") já é o cliente decidindo seguir
    // em frente — a intenção explícita da mensagem atual prevalece sobre a
    // fase antiga incompatível: repara o estado (limpa só dados/fase,
    // histórico é preservado à parte pelo chamador) e reinicia o funil.
    estado = { ...estadoInicial(), dados: extrairDadosQualificacao(mensagemCliente, {}) }
    intencao = classificarIntencao(mensagemCliente, estado.fase)
  }

  // Cliente voltou só com uma saudação (sem informação nova) enquanto havia
  // um pedido em andamento e consistente — retoma o contexto real em vez de
  // avançar o funil como se fosse mensagem nova.
  if (FASES_COMPRA_EM_ANDAMENTO.includes(estado.fase) && pareceSaudacaoSimples(mensagemCliente)) {
    return { estado, mensagem: montarMensagemRetomada(estado.fase, estado.dados) }
  }

  // Pedido de foto pode acontecer em qualquer fase após haver produto(s) em jogo.
  if (intencao === 'foto_produto') {
    // Nunca por posição fixa: primeiro o produto já formalmente escolhido,
    // depois tenta identificar a QUAL das opções apresentadas a mensagem se
    // refere (nome, número, preço) — só cai pra primeira opção como último
    // recurso, quando não há nenhum outro sinal.
    const alvo = estado.dados.produto
      ?? detectarProdutoEscolhido(mensagemCliente, estado.dados.opcoesRecomendadas)
      ?? estado.dados.opcoesRecomendadas?.[0]
      ?? undefined
    const resp = responderPedidoDeFoto(alvo ? { nome: alvo.nome, preco: alvo.preco, fotoUrl: alvo.fotoUrl, disponivel: true } : undefined)
    return { estado, mensagem: resp.mensagem, fotoUrl: resp.fotoUrl }
  }

  // Pergunta direta de disponibilidade ("tem girassol?", "tem lírios?") pode
  // acontecer em qualquer fase — consulta o catálogo real pelo termo pedido.
  // Produto não encontrado NUNCA aciona handoff automático: responde com
  // honestidade e oferece alternativas reais, ou pergunta preferência.
  const termoDisponibilidade = intencao === 'disponibilidade' ? extrairTermoDisponibilidade(mensagemCliente) : null
  if (termoDisponibilidade) {
    const produtos = await deps.buscarCatalogo({ query: termoDisponibilidade })
    const rec = selecionarRecomendacoes(produtos)
    if (rec.principal) {
      const novoEstado: EstadoConversa = {
        ...estado,
        fase: 'recomendacao',
        dados: { ...estado.dados, opcoesRecomendadas: [rec.principal, ...rec.alternativas], recomendacaoApresentada: true },
      }
      return { estado: novoEstado, mensagem: montarMensagemRecomendacao(rec) }
    }
    return {
      estado,
      mensagem: `No momento não temos ${termoDisponibilidade} disponível. Posso te mostrar outras opções que temos hoje, ou me conta uma preferência (cor, estilo, ocasião) que eu busco algo parecido.`,
    }
  }

  // Pergunta direta de frete: interrompe as sugestões sem apagar o produto
  // já escolhido nem os dados coletados. Nunca estima — só cota de verdade,
  // e só quando já sabe o quê (produto) e pra onde (CEP) entregar; se faltar
  // uma das duas coisas, pede só o que falta. Reaproveita o CEP/bairro já
  // informado na qualificação (`bairroOuCep`) em vez de perguntar de novo.
  if (intencao === 'frete') {
    if (!estado.dados.produto) {
      return { estado, mensagem: 'Claro! Antes de calcular o frete, me conta qual produto você tem em mente — aí eu já cotamos certinho.' }
    }
    const cepConhecido = estado.dados.endereco?.cep
      ?? (estado.dados.bairroOuCep && /\d{5}-?\d{3}/.test(estado.dados.bairroOuCep) ? estado.dados.bairroOuCep : undefined)
    if (!cepConhecido) {
      return { estado, mensagem: 'Claro! Pra calcular o frete, me passa o CEP de entrega.' }
    }
    const estadoComCep: EstadoConversa = {
      ...estado,
      dados: { ...estado.dados, endereco: { ...(estado.dados.endereco ?? { cep: '' }), cep: cepConhecido } },
    }
    return etapaCalculoFrete(estadoComCep, deps)
  }

  // Pergunta direta de forma de pagamento: responde com o que está
  // realmente habilitado na integração de produção agora — nunca inventa
  // Pix/cartão/dinheiro. Não apaga produto/endereço já coletados nem gera
  // link (isso só acontece depois do resumo confirmado, no fluxo normal).
  if (intencao === 'pagamento') {
    const formas = await deps.buscarFormasPagamento()
    if (formas.length === 0) {
      return {
        estado,
        mensagem: 'No momento não consigo confirmar automaticamente as formas de pagamento disponíveis — vou validar isso com nossa equipe antes de fecharmos o pedido.',
      }
    }
    return {
      estado,
      mensagem: `Aceitamos ${formas.join(', ')}, por um link de pagamento seguro depois que confirmarmos produto, entrega e total.`,
    }
  }

  switch (estado.fase) {
    case 'inicio':
    case 'qualificacao': {
      const proxima = proximaPerguntaQualificacao(estado.dados, estado.perguntasFeitas)
      if (proxima) {
        return {
          estado: { ...estado, fase: 'qualificacao', perguntasFeitas: registrarPergunta(proxima.campo, estado.perguntasFeitas) },
          mensagem: proxima.pergunta,
        }
      }
      return etapaEscolhaCategoria({ ...estado, fase: 'escolha_categoria' }, mensagemCliente, deps)
    }
    case 'escolha_categoria':
      return etapaEscolhaCategoria(estado, mensagemCliente, deps)
    case 'catalogo_completo':
      return etapaCatalogoCompleto(estado, mensagemCliente, deps)
    case 'recomendacao':
      return etapaRecomendacao(estado, mensagemCliente, deps)
    case 'produto_selecionado':
      return etapaConfirmacaoDetalhesProduto(estado, mensagemCliente)
    case 'aguardando_endereco':
      return etapaEndereco(estado, mensagemCliente)
    case 'calculando_frete':
      return etapaCalculoFrete(estado, deps)
    case 'aguardando_confirmacao':
      return etapaConfirmacao(estado, mensagemCliente, deps)
    case 'aguardando_pagamento':
      return { estado, mensagem: montarMensagemAguardandoPagamento(estado.dados) }
    case 'pagamento_confirmado':
    case 'pedido_criado':
      return { estado, mensagem: mensagemFinalizacao() }
    default:
      return { estado: transferirParaHumano(estado, `Fase inesperada: ${estado.fase}`), mensagem: mensagemTransferencia() }
  }
}

/**
 * Chamado a partir do webhook de confirmação de pagamento (Cielo/Mercado
 * Pago — integração real fora do escopo deste módulo, ver
 * docs/DEPLOYMENT.md). Nunca deve ser chamado a partir de uma mensagem do
 * cliente — só um provedor de pagamento real pode confirmar.
 */
export async function processarConfirmacaoPagamento(
  estado: EstadoConversa,
  paymentIdConfirmadoPeloProvedor: string,
  criar: CriadorPedido,
): Promise<ResultadoEtapa> {
  const confirmado = confirmarPagamento(estado, paymentIdConfirmadoPeloProvedor)
  const finalizado = await criarPedidoEtapa(confirmado, criar)
  return { estado: finalizado, mensagem: mensagemFinalizacao() }
}
