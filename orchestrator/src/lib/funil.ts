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
 *
 * ZERO IMPORTS é uma invariante deliberada (ver _shared/funil.ts): o núcleo
 * roda como cópia byte-a-byte tanto em Node (orchestrator) quanto em Deno
 * (Edge Functions). Um `import` relativo com extensão `.js` resolve certo
 * no Node (tsx/NodeNext) mas quebra no Deno (exige `.ts`) — por isso o
 * formulário de entrega (Parte 2) é uma SEÇÃO deste arquivo, não um módulo
 * separado importado. webhook-whatsapp (100% Deno) importa essas funções
 * direto de _shared/funil.ts, sem esse problema de runtime cruzado.
 */

// ── Fases do funil ────────────────────────────────────────────────────────

export type Fase =
  | 'inicio'
  | 'aviso_fora_horario'
  | 'qualificacao'
  | 'escolha_categoria'
  | 'catalogo_completo'
  | 'recomendacao'
  | 'produto_selecionado'
  /** @deprecated substituída por 'aguardando_formulario' (formulário único) — mantida só pra nunca travar uma conversa que ainda esteja nesta fase de antes da migração. */
  | 'aguardando_endereco'
  | 'calculando_frete'
  /** @deprecated substituída por 'aguardando_formulario'/'confirmando_formulario' — mantida só por compatibilidade com conversas antigas. */
  | 'endereco_completo'
  /** @deprecated substituída por 'aguardando_aprovacao_frete' — mantida só por compatibilidade com conversas antigas. */
  | 'aguardando_confirmacao'
  | 'aguardando_formulario'
  | 'confirmando_formulario'
  | 'aguardando_aprovacao_frete'
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
  uf?: string
  referencia?: string
  nomeDestinatario?: string
  telefoneDestinatario?: string
}

/** Dados completos da cotação real de frete — persistidos no pedido pra nunca confundir preço real, markup e preço cobrado, e pra nunca criar uma entrega com uma cotação vencida (ver Parte E/H). */
export interface FreteDetalhes {
  transportadora?: string
  servico?: string
  quotationId?: string
  /** Preço real da transportadora, sem markup — nunca confundir com valorFrete (que já inclui o markup cobrado do cliente). */
  precoReal?: number
  markup?: number
  moeda?: string
  expiresAt?: string | null
  ambiente?: string
  mercado?: string
  cotadoEm?: string
  origem?: { lat: string; lng: string; endereco: string }
  destino?: { lat: string; lng: string; endereco: string; cep: string }
  /** stopIds retornados pela cotação — reaproveitados na criação da entrega real só enquanto a cotação não estiver expirada (ver Parte H.2). */
  stopIdOrigem?: string
  stopIdDestino?: string
}

export interface DadosPedido {
  ocasiao?: string
  /** Tipo de produto citado pelo cliente (ramalhete, buquê, arranjo, orquídea, presente...) — satisfaz a qualificação tanto quanto a ocasião (ver Parte B.4: "ocasião OU tipo de produto"). */
  tipoProduto?: string
  destinatario?: string
  orcamento?: number
  dataEntrega?: string
  bairroOuCep?: string
  corPreferida?: string
  produto?: ProdutoSelecionado
  endereco?: EnderecoEntrega
  valorFrete?: number
  valorTotal?: number
  /** Detalhes da cotação real usada pra calcular valorFrete — nunca inclui o valor com markup (isso é valorFrete/valorTotal). */
  freteDetalhes?: FreteDetalhes
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
  /** Dados brutos do formulário único de entrega, coletados/validados incrementalmente (ver Parte 2). */
  formulario?: FormularioEntregaDados
  /** Nome de quem comprou (formulário) — pode diferir do nome do perfil do canal. */
  nomeComprador?: string
  /** true assim que o cliente aceita continuar mesmo fora do horário comercial, para esta jornada — nunca repete o aviso depois disso (ver Parte 4). Limpo a cada reinício de jornada. */
  aceitouForaDoHorario?: boolean
  aceitouForaDoHorarioEm?: string
  /** Texto pronto ("amanhã (terça-feira), a partir das 9h") pra ajustar "hoje" quando dataEntrega é coletada — só usado se aceitouForaDoHorario. */
  proximoHorarioTexto?: string
  /** Marca a fronteira de uma nova jornada dentro da mesma conversa — nunca apaga o histórico, só audita quando um reinício aconteceu (ver Parte 1). */
  jornadaIniciadaEm?: string
}

export interface EstadoConversa {
  fase: Fase
  dados: DadosPedido
  perguntasFeitas: string[]
}

export function estadoInicial(): EstadoConversa {
  return { fase: 'inicio', dados: {}, perguntasFeitas: [] }
}

// ── Formulário único de entrega (Parte 2) ─────────────────────────────────
//
// Substitui a coleta campo-a-campo antiga (CAMPOS_ENDERECO_COMPLETO): pede
// todos os dados de entrega numa única mensagem, com um parser determinístico
// (nunca IA generativa — mesma filosofia do resto do arquivo) tolerante a
// pequenas variações de rótulo. Usado por webhook-meta (via avancarFunil,
// abaixo) e por webhook-whatsapp (importa estas funções direto de
// _shared/funil.ts).

export interface FormularioEntregaDados {
  nomeComprador?: string
  nomeDestinatario?: string
  telefoneDestinatario?: string
  cep?: string
  rua?: string
  numero?: string
  complemento?: string
  bairro?: string
  cidade?: string
  uf?: string
  dataEntrega?: string
  periodo?: string
  mensagemCartao?: string
}

export const CAMPOS_OBRIGATORIOS_FORMULARIO: (keyof FormularioEntregaDados)[] = [
  'nomeComprador', 'nomeDestinatario', 'telefoneDestinatario',
  'cep', 'rua', 'numero', 'bairro', 'cidade', 'uf', 'dataEntrega',
]

export const CAMPOS_OPCIONAIS_FORMULARIO: (keyof FormularioEntregaDados)[] = [
  'complemento', 'periodo', 'mensagemCartao',
]

const ROTULO_EXIBICAO_FORMULARIO: Record<keyof FormularioEntregaDados, string> = {
  nomeComprador: 'nome de quem está fazendo o pedido',
  nomeDestinatario: 'nome de quem vai receber',
  telefoneDestinatario: 'telefone de quem vai receber (com DDD)',
  cep: 'CEP',
  rua: 'rua ou avenida',
  numero: 'número',
  complemento: 'complemento',
  bairro: 'bairro',
  cidade: 'cidade',
  uf: 'UF',
  dataEntrega: 'data desejada para entrega',
  periodo: 'período ou horário preferido',
  mensagemCartao: 'mensagem para o cartão',
}

export const TEXTO_FORMULARIO_ENTREGA = `📋 Dados para entrega

Pra agilizar, copie o formulário abaixo, preencha e envie tudo numa única mensagem:

Nome de quem está fazendo o pedido:
Nome de quem vai receber:
Telefone de quem vai receber, com DDD:
CEP:
Rua ou avenida:
Número:
Complemento, se houver:
Bairro:
Cidade:
UF:
Data desejada para entrega:
Período ou horário preferido:
Mensagem para o cartão, se desejar:`

// Rótulos aceitos por campo (já normalizados: sem acento, minúsculo, sem
// pontuação de marcação). O primeiro de cada lista é o rótulo canônico do
// formulário — os demais toleram pequenas variações reais de digitação.
const ROTULOS_ACEITOS_FORMULARIO: Record<keyof FormularioEntregaDados, string[]> = {
  nomeComprador: [
    'nome de quem esta fazendo o pedido', 'nome do comprador', 'quem esta fazendo o pedido',
    'quem esta pedindo', 'remetente', 'seu nome', 'nome de quem pede',
  ],
  nomeDestinatario: [
    'nome de quem vai receber', 'nome do destinatario', 'destinatario', 'quem vai receber',
  ],
  telefoneDestinatario: [
    'telefone de quem vai receber, com ddd', 'telefone de quem vai receber',
    'telefone do destinatario', 'telefone com ddd', 'telefone',
  ],
  cep: ['cep'],
  rua: ['rua ou avenida', 'rua/avenida', 'rua', 'avenida', 'logradouro', 'endereco'],
  numero: ['numero', 'nº', 'n°', 'n.'],
  complemento: ['complemento, se houver', 'complemento'],
  bairro: ['bairro'],
  cidade: ['cidade'],
  uf: ['uf', 'estado'],
  dataEntrega: ['data desejada para entrega', 'data de entrega', 'data desejada', 'data'],
  periodo: ['periodo ou horario preferido', 'periodo/horario', 'periodo', 'horario preferido', 'horario'],
  mensagemCartao: ['mensagem para o cartao, se desejar', 'mensagem para o cartao', 'mensagem do cartao', 'cartao'],
}

// Ordem de checagem importa: rótulos mais específicos (frases longas) antes
// dos mais genéricos, pra "nome de quem vai receber" nunca ser confundido
// com "nome de quem esta fazendo o pedido" só por conterem "nome" em comum.
const ORDEM_CAMPOS_FORMULARIO: (keyof FormularioEntregaDados)[] = [
  'telefoneDestinatario', 'nomeDestinatario', 'nomeComprador',
  'dataEntrega', 'periodo', 'complemento', 'mensagemCartao',
  'cep', 'rua', 'numero', 'bairro', 'cidade', 'uf',
]

function normalizarRotuloFormulario(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[*_📋💌]/g, '')
    .trim()
}

/**
 * Extrai os campos do formulário a partir de UMA resposta do cliente com
 * várias linhas "Rótulo: valor". Nunca inventa nada: um campo só aparece no
 * resultado se houver uma linha reconhecível com um valor não vazio depois
 * dos dois-pontos.
 */
export function extrairFormularioEntrega(texto: string): FormularioEntregaDados {
  const linhas = texto.split('\n')
  const dados: FormularioEntregaDados = {}

  for (const linhaBruta of linhas) {
    const idx = linhaBruta.indexOf(':')
    if (idx === -1) continue
    const rotulo = normalizarRotuloFormulario(linhaBruta.slice(0, idx))
    const valor = linhaBruta.slice(idx + 1).trim()
    if (!rotulo || !valor) continue

    for (const campo of ORDEM_CAMPOS_FORMULARIO) {
      if (dados[campo]) continue
      const candidatos = ROTULOS_ACEITOS_FORMULARIO[campo]
      const bateu = candidatos.some(r => rotulo === r || rotulo.includes(r))
      if (bateu) {
        dados[campo] = valor
        break
      }
    }
  }

  return dados
}

/** Campos obrigatórios que ainda faltam — nunca considera opcionais. */
export function camposFaltandoFormulario(dados: FormularioEntregaDados): (keyof FormularioEntregaDados)[] {
  return CAMPOS_OBRIGATORIOS_FORMULARIO.filter(c => !dados[c])
}

export function formularioCompleto(dados: FormularioEntregaDados): boolean {
  return camposFaltandoFormulario(dados).length === 0
}

/** Pede só os campos que faltam, numa única mensagem — nunca repete os já preenchidos. */
export function montarMensagemCamposFaltando(faltando: (keyof FormularioEntregaDados)[]): string {
  const linhas = faltando.map(c => `${ROTULO_EXIBICAO_FORMULARIO[c].replace(/^./, m => m.toUpperCase())}:`)
  return `Só faltou completar (pode responder tudo numa mensagem só):\n\n${linhas.join('\n')}`
}

/** CEP brasileiro: 8 dígitos, com ou sem hífen. */
export function cepValido(cep: string): boolean {
  return /^\d{5}-?\d{3}$/.test(cep.trim())
}

/**
 * Normaliza um telefone de destinatário digitado em qualquer formato comum
 * (com/sem DDI, com/sem formatação) para E.164 (+55DDDNUMERO) — formato
 * exigido pela Lalamove. Nunca inventa dígitos: se não for possível
 * reconhecer um número BR válido (10 ou 11 dígitos, +/- DDI 55), devolve
 * null em vez de arriscar um valor incorreto.
 */
export function normalizarTelefoneDestinatarioBR(raw: string): string | null {
  let digitos = raw.replace(/\D/g, '')
  if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) {
    // já tem DDI
  } else if (digitos.length === 10 || digitos.length === 11) {
    digitos = `55${digitos}`
  } else {
    return null
  }
  if (digitos.length !== 12 && digitos.length !== 13) return null
  return `+${digitos}`
}

/** Resumo sanitizado do formulário pra confirmação — nunca mostra o CEP sozinho sem o resto do endereço, nem inventa campo ausente. */
export function montarResumoFormulario(dados: FormularioEntregaDados): string {
  const linhas = [
    'Confere os dados de entrega?',
    '',
    dados.nomeComprador ? `- Pedido de: ${dados.nomeComprador}` : null,
    dados.nomeDestinatario ? `- Destinatário: ${dados.nomeDestinatario}` : null,
    dados.telefoneDestinatario ? `- Telefone do destinatário: ${dados.telefoneDestinatario}` : null,
    (dados.rua || dados.numero) ? `- Endereço: ${[dados.rua, dados.numero].filter(Boolean).join(', ')}${dados.complemento ? ` (${dados.complemento})` : ''}` : null,
    (dados.bairro || dados.cidade || dados.uf) ? `- Bairro/Cidade: ${[dados.bairro, dados.cidade, dados.uf].filter(Boolean).join(', ')}` : null,
    dados.cep ? `- CEP: ${dados.cep}` : null,
    dados.dataEntrega ? `- Data: ${dados.dataEntrega}${dados.periodo ? ` (${dados.periodo})` : ''}` : null,
    dados.mensagemCartao ? `- Mensagem do cartão: "${dados.mensagemCartao}"` : null,
    '',
    'Está tudo certo? (responda "sim" para eu calcular o frete)',
  ].filter((l): l is string => l !== null)
  return linhas.join('\n')
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
  'endereco_completo', 'aguardando_confirmacao', 'aguardando_formulario',
  'confirmando_formulario', 'aguardando_aprovacao_frete', 'aguardando_pagamento',
]

// Saudação "pura": a mensagem inteira (sem outro conteúdo) é só um
// cumprimento — usada para detectar que o cliente voltou depois de um
// intervalo sem trazer informação nova, e portanto a resposta deve retomar
// o contexto real em vez de tratar como mensagem nova.
const REGEX_SAUDACAO_SIMPLES = /^(oi+|ola|bom\s?dia|boa\s?tarde|boa\s?noite|e\s?ai|eae+|opa|hey)[\s!?.,]*$/

export function pareceSaudacaoSimples(mensagem: string): boolean {
  return REGEX_SAUDACAO_SIMPLES.test(normalizar(mensagem))
}

// ── Reinício seguro de uma nova jornada (Parte 1) ─────────────────────────
//
// Caso real observado em monitoramento: uma conversa presa numa fase
// avançada (endereço/frete) recebeu uma mensagem pedindo pra ver outras
// opções — o funil reaproveitou CEP e cotação antigos em vez de começar do
// catálogo. Frases explícitas de continuação/correção NUNCA disparam
// reinício; só uma intenção comercial nova e inequívoca dispara.

const FRASES_NOVO_PEDIDO = [
  'novo pedido', 'outro pedido', 'outro produto', 'fazer um novo pedido',
  'quero ver op', 'mostrar op', 'mostra op', 'outras opcoes', 'outras op', 'ver outras op',
]

const FRASES_CONTINUACAO = [
  'continuar', 'pode seguir', 'e o frete', 'segue', 'continua', 'pode continuar', 'prossegue',
]

/**
 * true só quando a mensagem, numa fase de compra já avançada, traz uma
 * intenção comercial claramente NOVA — nunca em resposta a "continuar",
 * confirmações ("sim"), ou o que parece ser a resposta esperada pela fase
 * atual (não bate com nenhuma frase de reinício nem gatilho saudação+tipo).
 */
export function pareceNovaIntencaoDeCompra(mensagem: string, faseAtual: Fase): boolean {
  if (!FASES_COMPRA_EM_ANDAMENTO.includes(faseAtual)) return false
  const n = normalizar(mensagem)
  if (FRASES_CONTINUACAO.some(p => n.includes(normalizar(p)))) return false
  if (pareceConfirmacao(mensagem)) return false
  if (FRASES_NOVO_PEDIDO.some(p => n.includes(normalizar(p)))) return true
  const temSaudacao = /^(oi+|ola|bom\s?dia|boa\s?tarde|boa\s?noite|e\s?ai|eae+|opa|hey)\b/.test(n)
  const temTipoProdutoOuOcasiao = TIPOS_PRODUTO.some(t => t.regex.test(n))
  return temSaudacao && temTipoProdutoOuOcasiao
}

/**
 * Reinicia a jornada: limpa produto, quantidade, data, endereço,
 * destinatário, cotação/quotationId, frete, total, pedidoId, preference e
 * formulário do pedido anterior — nunca reaproveita cotação/endereço/
 * pagamento antigos numa jornada nova. O histórico da conversa (auditoria)
 * é preservado à parte pelo chamador (webhook-meta/webhook-whatsapp nunca
 * apagam `historico`); aqui só marcamos a fronteira da nova jornada em
 * `jornadaIniciadaEm`, pra permitir localizar onde ela começou depois.
 */
export function reiniciarJornada(mensagemCliente: string): EstadoConversa {
  const dados = extrairDadosQualificacao(mensagemCliente, {})
  return {
    ...estadoInicial(),
    dados: { ...dados, jornadaIniciadaEm: new Date().toISOString() },
  }
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

// ── Horário comercial — aviso com opt-in no início de uma jornada (Parte 4) ──
//
// Texto exato definido na tarefa. Mostrado só uma vez por jornada (nunca
// repetido a cada mensagem — ver fase 'aviso_fora_horario'), nunca finaliza
// dizendo só que está fora do horário, nunca transfere pra humano só por
// isso, e nunca bloqueia pagamento depois que o cliente aceitou continuar.
export function mensagemAvisoForaDoHorarioComOpcao(): string {
  return 'Olá! No momento estamos fora do horário de atendimento. Nosso horário é de segunda a sexta, das 9h às 19h, e aos sábados, domingos e feriados, das 10h às 18h. Se desejar, podemos adiantar seu pedido agora para entrega no próximo dia útil, a partir do horário de funcionamento. Deseja continuar?'
}

/** Lembrete curto enquanto o cliente ainda não respondeu sim/continuar ao aviso — nunca repete o texto completo do aviso de novo. */
export function mensagemAguardandoRespostaForaDoHorario(): string {
  return 'Posso adiantar seu pedido agora mesmo fora do horário — é só confirmar. Deseja continuar?'
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

// Orçamento nunca é perguntado (removido do fluxo automático — a Flora
// mostra o catálogo real com preços reais em vez de filtrar por faixa).
// Data de entrega e CEP não são coletados aqui: são perguntados só depois
// da escolha do produto (ver etapaConfirmacaoDetalhesProduto/etapaEndereco),
// para nunca pedir CEP antes do cliente saber o que vai comprar. Destinatário
// (nome de quem recebe) também não é pré-qualificação — é coletado junto do
// endereço completo, depois da cotação real (ver CAMPOS_ENDERECO_COMPLETO).
// Único gate antes de mostrar categorias/produtos: entender ocasião OU tipo
// de produto (ver Parte B.4) — qualquer um dos dois já é suficiente.
const CAMPOS_QUALIFICACAO: { campo: keyof DadosPedido; pergunta: string }[] = [
  { campo: 'ocasiao', pergunta: 'Pra qual ocasião é o presente?' },
]

const TIPOS_PRODUTO: { termo: string; regex: RegExp }[] = [
  { termo: 'ramalhete', regex: /ramalhete/ },
  { termo: 'buquê', regex: /buqu[eê]/ },
  { termo: 'arranjo', regex: /arranjo/ },
  { termo: 'orquídea', regex: /orqu[ií]de/ },
  { termo: 'presente', regex: /presente/ },
  { termo: 'cesta', regex: /cesta/ },
  { termo: 'coroa', regex: /coroa/ },
  { termo: 'planta', regex: /planta/ },
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

  if (!dados.tipoProduto) {
    const encontrado = TIPOS_PRODUTO.find(t => t.regex.test(lower))
    if (encontrado) dados.tipoProduto = encontrado.termo
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

/** Retorna a próxima pergunta de qualificação a fazer, ou null se já há dados suficientes (ocasião OU tipo de produto). Nunca repete uma pergunta já feita. */
export function proximaPerguntaQualificacao(dados: DadosPedido, perguntasFeitas: string[]): { campo: string; pergunta: string } | null {
  for (const { campo, pergunta } of CAMPOS_QUALIFICACAO) {
    const satisfeito = campo === 'ocasiao' ? (dados.ocasiao != null || dados.tipoProduto != null) : dados[campo] != null
    if (!satisfeito && !perguntasFeitas.includes(campo)) {
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

// Catálogo primeiro em texto — nunca despeja link/foto automaticamente
// (ver Parte C/E da correção de 2026-07-20): apenas código, nome e preço
// reais, compactos. Foto só é enviada sob pedido explícito do cliente
// (ver responderPedidoDeFoto / bloco foto_produto em avancarFunil).
export function montarMensagemRecomendacao(rec: Recomendacao, ocasiao?: string): string {
  if (!rec.principal) {
    return 'No momento não encontrei opções disponíveis para o que você pediu. Me conta melhor o que você tem em mente (cor, estilo, ocasião) que eu vejo outras alternativas.'
  }
  const opcoes = [rec.principal, ...rec.alternativas]
  const linhas = opcoes.map(p => `${p.codigo ? `${p.codigo} — ` : ''}${p.nome} — ${formatarPreco(p.preco)}`)
  const abertura = ocasiao ? `Para ${ocasiao}, encontrei estas opções:` : 'Encontrei estas opções:'
  return `${abertura}\n${linhas.join('\n')}\n\nQual te interessa? Pode me dizer o nome, o código, ou pedir a foto de alguma delas.`
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

export type ResultadoFrete = { ok: true; valor: number; detalhes?: FreteDetalhes } | { ok: false }
export type CalculadorFrete = (cep: string) => Promise<ResultadoFrete>

export interface RespostaFrete {
  mensagem: string
  valor: number | null
  falhou: boolean
  detalhes?: FreteDetalhes
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
    detalhes: resultado.detalhes,
  }
}

// ── Etapa 6 — Resumo do pedido ────────────────────────────────────────────

export function montarResumoPedido(dados: DadosPedido): string {
  const p = dados.produto
  const subtotal = p?.preco != null ? p.preco * (p.quantidade ?? 1) : null
  const linhas = [
    'Resumo do seu pedido:',
    p ? `- Produto: ${p.codigo ? `${p.codigo} — ` : ''}${p.nome}${p.quantidade ? ` x${p.quantidade}` : ''}${p.tamanho ? ` (${p.tamanho})` : ''}${p.cor ? ` — cor ${p.cor}` : ''}` : null,
    p?.dataEntrega ? `- Data: ${p.dataEntrega}` : null,
    dados.endereco?.nomeDestinatario ? `- Destinatário: ${dados.endereco.nomeDestinatario}` : null,
    dados.endereco ? `- Entrega: ${[dados.endereco.rua, dados.endereco.numero, dados.endereco.bairro, dados.endereco.cidade].filter(Boolean).join(', ')}` : null,
    subtotal != null ? `- Subtotal: ${formatarPreco(subtotal)}` : null,
    dados.valorFrete != null ? `- Frete: ${formatarPreco(dados.valorFrete)}` : null,
    dados.valorTotal != null ? `- Total: ${formatarPreco(dados.valorTotal)}` : null,
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

// "quero ele"/"quero ela" incluídos aqui (regressão real observada
// 2026-07-20): referência inequívoca à recomendação principal quando ela
// está claramente destacada — nunca por posição quando há dúvida real
// entre várias opções (ver detectarProdutoEscolhido: código/nome/preço
// sempre têm prioridade sobre esta lista).
const PALAVRAS_ESCOLHA_PRIMEIRA_OPCAO = ['primeira opção', 'primeira opcao', 'a primeira', 'o primeiro', 'esse mesmo', 'esse aí', 'esse ai', 'esse mesmo aí', 'fico com esse', 'quero esse', 'vou querer esse', 'quero ele', 'quero ela', 'vou querer ele', 'vou querer ela']
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
interface EscolhaProduto {
  produto: ProdutoCatalogo | null
  /** Preenchido só quando a mensagem bateu por código, mas o código é usado
   * por mais de uma opção apresentada — nunca seleciona sozinho nesse caso,
   * quem chama deve pedir desambiguação por nome/preço/posição. */
  opcoesConflitantes?: ProdutoCatalogo[]
}

function detectarProdutoEscolhido(mensagem: string, opcoes?: ProdutoCatalogo[]): EscolhaProduto {
  if (!opcoes || opcoes.length === 0) return { produto: null }
  const lower = mensagem.toLowerCase()
  const normalizado = normalizar(mensagem)

  // Nome inequívoco seleciona direto; nome que bate em mais de uma opção
  // (nunca escolhe pelo primeiro que achar) pede desambiguação — mesma
  // regra do código comercial duplicado, abaixo.
  const porNome = opcoes.filter(o => lower.includes(o.nome.toLowerCase()))
  if (porNome.length === 1) return { produto: porNome[0] }
  if (porNome.length > 1) return { produto: null, opcoesConflitantes: porNome }

  // Código exato como token isolado da mensagem (ex.: "quero o código 002",
  // "manda o M08") — nunca por substring solta, pra não confundir "0" de
  // quantidade com o código "010" de outro produto. Se o mesmo código
  // aparece em mais de uma opção (cadastro duplicado), nunca escolhe pelo
  // primeiro que achar — sinaliza o conflito pra quem chama desambiguar.
  const tokensMensagem = lower.split(/[^a-z0-9]+/i).filter(Boolean)
  const porCodigo = opcoes.filter(o => o.codigo && tokensMensagem.includes(o.codigo.toLowerCase()))
  if (porCodigo.length === 1) return { produto: porCodigo[0] }
  if (porCodigo.length > 1) return { produto: null, opcoesConflitantes: porCodigo }

  if (PALAVRAS_ESCOLHA_SEGUNDA_OPCAO.some(p => normalizado.includes(normalizar(p))) && opcoes[1]) return { produto: opcoes[1] }
  if (PALAVRAS_ESCOLHA_TERCEIRA_OPCAO.some(p => normalizado.includes(normalizar(p))) && opcoes[2]) return { produto: opcoes[2] }

  const numerosMensagem = extrairNumeros(mensagem)
  if (numerosMensagem.length > 0) {
    const porPreco = opcoes.find(o => o.preco != null && numerosMensagem.some(n => Math.round(n) === Math.round(o.preco!)))
    if (porPreco) return { produto: porPreco }
    const porNumeroNoNome = opcoes.find(o => extrairNumeros(o.nome).some(nn => numerosMensagem.includes(nn)))
    if (porNumeroNoNome) return { produto: porNumeroNoNome }
  }

  if (/mais barat/.test(normalizado)) {
    return { produto: opcoes.reduce<ProdutoCatalogo | null>((min, o) => (o.preco != null && (min?.preco == null || o.preco < min.preco) ? o : min), null) }
  }
  if (/mais car[oa]/.test(normalizado)) {
    return { produto: opcoes.reduce<ProdutoCatalogo | null>((max, o) => (o.preco != null && (max?.preco == null || o.preco > max.preco) ? o : max), null) }
  }

  if (PALAVRAS_ESCOLHA_PRIMEIRA_OPCAO.some(p => lower.includes(p))) return { produto: opcoes[0] }
  return { produto: null }
}

/** Mensagem quando o código informado é usado por mais de uma opção apresentada — nunca escolhe sozinho, sempre pede um sinal inequívoco. */
// Usada tanto para código comercial duplicado quanto para nome que bate em
// mais de uma opção apresentada — nunca escolhe sozinho em nenhum dos dois
// casos, sempre pede um sinal inequívoco.
function montarMensagemCodigoAmbiguo(opcoesConflitantes: ProdutoCatalogo[]): string {
  const lista = opcoesConflitantes.map(o => `${o.nome} (${formatarPreco(o.preco)})`).join(' | ')
  return `Encontrei mais de uma opção que combina com o que você disse: ${lista}. Pode me dizer o nome completo, o código, o preço ou a posição (primeira, segunda...) de qual delas você quer?`
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
  // Catálogo primeiro em texto — sem foto/link automático (ver Parte C/E).
  const linhas = opcoes.map(p => `${p.codigo ? `${p.codigo} — ` : ''}${p.nome} — ${formatarPreco(p.preco)}`)
  return {
    estado: novoEstado,
    mensagem: `Na categoria ${categoria.nome}, encontrei:\n${linhas.join('\n')}\n\nQual te interessa? Pode me dizer o nome, o código, ou pedir a foto de alguma delas.`,
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
  // Catálogo primeiro em texto — sem foto/link automático (ver Parte C/E).
  const lista = pagina.map(p => `${p.codigo ? `${p.codigo} — ` : ''}${p.nome} — ${formatarPreco(p.preco)}`).join('\n')
  const pergunta = temMaisNestaCategoria
    ? `Quer ver mais opções de ${categoria.nome}, ou já posso passar pra outra categoria?`
    : 'Quer ver a próxima categoria?'
  return {
    estado: novoEstado,
    mensagem: `${categoria.nome}:\n${lista}\n\n${pergunta}`,
  }
}

async function etapaCatalogoCompleto(estado: EstadoConversa, mensagemCliente: string, deps: DependenciasFunil): Promise<ResultadoEtapa> {
  const { produto: escolhido, opcoesConflitantes } = detectarProdutoEscolhido(mensagemCliente, estado.dados.opcoesRecomendadas)
  if (opcoesConflitantes) {
    return { estado, mensagem: montarMensagemCodigoAmbiguo(opcoesConflitantes) }
  }
  if (escolhido) {
    const novoEstado: EstadoConversa = {
      ...estado,
      fase: 'produto_selecionado',
      dados: { ...estado.dados, produto: { nome: escolhido.nome, preco: escolhido.preco, codigo: escolhido.codigo, idExterno: escolhido.idExterno, url: escolhido.url, origem: escolhido.origem, fotoUrl: escolhido.fotoUrl } },
    }
    return { estado: novoEstado, mensagem: `Você escolheu ${escolhido.codigo ? `${escolhido.codigo} — ` : ''}${escolhido.nome}, por ${formatarPreco(escolhido.preco)}. Quantas unidades você quer?` }
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
  const { produto: escolhido, opcoesConflitantes } = detectarProdutoEscolhido(mensagemCliente, estado.dados.opcoesRecomendadas)
  if (opcoesConflitantes) {
    return { estado, mensagem: montarMensagemCodigoAmbiguo(opcoesConflitantes) }
  }
  if (escolhido) {
    const novoEstado: EstadoConversa = {
      ...estado,
      fase: 'produto_selecionado',
      dados: { ...estado.dados, produto: { nome: escolhido.nome, preco: escolhido.preco, codigo: escolhido.codigo, idExterno: escolhido.idExterno, url: escolhido.url, origem: escolhido.origem, fotoUrl: escolhido.fotoUrl } },
    }
    return { estado: novoEstado, mensagem: `Você escolheu ${escolhido.codigo ? `${escolhido.codigo} — ` : ''}${escolhido.nome}, por ${formatarPreco(escolhido.preco)}. Quantas unidades você quer?` }
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
    query: [estado.dados.tipoProduto, estado.dados.ocasiao, estado.dados.corPreferida].filter(Boolean).join(' ') || 'flores',
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
  // Catálogo primeiro em texto — sem foto/link automático (ver Parte C/E).
  // Foto só é enviada sob pedido explícito (ver bloco foto_produto abaixo).
  return { estado: novoEstado, mensagem: montarMensagemRecomendacao(rec, estado.dados.ocasiao) }
}

function etapaConfirmacaoDetalhesProduto(estado: EstadoConversa, mensagemCliente: string): ResultadoEtapa {
  const produto = { ...estado.dados.produto } as ProdutoSelecionado
  let avisoData = ''
  if (produto.quantidade == null) {
    const qtdMatch = mensagemCliente.match(/\b(\d{1,2})\b/)
    if (qtdMatch) produto.quantidade = parseInt(qtdMatch[1], 10)
  }
  if (!produto.dataEntrega && /hoje|amanh[ãa]|\d{1,2}\/\d{1,2}/i.test(mensagemCliente)) {
    const pediuHoje = /^\s*hoje\s*[.!]?\s*$/i.test(mensagemCliente.trim()) || /\bhoje\b/i.test(mensagemCliente)
    // "hoje" pedido numa jornada aceita fora do horário vira o próximo
    // horário comercial real, comunicado com clareza (Parte 4) — nunca
    // finge que a entrega vai sair "hoje" fora do expediente da loja.
    if (pediuHoje && estado.dados.aceitouForaDoHorario && estado.dados.proximoHorarioTexto) {
      produto.dataEntrega = estado.dados.proximoHorarioTexto
      avisoData = `Como estamos fora do horário agora, ajustei sua entrega para ${estado.dados.proximoHorarioTexto} — se preferir outra data, é só me avisar. `
    } else {
      produto.dataEntrega = mensagemCliente.trim()
    }
  }
  const estadoAtualizado: EstadoConversa = { ...estado, dados: { ...estado.dados, produto } }

  if (!produtoTemDadosMinimos(produto)) {
    if (produto.quantidade == null) {
      return { estado: estadoAtualizado, mensagem: 'Quantas unidades você quer?' }
    }
    return { estado: estadoAtualizado, mensagem: 'Pra quando você precisa da entrega?' }
  }

  return {
    estado: { ...estadoAtualizado, fase: 'aguardando_formulario' },
    mensagem: `${avisoData}${TEXTO_FORMULARIO_ENTREGA}`,
  }
}

// ── Etapa 5b — Formulário único de entrega (Parte 2/3) ────────────────────
//
// Substitui a coleta campo-a-campo antiga: o formulário completo (incluindo
// CEP) é pedido de uma vez (ver etapaConfirmacaoDetalhesProduto), extraído
// numa única resposta, confirmado pelo cliente, e só DEPOIS o frete é
// cotado de verdade — nunca antes da confirmação dos dados de entrega.

/** Sincroniza o formulário validado pra estrutura antiga (endereco/produto.mensagemCartao) — nunca reinventa formato, só espelha o que já foi confirmado. */
function sincronizarFormularioParaEndereco(estado: EstadoConversa): EstadoConversa {
  const f = estado.dados.formulario
  if (!f) return estado
  const endereco: EnderecoEntrega = {
    cep: f.cep!,
    rua: f.rua,
    numero: f.numero,
    complemento: f.complemento,
    bairro: f.bairro,
    cidade: f.cidade,
    uf: f.uf,
    nomeDestinatario: f.nomeDestinatario,
    telefoneDestinatario: f.telefoneDestinatario,
  }
  const produto = estado.dados.produto
    ? { ...estado.dados.produto, mensagemCartao: f.mensagemCartao ?? estado.dados.produto.mensagemCartao }
    : estado.dados.produto
  return { ...estado, dados: { ...estado.dados, endereco, produto, nomeComprador: f.nomeComprador } }
}

/** Coleta o formulário único — aceita todos os campos numa mensagem só, pede só os que faltarem (nunca um por vez), e nunca sobrescreve um campo já válido com um valor vazio. */
function etapaFormulario(estado: EstadoConversa, mensagemCliente: string): ResultadoEtapa {
  const extraido = extrairFormularioEntrega(mensagemCliente)
  const formularioAtual: FormularioEntregaDados = { ...(estado.dados.formulario ?? {}), ...extraido }
  const estadoAtualizado: EstadoConversa = { ...estado, dados: { ...estado.dados, formulario: formularioAtual } }

  const cepInformadoInvalido = !!formularioAtual.cep && !cepValido(formularioAtual.cep)
  const telefoneInformadoInvalido = !!formularioAtual.telefoneDestinatario && !normalizarTelefoneDestinatarioBR(formularioAtual.telefoneDestinatario)
  const faltando = camposFaltandoFormulario(formularioAtual)

  if (cepInformadoInvalido) {
    return { estado: { ...estadoAtualizado, fase: 'aguardando_formulario' }, mensagem: 'O CEP informado não parece válido — pode confirmar (8 dígitos)?' }
  }
  if (telefoneInformadoInvalido) {
    return { estado: { ...estadoAtualizado, fase: 'aguardando_formulario' }, mensagem: 'O telefone de quem vai receber não ficou claro — pode informar de novo, com DDD?' }
  }
  if (faltando.length > 0) {
    return { estado: { ...estadoAtualizado, fase: 'aguardando_formulario' }, mensagem: montarMensagemCamposFaltando(faltando) }
  }

  // Telefone sempre normalizado pra E.164 antes de seguir — é o formato que
  // a Lalamove exige (Parte 2), nunca enviado "cru" pra frente.
  const telefoneE164 = normalizarTelefoneDestinatarioBR(formularioAtual.telefoneDestinatario!)!
  const formularioNormalizado = { ...formularioAtual, telefoneDestinatario: telefoneE164 }
  const novoEstado: EstadoConversa = { ...estadoAtualizado, fase: 'confirmando_formulario', dados: { ...estadoAtualizado.dados, formulario: formularioNormalizado } }
  return { estado: novoEstado, mensagem: montarResumoFormulario(formularioNormalizado) }
}

async function etapaCalculoFrete(estado: EstadoConversa, deps: DependenciasFunil): Promise<ResultadoEtapa> {
  const cep = estado.dados.endereco?.cep ?? estado.dados.formulario?.cep
  if (!cep) {
    return { estado: transferirParaHumano(estado, 'CEP ausente ao tentar calcular frete'), mensagem: mensagemTransferencia() }
  }
  const resultado = await calcularFreteEtapa(cep, deps.calcularFrete)
  if (resultado.falhou) {
    // Falha real (timeout, integração fora do ar, endereço não localizado)
    // nunca inventa valor nem avança para pagamento. Também nunca transfere
    // pra humano de imediato por uma falha transitória — fica em
    // 'confirmando_formulario' pra permitir uma nova tentativa controlada
    // (o cliente confirma de novo, ou a própria integração já pode ter se
    // recuperado). O chamador (webhook-meta) é responsável por logar o erro
    // técnico sanitizado antes de devolver { ok: false } aqui.
    return {
      estado: { ...estado, fase: 'confirmando_formulario' },
      mensagem: 'No momento não consegui calcular o frete para esse CEP. Pode confirmar se os dados de entrega estão certos? (responda "sim" pra eu tentar de novo)',
    }
  }
  const precoProduto = estado.dados.produto?.preco ?? 0
  const quantidade = estado.dados.produto?.quantidade ?? 1
  const valorFrete = resultado.valor ?? 0
  const subtotal = precoProduto * quantidade
  const valorTotal = subtotal + valorFrete
  const dados = { ...estado.dados, valorFrete, valorTotal, freteDetalhes: resultado.detalhes }
  const novoEstado: EstadoConversa = { ...estado, fase: 'aguardando_aprovacao_frete', dados }
  return { estado: novoEstado, mensagem: montarMensagemAprovacaoFrete(dados) }
}

/** Nunca cobra antes de cotar e aprovar o frete — esta mensagem é o único lugar que apresenta subtotal/frete/total antes do link de pagamento (Parte 3). */
function montarMensagemAprovacaoFrete(dados: DadosPedido): string {
  const p = dados.produto
  const subtotal = p?.preco != null ? p.preco * (p.quantidade ?? 1) : 0
  const transportadora = dados.freteDetalhes?.transportadora
  const servico = dados.freteDetalhes?.servico
  const linhaFrete = `Frete${transportadora ? ` (${transportadora}${servico ? ` — ${servico}` : ''})` : ''}: ${formatarPreco(dados.valorFrete)}`
  return [
    `Subtotal: ${formatarPreco(subtotal)}`,
    linhaFrete,
    `Total: ${formatarPreco(dados.valorTotal)}`,
    '',
    'Você aprova o frete e o total?',
  ].join('\n')
}

/** Coleta a confirmação dos dados do formulário — nunca cota frete antes disso (Parte 3.3/3.4). Cliente pode corrigir um campo em vez de confirmar; nunca perde os dados já certos. */
async function etapaConfirmandoFormulario(estado: EstadoConversa, mensagemCliente: string, deps: DependenciasFunil): Promise<ResultadoEtapa> {
  if (!pareceConfirmacao(mensagemCliente)) {
    const correcao = extrairFormularioEntrega(mensagemCliente)
    if (Object.keys(correcao).length > 0) {
      const formularioAtualizado = { ...(estado.dados.formulario ?? {}), ...correcao }
      return {
        estado: { ...estado, dados: { ...estado.dados, formulario: formularioAtualizado } },
        mensagem: montarResumoFormulario(formularioAtualizado),
      }
    }
    return { estado, mensagem: `Sem problemas — me avisa quando os dados estiverem certos.\n\n${montarResumoFormulario(estado.dados.formulario ?? {})}` }
  }

  if (!estado.dados.formulario || !formularioCompleto(estado.dados.formulario)) {
    // Estado inconsistente (nunca deveria chegar aqui sem formulário
    // completo) — nunca cota frete com dados incompletos, reenvia o formulário.
    return { estado: { ...estado, fase: 'aguardando_formulario' }, mensagem: TEXTO_FORMULARIO_ENTREGA }
  }

  const estadoSincronizado = sincronizarFormularioParaEndereco(estado)
  return etapaCalculoFrete({ ...estadoSincronizado, fase: 'calculando_frete' }, deps)
}

async function etapaAguardandoAprovacaoFrete(estado: EstadoConversa, mensagemCliente: string, deps: DependenciasFunil): Promise<ResultadoEtapa> {
  if (!pareceConfirmacao(mensagemCliente)) {
    return { estado, mensagem: `Sem problemas — me avisa quando quiser seguir.\n\n${montarMensagemAprovacaoFrete(estado.dados)}` }
  }

  // Guarda defensiva: nunca gera link de pagamento faltando produto,
  // quantidade, data, cotação real de frete ou endereço/destinatário
  // completos — mesmo que um estado inconsistente (migração, bug antigo)
  // tenha chegado até aqui sem passar pelas etapas normais.
  const dadosIncompletos =
    !estado.dados.produto?.nome ||
    !estado.dados.produto?.quantidade ||
    !estado.dados.produto?.dataEntrega ||
    estado.dados.valorFrete == null ||
    estado.dados.valorTotal == null ||
    !estado.dados.formulario ||
    !formularioCompleto(estado.dados.formulario)
  if (dadosIncompletos) {
    return {
      estado: { ...estado, fase: 'aguardando_formulario' },
      mensagem: 'Antes de confirmar, preciso terminar de coletar os dados da entrega.\n\n' + TEXTO_FORMULARIO_ENTREGA,
    }
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
 *
 * @param foraDoHorario Calculado pelo chamador (ver _shared/horario-comercial.ts,
 *   fonte única do horário) — funil.ts nunca calcula hora sozinho (zero imports).
 * @param proximoHorarioTexto Texto pronto ("amanhã (terça-feira), a partir das
 *   9h") pra ajustar "hoje" quando a jornada foi aceita fora do horário (Parte 4).
 */
export async function avancarFunil(
  estadoRecebido: EstadoConversa,
  mensagemCliente: string,
  intencao: Intencao,
  deps: DependenciasFunil,
  foraDoHorario = false,
  proximoHorarioTexto?: string,
): Promise<ResultadoEtapa> {
  let estado: EstadoConversa = { ...estadoRecebido, dados: extrairDadosQualificacao(mensagemCliente, estadoRecebido.dados) }

  // Gate de horário (Parte 4): só é resolvido respondendo sim/continuar —
  // nunca avança sozinho, nunca repete o aviso completo de novo (só um
  // lembrete curto), nunca transfere pra humano só por estar fora do horário.
  if (estado.fase === 'aviso_fora_horario') {
    const n = normalizar(mensagemCliente)
    if (pareceConfirmacao(mensagemCliente) || n.includes('continuar')) {
      estado = {
        ...estado,
        fase: 'inicio',
        dados: { ...estado.dados, aceitouForaDoHorario: true, aceitouForaDoHorarioEm: new Date().toISOString(), proximoHorarioTexto },
      }
      // segue o fluxo normal abaixo, agora liberado.
    } else {
      return { estado, mensagem: mensagemAguardandoRespostaForaDoHorario() }
    }
  }

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
    // fase antiga incompatível: repara o estado (histórico é preservado à
    // parte pelo chamador) e reinicia o funil (ver Parte 1).
    estado = reiniciarJornada(mensagemCliente)
    intencao = classificarIntencao(mensagemCliente, estado.fase)
  } else if (pareceNovaIntencaoDeCompra(mensagemCliente, estado.fase)) {
    // Nova intenção comercial explícita numa fase de compra já avançada —
    // nunca reaproveita CEP/cotação/endereço/pagamento antigos (Parte 1;
    // caso real observado em monitoramento 2026-07-21).
    estado = reiniciarJornada(mensagemCliente)
    intencao = classificarIntencao(mensagemCliente, estado.fase)
  }

  // Nova jornada (primeira mensagem real ou reinício) começando fora do
  // horário — mostra o aviso com opt-in antes de catálogo/formulário
  // (Parte 4). Nunca dispara de novo se esta jornada já foi aceita.
  if (estado.fase === 'inicio' && foraDoHorario && !estado.dados.aceitouForaDoHorario) {
    return { estado: { ...estado, fase: 'aviso_fora_horario' }, mensagem: mensagemAvisoForaDoHorarioComOpcao() }
  }

  // Cliente voltou só com uma saudação (sem informação nova) enquanto havia
  // um pedido em andamento e consistente — retoma o contexto real em vez de
  // avançar o funil como se fosse mensagem nova.
  if (FASES_COMPRA_EM_ANDAMENTO.includes(estado.fase) && pareceSaudacaoSimples(mensagemCliente)) {
    return { estado, mensagem: montarMensagemRetomada(estado.fase, estado.dados) }
  }

  // Pedido de foto pode acontecer em qualquer fase após haver produto(s) em jogo.
  if (intencao === 'foto_produto') {
    // Resolve exatamente qual produto foi pedido, nesta ordem: código/nome
    // citados na própria mensagem (mesmo que um produto já esteja
    // selecionado — o cliente pode estar pedindo a foto de OUTRA opção
    // apresentada antes), depois o produto já formalmente escolhido, e só
    // por último a recomendação principal, quando inequívoca. Código
    // duplicado entre opções nunca escolhe sozinho — pede desambiguação,
    // mesma regra da seleção de compra.
    const { produto: detectado, opcoesConflitantes } = detectarProdutoEscolhido(mensagemCliente, estado.dados.opcoesRecomendadas)
    if (opcoesConflitantes) {
      return { estado, mensagem: montarMensagemCodigoAmbiguo(opcoesConflitantes) }
    }
    const alvo = detectado ?? estado.dados.produto ?? estado.dados.opcoesRecomendadas?.[0] ?? undefined
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
    case 'aguardando_formulario':
      return etapaFormulario(estado, mensagemCliente)
    case 'confirmando_formulario':
      return etapaConfirmandoFormulario(estado, mensagemCliente, deps)
    case 'calculando_frete':
      return etapaCalculoFrete(estado, deps)
    case 'aguardando_aprovacao_frete':
      return etapaAguardandoAprovacaoFrete(estado, mensagemCliente, deps)
    // Fases antigas (fluxo campo-a-campo, substituído pelo formulário único
    // — Parte 2/3): nunca travam uma conversa que ainda esteja numa delas,
    // sempre reencaminham pro novo fluxo. 'aguardando_endereco'/
    // 'calculando_frete'/'endereco_completo' nunca reaproveitam
    // endereço/frete parciais do formato antigo — pedem o formulário do
    // zero. 'aguardando_confirmacao' com frete real já calculado equivale à
    // nova etapa de aprovação de frete (mais fiel ao que já foi comunicado
    // ao cliente); sem frete, volta pro formulário.
    case 'aguardando_endereco':
    case 'endereco_completo':
      return {
        estado: { ...estado, fase: 'aguardando_formulario', dados: { ...estado.dados, endereco: undefined, valorFrete: undefined, valorTotal: undefined, freteDetalhes: undefined } },
        mensagem: TEXTO_FORMULARIO_ENTREGA,
      }
    case 'aguardando_confirmacao':
      if (estado.dados.valorFrete != null && estado.dados.freteDetalhes) {
        return etapaAguardandoAprovacaoFrete({ ...estado, fase: 'aguardando_aprovacao_frete' }, mensagemCliente, deps)
      }
      return { estado: { ...estado, fase: 'aguardando_formulario' }, mensagem: TEXTO_FORMULARIO_ENTREGA }
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
