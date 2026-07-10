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
  codigo?: string
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
  'quero falar com alguém', 'quero falar com alguem', 'fala comigo',
  'assistente pessoal', 'gerente', 'responsável', 'responsavel',
  'proprietário', 'proprietario', 'dono', 'falar com carlos',
]

const PALAVRAS_RECLAMACAO = [
  'reclamação', 'reclamacao', 'reclamar', 'insatisfeit', 'péssimo', 'pessimo',
  'terrível', 'terrivel', 'veio errado', 'pedido errado', 'cancelar',
  'cancelamento', 'não chegou', 'nao chegou', 'está atrasado', 'esta atrasado',
  'chegou atrasado', 'chegou quebrado', 'quebrado', 'estragado', 'decepcionad',
  'muito ruim', 'horrível', 'horrivel', 'não gostei', 'nao gostei',
]

const PALAVRAS_FORA_ESCOPO = [
  'política', 'politica', 'eleição', 'eleicao', 'presidente do brasil',
  'governo', 'religião', 'religiao', 'deus existe', 'igreja', 'bíblia',
  'biblia', 'notícia', 'noticia', 'futebol', 'campeonato', 'novela',
  'seu conselho', 'me dá um conselho', 'me da um conselho',
  'o que você acha de', 'o que voce acha de', 'sua opinião sobre',
  'sua opiniao sobre', 'me ajuda com meu trabalho', 'programação',
  'programacao', 'escreva um código', 'escreva um codigo', 'receita de bolo',
  'conta uma piada', 'horóscopo', 'horoscopo', 'previsão do tempo',
  'previsao do tempo',
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
  'pagamento', 'pagar', 'pix', 'cartão', 'cartao', 'link de pagamento',
  'como eu pago', 'como pago', 'forma de pagamento',
]

const PALAVRAS_STATUS_PEDIDO = [
  'status do meu pedido', 'status do pedido', 'meu pedido já saiu',
  'meu pedido ja saiu', 'onde está meu pedido', 'onde esta meu pedido',
  'já foi entregue', 'ja foi entregue', 'rastrear pedido', 'código do pedido',
  'codigo do pedido',
]

const PALAVRAS_DISPONIBILIDADE = [
  'tem disponível', 'tem disponivel', 'tem em estoque', 'ainda tem',
  'está disponível', 'esta disponivel',
]

function contemAlguma(mensagem: string, palavras: string[]): boolean {
  const lower = mensagem.toLowerCase()
  return palavras.some(p => lower.includes(p))
}

/**
 * Classifica a intenção da mensagem. A ordem importa: escalonamento e
 * escopo são checados antes de qualquer intenção comercial, porque devem
 * interromper o fluxo normal independente da fase atual da conversa.
 */
export function classificarIntencao(mensagem: string, faseAtual: Fase): Intencao {
  if (contemAlguma(mensagem, PALAVRAS_ATENDIMENTO_HUMANO)) return 'atendimento_humano'
  if (contemAlguma(mensagem, PALAVRAS_RECLAMACAO)) return 'reclamacao'
  if (contemAlguma(mensagem, PALAVRAS_FORA_ESCOPO)) return 'assunto_fora_escopo'
  if (contemAlguma(mensagem, PALAVRAS_FOTO)) return 'foto_produto'
  if (contemAlguma(mensagem, PALAVRAS_STATUS_PEDIDO)) return 'status_pedido'
  if (contemAlguma(mensagem, PALAVRAS_FRETE)) return 'frete'
  if (contemAlguma(mensagem, PALAVRAS_PAGAMENTO)) return 'pagamento'
  if (contemAlguma(mensagem, PALAVRAS_DISPONIBILIDADE)) return 'disponibilidade'
  if (faseAtual === 'inicio' || faseAtual === 'qualificacao' || faseAtual === 'recomendacao') {
    return 'recomendacao'
  }
  return 'compra_produto'
}

export function intencaoInterrompeFluxo(intencao: Intencao): boolean {
  return intencao === 'assunto_fora_escopo' || intencao === 'reclamacao' || intencao === 'atendimento_humano'
}

// ── Mensagens fixas (nunca geradas por LLM) ──────────────────────────────

export function mensagemForaDeEscopo(): string {
  return 'Posso te ajudar com flores, presentes, pedidos e entregas da Enemeop Flores. Para outros assuntos, fale com nossa equipe pelo WhatsApp final 8282.'
}

export function mensagemTransferencia(): string {
  return 'Esse assunto precisa da nossa equipe. Fale com a Enemeop Flores pelo WhatsApp final 8282 para continuar o atendimento.'
}

export function mensagemFinalizacao(): string {
  return 'Pagamento confirmado. Seu pedido foi registrado e será preparado para entrega. Qualquer atualização será enviada por aqui.'
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
  codigo?: string
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
    return 'No momento não encontrei opções disponíveis para o que você pediu. Posso avisar assim que tivermos, ou prefere falar com nossa equipe pelo WhatsApp final 8282?'
  }
  const p = rec.principal
  let msg = `Para ${ocasiao ?? 'essa ocasião'}, recomendo o ${p.nome}${p.descricao ? ` — ${p.descricao}` : ''}. Está disponível por ${formatarPreco(p.preco)}.`
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
    mensagem: `Segue o link de pagamento: ${resultado.link}\nO link fica válido por algumas horas.`,
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
