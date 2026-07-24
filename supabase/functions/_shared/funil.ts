/**
 * _shared/funil.ts (Deno/Supabase Edge Functions) — cópia sincronizada de
 * orchestrator/src/lib/funil.ts (Node/Render).
 *
 * DECISÃO DE ARQUITETURA (ver relatório final da integração do funil
 * comercial): o núcleo do funil (classificação de intenção, fases,
 * qualificação, dispatcher avancarFunil) é puro — zero imports, zero
 * chamada de rede — e portanto roda sem alteração tanto em Node quanto em
 * Deno. Ainda assim, Deno Edge Functions e o serviço Node do orchestrator
 * são bundles/deploys independentes: um import relativo cruzando
 * supabase/functions/ ↔ orchestrator/src/ não é garantidamente resolvido
 * pelo bundler de deploy de Edge Functions da Supabase. Em vez de arriscar
 * isso sem poder testar (não há Deno CLI disponível no ambiente onde esta
 * integração foi construída), optou-se por manter duas cópias do mesmo
 * código-fonte puro, com um teste de paridade em
 * orchestrator/src/lib/funil.parity.test.ts que falha caso as duas cópias
 * divirjam — ou seja, a "fonte única" é garantida por teste automatizado,
 * não por um grafo de import compartilhado.
 *
 * NÃO EDITE este arquivo isoladamente — qualquer mudança de regra de
 * negócio deve ser feita em orchestrator/src/lib/funil.ts e depois
 * copiada aqui (o teste de paridade avisa se isso for esquecido).
 *
 * Tudo abaixo desta linha é idêntico, caractere por caractere, a
 * orchestrator/src/lib/funil.ts.
 */
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
  /** Gate de retomada após intervalo sem interação (Parte 3) — aguardando o cliente escolher entre continuar o pedido anterior ou iniciar uma nova compra. */
  | 'retomada_apos_intervalo'

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
  /** Data de entrega solicitada, já reconhecida e validada (nunca no passado) — calculada a partir do texto livre do formulário só uma vez, na confirmação (ver etapaConfirmandoFormulario / Parte 2 "agendar pela data prometida"). Nunca reconstruída a partir de texto livre depois disso. */
  dataEntregaSolicitada?: DataCalendario
  /** Período preferido (manhã/tarde/noite), se informado e reconhecido — null/ausente usa o horário operacional padrão configurado. */
  periodoEntrega?: PeriodoEntrega | null
  /**
   * Janela de entrega já corrigida pra sempre ser cumprível (nunca promete um
   * horário que o lead time operacional não permite cumprir dado o horário
   * de funcionamento) — calculada UMA ÚNICA VEZ na cotação de frete (ver
   * etapaCalculoFrete / GO-LIVE Parte 4 "entrega agendada e promessa
   * possível") e mostrada ao cliente antes da aprovação do frete/pagamento.
   * O pedido persiste exatamente isto — nunca recalculado depois do
   * pagamento, pra nunca alterar silenciosamente a promessa já feita.
   */
  entregaPrometidaEmISO?: string
  /** Instante técnico (ISO) em que a corrida deve ser despachada — calculado junto com o campo acima. */
  despachoEmISO?: string
  /** true quando o despacho já pode acontecer assim que o pagamento for confirmado (sem precisar de agendamento). */
  entregaImediata?: boolean
  /** ISO da última mensagem processada do cliente — usado só para detectar intervalo sem interação (Parte 3), nunca para nenhuma outra decisão de negócio. */
  ultimaInteracaoEm?: string
  /** Fase em que a conversa estava antes do gate de retomada após intervalo (Parte 3) — restaurada quando o cliente escolhe continuar. */
  faseAntesDoIntervalo?: Fase
  /** CEP (valor exato) para o qual a consulta real ao ViaCEP (deps.consultarCep) já foi feita nesta jornada — evita reconsultar a cada mensagem; muda quando o cliente corrige o CEP, disparando nova consulta (ver etapaFormulario, coleta em duas etapas). */
  cepConsultadoViaApi?: string
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
  /** Resposta bruta (ex.: "sim"/"não") à pergunta do cartão impresso — interpretada via pareceConfirmacao. Campo opcional: ausência equivale a "não". */
  querCartaoImpresso?: string
  mensagemCartao?: string
}

// Cidade/UF nunca são pedidas no formulário (resolvidas pela consulta real
// do CEP no pipeline de logística, ver agente-logistica/index.ts — já
// resolve ViaCEP e só sinaliza divergência real); nunca reintroduzidas aqui
// como pergunta padrão. Ver decisão registrada em SECURITY_INCIDENTS/relato
// da tarefa: só entrariam como pergunta isolada numa eventual divergência
// tratada pelo pipeline de logística, não neste formulário conversacional.
export const CAMPOS_OBRIGATORIOS_FORMULARIO: (keyof FormularioEntregaDados)[] = [
  'nomeComprador', 'nomeDestinatario', 'telefoneDestinatario',
  'cep', 'rua', 'numero', 'bairro', 'dataEntrega',
]

export const CAMPOS_OPCIONAIS_FORMULARIO: (keyof FormularioEntregaDados)[] = [
  'complemento', 'cidade', 'uf', 'periodo', 'querCartaoImpresso', 'mensagemCartao',
]

const ROTULO_EXIBICAO_FORMULARIO: Record<keyof FormularioEntregaDados, string> = {
  nomeComprador: 'remetente',
  nomeDestinatario: 'destinatário',
  telefoneDestinatario: 'telefone do destinatário',
  cep: 'CEP',
  rua: 'rua e número',
  numero: 'número',
  complemento: 'complemento',
  bairro: 'bairro',
  cidade: 'cidade',
  uf: 'UF',
  dataEntrega: 'data de entrega',
  periodo: 'período ou horário preferido',
  querCartaoImpresso: 'confirmação se quer cartão impresso (sim ou não)',
  mensagemCartao: 'mensagem para o cartão',
}

// Coleta de entrega em duas etapas (substituiu o formulário único de 8
// campos numa mensagem só): a Etapa 1 pede só o operacional mínimo pra
// localizar o CEP; assim que o CEP chega, a Etapa 2 consulta o ViaCEP real
// (deps.consultarCep) e preenche rua/bairro/cidade/UF automaticamente — só
// pede número/complemento e o que a consulta não trouxer (ver etapaFormulario
// abaixo). Data de entrega e cartão continuam pedidos depois, pelo mecanismo
// já existente de campos faltantes (camposFaltandoFormulario) — nunca
// misturados com os quatro campos iniciais.
export const TEXTO_FORMULARIO_ENTREGA = `Para calcular a entrega, envie por favor:

Nome do remetente:
Nome do destinatário:
Telefone do destinatário:
CEP da entrega:`

// Rótulos aceitos por campo (já normalizados: sem acento, minúsculo, sem
// pontuação de marcação). O primeiro de cada lista é o rótulo canônico do
// formulário — os demais toleram pequenas variações reais de digitação.
const ROTULOS_ACEITOS_FORMULARIO: Record<keyof FormularioEntregaDados, string[]> = {
  nomeComprador: [
    'remetente', 'nome de quem esta fazendo o pedido', 'nome do comprador', 'quem esta fazendo o pedido',
    'quem esta pedindo', 'seu nome', 'nome de quem pede',
  ],
  nomeDestinatario: [
    'destinatario', 'nome de quem vai receber', 'nome do destinatario', 'quem vai receber',
  ],
  telefoneDestinatario: [
    'telefone do destinatario', 'telefone de quem vai receber, com ddd', 'telefone de quem vai receber',
    'telefone com ddd', 'telefone',
  ],
  cep: ['cep'],
  rua: ['rua e numero', 'rua ou avenida', 'rua/avenida', 'rua', 'avenida', 'logradouro', 'endereco'],
  numero: ['numero', 'nº', 'n°', 'n.'],
  complemento: ['complemento, se houver', 'complemento'],
  bairro: ['bairro'],
  cidade: ['cidade'],
  uf: ['uf', 'estado'],
  dataEntrega: ['data de entrega', 'data desejada para entrega', 'data desejada', 'data'],
  periodo: ['periodo ou horario preferido', 'periodo/horario', 'periodo', 'horario preferido', 'horario'],
  querCartaoImpresso: [
    'quer que enviemos um cartao impresso com uma mensagem personalizada', 'quer cartao impresso',
    'quer que enviemos um cartao impresso', 'cartao impresso',
  ],
  mensagemCartao: ['mensagem para o cartao, se desejar', 'mensagem para o cartao', 'mensagem do cartao', 'cartao'],
}

// Ordem de checagem importa: rótulos mais específicos (frases longas) antes
// dos mais genéricos, pra "nome de quem vai receber" nunca ser confundido
// com "nome de quem esta fazendo o pedido" só por conterem "nome" em comum.
const ORDEM_CAMPOS_FORMULARIO: (keyof FormularioEntregaDados)[] = [
  'telefoneDestinatario', 'nomeDestinatario', 'nomeComprador',
  'dataEntrega', 'periodo', 'complemento', 'querCartaoImpresso', 'mensagemCartao',
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

/** true quando o cliente confirmou explicitamente que quer cartão impresso — ausência de resposta nunca bloqueia (equivale a "não"). */
export function querCartaoImpresso(dados: FormularioEntregaDados): boolean {
  return dados.querCartaoImpresso != null && pareceConfirmacao(dados.querCartaoImpresso)
}

/** Campos obrigatórios que ainda faltam — nunca considera opcionais, exceto a mensagem do cartão, que só entra como obrigatória se o cliente confirmou que quer cartão impresso (Parte 2). */
export function camposFaltandoFormulario(dados: FormularioEntregaDados): (keyof FormularioEntregaDados)[] {
  const faltando = CAMPOS_OBRIGATORIOS_FORMULARIO.filter(c => !dados[c])
  if (querCartaoImpresso(dados) && !dados.mensagemCartao) faltando.push('mensagemCartao')
  return faltando
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

// ── Data e período de entrega — normalização determinística (Parte 2 da
// correção "fechar bloqueios do agendamento") ─────────────────────────────
//
// A logística (webhook-mercadopago/_shared/agendamento-entrega.ts, fora
// deste arquivo por depender de horário comercial) precisa de uma DATA
// TIPADA pra decidir quando despachar a corrida real — nunca de texto livre
// como "amanhã, a partir das 9h". Este bloco só RECONHECE e VALIDA padrões
// explícitos e inequívocos ("hoje", "amanhã", dia da semana, DD/MM[/AAAA]);
// qualquer outra coisa retorna null e a confirmação do pedido é bloqueada
// (ver etapaConfirmandoFormulario) até o cliente esclarecer — nunca adivinha
// uma data.

export interface DataCalendario { ano: number; mes: number; dia: number } // mes: 0-11, mesma convenção do Date

const DIAS_SEMANA_NOMES = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']

/** Lê a data de hoje no fuso America/Sao_Paulo a partir de um instante UTC — mesma técnica (sem métodos locais do Date) de _shared/horario-comercial.ts. */
function dataAtualBRT(agora: Date): DataCalendario & { diaSemana: number } {
  const deslocado = new Date(agora.getTime() - 3 * 60 * 60_000)
  return { ano: deslocado.getUTCFullYear(), mes: deslocado.getUTCMonth(), dia: deslocado.getUTCDate(), diaSemana: deslocado.getUTCDay() }
}

/** Soma dias a uma data de calendário — usa meio-dia UTC como pivô só pra normalizar overflow de mês/ano via o próprio Date, nunca pra decidir hora (isso é sempre calculado à parte, em horario-comercial.ts). */
function somarDiasCalendario(data: DataCalendario, dias: number): DataCalendario & { diaSemana: number } {
  const instante = new Date(Date.UTC(data.ano, data.mes, data.dia + dias, 12, 0, 0))
  return { ano: instante.getUTCFullYear(), mes: instante.getUTCMonth(), dia: instante.getUTCDate(), diaSemana: instante.getUTCDay() }
}

/**
 * Reconhece só "hoje", "amanhã", nome de dia da semana ("segunda",
 * "terça-feira"...) e datas explícitas DD/MM ou DD/MM/AAAA. Dia da semana
 * dito no próprio dia sempre significa a PRÓXIMA ocorrência (nunca hoje —
 * evita ambiguidade: "segunda" dito numa segunda não é natural pro mesmo
 * dia). Qualquer outro texto (datas por extenso, "semana que vem",
 * intervalos, etc.) retorna null.
 */
export function normalizarDataEntregaTexto(texto: string, agora: Date = new Date()): DataCalendario | null {
  const n = normalizar(texto).trim()
  const hojeBRT = dataAtualBRT(agora)
  const limpar = (d: DataCalendario): DataCalendario => ({ ano: d.ano, mes: d.mes, dia: d.dia })

  if (/^hoje\b/.test(n)) return limpar(hojeBRT)
  if (/^amanha\b/.test(n)) return limpar(somarDiasCalendario(hojeBRT, 1))

  const diaSemanaAlvo = DIAS_SEMANA_NOMES.findIndex(d => n.includes(d))
  if (diaSemanaAlvo !== -1) {
    const diff = ((diaSemanaAlvo - hojeBRT.diaSemana + 7) % 7) || 7
    return limpar(somarDiasCalendario(hojeBRT, diff))
  }

  const dataExplicita = n.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/)
  if (dataExplicita) {
    const dia = parseInt(dataExplicita[1], 10)
    const mes = parseInt(dataExplicita[2], 10) - 1
    let ano = dataExplicita[3] ? parseInt(dataExplicita[3], 10) : hojeBRT.ano
    if (ano < 100) ano += 2000
    if (mes < 0 || mes > 11 || dia < 1 || dia > 31) return null
    return { ano, mes, dia }
  }

  return null
}

function chaveComparavelData(d: DataCalendario): number {
  return d.ano * 10000 + d.mes * 100 + d.dia
}

/** Data reconhecida (não null) e não está no passado, comparada ao dia de hoje em BRT — nunca aceita silenciosamente uma data inválida ou já passada. */
export function dataEntregaValida(data: DataCalendario | null, agora: Date = new Date()): boolean {
  if (!data) return false
  return chaveComparavelData(data) >= chaveComparavelData(dataAtualBRT(agora))
}

/** Formato ISO (AAAA-MM-DD) pra persistir num campo `date` do banco — nunca guarda o texto livre original como se fosse a data operacional. */
export function dataCalendarioParaISO(data: DataCalendario): string {
  return `${String(data.ano).padStart(4, '0')}-${String(data.mes + 1).padStart(2, '0')}-${String(data.dia).padStart(2, '0')}`
}

export type PeriodoEntrega = 'manha' | 'tarde' | 'noite'

const PERIODOS_ENTREGA_ACEITOS: { periodo: PeriodoEntrega; termos: string[] }[] = [
  { periodo: 'manha', termos: ['manha', 'de manha'] },
  { periodo: 'tarde', termos: ['tarde', 'de tarde'] },
  { periodo: 'noite', termos: ['noite', 'de noite'] },
]

/** Reconhece só manhã/tarde/noite — período não reconhecido ou ausente retorna null (nunca inventa um período; a logística usa um horário operacional seguro configurado como padrão nesse caso). */
export function normalizarPeriodoEntregaTexto(texto?: string): PeriodoEntrega | null {
  if (!texto) return null
  const n = normalizar(texto)
  for (const p of PERIODOS_ENTREGA_ACEITOS) if (p.termos.some(t => n.includes(t))) return p.periodo
  return null
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
  'nova compra', 'nova jornada',
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

// ── Retomada após intervalo sem interação (Parte 3) ───────────────────────
//
// Diferente da retomada por saudação simples (acima): aqui o gatilho é
// puramente temporal — mais de 1h desde a última mensagem processada nesta
// conversa, com uma compra em andamento. Nunca dispara sozinho (só quando
// chega uma mensagem nova, ver avancarFunil) e nunca decide por conta
// própria: sempre pergunta objetivamente antes de continuar ou reiniciar.

const LIMITE_INTERVALO_RETOMADA_MS = 60 * 60_000 // 1 hora

export function mensagemRetomadaAposIntervalo(): string {
  return 'Você deseja continuar o pedido anterior ou prefere iniciar uma nova compra?'
}

/** true só quando há uma compra em andamento e mais de 1h já passou desde a última interação real registrada. */
export function deveGatilharRetomadaAposIntervalo(estado: EstadoConversa, agora: Date): boolean {
  if (!FASES_COMPRA_EM_ANDAMENTO.includes(estado.fase)) return false
  const ultima = estado.dados.ultimaInteracaoEm
  if (!ultima) return false
  return agora.getTime() - new Date(ultima).getTime() > LIMITE_INTERVALO_RETOMADA_MS
}

/**
 * Resolve a resposta do cliente ao gate de retomada — "nova compra" reinicia
 * a jornada (nunca reaproveita produto/endereço/frete/pagamento antigos);
 * "continuar"/confirmação restaura a fase salva e mostra o resumo real de
 * onde a conversa parou; qualquer outra coisa repete a pergunta, sem avançar
 * sozinho.
 */
function resolverRetomadaAposIntervalo(estado: EstadoConversa, mensagemCliente: string, agora: Date): ResultadoEtapa | null {
  const n = normalizar(mensagemCliente)
  if (FRASES_NOVO_PEDIDO.some(p => n.includes(normalizar(p)))) {
    return null // sinaliza pro chamador reiniciar a jornada e seguir o fluxo normal
  }
  const querContinuar = FRASES_CONTINUACAO.some(p => n.includes(normalizar(p))) || pareceConfirmacao(mensagemCliente)
  if (querContinuar) {
    const faseAnterior = estado.dados.faseAntesDoIntervalo ?? 'inicio'
    const dadosRestaurados: DadosPedido = { ...estado.dados, faseAntesDoIntervalo: undefined, ultimaInteracaoEm: agora.toISOString() }
    return {
      estado: { ...estado, fase: faseAnterior, dados: dadosRestaurados },
      mensagem: montarMensagemRetomada(faseAnterior, dadosRestaurados),
    }
  }
  return { estado, mensagem: mensagemRetomadaAposIntervalo() }
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

/** Fixa (dentro do horário) — nunca usada quando o pagamento foi confirmado fora do horário (ver mensagemPagamentoConfirmadoForaDoHorario). */
export function mensagemFinalizacao(): string {
  return 'Pagamento confirmado. Seu pedido foi registrado e será preparado para entrega. Qualquer atualização será enviada por aqui.'
}

/**
 * Pagamento confirmado enquanto a loja está fora do horário (Parte 5) —
 * nunca cria corrida imediata: preparação e logística ficam agendadas pro
 * horário comercial do próximo dia, mesmo quando o pagamento acontece antes
 * da abertura. Texto exato definido na tarefa.
 */
export function mensagemPagamentoConfirmadoForaDoHorario(): string {
  return 'Pagamento confirmado! Como estamos fora do horário da loja, seu pedido será preparado e seguirá para entrega a partir do horário comercial do próximo dia.'
}

// ── Horário comercial — aviso com opt-in no início de uma jornada (Parte 4/6) ──
//
// Regra oficial: todo o fluxo comercial (atendimento, catálogo, formulário,
// cotação real, aprovação, link, pagamento, confirmação, criação do pedido)
// pode acontecer normalmente fora do horário — só a corrida real (despacho)
// nunca acontece fora dele, decidida depois do pagamento (ver
// webhook-mercadopago). Texto exato definido na tarefa. Mostrado só uma vez
// por jornada (nunca repetido a cada mensagem — ver fase
// 'aviso_fora_horario'), nunca finaliza dizendo só que está fora do
// horário, nunca transfere pra humano só por isso, e nunca bloqueia
// pagamento depois que o cliente aceitou continuar.
export function mensagemAvisoForaDoHorarioComOpcao(): string {
  return 'Podemos concluir seu pedido agora. Como estamos fora do horário da loja, ele será preparado e entregue no próximo dia de funcionamento, dentro do horário comercial. Deseja continuar?'
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

// ── Validade da cotação real de frete (Parte 4) ───────────────────────────
//
// Validade máxima: o menor valor entre o expiresAt real devolvido pela
// Lalamove e cotadoEm + 30 minutos — nunca a cotação fica válida por mais
// tempo que isso, mesmo que a Lalamove informe um expiresAt maior. Sem
// cotadoEm registrado (nunca deveria acontecer numa cotação real — ver
// etapaCalculoFrete, que sempre grava), trata como vencida por segurança:
// nunca gera pagamento sobre uma cotação que não se sabe quando foi feita.
const VALIDADE_MAXIMA_COTACAO_MS = 30 * 60_000

function cotacaoValidaAteMs(detalhes: FreteDetalhes | undefined): number | null {
  if (!detalhes?.cotadoEm) return null
  const cotadoEmMs = new Date(detalhes.cotadoEm).getTime()
  const limiteMs = cotadoEmMs + VALIDADE_MAXIMA_COTACAO_MS
  if (!detalhes.expiresAt) return limiteMs
  const expiresAtMs = new Date(detalhes.expiresAt).getTime()
  return Math.min(limiteMs, expiresAtMs)
}

/** true quando a cotação real de frete já venceu (ou nunca foi registrada) — nunca gera link de pagamento nesse caso (Parte 4). */
export function cotacaoFreteVencida(detalhes: FreteDetalhes | undefined, agora: Date): boolean {
  const validaAteMs = cotacaoValidaAteMs(detalhes)
  if (validaAteMs == null) return true
  return agora.getTime() >= validaAteMs
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
  /**
   * Consulta real do CEP (ViaCEP) — preenche rua/bairro/cidade/UF
   * automaticamente antes de pedir esses campos ao cliente (coleta de
   * entrega em duas etapas). null = CEP sintaticamente válido mas não
   * localizado; campos ausentes no retorno (ex.: CEP "geral" de cidade
   * pequena, sem logradouro) são pedidos ao cliente isoladamente.
   */
  consultarCep: (cep: string) => Promise<{ rua?: string; bairro?: string; cidade?: string; uf?: string } | null>
  /**
   * Calcula a janela de entrega prometível (já corrigida pro horário de
   * funcionamento + lead time operacional) e o instante técnico de despacho
   * — síncrono e puro do lado de quem implementa (ver
   * _shared/agendamento-entrega.ts), injetado aqui pra funil.ts continuar
   * sem nenhum import externo (Parte 4 GO-LIVE).
   */
  calcularAgendamento: (dataEntrega: DataCalendario, periodoEntrega: PeriodoEntrega | null) => { entregaPrometidaEmISO: string; despachoEmISO: string; imediato: boolean }
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

/** Extrai "123" ou "123, apto 45" / "123 bloco B" de uma resposta livre (sem rótulos) à pergunta do número — usado só quando o CEP já foi resolvido em turno anterior e a mensagem atual não trouxe nenhum campo no formato "Rótulo: valor". Nunca inventa um número: mensagem que não começa com dígitos devolve null e o número continua sendo pedido. */
function extrairNumeroComplementoLivre(texto: string): { numero: string; complemento?: string } | null {
  const m = texto.trim().match(/^(\d+[a-zA-Z]?)\s*[,.\-–]?\s*(.*)$/)
  if (!m) return null
  const complemento = m[2].trim()
  return { numero: m[1], complemento: complemento || undefined }
}

/** Mensagem da Etapa 2 quando o ViaCEP devolve rua/bairro/cidade/UF completos — nunca pede confirmação do endereço em si (já veio de fonte real), só o que a consulta não pode saber: número e complemento. */
function mensagemEnderecoLocalizado(rua: string, bairro: string, cidade: string, uf: string): string {
  return `Localizei o endereço em ${rua}, ${bairro}, ${cidade}–${uf}. Qual é o número? Se houver apartamento, bloco ou outro complemento, informe também.`
}

/**
 * Coleta os dados de entrega em duas etapas (substituiu o formulário único
 * de 8 campos numa mensagem só):
 *
 * Etapa 1 — aceita nome do remetente/destinatário, telefone e CEP em
 * qualquer ordem, nunca repete o que já foi informado.
 *
 * Etapa 2 — assim que o CEP é sintaticamente válido e ainda não foi
 * consultado nesta jornada (ou foi corrigido pra um valor diferente),
 * consulta o ViaCEP real (deps.consultarCep) e preenche rua/bairro/cidade/UF
 * automaticamente; pede só número/complemento e os campos que a consulta não
 * trouxer (nunca pergunta o que o CEP já respondeu). CEP não localizado pede
 * pro cliente reenviar.
 *
 * Data de entrega e cartão personalizado continuam pedidos depois, pelo
 * mecanismo já existente de campos faltantes (camposFaltandoFormulario) —
 * nunca misturados com os quatro campos iniciais nem repetidos.
 */
async function etapaFormulario(estado: EstadoConversa, mensagemCliente: string, deps: DependenciasFunil): Promise<ResultadoEtapa> {
  const formularioAnterior = estado.dados.formulario ?? {}
  const extraido = extrairFormularioEntrega(mensagemCliente)
  let formularioAtual: FormularioEntregaDados = { ...formularioAnterior, ...extraido }
  let cepConsultadoViaApi = estado.dados.cepConsultadoViaApi
  const cepJaConsultadoAntesDesteTurno = !!formularioAnterior.cep && cepConsultadoViaApi === formularioAnterior.cep && formularioAnterior.cep === formularioAtual.cep

  const responder = (mensagem: string): ResultadoEtapa => ({
    estado: { ...estado, fase: 'aguardando_formulario', dados: { ...estado.dados, formulario: formularioAtual, cepConsultadoViaApi } },
    mensagem,
  })

  const cepInformadoInvalido = !!formularioAtual.cep && !cepValido(formularioAtual.cep)
  const telefoneInformadoInvalido = !!formularioAtual.telefoneDestinatario && !normalizarTelefoneDestinatarioBR(formularioAtual.telefoneDestinatario)

  if (cepInformadoInvalido) {
    return responder('O CEP informado não parece válido — pode confirmar (8 dígitos)?')
  }
  if (telefoneInformadoInvalido) {
    return responder('O telefone de quem vai receber não ficou claro — pode informar de novo, com DDD?')
  }

  if (formularioAtual.cep && cepValido(formularioAtual.cep) && cepConsultadoViaApi !== formularioAtual.cep) {
    const endereco = await deps.consultarCep(formularioAtual.cep)
    if (!endereco) {
      formularioAtual = { ...formularioAtual, cep: undefined }
      cepConsultadoViaApi = undefined
      return responder('Não consegui localizar esse CEP. Pode conferir e enviar novamente?')
    }
    formularioAtual = {
      ...formularioAtual,
      rua: formularioAtual.rua || endereco.rua || undefined,
      bairro: formularioAtual.bairro || endereco.bairro || undefined,
      cidade: formularioAtual.cidade || endereco.cidade || undefined,
      uf: formularioAtual.uf || endereco.uf || undefined,
    }
    cepConsultadoViaApi = formularioAtual.cep

    if (endereco.rua && endereco.bairro && endereco.cidade && endereco.uf && !formularioAtual.numero) {
      return responder(mensagemEnderecoLocalizado(endereco.rua, endereco.bairro, endereco.cidade, endereco.uf))
    }
  } else if (cepJaConsultadoAntesDesteTurno && !formularioAtual.numero && Object.keys(extraido).length === 0) {
    // CEP já resolvido num turno anterior e ainda esperando o número —
    // resposta livre (sem rótulos "Campo: valor"), nunca ignora um número
    // informado só porque não veio no formato do formulário.
    const numeroLivre = extrairNumeroComplementoLivre(mensagemCliente)
    if (numeroLivre) {
      formularioAtual = { ...formularioAtual, numero: numeroLivre.numero, complemento: formularioAtual.complemento || numeroLivre.complemento }
    }
  }

  // Endereço ainda incompleto após a consulta ao CEP: pede só o que falta
  // (rua e/ou bairro, quando o ViaCEP não trouxe, sempre junto do número),
  // isolado dos demais campos — nunca junto de remetente/destinatário/data.
  const faltandoEndereco = (['rua', 'numero', 'bairro'] as const).filter(c => !formularioAtual[c])
  if (!!formularioAtual.cep && cepConsultadoViaApi === formularioAtual.cep && faltandoEndereco.length > 0) {
    return responder(montarMensagemCamposFaltando(faltandoEndereco))
  }

  const faltando = camposFaltandoFormulario(formularioAtual)
  if (faltando.length > 0) {
    return responder(montarMensagemCamposFaltando(faltando))
  }

  // Telefone sempre normalizado pra E.164 antes de seguir — é o formato que
  // a Lalamove exige (Parte 2), nunca enviado "cru" pra frente.
  const telefoneE164 = normalizarTelefoneDestinatarioBR(formularioAtual.telefoneDestinatario!)!
  const formularioNormalizado = { ...formularioAtual, telefoneDestinatario: telefoneE164 }
  const novoEstado: EstadoConversa = { ...estado, fase: 'confirmando_formulario', dados: { ...estado.dados, formulario: formularioNormalizado, cepConsultadoViaApi } }
  return { estado: novoEstado, mensagem: montarResumoFormulario(formularioNormalizado) }
}

async function etapaCalculoFrete(estado: EstadoConversa, deps: DependenciasFunil, agora: Date): Promise<ResultadoEtapa> {
  // Cotação real acontece normalmente fora do horário comercial (regra
  // oficial: todo o fluxo comercial pode acontecer fora do horário) — só a
  // corrida real (despacho) nunca acontece fora dele, decidida depois do
  // pagamento (ver webhook-mercadopago). A validade máxima da cotação
  // (30min/expiresAt real da Lalamove) continua valendo do mesmo jeito,
  // dentro ou fora do horário — ver cotacaoFreteVencida.
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
  // cotadoEm é a fonte da validade da cotação (Parte 4, ver
  // cotacaoFreteVencida) — sempre gravado aqui quando há detalhes reais,
  // mesmo que o provedor não devolva o campo, pra nunca ficar sem saber
  // quando a cotação foi feita. Sem detalhes (nunca deveria acontecer numa
  // cotação real bem-sucedida), freteDetalhes fica undefined como antes —
  // cotacaoFreteVencida já trata ausência de cotadoEm como vencida.
  const freteDetalhes: FreteDetalhes | undefined = resultado.detalhes
    ? { ...resultado.detalhes, cotadoEm: resultado.detalhes.cotadoEm ?? agora.toISOString() }
    : undefined
  let dados: DadosPedido = { ...estado.dados, valorFrete, valorTotal, freteDetalhes }
  // Calcula (uma única vez) a janela de entrega já corrigida pro horário de
  // funcionamento + lead time operacional — GO-LIVE Parte 4 "nunca prometer
  // uma janela impossível". Só quando a data já foi tipada (sempre o caso
  // vindo de etapaConfirmandoFormulario; o atalho de "e o frete?" antes do
  // formulário completo ainda não tem isso, e o guard de dados incompletos
  // em etapaAguardandoAprovacaoFrete pede o formulário antes de prosseguir).
  if (dados.dataEntregaSolicitada) {
    const agendamento = deps.calcularAgendamento(dados.dataEntregaSolicitada, dados.periodoEntrega ?? null)
    dados = {
      ...dados,
      entregaPrometidaEmISO: agendamento.entregaPrometidaEmISO,
      despachoEmISO: agendamento.despachoEmISO,
      entregaImediata: agendamento.imediato,
    }
  }
  const novoEstado: EstadoConversa = { ...estado, fase: 'aguardando_aprovacao_frete', dados }
  return { estado: novoEstado, mensagem: montarMensagemAprovacaoFrete(dados) }
}

/** Formata a janela de entrega prometida (BRT) pra exibição — texto simples, sem depender de nenhum import de horário (Parte 4). */
function textoJanelaPrometida(entregaPrometidaEmISO: string): string {
  const d = new Date(entregaPrometidaEmISO)
  const dataFmt = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
  const horaFmt = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  return `${dataFmt}, a partir das ${horaFmt}`
}

/** Nunca cobra antes de cotar e aprovar o frete — esta mensagem é o único lugar que apresenta subtotal/frete/total antes do link de pagamento (Parte 3). */
function montarMensagemAprovacaoFrete(dados: DadosPedido): string {
  const p = dados.produto
  const subtotal = p?.preco != null ? p.preco * (p.quantidade ?? 1) : 0
  const transportadora = dados.freteDetalhes?.transportadora
  const servico = dados.freteDetalhes?.servico
  const linhaFrete = `Frete${transportadora ? ` (${transportadora}${servico ? ` — ${servico}` : ''})` : ''}: ${formatarPreco(dados.valorFrete)}`
  const linhaEntrega = dados.entregaPrometidaEmISO ? `Entrega prevista: ${textoJanelaPrometida(dados.entregaPrometidaEmISO)}` : null
  return [
    `Subtotal: ${formatarPreco(subtotal)}`,
    linhaFrete,
    linhaEntrega,
    `Total: ${formatarPreco(dados.valorTotal)}`,
    '',
    'Você aprova o frete e o total?',
  ].filter((l): l is string => l !== null).join('\n')
}

/** Coleta a confirmação dos dados do formulário — nunca cota frete antes disso (Parte 3.3/3.4). Cliente pode corrigir um campo em vez de confirmar; nunca perde os dados já certos. */
async function etapaConfirmandoFormulario(estado: EstadoConversa, mensagemCliente: string, deps: DependenciasFunil, agora: Date): Promise<ResultadoEtapa> {
  if (!pareceConfirmacao(mensagemCliente)) {
    const correcao = extrairFormularioEntrega(mensagemCliente)
    if (Object.keys(correcao).length > 0) {
      const formularioAtualizado = { ...(estado.dados.formulario ?? {}), ...correcao }
      // Corrigir qualquer campo do formulário invalida uma cotação anterior
      // (Parte 4: "mudança de endereço invalida a cotação") — nunca deixa
      // uma cotação de um endereço/data diferente sobreviver pra aprovação.
      const dadosSemCotacaoAntiga: DadosPedido = {
        ...estado.dados,
        formulario: formularioAtualizado,
        valorFrete: undefined, valorTotal: undefined, freteDetalhes: undefined,
        entregaPrometidaEmISO: undefined, despachoEmISO: undefined, entregaImediata: undefined,
      }
      return {
        estado: { ...estado, dados: dadosSemCotacaoAntiga },
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

  // Data de entrega tem que ser reconhecível e nunca no passado ANTES de
  // seguir — nunca gera pagamento (nem sequer cota frete) com uma data
  // inválida/ambígua; o cliente precisa corrigir primeiro (Parte 2 "agendar
  // pela data prometida, não pelo horário do pagamento").
  const dataParseada = normalizarDataEntregaTexto(estado.dados.formulario.dataEntrega ?? '')
  if (!dataEntregaValida(dataParseada)) {
    return {
      estado: { ...estado, fase: 'confirmando_formulario' },
      mensagem: 'Não consegui identificar a data de entrega — pode confirmar usando "hoje", "amanhã", o dia da semana ou uma data no formato DD/MM?',
    }
  }

  const estadoSincronizado = sincronizarFormularioParaEndereco(estado)
  const dadosComDataTipada: DadosPedido = {
    ...estadoSincronizado.dados,
    dataEntregaSolicitada: dataParseada!,
    periodoEntrega: normalizarPeriodoEntregaTexto(estado.dados.formulario.periodo),
  }
  return etapaCalculoFrete({ ...estadoSincronizado, dados: dadosComDataTipada, fase: 'calculando_frete' }, deps, agora)
}

async function etapaAguardandoAprovacaoFrete(estado: EstadoConversa, mensagemCliente: string, deps: DependenciasFunil, agora: Date): Promise<ResultadoEtapa> {
  // Cotação vencida nunca pode gerar pagamento (Parte 4) — checado antes de
  // interpretar a resposta do cliente, pra nunca aprovar um total calculado
  // sobre uma cotação já vencida. Sempre recota e apresenta o total
  // atualizado — cotação real acontece normalmente fora do horário também
  // (regra oficial), só a corrida real nunca acontece fora dele.
  if (cotacaoFreteVencida(estado.dados.freteDetalhes, agora)) {
    return etapaCalculoFrete({ ...estado, fase: 'calculando_frete' }, deps, agora)
  }

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
 *   Só usado pro aviso com opt-in no início de uma jornada nova (Parte 6):
 *   todo o resto do fluxo comercial (catálogo, formulário, cotação real,
 *   aprovação, link, pagamento) acontece normalmente fora do horário — só a
 *   corrida real nunca acontece fora dele, decidida depois do pagamento.
 * @param proximoHorarioTexto Texto pronto ("amanhã (terça-feira), a partir das
 *   9h") pra ajustar "hoje" quando a jornada foi aceita fora do horário (Parte 4).
 * @param agora Instante atual — injetável só pra testes determinísticos (Parte
 *   3/4: retomada após intervalo e validade da cotação); em produção sempre o
 *   padrão (agora real).
 */
export async function avancarFunil(
  estadoRecebido: EstadoConversa,
  mensagemCliente: string,
  intencao: Intencao,
  deps: DependenciasFunil,
  foraDoHorario = false,
  proximoHorarioTexto?: string,
  agora: Date = new Date(),
): Promise<ResultadoEtapa> {
  let estado: EstadoConversa = { ...estadoRecebido, dados: extrairDadosQualificacao(mensagemCliente, estadoRecebido.dados) }

  // Gate de retomada após intervalo sem interação (Parte 3): verificado
  // antes de qualquer outro gate. Nunca dispara sozinho — só quando chega
  // esta mensagem nova. "nova compra" segue pro reinício normal de jornada
  // logo abaixo (estadoComPedidoInconsistente/pareceNovaIntencaoDeCompra
  // nunca disparam aqui pois a fase é 'retomada_apos_intervalo').
  if (estado.fase === 'retomada_apos_intervalo') {
    const resolucao = resolverRetomadaAposIntervalo(estado, mensagemCliente, agora)
    if (resolucao) return resolucao
    estado = reiniciarJornada(mensagemCliente)
    intencao = classificarIntencao(mensagemCliente, estado.fase)
  } else if (deveGatilharRetomadaAposIntervalo(estado, agora)) {
    return {
      estado: {
        ...estado,
        fase: 'retomada_apos_intervalo',
        dados: { ...estado.dados, faseAntesDoIntervalo: estado.fase, ultimaInteracaoEm: agora.toISOString() },
      },
      mensagem: mensagemRetomadaAposIntervalo(),
    }
  }
  // Marca esta mensagem como a última interação real — sempre, em qualquer
  // caminho que chegue até aqui (nunca só num dos ramos acima), pra o gate
  // de intervalo continuar funcionando em mensagens futuras desta mesma
  // conversa (Parte 3).
  estado = { ...estado, dados: { ...estado.dados, ultimaInteracaoEm: agora.toISOString() } }

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
    return etapaCalculoFrete(estadoComCep, deps, agora)
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
      return etapaFormulario(estado, mensagemCliente, deps)
    case 'confirmando_formulario':
      return etapaConfirmandoFormulario(estado, mensagemCliente, deps, agora)
    case 'calculando_frete':
      return etapaCalculoFrete(estado, deps, agora)
    case 'aguardando_aprovacao_frete':
      return etapaAguardandoAprovacaoFrete(estado, mensagemCliente, deps, agora)
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
        return etapaAguardandoAprovacaoFrete({ ...estado, fase: 'aguardando_aprovacao_frete' }, mensagemCliente, deps, agora)
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
 *
 * @param foraDoHorario Calculado pelo chamador no instante real da
 *   confirmação (ver _shared/horario-comercial.ts) — Parte 5: pagamento
 *   confirmado fora do horário nunca cria corrida imediata, mesmo que a
 *   cotação/aprovação tenha acontecido dentro do horário; a preparação e a
 *   logística ficam agendadas pro horário comercial do próximo dia, mesmo
 *   quando o pagamento acontece antes da abertura.
 * @param proximaAberturaComercialISO Instante ISO da próxima abertura,
 *   calculado pelo chamador — só usado quando foraDoHorario é true.
 */
export async function processarConfirmacaoPagamento(
  estado: EstadoConversa,
  paymentIdConfirmadoPeloProvedor: string,
  criar: CriadorPedido,
  foraDoHorario = false,
  proximaAberturaComercialISO?: string,
): Promise<ResultadoEtapa> {
  let confirmado = confirmarPagamento(estado, paymentIdConfirmadoPeloProvedor)
  if (foraDoHorario) {
    confirmado = {
      ...confirmado,
      dados: {
        ...confirmado.dados,
        entregaImediata: false,
        ...(proximaAberturaComercialISO ? { despachoEmISO: proximaAberturaComercialISO } : {}),
      },
    }
  }
  const finalizado = await criarPedidoEtapa(confirmado, criar)
  return { estado: finalizado, mensagem: foraDoHorario ? mensagemPagamentoConfirmadoForaDoHorario() : mensagemFinalizacao() }
}
