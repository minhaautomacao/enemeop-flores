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
  /** Gate de reaproveitamento de dados ao reiniciar/trocar o produto de um pedido — aguardando o cliente confirmar se quer reusar o formulário de entrega (destinatário/endereço/telefone) já coletado antes, ou informar dados novos (feedback direto do usuário, monitoramento 2026-07-24). */
  | 'aguardando_reaproveitar_dados'

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

// ── Camada de interpretação contextual de intenção (Parte "correção
// estrutural" — substitui comparação de frases fixas em pontos de ambiguidade
// real) ────────────────────────────────────────────────────────────────────
//
// Diferente de `Intencao` acima (que classifica sobre O QUE o cliente está
// falando — frete, pagamento, disponibilidade...), `IntencaoContextual`
// classifica QUAL das opções em aberto numa pergunta pendente da Flora a
// resposta do cliente resolve. É um eixo ortogonal, só relevante quando existe
// uma pergunta pendente (`DadosPedido.ultimaPergunta`, ver abaixo) — nunca
// substitui `classificarIntencao`, complementa os gates que hoje decidem só
// por lista fixa de frases (`pareceConfirmacao`/`pareceNegacao`/
// `FRASES_NOVO_PEDIDO`/etc.), permitindo estendê-los sem espalhar `if`s novos
// pelo funil inteiro.
export type IntencaoContextual =
  | 'continuar_pedido_anterior'
  | 'iniciar_nova_compra'
  | 'retomar_atendimento'
  | 'escolher_produto'
  | 'trocar_produto'
  | 'trocar_pedido'
  | 'alterar_quantidade'
  | 'corrigir_informacao'
  | 'substituir_informacao'
  | 'remover_informacao'
  | 'confirmar'
  | 'negar'
  | 'cancelar'
  | 'desistir'
  | 'voltar_etapa'
  | 'avancar'
  | 'fornecer_dado'
  | 'perguntar_preco'
  | 'perguntar_disponibilidade'
  | 'perguntar_prazo'
  | 'perguntar_entrega'
  | 'pedir_recomendacao'
  | 'alterar_destinatario'
  | 'alterar_endereco'
  | 'alterar_data'
  | 'alterar_horario'
  | 'alterar_mensagem_cartao'
  | 'falar_com_humano'
  | 'fora_de_contexto'
  | 'ambigua'
  | 'incompleta'

export type NivelConfianca = 'alta' | 'media' | 'baixa'

/**
 * Contrato estruturado e auditável devolvido pela camada de interpretação
 * contextual (via LLM, ver `DependenciasFunil.interpretarIntencao`) — nunca
 * usado sem passar antes por `validarRespostaInterpretacao`. Nunca contém
 * decisão comercial (preço, disponibilidade, regra de negócio) — só intenção
 * e entidades extraídas do texto do cliente; quem decide preço/disponibilidade
 * continua sendo o código determinístico existente (`selecionarRecomendacoes`,
 * `revalidarProduto`, etc.), nunca este resultado.
 */
export interface ResultadoInterpretacao {
  intencaoPrimaria: IntencaoContextual
  /** Múltiplas intenções na mesma mensagem (ex.: "quero continuar, mas com outro produto") — nunca descartadas, preservadas em ordem. */
  intencoesSecundarias: IntencaoContextual[]
  /** Valores extraídos do texto (nunca inventados) — ex.: {"produto": "outro"}. */
  entidades: Record<string, string | number>
  camposParaAtualizar: string[]
  confianca: NivelConfianca
  /** Trecho/paráfrase curta do texto do cliente que evidencia a intenção — trilha de auditoria (nunca usado pra decisão, só pra registro/telemetria). */
  evidenciaContextual: string
  acaoRecomendada: string
  precisaEsclarecimento: boolean
}

const INTENCOES_CONTEXTUAIS_VALIDAS = new Set<IntencaoContextual>([
  'continuar_pedido_anterior', 'iniciar_nova_compra', 'retomar_atendimento',
  'escolher_produto', 'trocar_produto', 'trocar_pedido', 'alterar_quantidade',
  'corrigir_informacao', 'substituir_informacao', 'remover_informacao',
  'confirmar', 'negar', 'cancelar', 'desistir', 'voltar_etapa', 'avancar',
  'fornecer_dado', 'perguntar_preco', 'perguntar_disponibilidade', 'perguntar_prazo',
  'perguntar_entrega', 'pedir_recomendacao', 'alterar_destinatario', 'alterar_endereco',
  'alterar_data', 'alterar_horario', 'alterar_mensagem_cartao', 'falar_com_humano',
  'fora_de_contexto', 'ambigua', 'incompleta',
])
const NIVEIS_CONFIANCA_VALIDOS = new Set<NivelConfianca>(['alta', 'media', 'baixa'])

/**
 * Validação hand-rolled (sem zod/ajv — este arquivo nunca importa nada, ver
 * cabeçalho) do JSON bruto devolvido pelo modelo. Qualquer campo fora do
 * formato esperado invalida o resultado inteiro — nunca aceita parcialmente,
 * nunca corrige/completa o que faltar. Resultado inválido é tratado
 * exatamente como indisponibilidade do modelo (cai no fallback determinístico
 * de quem chamou, ver `interpretarComFallback`).
 */
export function validarRespostaInterpretacao(bruto: unknown): ResultadoInterpretacao | null {
  if (!bruto || typeof bruto !== 'object') return null
  const r = bruto as Record<string, unknown>
  if (typeof r.intencaoPrimaria !== 'string' || !INTENCOES_CONTEXTUAIS_VALIDAS.has(r.intencaoPrimaria as IntencaoContextual)) return null
  if (typeof r.confianca !== 'string' || !NIVEIS_CONFIANCA_VALIDOS.has(r.confianca as NivelConfianca)) return null
  if (typeof r.evidenciaContextual !== 'string') return null
  if (typeof r.acaoRecomendada !== 'string') return null
  if (typeof r.precisaEsclarecimento !== 'boolean') return null
  const intencoesSecundarias = Array.isArray(r.intencoesSecundarias)
    ? r.intencoesSecundarias.filter((i): i is IntencaoContextual => typeof i === 'string' && INTENCOES_CONTEXTUAIS_VALIDAS.has(i as IntencaoContextual))
    : []
  const entidades = (r.entidades && typeof r.entidades === 'object' && !Array.isArray(r.entidades))
    ? Object.fromEntries(Object.entries(r.entidades as Record<string, unknown>).filter((entry): entry is [string, string | number] => typeof entry[1] === 'string' || typeof entry[1] === 'number'))
    : {}
  const camposParaAtualizar = Array.isArray(r.camposParaAtualizar)
    ? r.camposParaAtualizar.filter((c): c is string => typeof c === 'string')
    : []
  return {
    intencaoPrimaria: r.intencaoPrimaria as IntencaoContextual,
    intencoesSecundarias,
    entidades,
    camposParaAtualizar,
    confianca: r.confianca as NivelConfianca,
    evidenciaContextual: r.evidenciaContextual,
    acaoRecomendada: r.acaoRecomendada,
    precisaEsclarecimento: r.precisaEsclarecimento,
  }
}

/**
 * Chama a camada de interpretação contextual com proteção completa: se a
 * dependência não estiver conectada (canal ainda sem rollout, ou teste sem
 * essa dependência fake), se o modelo expirar, falhar ou devolver algo que
 * não valida no schema, devolve `null` — NUNCA lança exceção, nunca trava o
 * atendimento. Quem chama trata `null` exatamente como "sem sinal do
 * interpretador", caindo no fallback determinístico do próprio gate.
 */
async function interpretarComFallback(
  deps: DependenciasFunil,
  systemPrompt: string,
  mensagemCliente: string,
  timeoutMs = 3000,
): Promise<ResultadoInterpretacao | null> {
  if (!deps.interpretarIntencao) return null
  try {
    const bruto = await deps.interpretarIntencao(systemPrompt, mensagemCliente, timeoutMs)
    if (!bruto) return null
    const semCercas = bruto.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(semCercas)
    return validarRespostaInterpretacao(parsed)
  } catch {
    return null
  }
}

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
  /** Formulário de entrega completo salvo antes de reiniciar a jornada (troca de produto/novo pedido) — só existe durante a fase 'aguardando_reaproveitar_dados', enquanto aguarda o cliente decidir se reaproveita esses dados ou informa dados novos. Nunca persiste além dessa decisão. */
  formularioAnterior?: FormularioEntregaDados
  /** true logo depois que a Flora pergunta o link/nome exato de um produto citado que a busca real não encontrou — a PRÓXIMA mensagem é tratada como a resposta a essa pergunta (busca ao vivo direto, sem precisar repetir "site"/"não está no catálogo"). Limpo assim que a próxima mensagem é processada, sucesso ou não. */
  aguardandoNomeProdutoCitado?: boolean
  /**
   * Registro estruturado da última pergunta pendente feita pela Flora — dá
   * peso contextual real à resposta do cliente na camada de interpretação
   * (ver `IntencaoContextual`/`interpretarComFallback`): a mesma resposta
   * ("esse mesmo", "pode") significa coisas diferentes dependendo de qual
   * pergunta está em aberto. `chave` é um identificador estável do gate
   * (ex.: 'retomada_apos_intervalo') — nunca o texto em si, pra sobreviver a
   * reformulações (ver `tentativasInterpretacao`). Nunca usado sozinho pra
   * decidir nada — só como evidência que a interpretação consome junto da
   * mensagem atual.
   */
  ultimaPergunta?: { chave: string; textoExibido: string; intentsValidas: IntencaoContextual[] }
  /**
   * Contador de tentativas de interpretação sem sucesso, por chave de
   * pergunta pendente (`ultimaPergunta.chave`) — motor da proteção anti-loop.
   * Persiste no mesmo JSONB que o resto de `dados` (nenhuma migration nova).
   * Nunca reseta sozinho/silenciosamente — só no único caminho de sucesso de
   * cada gate (ver `resolverRetomadaAposIntervalo`), nunca por mudança de
   * fase nem por reinício de jornada disfarçado.
   */
  tentativasInterpretacao?: Record<string, number>
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
CEP da entrega:
Número:
Complemento (se houver):`

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

/** Nomes reconhecidos de complemento — só um destes, sozinho na frase, nunca um adjetivo qualquer interpretado como complemento. */
const COMPLEMENTOS_CONHECIDOS_LIVRE = ['apartamento', 'apto', 'ap', 'bloco', 'sobrado', 'fundos', 'sala', 'casa']

/**
 * Extrai vários campos de UMA mensagem em linguagem natural, sem nenhum
 * rótulo "Campo: valor" — ex.: "Carlos enviar para Maria. O celular dela é
 * 11948579179, cep 04204-001 numero 1223, casa" (caso real observado num
 * pedido real em produção, 2026-07-31: extrairFormularioEntrega não achava
 * nada porque a mensagem não tem nenhum ":", e a Flora ficava repetindo o
 * mesmo formulário pedido). Só chamada quando extrairFormularioEntrega não
 * reconheceu nenhum campo rotulado (ver etapaFormulario) — nunca compete com
 * um formulário rotulado real.
 *
 * Diferente de interpretarTelefoneLivre/extrairNumeroComplementoLivre (que
 * tratam a mensagem INTEIRA como um único campo isolado): aqui vários campos
 * coexistem na mesma frase. Cada um só é reconhecido por um padrão de alta
 * confiança — nunca adivinha:
 *   - CEP: 8 dígitos (com/sem hífen) nunca se confunde com telefone (10-11
 *     dígitos) só pela contagem de dígitos.
 *   - Telefone: procurado DEPOIS de remover o CEP já encontrado do texto
 *     (evita ler os 8 dígitos do CEP como parte de um telefone), validado
 *     pela mesma normalizarTelefoneDestinatarioBR usada em todo o resto do
 *     formulário — candidato que não validar é descartado, nunca salvo.
 *   - Número da casa: só reconhecido com a palavra "número"/"nº" citada
 *     explicitamente do lado — nunca um número solto qualquer (poderia ser
 *     o CEP ou o telefone mal segmentados).
 *   - Complemento: só uma palavra de uma lista curta e conhecida
 *     (COMPLEMENTOS_CONHECIDOS_LIVRE) — nunca um texto livre qualquer.
 *   - Nomes: só no padrão explícito "X enviar/mandar para Y" ou "de X para
 *     Y" — fora desse conectivo claro, nunca tenta adivinhar quem é
 *     remetente e quem é destinatário.
 * Qualquer campo fora desses padrões simplesmente não aparece no resultado
 * — continua sendo pedido normalmente, nunca inventado.
 */
export function extrairFormularioEntregaLivre(texto: string): FormularioEntregaDados {
  const dados: FormularioEntregaDados = {}

  const mCep = texto.match(/\b\d{5}-?\d{3}\b/)
  if (mCep) dados.cep = mCep[0]

  const semCep = mCep ? texto.replace(mCep[0], ' ') : texto
  const candidatosTelefone = semCep.match(/(?:\+?55\s?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g) ?? []
  for (const candidato of candidatosTelefone) {
    const normalizado = normalizarTelefoneDestinatarioBR(candidato)
    if (normalizado) { dados.telefoneDestinatario = normalizado; break }
  }

  const mNumero = texto.match(/\bn[uú]mero\s*[:\-]?\s*(\d{1,5})\b/i) ?? texto.match(/\bn[º°]\s*(\d{1,5})\b/i)
  if (mNumero) dados.numero = mNumero[1]

  const reComplemento = new RegExp(`\\b(${COMPLEMENTOS_CONHECIDOS_LIVRE.join('|')})\\b.*$`, 'i')
  const mComplemento = texto.match(reComplemento)
  if (mComplemento) dados.complemento = mComplemento[0].trim()

  const mNomes =
    texto.match(/\b([A-ZÀ-Ýa-zà-ÿ]+)\s+(?:enviar|mandar|manda|envia)\s+(?:pra|para)\s+([A-ZÀ-Ýa-zà-ÿ]+)/i) ??
    texto.match(/\bde\s+([A-ZÀ-Ýa-zà-ÿ]+)\s+(?:pra|para)\s+([A-ZÀ-Ýa-zà-ÿ]+)\b/i)
  if (mNomes) {
    dados.nomeComprador = mNomes[1]
    dados.nomeDestinatario = mNomes[2]
  }

  return dados
}

/** true quando o cliente confirmou explicitamente que quer cartão impresso — ausência de resposta nunca bloqueia (equivale a "não"). */
export function querCartaoImpresso(dados: FormularioEntregaDados): boolean {
  return dados.querCartaoImpresso != null && pareceConfirmacao(dados.querCartaoImpresso)
}

/** Campos obrigatórios que ainda faltam — nunca considera opcionais, exceto a mensagem do cartão, que só entra como obrigatória se o cliente confirmou que quer cartão impresso (Parte 2). */
export function camposFaltandoFormulario(dados: FormularioEntregaDados): (keyof FormularioEntregaDados)[] {
  const faltando = CAMPOS_OBRIGATORIOS_FORMULARIO.filter(c => {
    // Telefone nunca conta como "presente" só por ser truthy — um valor que
    // não sobrevive à normalização (ex.: um valor inválido que tenha
    // chegado ao estado por algum outro caminho) tem que voltar a ser
    // pedido, nunca seguir adiante pra ser silenciosamente descartado na
    // normalização final (ver etapaFormulario).
    if (c === 'telefoneDestinatario') return !dados.telefoneDestinatario || !normalizarTelefoneDestinatarioBR(dados.telefoneDestinatario)
    return !dados[c]
  })
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

/**
 * Formata um telefone já normalizado (E.164, +55DDDNÚMERO) pro padrão
 * brasileiro de exibição — a Flora nunca mostra o "+55" pro cliente, só
 * usado internamente (E.164 é exigido por Meta/WhatsApp/Mercado Pago/
 * Lalamove). Nunca migra nem reescreve o valor armazenado — só formata na
 * hora de montar a mensagem. Valor em formato inesperado é devolvido como
 * veio, nunca quebra a mensagem.
 */
export function formatarTelefoneExibicao(telefone: string): string {
  const digitos = telefone.replace(/\D/g, '')
  const semDDI = digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)
    ? digitos.slice(2)
    : digitos
  if (semDDI.length === 11) return `(${semDDI.slice(0, 2)}) ${semDDI.slice(2, 7)}-${semDDI.slice(7)}`
  if (semDDI.length === 10) return `(${semDDI.slice(0, 2)}) ${semDDI.slice(2, 6)}-${semDDI.slice(6)}`
  return telefone
}

/** Resumo sanitizado do formulário pra confirmação — nunca mostra o CEP sozinho sem o resto do endereço, nem inventa campo ausente. */
export function montarResumoFormulario(dados: FormularioEntregaDados): string {
  const linhas = [
    'Confere os dados de entrega?',
    '',
    dados.nomeComprador ? `- Pedido de: ${dados.nomeComprador}` : null,
    dados.nomeDestinatario ? `- Destinatário: ${dados.nomeDestinatario}` : null,
    dados.telefoneDestinatario ? `- Telefone do destinatário: ${formatarTelefoneExibicao(dados.telefoneDestinatario)}` : null,
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
  'governo', 'religiao', 'deus existe', 'igreja', 'biblia', 'jesus',
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
  'nova compra', 'nova jornada', 'nova encomenda', 'comecar de novo', 'iniciar novamente',
  // Caso real observado em monitoramento 2026-07-24 (retomada de pagamento
  // recusado): "cancele este pedido. Vamos fazer um novo" não batia com
  // nenhuma frase acima — caía no case fase-específico de
  // aguardando_pagamento, que sempre reenvia o link antigo, ignorando o
  // pedido explícito de cancelar/recomeçar.
  'cancelar pedido', 'cancele o pedido', 'cancele este pedido', 'cancelar este pedido',
  'vamos fazer um novo',
  // Caso real observado em monitoramento 2026-07-24 (2ª ocorrência, agora em
  // aguardando_pagamento com link já gerado): "Quero trocar o produto"
  // também caía no case fase-específico que sempre reenvia o link antigo,
  // ignorando o pedido explícito de trocar. Nunca "mudar o produto" — essa
  // frase, numa resposta negativa ao resumo do frete (aguardando_aprovacao_
  // frete), tem que continuar SEM reiniciar a jornada (comportamento já
  // coberto por teste existente); "trocar" não colide com esse caso.
  'trocar o produto', 'trocar produto',
  // Bug real observado em monitoramento: "Quero trocar o pedido" (não
  // "produto") caía no mesmo caso fase-específico de repetir a pergunta de
  // retomada indefinidamente — só "trocar o produto"/"trocar produto"
  // estavam cobertos, nunca a variante mais comum com "pedido".
  'trocar o pedido', 'trocar pedido',
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

// Subconjunto de FRASES_NOVO_PEDIDO que é puramente sobre CANCELAR (nunca
// sobre trocar/começar um pedido novo) — historicamente agrupado junto
// pra resolver um bug real ("cancele este pedido. Vamos fazer um novo"
// ficava preso repetindo o link de pagamento antigo, ver monitoramento
// 2026-07-24). Mas cancelamento PURO (sem nenhum sinal de que o cliente
// quer um pedido novo na mesma mensagem) nunca deveria reiniciar a jornada
// SILENCIOSAMENTE — reiniciar apaga produto/formulário/frete já coletados
// sem o cliente nunca ter confirmado que é isso que ele quer (Prioridade:
// "cancelamento, desistência e negativa indireta" tratados à parte de
// "iniciar nova compra"; critério de rollout "zero cancelamento indevido").
// Mensagens compostas (cancelar + sinal explícito de novo pedido/troca na
// MESMA mensagem) continuam reiniciando direto — comportamento já coberto
// pelo teste existente, nunca alterado aqui.
const FRASES_CANCELAMENTO_PEDIDO = ['cancelar pedido', 'cancele o pedido', 'cancele este pedido', 'cancelar este pedido']

export function pareceApenasCancelamento(mensagem: string, faseAtual: Fase): boolean {
  if (!FASES_COMPRA_EM_ANDAMENTO.includes(faseAtual)) return false
  const n = normalizarFrase(mensagem)
  const temFraseDeCancelamento = FRASES_CANCELAMENTO_PEDIDO.some(p => n.includes(normalizarFrase(p)))
  if (!temFraseDeCancelamento) return false
  const outrosSinaisDeNovoPedido = FRASES_NOVO_PEDIDO.filter(p => !FRASES_CANCELAMENTO_PEDIDO.includes(p))
  return !outrosSinaisDeNovoPedido.some(p => n.includes(normalizarFrase(p)))
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

/** 1ª reformulação (mesma pergunta, palavras diferentes) — mostrada quando a 1ª tentativa de interpretar a resposta do cliente falha (ver mensagemEsclarecimentoPorTentativa). Nunca acumula com a mensagem anterior, substitui. */
function mensagemRetomadaAposIntervaloVariante2(): string {
  return 'Só pra eu confirmar certinho: você quer que eu continue de onde paramos no pedido anterior, ou prefere começar um pedido diferente agora?'
}

/** 2ª+ falha: opções curtas numeradas (aceitas por número, texto natural ou referência indireta) + oferta de atendimento humano — nunca força a transferência, só oferece (ver resolverRetomadaAposIntervalo, que continua tentando interpretar mesmo depois desta mensagem). */
function mensagemRetomadaAposIntervaloOpcoes(): string {
  return 'Não consegui identificar sua resposta. Pode escolher uma das opções abaixo (vale responder com o número, o texto, ou do seu jeito):\n\n1. Continuar o pedido anterior\n2. Começar uma compra nova\n\nSe preferir, também posso te transferir para um atendente — é só pedir.'
}

/** Escolhe qual variante da pergunta mostrar, escalando conforme o número de tentativas de interpretação já falhadas para esta chave (proteção anti-loop — nunca repete a mesma redação duas vezes seguidas). */
function mensagemEsclarecimentoPorTentativa(tentativas: number): string {
  if (tentativas <= 0) return mensagemRetomadaAposIntervalo()
  if (tentativas === 1) return mensagemRetomadaAposIntervaloVariante2()
  return mensagemRetomadaAposIntervaloOpcoes()
}

/** true só quando há uma compra em andamento e mais de 1h já passou desde a última interação real registrada. */
export function deveGatilharRetomadaAposIntervalo(estado: EstadoConversa, agora: Date): boolean {
  if (!FASES_COMPRA_EM_ANDAMENTO.includes(estado.fase)) return false
  const ultima = estado.dados.ultimaInteracaoEm
  if (!ultima) return false
  return agora.getTime() - new Date(ultima).getTime() > LIMITE_INTERVALO_RETOMADA_MS
}

/**
 * Normalização adicional só pra comparar frases curtas de intenção (gate de
 * retomada) — nunca usada em parsing de data/CEP/telefone, que dependem de
 * caracteres como "/" preservados exatamente. Além de acentos/caixa (já
 * feito por normalizar()), remove pontuação irrelevante e colapsa qualquer
 * sequência de espaços (ex.: "nova  compra", com espaço duplo, digitado
 * sem querer) num único espaço — bug real: "nova  compra" não batia com
 * "nova compra" via includes() por causa do espaço extra, e a Flora
 * repetia a pergunta de retomada em vez de reiniciar a jornada.
 */
function normalizarFrase(texto: string): string {
  return normalizar(texto)
    .replace(/[.,!?;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Resolve a resposta do cliente ao gate de retomada — "nova compra" reinicia
 * a jornada (nunca reaproveita produto/endereço/frete/pagamento antigos);
 * "continuar"/confirmação restaura a fase salva e mostra o resumo real de
 * onde a conversa parou; qualquer outra coisa repete a pergunta, sem avançar
 * sozinho.
 *
 * Bug real: quando o cliente respondia ao gate já trazendo campos rotulados
 * do formulário (ex.: "Remetente: ...\nCEP da entrega: ..."), a Flora
 * descartava esses dados, mostrava a pergunta de novo, e só depois de
 * "continuar" restaurava dados ANTIGOS (sem aplicar os novos). Agora, campos
 * rotulados reconhecidos contam como intenção clara de continuar — aplica
 * imediatamente sobre o formulário já salvo (reusando etapaFormulario, nunca
 * duplicando a validação/consulta real de CEP e telefone), sem exigir
 * "continuar" antes.
 */
// Resposta natural e inequívoca à própria pergunta do gate ("...continuar o
// pedido anterior ou prefere iniciar uma nova compra?") — o cliente repete a
// palavra-chave da pergunta em vez de "sim"/"continuar". Bug real observado
// em monitoramento: "Anterior" e "Pedido anterior" caíam fora de
// FRASES_CONTINUACAO e de pareceConfirmacao, e a Flora repetia a mesma
// pergunta indefinidamente mesmo com uma resposta clara. Escopo restrito a
// este gate (nunca em FRASES_CONTINUACAO global) porque "anterior" só é
// inequívoco aqui, onde as únicas duas opções em jogo são "anterior" vs "nova".
const FRASES_QUER_PEDIDO_ANTERIOR = ['anterior', 'pedido anterior', 'o anterior', 'continuar com o anterior', 'quero o anterior', 'quero o pedido anterior']

/** Chave estável deste gate na proteção anti-loop/interpretação contextual — nunca o texto da pergunta em si, pra sobreviver a reformulações. */
const CHAVE_GATE_RETOMADA = 'retomada_apos_intervalo'
const INTENTS_VALIDAS_RETOMADA: IntencaoContextual[] = ['continuar_pedido_anterior', 'iniciar_nova_compra', 'falar_com_humano', 'ambigua', 'incompleta']

/** Chave global (não amarrada a nenhuma fase específica) da confirmação de cancelamento aberta por uma frase de cancelamento puro (ver pareceApenasCancelamento) — checada no topo de avancarFunil, funciona não importa em qual fase o cliente estava. */
const CHAVE_GATE_CANCELAMENTO_GLOBAL = 'confirmar_cancelamento_pedido'

/**
 * Prompt mínimo necessário (nunca decide preço/disponibilidade/regra
 * comercial) pra camada de interpretação contextual resolver a ambiguidade
 * real deste gate: a mesma resposta curta do cliente ("pode", "esse mesmo")
 * só faz sentido à luz da pergunta que a Flora acabou de fazer.
 */
function montarPromptInterpretacaoRetomada(estado: EstadoConversa): string {
  const produtoResumo = estado.dados.produto?.nome
    ? `Produto do pedido anterior em andamento: ${estado.dados.produto.nome}.`
    : 'Nenhum produto específico registrado ainda no pedido anterior.'
  return [
    'Você é um interpretador de intenção para um funil de vendas de flores (WhatsApp/Instagram). NUNCA decida preço, disponibilidade ou regras comerciais — só identifique a intenção do cliente na resposta abaixo.',
    `A Flora acabou de perguntar ao cliente: "${mensagemRetomadaAposIntervalo()}"`,
    produtoResumo,
    'Intenções válidas para esta resposta específica: continuar_pedido_anterior, iniciar_nova_compra, falar_com_humano, ambigua, incompleta.',
    'Considere equivalentes a "continuar_pedido_anterior" respostas como: confirmações diretas ou indiretas, referências ao pedido/produto anterior, pedidos pra retomar/prosseguir/dar continuidade, mesmo com erro de digitação, sem acento, abreviadas, ou em linguagem bem informal.',
    'Considere "iniciar_nova_compra" quando o cliente claramente quer algo diferente do pedido anterior.',
    'Se o cliente pedir explicitamente para falar com uma pessoa/atendente, classifique como falar_com_humano.',
    'Se não for possível ter certeza real, classifique como ambigua (mensagem existe mas não dá pra saber) ou incompleta (faltou informação) com confianca "baixa" e precisaEsclarecimento true — nunca invente uma escolha que o texto não sustenta.',
    'Responda APENAS com um JSON válido, sem texto antes ou depois, no formato exato: {"intencaoPrimaria": "...", "intencoesSecundarias": [], "entidades": {}, "camposParaAtualizar": [], "confianca": "alta"|"media"|"baixa", "evidenciaContextual": "...", "acaoRecomendada": "...", "precisaEsclarecimento": true|false}',
  ].join('\n')
}

/** "1"/"2" isolado em resposta às opções numeradas (2ª+ falha) — fast-path determinístico, nunca precisa do modelo pra isso. */
function detectarEscolhaNumericaRetomada(mensagemCliente: string): 'continuar' | 'nova' | null {
  const numeros = extrairNumeros(mensagemCliente)
  if (numeros.length !== 1) return null
  if (numeros[0] === 1) return 'continuar'
  if (numeros[0] === 2) return 'nova'
  return null
}

async function resolverRetomadaAposIntervalo(
  estado: EstadoConversa,
  mensagemCliente: string,
  deps: DependenciasFunil,
  agora: Date,
): Promise<ResultadoEtapa | null> {
  const n = normalizarFrase(mensagemCliente)
  const tentativasAnterioresParaDiag = estado.dados.tentativasInterpretacao?.[CHAVE_GATE_RETOMADA] ?? 0
  const comDiagRetomada = (r: ResultadoEtapa | null, motivo: string, diag: Partial<DiagnosticoGateBinario> = {}): ResultadoEtapa | null =>
    r ? { ...r, diagnosticoInterpretacao: { gate: CHAVE_GATE_RETOMADA, motivo, fallbackAcionado: false, tentativaNumero: tentativasAnterioresParaDiag, ...diag } } : null

  const resolverComoNovaCompra = (): ResultadoEtapa | null => {
    // Mesma pergunta de reaproveitamento de dados já usada quando "nova
    // intenção de compra" reinicia a jornada em fases mais avançadas (ver
    // avancarFunil) — faltava aqui, no reinício vindo do gate de intervalo
    // (>1h sem interação + "nova compra"). Bug real observado em
    // monitoramento 2026-07-25: cliente perdeu o formulário completo já
    // informado antes e teve que digitar tudo de novo, mesmo pedindo
    // explicitamente "use os dados do pedido anterior" depois.
    const formularioAnterior = estado.dados.formulario
    const enderecoCompleto = !!formularioAnterior && camposFaltandoFormulario(formularioAnterior).length === 0
    if (enderecoCompleto) {
      const jornadaReiniciada = reiniciarJornada(mensagemCliente)
      return {
        estado: { ...jornadaReiniciada, fase: 'aguardando_reaproveitar_dados', dados: { ...jornadaReiniciada.dados, formularioAnterior } },
        mensagem: mensagemPerguntaReaproveitarDados(),
      }
    }
    return null // sinaliza pro chamador reiniciar a jornada e seguir o fluxo normal
  }

  const resolverComoContinuar = (): ResultadoEtapa => {
    const faseAnterior = estado.dados.faseAntesDoIntervalo ?? 'inicio'
    const dadosRestaurados: DadosPedido = {
      ...estado.dados, faseAntesDoIntervalo: undefined, ultimaInteracaoEm: agora.toISOString(),
      ultimaPergunta: undefined, tentativasInterpretacao: undefined,
    }
    return { estado: { ...estado, fase: faseAnterior, dados: dadosRestaurados }, mensagem: montarMensagemRetomada(faseAnterior, dadosRestaurados) }
  }

  if (FRASES_NOVO_PEDIDO.some(p => n.includes(normalizarFrase(p)))) {
    return comDiagRetomada(resolverComoNovaCompra(), 'nova_compra_deterministica', { intencaoPrimaria: 'iniciar_nova_compra' })
  }

  const trouxeDadosDoFormulario = Object.keys(extrairFormularioEntrega(mensagemCliente)).length > 0
  // Bug real (pego escrevendo os testes negativos desta correção): "não
  // quero o pedido anterior" contém "pedido anterior" como substring, então
  // FRASES_QUER_PEDIDO_ANTERIOR batia via .includes() mesmo com a negação —
  // a Flora confirmava continuar exatamente o que o cliente disse que NÃO
  // queria. `.includes()` nunca enxerga negação; a guarda abaixo nunca deixa
  // uma frase negada (pareceNegacao, já usada em outros gates) contar como
  // "quer continuar" — cai pra interpretação contextual (ou pro
  // esclarecimento anti-loop) em vez de confiar cegamente na substring.
  const negado = pareceNegacao(mensagemCliente)
  const querContinuar = trouxeDadosDoFormulario
    || (!negado && FRASES_CONTINUACAO.some(p => n.includes(normalizarFrase(p))))
    || (!negado && FRASES_QUER_PEDIDO_ANTERIOR.some(p => n === normalizarFrase(p) || n.includes(normalizarFrase(p))))
    || pareceConfirmacao(mensagemCliente)

  if (querContinuar) {
    if (trouxeDadosDoFormulario) {
      const dadosLimpos: DadosPedido = {
        ...estado.dados, faseAntesDoIntervalo: undefined, ultimaInteracaoEm: agora.toISOString(),
        ultimaPergunta: undefined, tentativasInterpretacao: undefined,
      }
      const resultadoFormulario = await etapaFormulario({ ...estado, fase: 'aguardando_formulario', dados: dadosLimpos }, mensagemCliente, deps)
      return comDiagRetomada(resultadoFormulario, 'continuar_com_dados_de_formulario', { intencaoPrimaria: 'continuar_pedido_anterior' })
    }
    return comDiagRetomada(resolverComoContinuar(), 'continuar_deterministico', { intencaoPrimaria: 'continuar_pedido_anterior' })
  }

  // Caminho determinístico não decidiu — antes de repetir a pergunta,
  // tenta a camada de interpretação contextual (mensagem + qual pergunta
  // está pendente + fase + dados coletados). Correção estrutural: em vez de
  // cadastrar mais uma frase em FRASES_QUER_PEDIDO_ANTERIOR a cada novo
  // sinônimo encontrado em produção, o interpretador cobre variações
  // semânticas equivalentes ainda não previstas, sem precisar de deploy novo
  // por frase.
  const tentativasAnteriores = estado.dados.tentativasInterpretacao?.[CHAVE_GATE_RETOMADA] ?? 0

  const escolhaNumerica = tentativasAnteriores >= 2 ? detectarEscolhaNumericaRetomada(mensagemCliente) : null
  if (escolhaNumerica === 'continuar') return comDiagRetomada(resolverComoContinuar(), 'escolha_numerica', { intencaoPrimaria: 'continuar_pedido_anterior', tentativaNumero: tentativasAnteriores })
  // null aqui é um retorno intencional (mesmo contrato de resolverComoNovaCompra):
  // sinaliza pro chamador (avancarFunil) reiniciar a jornada normalmente,
  // nunca um erro — nunca substituído por resolverComoContinuar().
  if (escolhaNumerica === 'nova') return comDiagRetomada(resolverComoNovaCompra(), 'escolha_numerica', { intencaoPrimaria: 'iniciar_nova_compra', tentativaNumero: tentativasAnteriores })

  const interpretado = await interpretarComFallback(deps, montarPromptInterpretacaoRetomada(estado), mensagemCliente)
  const diagInterpretado: DiagnosticoGateBinario = {
    intencaoPrimaria: interpretado?.intencaoPrimaria,
    intencoesSecundarias: interpretado?.intencoesSecundarias,
    confianca: interpretado?.confianca,
    precisaEsclarecimento: interpretado?.precisaEsclarecimento,
    fallbackAcionado: !!deps.interpretarIntencao && !interpretado,
    tentativaNumero: tentativasAnteriores,
  }

  if (interpretado && interpretado.confianca !== 'baixa' && !interpretado.precisaEsclarecimento) {
    if (interpretado.intencaoPrimaria === 'continuar_pedido_anterior') {
      return { ...resolverComoContinuar(), diagnosticoInterpretacao: { gate: CHAVE_GATE_RETOMADA, motivo: 'continuar_interpretado', ...diagInterpretado } }
    }
    if (interpretado.intencaoPrimaria === 'iniciar_nova_compra') {
      const resultado = resolverComoNovaCompra()
      if (resultado) return { ...resultado, diagnosticoInterpretacao: { gate: CHAVE_GATE_RETOMADA, motivo: 'nova_compra_interpretada', ...diagInterpretado } }
      return null
    }
    if (interpretado.intencaoPrimaria === 'falar_com_humano') {
      return {
        estado: transferirParaHumano(estado, 'falar_com_humano (gate retomada_apos_intervalo)'),
        mensagem: mensagemTransferencia(),
        diagnosticoInterpretacao: { gate: CHAVE_GATE_RETOMADA, motivo: 'falar_com_humano', ...diagInterpretado },
      }
    }
  }

  // Nem o determinístico nem o interpretador conseguiram resolver com
  // confiança — proteção anti-loop: nunca repete a mesma redação da
  // pergunta duas vezes seguidas, escala pra opções numeradas na 2ª+ falha,
  // e nunca reseta o estado silenciosamente enquanto isso acontece.
  const tentativas = tentativasAnteriores + 1
  return {
    estado: {
      ...estado,
      dados: {
        ...estado.dados,
        ultimaPergunta: { chave: CHAVE_GATE_RETOMADA, textoExibido: mensagemRetomadaAposIntervalo(), intentsValidas: INTENTS_VALIDAS_RETOMADA },
        tentativasInterpretacao: { ...estado.dados.tentativasInterpretacao, [CHAVE_GATE_RETOMADA]: tentativas },
      },
    },
    mensagem: mensagemEsclarecimentoPorTentativa(tentativas),
    diagnosticoInterpretacao: { gate: CHAVE_GATE_RETOMADA, motivo: 'ambiguo_anti_loop', ...diagInterpretado, tentativaNumero: tentativas },
  }
}

// Pergunta direta de disponibilidade por nome de produto — "tem girassol?",
// "vocês tem lírios pra hoje", "tem rosas aí?". Diferente de
// PALAVRAS_DISPONIBILIDADE (frases fixas genéricas): aqui extraímos o termo
// do produto perguntado, pra consultar o catálogo real por ele — nunca cai
// no fallback de "compra_produto"/fase antiga.
// A palavra de preenchimento (pra hoje/hoje/aí/disponível) só é removida
// quando aparece como palavra SEPARADA (com espaço antes) — nunca como
// sufixo colado ao nome do produto. Bug real observado em validação
// interna 2026-07-30: "vocês tem bonsai?" virava termo de busca "bons",
// porque o "ai" final de "bonsai" batia com o filler "aí" mesmo sem
// espaço nenhum antes, respondendo ao cliente "não temos bons disponível".
const REGEX_PERGUNTA_DISPONIBILIDADE = /^(?:voces?\s+)?tem\s+(.+?)(?:\s+(?:pra\s?hoje|para\s?hoje|hoje|a[íi]|dispon[íi]vel))?[\s?.!]*$/

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

// Número operacional atual do WhatsApp (WHATSAPP_ACTIVE_NUMBER) — o número
// oficial da loja (5511982829083) fica protegido/bloqueado enquanto esta
// fase durar (ver _shared/whatsapp-guard.ts). Texto fixo, nunca lido de env
// var aqui (funil.ts nunca importa nada — ver cabeçalho do arquivo);
// atualizar os dois literais abaixo junto se o número operacional mudar de
// novo.
export function mensagemForaDeEscopo(): string {
  return 'Posso te ajudar com flores, presentes, pedidos e entregas da Enemeop Flores. Para outros assuntos, fale com nossa equipe pelo WhatsApp final 9190.'
}

export function mensagemTransferencia(): string {
  return 'Vou te transferir para nossa equipe! Pode continuar por aqui mesmo.'
}

/**
 * Só para quando uma limitação técnica real impede continuar no canal atual
 * (ex.: falha ao enviar mídia pela API do Instagram/Facebook) — nunca como
 * oferta padrão de handoff. Sempre com link clicável, nunca só "final 9190".
 */
export function mensagemTransferenciaLimitacaoTecnica(): string {
  return 'No momento não consigo continuar por aqui devido a uma limitação técnica. Fale com nossa equipe pelo WhatsApp oficial: https://wa.me/5511966439190'
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
// Reconhecimento curto e determinístico do que o cliente pediu, prefixado
// ao aviso de horário — nunca gerado por IA (mesma regra do resto do
// arquivo: só reconhece sinais claros já usados em outro lugar do funil,
// FRASES_NOVO_PEDIDO/TIPOS_PRODUTO). Vazio quando a mensagem não traz
// nenhum sinal reconhecível (ex.: primeira mensagem genérica, "oi") — nesse
// caso o texto exato original (definido na tarefa) permanece intacto. Caso
// real observado em monitoramento 2026-07-24: "quero escolher outro
// produto" reiniciou a jornada corretamente, mas a resposta ignorava o que
// o cliente pediu e soava fora de contexto.
function reconhecimentoAberturaForaDoHorario(mensagemCliente: string): string {
  const n = normalizar(mensagemCliente)
  if (FRASES_NOVO_PEDIDO.some(p => n.includes(normalizar(p)))) return 'Claro, vamos montar um novo pedido! '
  const tipo = TIPOS_PRODUTO.find(t => t.regex.test(n))
  if (tipo) return `Claro, vamos cuidar do seu pedido de ${tipo.termo}! `
  return ''
}

/**
 * Pergunta do gate 'aguardando_reaproveitar_dados' — feedback direto do
 * usuário em monitoramento real, 2026-07-24: reiniciar um pedido ou trocar
 * o produto não deve obrigar o cliente a redigitar destinatário/endereço/
 * telefone quando esses dados já foram informados antes. Texto fixo, nunca
 * gerado por IA.
 */
function mensagemPerguntaReaproveitarDados(): string {
  return 'Você quer usar os mesmos dados de entrega do pedido anterior (destinatário, endereço e telefone)? Responda "sim" para reaproveitar, ou "não" para informar dados novos.'
}

/** Prompt mínimo pro gate de reaproveitamento de dados — mesma filosofia de montarPromptInterpretacaoRetomada (Fatia 1), restrito às duas únicas intenções válidas aqui. */
function montarPromptReaproveitarDados(): string {
  return [
    'Você é um interpretador de intenção para um funil de vendas de flores (WhatsApp/Instagram). NUNCA decida preço, disponibilidade ou regras comerciais — só identifique a intenção do cliente na resposta abaixo.',
    `A Flora acabou de perguntar ao cliente: "${mensagemPerguntaReaproveitarDados()}"`,
    'Intenções válidas para esta resposta específica: confirmar, negar, ambigua, incompleta.',
    'Considere "confirmar" respostas que aceitam reaproveitar os dados anteriores, mesmo indiretas ou informais.',
    'Considere "negar" respostas que preferem informar dados novos.',
    'Se não for possível ter certeza real, classifique como ambigua ou incompleta, com confianca "baixa" e precisaEsclarecimento true — nunca invente uma decisão que o texto não sustenta.',
    'Responda APENAS com um JSON válido, sem texto antes ou depois, no formato exato: {"intencaoPrimaria": "...", "intencoesSecundarias": [], "entidades": {}, "camposParaAtualizar": [], "confianca": "alta"|"media"|"baixa", "evidenciaContextual": "...", "acaoRecomendada": "...", "precisaEsclarecimento": true|false}',
  ].join('\n')
}

export function mensagemAvisoForaDoHorarioComOpcao(mensagemCliente = ''): string {
  const reconhecimento = reconhecimentoAberturaForaDoHorario(mensagemCliente)
  return `${reconhecimento}Podemos concluir seu pedido agora. Como estamos fora do horário da loja, ele será preparado e entregue no próximo dia de funcionamento, dentro do horário comercial. Deseja continuar?`
}

/**
 * Lembrete curto enquanto o cliente ainda não respondeu sim/continuar ao
 * aviso — nunca repete o texto completo do aviso de novo, nunca avança
 * sozinho (ainda exige sim/continuar explícito, mesma regra do gate). Só
 * reconhece o que o cliente disse desta vez (mesmos sinais de
 * reconhecimentoAberturaForaDoHorario) pra não soar fora de contexto quando
 * ele pede algo concreto (ex.: "quero trocar o produto") em vez de
 * responder sim/não — caso real observado em monitoramento 2026-07-24.
 */
export function mensagemAguardandoRespostaForaDoHorario(mensagemCliente = ''): string {
  const reconhecimento = reconhecimentoAberturaForaDoHorario(mensagemCliente)
  return `${reconhecimento}Posso adiantar seu pedido agora mesmo fora do horário — é só confirmar. Deseja continuar?`
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
  { campo: 'ocasiao', pergunta: 'Para qual ocasião é o presente?' },
]

// `termo` é o vocabulário real do catálogo (o que vira palavra de busca no
// site) — nunca necessariamente a mesma palavra que o cliente usou. "Ramalhete"
// é reconhecido como sinônimo de buquê (regex), mas o termo salvo/buscado é
// "buquê", porque nenhum produto real do site usa "ramalhete" no nome — uma
// busca literal por "ramalhete" sempre voltava vazia, fazendo a Flora dizer
// "não encontrei opções" pra um pedido comum (buquê de rosas), bug real
// observado em monitoramento 2026-07-25 (mesma conversa falhou em 07-18,
// 07-25 15h47 e 07-25 19h34, mesmo depois do cliente dizer "buquê" — porque
// tipoProduto já tinha sido travado em "ramalhete" antes).
const TIPOS_PRODUTO: { termo: string; regex: RegExp }[] = [
  { termo: 'buquê', regex: /ramalhete/ },
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

// Remove frases de abertura/fechamento comuns ao redor do nome do produto
// citado, deixando só o nome pra buscar — a busca real (WooCommerce
// ?search=) não lida bem com frases inteiras cheias de palavras soltas
// (bug real observado em monitoramento 2026-07-24: a mensagem completa
// "quero este produto X que está no site" não encontrava X mesmo com X
// existindo de verdade no catálogo). Nunca tenta demais: se sobrar texto
// não reconhecido, ainda assim usa o que sobrou — a busca real decide,
// nunca inventa um nome.
export function extrairNomeProdutoCitado(mensagem: string): string {
  return mensagem
    .replace(/^\s*(eu\s+)?quero\s+(este|esse|o)\s+produto\s*/i, '')
    .replace(/^\s*o\s+produto\s+[ée]\s*/i, '')
    // Abertura genérica de desejo ("eu quero um/uma X", "queria X",
    // "gostaria de um X", "preciso de uma X") — sem isso, a frase inteira
    // ia pra busca real e o WooCommerce (?search=) não encontrava nada
    // mesmo com o produto existindo (bug real observado em monitoramento
    // 2026-07-31: "Eu quero uma ramalhete" não encontrava nenhum dos vários
    // ramalhetes reais do site, mas buscar só "ramalhete" encontrava 10).
    // Roda DEPOIS do padrão "quero este/esse/o produto" acima (mais
    // específico) pra não competir com ele. Alternância do artigo em ordem
    // do mais longo pro mais curto (umas/uma/uns/um) — nunca o contrário,
    // senão "um" casa primeiro como prefixo de "uma" e sobra um "a" solto.
    .replace(/^\s*(eu\s+)?(quero|queria|gostaria\s+de|preciso\s+de)\s+(umas|uma|uns|um)?\s*/i, '')
    .replace(/\s*,?\s*que\s+(vi|est[aá])\s+no\s+site\.?/gi, '')
    .replace(/\s*\.?\s*(ele\s+)?n[aã]o\s+est[aá]\s+no\s+cat[aá]logo\.?/gi, '')
    // Traço isolado (– — -) entre palavras quebra a busca real (WooCommerce
    // ?search=) mesmo com o resto do nome idêntico — confirmado ao vivo no
    // site real, 2026-07-25: a mesma consulta sem o traço encontra o
    // produto, com o traço devolve zero resultados. Nunca remove hífen
    // colado a uma palavra (ex.: "mini-ramalhete"), só o separado por
    // espaços dos dois lados.
    .replace(/\s[-–—]\s/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim() || mensagem.trim()
}

/**
 * Busca ao vivo por um produto citado diretamente pelo nome, fora das
 * opções já apresentadas — mesma fonte/filtro de validade do resto do
 * catálogo (deps.buscarCatalogo), nunca inventa nem confirma um produto que
 * a busca real não confirmar (um produto de teste/indisponível no site
 * nunca aparece aqui, pois já é filtrado na origem — ver
 * catalogo-woocommerce-filtro.ts).
 */
// Nunca conta como "encontrado" um produto que já está entre as opções
// apresentadas nesta conversa — sem essa checagem, uma pergunta ambígua
// de continuação ("tem mais alguma coisa?", sem citar produto nenhum)
// dispararia uma busca que devolve o MESMO catálogo já mostrado, e ele
// seria re-apresentado como se fosse uma descoberta nova (regressão real
// já corrigida antes — "loop de aniversário", monitoramento 2026-07-21).
function jaEstaNasOpcoesMostradas(produto: ProdutoCatalogo, opcoesMostradas?: ProdutoCatalogo[]): boolean {
  if (!opcoesMostradas) return false
  return opcoesMostradas.some(o => (produto.codigo && o.codigo === produto.codigo) || o.nome === produto.nome)
}

async function buscarProdutoCitadoNoSite(
  mensagemCliente: string,
  deps: DependenciasFunil,
  opcoesJaMostradas?: ProdutoCatalogo[],
): Promise<Recomendacao | null> {
  const produtos = await deps.buscarCatalogo({ query: extrairNomeProdutoCitado(mensagemCliente) })
  const rec = selecionarRecomendacoes(produtos)
  if (!rec.principal || jaEstaNasOpcoesMostradas(rec.principal, opcoesJaMostradas)) return null
  return rec
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

export type GeradorPagamentoPix = (pedidoId: string, valorTotal: number) => Promise<{ qrCodeUrl: string; copiaCola: string } | null>

// "pix" sozinho já é inequívoco aqui — só é checado dentro de
// aguardando_pagamento (Etapa 8, ver dispatcher), fase em que um link real
// já existe e o cliente falando de pix só pode significar "quero pagar por
// pix" (nunca confundido com a resposta genérica de FAQ de formas de
// pagamento, que só roda fora dessa fase).
const REGEX_PEDIDO_QRCODE_PIX = /\bpix\b|\bqr\s*code\b|\bqrcode\b/i

export function pedeQrCodePix(mensagem: string): boolean {
  return REGEX_PEDIDO_QRCODE_PIX.test(mensagem)
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
  /** Gera (ou reaproveita, se ainda válido) um QR Code Pix real pro mesmo pedido — só chamado quando o cliente pede Pix explicitamente na fase aguardando_pagamento (ver pedeQrCodePix). */
  gerarPagamentoPix: GeradorPagamentoPix
  /** Cria o registro do pedido (rascunho, ainda sem pagamento) e devolve o id. */
  criarPedido: CriadorPedido
  /** Formas de pagamento realmente habilitadas na configuração/integração de
   * produção agora — [] quando não há como confirmar (nunca inventa Pix/
   * cartão/dinheiro sem uma fonte real por trás). */
  buscarFormasPagamento: () => Promise<string[]>
  /**
   * Camada de compreensão contextual de intenção (ver `IntencaoContextual`/
   * `ResultadoInterpretacao` acima) — chamada só quando um gate de ambiguidade
   * real (ex.: `resolverRetomadaAposIntervalo`) não consegue decidir sozinho
   * pelo caminho determinístico. Recebe o prompt já montado (contexto mínimo:
   * mensagem, última pergunta, fase, dados coletados) e devolve o JSON bruto
   * do modelo como string, ou `null` em caso de indisponibilidade/erro —
   * NUNCA deve lançar exceção (a implementação real, fora deste arquivo,
   * embrulha timeout/erro em `null`). Opcional de propósito: ausente (testes,
   * ou canal ainda sem rollout do interpretador) significa comportamento
   * 100% determinístico, idêntico ao anterior a esta camada — nunca decide
   * preço, disponibilidade ou regra comercial, só intenção/entidades do texto.
   */
  interpretarIntencao?: (systemPrompt: string, mensagemCliente: string, timeoutMs: number) => Promise<string | null>
}

export interface ResultadoEtapa {
  estado: EstadoConversa
  mensagem: string
  fotoUrl?: string | null
  /** Uma foto por produto apresentado (recomendação com 2-3 opções) — cada
   * uma amarrada ao código/ID do produto real, nunca por posição. Quando
   * presente, tem prioridade sobre `fotoUrl` no envio. */
  fotos?: { codigo?: string; nome: string; url: string }[]
  /**
   * Diagnóstico da camada de interpretação contextual, presente só quando
   * um gate que usa essa camada esteve envolvido nesta mensagem — nunca
   * populado pelas outras ~30 etapas do funil que não usam interpretação
   * (permanece `undefined` para elas, sem quebrar nenhum call site
   * existente). Contrato estável pra quem chama `avancarFunil` (os 4
   * canais reais) registrar telemetria sem nunca precisar ler
   * `estado.dados` bruto (que pode conter nome/telefone/endereço) — ver
   * `DiagnosticoInterpretacao` e `INTERPRETADOR_PRIVACIDADE.md`. `funil.ts`
   * nunca importa nada pra fora (zero imports, ver cabeçalho) — este campo
   * é o único acoplamento com telemetria, e é só um objeto de dados, nunca
   * uma chamada de banco.
   */
  diagnosticoInterpretacao?: DiagnosticoInterpretacao
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

/** Usado só no gate de reaproveitamento de dados (sim/não é a única decisão ali) — nunca confundido com pareceRejeicaoSemCampo (que é sobre rejeitar um resumo específico, contexto diferente). */
function pareceNegacao(mensagem: string): boolean {
  const lower = mensagem.toLowerCase().trim()
  return PALAVRAS_NEGACAO.some(p => lower.includes(p))
}

// ── Gate binário genérico com interpretação contextual (Fatia 2 — correção
// estrutural) ──────────────────────────────────────────────────────────────
//
// Generaliza o padrão do gate `resolverRetomadaAposIntervalo` (Fatia 1) pra
// qualquer ponto do funil que hoje decide só por pareceConfirmacao/
// pareceNegacao, sem memória da pergunta pendente nem fallback pra
// formulações inéditas. Cada gate que passa a usar isto ganha, de graça:
// interpretação contextual pra respostas ambíguas, proteção anti-loop
// (reformula → opções numeradas → oferece humano, nunca repete a mesma
// pergunta duas vezes seguidas), e reconhecimento de que a resposta pode não
// ser um "sim"/"não" puro (cancelamento, troca de produto/dado, pergunta de
// preço etc.) sem descartar essa informação.
//
// Regra de custo/segurança: o caminho determinístico rápido só resolve
// sozinho quando a mensagem, depois de normalizada, é EXATAMENTE uma palavra
// de confirmação/negação conhecida — nunca um prefixo/sufixo dela. Isso é
// deliberadamente mais restrito que `pareceConfirmacao`/`pareceNegacao`
// (usadas em gates mais antigos): "sim" sozinho nunca precisa do modelo,
// mas "sim, mas troca o endereço" não pode ser resolvido só pela palavra
// "sim" — precisa passar pelo interpretador pra nunca descartar a troca.
// Quando não há interpretador conectado (canal sem rollout, ou o modelo
// falhou/expirou), cai de volta no comportamento determinístico mais
// permissivo de sempre (`pareceConfirmacao`/`pareceNegacao`) — nunca pior
// que o gate era antes desta camada.

export interface ConfigGateBinario {
  /** Identificador estável do gate (nunca o texto da pergunta) — chave de tentativasInterpretacao/ultimaPergunta, sobrevive a reformulações. */
  chave: string
  perguntaAtual: string
  perguntaReformulada: string
  perguntaComOpcoes: string
  /** Intenções contextuais que fazem sentido nesta pergunta específica — sempre inclui ao menos confirmar/negar. */
  intentsValidas: IntencaoContextual[]
  /** Linhas extras de contexto pro prompt (produto/fase/dados relevantes) — nunca decide preço/regra comercial, só dá contexto textual. */
  linhasContexto: string[]
}

/**
 * Diagnóstico de UMA decisão do gate binário — nunca inclui o texto da
 * mensagem do cliente nem valores de campo (só nomes/metadados), pra poder
 * ser persistido em telemetria sem risco de vazar dado pessoal (ver
 * INTERPRETADOR_PRIVACIDADE.md). `fallbackAcionado` é true só quando o
 * interpretador foi de fato chamado E não devolveu um resultado usável
 * nesta mensagem específica — nunca confundido com "canal sem rollout"
 * (aí nunca chega a chamar nada, então é `false`, comportamento normal).
 */
export interface DiagnosticoGateBinario {
  intencaoPrimaria?: IntencaoContextual
  intencoesSecundarias?: IntencaoContextual[]
  confianca?: NivelConfianca
  precisaEsclarecimento?: boolean
  fallbackAcionado: boolean
  tentativaNumero: number
}

/**
 * Mesmo diagnóstico acima, mais o identificador do gate e (quando houve
 * mudança real de dado) os nomes dos campos alterados — nunca os valores.
 * É exatamente o subconjunto de campos que `funil_interpretacao_eventos`
 * persiste (ver migration 202608030001) — qualquer campo novo pedido por
 * telemetria deve nascer aqui, nunca ser lido de `estado.dados` bruto por
 * quem chama.
 */
export interface DiagnosticoInterpretacao extends DiagnosticoGateBinario {
  gate: string
  /** Motivo curto e não-livre da decisão (ex.: 'confirmou', 'cancelamento_pendente_confirmacao', 'trocou_produto') — nunca texto do cliente nem frase gerada por IA. */
  motivo: string
  /** Nomes dos campos que mudaram nesta mensagem — nunca os valores antes/depois. */
  camposAlterados?: string[]
}

export type ResultadoGateBinario =
  | { decisao: 'confirmou'; diagnostico: DiagnosticoGateBinario }
  | { decisao: 'negou'; diagnostico: DiagnosticoGateBinario }
  /** O cliente respondeu outra coisa reconhecível (cancelar, trocar produto/dado, pergunta, falar com humano...), sozinha ou junto de confirmar/negar (ação composta) — nunca descartada. */
  | { decisao: 'outra'; resultado: ResultadoInterpretacao; diagnostico: DiagnosticoGateBinario }
  | { decisao: 'pendente'; estado: EstadoConversa; mensagem: string; diagnostico: DiagnosticoGateBinario }

function respostaBinariaLimpa(mensagem: string, palavras: string[]): boolean {
  const n = normalizarFrase(mensagem)
  return palavras.some(p => n === normalizarFrase(p))
}

/** "1"/"2" isolado em resposta às opções numeradas (2ª+ falha) — fast-path determinístico, nunca precisa do modelo pra isso. Generaliza detectarEscolhaNumericaRetomada pra qualquer gate binário. */
function detectarEscolhaNumericaSimNao(mensagemCliente: string): 'sim' | 'nao' | null {
  const numeros = extrairNumeros(mensagemCliente)
  if (numeros.length !== 1) return null
  if (numeros[0] === 1) return 'sim'
  if (numeros[0] === 2) return 'nao'
  return null
}

function montarPromptGateBinario(cfg: ConfigGateBinario): string {
  return [
    'Você é um interpretador de intenção para um funil de vendas de flores (WhatsApp/Instagram). NUNCA decida preço, disponibilidade ou regras comerciais — só identifique a intenção do cliente na resposta abaixo.',
    `A Flora acabou de perguntar/mostrar ao cliente: "${cfg.perguntaAtual}"`,
    ...cfg.linhasContexto,
    `Intenções válidas para esta resposta específica: ${cfg.intentsValidas.join(', ')}.`,
    'Considere "confirmar" respostas afirmativas diretas ou indiretas, mesmo com erro de digitação, sem acento, abreviadas ou informais.',
    'Considere "negar" respostas negativas diretas ou indiretas, inclusive quando o cliente rejeita implicitamente ao pedir outra coisa em vez de seguir.',
    'Se o cliente pedir para cancelar ou desistir do pedido, classifique como cancelar ou desistir — nunca como negar simples.',
    'Se o cliente perguntar preço, disponibilidade, prazo ou forma de entrega antes de responder, classifique a pergunta correspondente (perguntar_preco/perguntar_disponibilidade/perguntar_prazo/perguntar_entrega).',
    'Se o cliente quiser trocar o produto, o pedido, a quantidade, ou corrigir/alterar um dado (destinatário, endereço, data, horário, mensagem do cartão), classifique a intenção específica de troca/alteração correspondente. Preencha "entidades" só com os valores que o próprio texto realmente traz (nunca invente um valor que o cliente não disse), usando EXATAMENTE estas chaves quando aplicável: nomeDestinatario, nomeComprador, telefoneDestinatario, cep, rua, numero, complemento, bairro, dataEntrega, periodo, quantidade, mensagemCartao — nunca outras chaves. Liste em "camposParaAtualizar" o nome de cada uma dessas chaves que você preencheu.',
    'Se o cliente pedir explicitamente para falar com uma pessoa/atendente, classifique como falar_com_humano.',
    'Mensagens podem trazer mais de uma intenção ao mesmo tempo (ex.: "sim, mas troca o endereço", "mantém o pedido e entrega amanhã") — registre a intenção principal em intencaoPrimaria e as demais em intencoesSecundarias, na ordem em que aparecem no texto, sem descartar nenhuma.',
    'Se não for possível ter certeza real, classifique como ambigua (mensagem existe mas não dá pra saber) ou incompleta (faltou informação), com confianca "baixa" e precisaEsclarecimento true — nunca invente uma decisão que o texto não sustenta.',
    'Responda APENAS com um JSON válido, sem texto antes ou depois, no formato exato: {"intencaoPrimaria": "...", "intencoesSecundarias": [], "entidades": {}, "camposParaAtualizar": [], "confianca": "alta"|"media"|"baixa", "evidenciaContextual": "...", "acaoRecomendada": "...", "precisaEsclarecimento": true|false}',
  ].join('\n')
}

function mensagemGateBinarioPorTentativa(cfg: ConfigGateBinario, tentativas: number): string {
  if (tentativas <= 0) return cfg.perguntaAtual
  if (tentativas === 1) return cfg.perguntaReformulada
  return cfg.perguntaComOpcoes
}

/** Limpa ultimaPergunta/tentativasInterpretacao — só no único caminho de sucesso de cada gate, nunca silenciosamente (mesma regra da Fatia 1). */
function limparPendenciaInterpretacao(dados: DadosPedido): DadosPedido {
  return { ...dados, ultimaPergunta: undefined, tentativasInterpretacao: undefined }
}

async function avaliarGateBinario(
  cfg: ConfigGateBinario,
  estado: EstadoConversa,
  mensagemCliente: string,
  deps: DependenciasFunil,
): Promise<ResultadoGateBinario> {
  const tentativasAnteriores = estado.dados.tentativasInterpretacao?.[cfg.chave] ?? 0
  const diagnosticoSemChamada = (intencaoPrimaria?: IntencaoContextual): DiagnosticoGateBinario => ({
    intencaoPrimaria, fallbackAcionado: false, tentativaNumero: tentativasAnteriores,
  })

  if (respostaBinariaLimpa(mensagemCliente, PALAVRAS_CONFIRMACAO)) return { decisao: 'confirmou', diagnostico: diagnosticoSemChamada('confirmar') }
  if (respostaBinariaLimpa(mensagemCliente, PALAVRAS_NEGACAO)) return { decisao: 'negou', diagnostico: diagnosticoSemChamada('negar') }

  // Sem interpretador conectado: mantém o comportamento determinístico mais
  // permissivo de sempre — nunca pior que o gate era antes desta camada.
  // Nunca conta como fallback_acionado (nada foi chamado pra falhar).
  if (!deps.interpretarIntencao) {
    if (pareceConfirmacao(mensagemCliente)) return { decisao: 'confirmou', diagnostico: diagnosticoSemChamada('confirmar') }
    if (pareceNegacao(mensagemCliente)) return { decisao: 'negou', diagnostico: diagnosticoSemChamada('negar') }
  }

  const escolhaNumerica = tentativasAnteriores >= 2 ? detectarEscolhaNumericaSimNao(mensagemCliente) : null
  if (escolhaNumerica === 'sim') return { decisao: 'confirmou', diagnostico: diagnosticoSemChamada('confirmar') }
  if (escolhaNumerica === 'nao') return { decisao: 'negou', diagnostico: diagnosticoSemChamada('negar') }

  const interpretado = await interpretarComFallback(deps, montarPromptGateBinario(cfg), mensagemCliente)
  if (interpretado && interpretado.confianca !== 'baixa' && !interpretado.precisaEsclarecimento) {
    const composta = interpretado.intencoesSecundarias.length > 0
    const diagnosticoInterpretado: DiagnosticoGateBinario = {
      intencaoPrimaria: interpretado.intencaoPrimaria,
      intencoesSecundarias: interpretado.intencoesSecundarias,
      confianca: interpretado.confianca,
      precisaEsclarecimento: interpretado.precisaEsclarecimento,
      fallbackAcionado: false,
      tentativaNumero: tentativasAnteriores,
    }
    if (interpretado.intencaoPrimaria === 'confirmar' && !composta) return { decisao: 'confirmou', diagnostico: diagnosticoInterpretado }
    if (interpretado.intencaoPrimaria === 'negar' && !composta) return { decisao: 'negou', diagnostico: diagnosticoInterpretado }
    if (interpretado.intencaoPrimaria !== 'ambigua' && interpretado.intencaoPrimaria !== 'incompleta') {
      return { decisao: 'outra', resultado: interpretado, diagnostico: diagnosticoInterpretado }
    }
  }

  // Chegou até aqui sem decidir. `fallbackAcionado` é true só quando o
  // interpretador foi chamado e falhou de verdade (null/timeout/JSON
  // inválido) — nunca quando ele respondeu com confiança baixa/precisa
  // esclarecimento/ambígua/incompleta: isso é o modelo funcionando
  // corretamente e admitindo incerteza, um sinal de produto (registrado à
  // parte em `confianca`/`precisaEsclarecimento`), não uma falha de
  // infraestrutura.
  const fallbackAcionado = !!deps.interpretarIntencao && !interpretado
  if (!interpretado) {
    if (pareceConfirmacao(mensagemCliente)) return { decisao: 'confirmou', diagnostico: { fallbackAcionado, tentativaNumero: tentativasAnteriores } }
    if (pareceNegacao(mensagemCliente)) return { decisao: 'negou', diagnostico: { fallbackAcionado, tentativaNumero: tentativasAnteriores } }
  }

  const tentativas = tentativasAnteriores + 1
  return {
    decisao: 'pendente',
    diagnostico: {
      intencaoPrimaria: interpretado?.intencaoPrimaria,
      intencoesSecundarias: interpretado?.intencoesSecundarias,
      confianca: interpretado?.confianca,
      precisaEsclarecimento: interpretado?.precisaEsclarecimento,
      fallbackAcionado,
      tentativaNumero: tentativas,
    },
    estado: {
      ...estado,
      dados: {
        ...estado.dados,
        ultimaPergunta: { chave: cfg.chave, textoExibido: cfg.perguntaAtual, intentsValidas: cfg.intentsValidas },
        tentativasInterpretacao: { ...estado.dados.tentativasInterpretacao, [cfg.chave]: tentativas },
      },
    },
    mensagem: mensagemGateBinarioPorTentativa(cfg, tentativas),
  }
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
    // Não bateu com nenhuma categoria, nem pede catálogo completo, nem é
    // pedido de navegação genérico ("outras opções" etc.) — pode ser o
    // nome de um produto específico do site: busca ao vivo antes de só
    // perguntar de novo (mesma lógica de etapaRecomendacao/
    // etapaCatalogoCompleto; bug real observado em monitoramento
    // 2026-07-25: citar um produto aqui, logo após "trocar o produto" ter
    // levado o cliente pra esta fase, só repetia "qual categoria").
    if (!FRASES_NOVO_PEDIDO.some(p => normalizar(mensagemCliente).includes(normalizar(p)))) {
      const encontrado = await buscarProdutoCitadoNoSite(mensagemCliente, deps)
      if (encontrado) {
        const novoEstado: EstadoConversa = {
          ...estado,
          fase: 'recomendacao',
          dados: { ...estado.dados, opcoesRecomendadas: [encontrado.principal!, ...encontrado.alternativas], recomendacaoApresentada: true },
        }
        return { estado: novoEstado, mensagem: montarMensagemRecomendacao(encontrado) }
      }
    }
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
  // "quero outro produto"/"outras opções" etc. é pedido de navegação
  // (quer ver coisas diferentes), nunca o nome de um produto — nunca tenta
  // buscar isso ao vivo como se fosse uma citação de produto (bug real
  // observado em monitoramento 2026-07-25: "quero escolher outro produto"
  // virou uma busca fracassada, respondendo "não encontrei esse produto").
  if (FRASES_NOVO_PEDIDO.some(p => normalizar(mensagemCliente).includes(normalizar(p)))) {
    return { estado: { ...estado, fase: 'escolha_categoria' }, mensagem: 'Claro! Me conta o que você procura (cor, estilo, ocasião), ou posso te mostrar as categorias de novo.' }
  }
  // Não bateu com nenhuma opção já mostrada, nem é confirmação/negação/
  // pedido de navegação — pode ser o nome de outro produto do site: busca
  // ao vivo antes de só perguntar de novo.
  const encontradoNoSite = await buscarProdutoCitadoNoSite(mensagemCliente, deps, estado.dados.opcoesRecomendadas)
  if (encontradoNoSite) {
    const novoEstado: EstadoConversa = {
      ...estado,
      fase: 'recomendacao',
      dados: { ...estado.dados, opcoesRecomendadas: [encontradoNoSite.principal!, ...encontradoNoSite.alternativas], recomendacaoApresentada: true, aguardandoNomeProdutoCitado: undefined },
    }
    return { estado: novoEstado, mensagem: montarMensagemRecomendacao(encontradoNoSite) }
  }
  return {
    estado: { ...estado, dados: { ...estado.dados, aguardandoNomeProdutoCitado: true } },
    mensagem: 'Não encontrei esse produto com esse nome. Pode me dizer o link do produto no site, ou o nome exato como aparece lá, pra eu localizar certinho? Se preferir, também posso te mostrar as opções que já te apresentei.',
  }
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

  // "quero outro produto"/"outras opções"/"fazer um novo pedido" etc. é
  // pedido de navegação (quer ver coisas diferentes), nunca o nome de um
  // produto — nunca tenta buscar isso ao vivo como se fosse uma citação de
  // produto (bug real observado em monitoramento 2026-07-25: "quero
  // escolher outro produto" virou uma busca fracassada, respondendo "não
  // encontrei esse produto"). Checado ANTES e independente de
  // recomendacaoApresentada/opcoesRecomendadas: quando a primeira busca já
  // tinha falhado (opcoesRecomendadas vazio), a conversa ficava presa
  // repetindo pra sempre a mesma busca fracassada — inclusive quando o
  // cliente pedia explicitamente "gostaria de fazer um novo pedido" (caso
  // real de monitoramento 2026-07-25, mesma conversa do bug "ramalhete").
  if (FRASES_NOVO_PEDIDO.some(p => normalizar(mensagemCliente).includes(normalizar(p)))) {
    return {
      estado: { ...estado, fase: 'escolha_categoria' },
      mensagem: 'Claro! Me conta o que você procura (cor, estilo, ocasião), ou posso te mostrar as categorias de novo.',
    }
  }

  // Opções já foram apresentadas nesta conversa e o cliente ainda não
  // escolheu (a mensagem não bateu com nenhuma delas acima) — nunca
  // reapresenta o catálogo do zero. Nunca filtra por palavra de negação
  // aqui antes de buscar: um nome de produto real pode conter "não" (ex.:
  // "Produto Teste – Não disponível para venda", caso real de monitoramento
  // 2026-07-25) e um filtro lexical de negação bloquearia a busca desse
  // produto genuíno. A proteção contra reapresentar o MESMO catálogo já
  // mostrado como se fosse uma descoberta nova (regressão real "loop de
  // aniversário", 2026-07-21) fica inteiramente a cargo de
  // jaEstaNasOpcoesMostradas, dentro de buscarProdutoCitadoNoSite — nunca
  // do conteúdo da mensagem.
  if (estado.dados.recomendacaoApresentada && estado.dados.opcoesRecomendadas?.length) {
    const encontrado = await buscarProdutoCitadoNoSite(mensagemCliente, deps, estado.dados.opcoesRecomendadas)
    if (encontrado) {
      const novoEstado: EstadoConversa = {
        ...estado,
        dados: { ...estado.dados, opcoesRecomendadas: [encontrado.principal!, ...encontrado.alternativas], recomendacaoApresentada: true, aguardandoNomeProdutoCitado: undefined },
      }
      return { estado: novoEstado, mensagem: montarMensagemRecomendacao(encontrado) }
    }
    return {
      estado: { ...estado, dados: { ...estado.dados, aguardandoNomeProdutoCitado: true } },
      mensagem: 'Não encontrei esse produto com esse nome. Pode me dizer o link do produto no site, ou o nome exato como aparece lá, pra eu localizar certinho? Se preferir, também posso te mostrar as opções que já te apresentei.',
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

  // Formulário de entrega reaproveitado (cliente reiniciou o pedido/trocou
  // o produto e escolheu manter destinatário/endereço/telefone — ver gate
  // 'aguardando_reaproveitar_dados') já está completo: pula direto pro
  // resumo, nunca pede o formulário de novo.
  const formularioReaproveitado = estadoAtualizado.dados.formulario
  if (formularioReaproveitado && camposFaltandoFormulario(formularioReaproveitado).length === 0) {
    const telefoneE164 = normalizarTelefoneDestinatarioBR(formularioReaproveitado.telefoneDestinatario!)
    if (telefoneE164) {
      const formularioNormalizado = { ...formularioReaproveitado, telefoneDestinatario: telefoneE164 }
      return {
        estado: { ...estadoAtualizado, fase: 'confirmando_formulario', dados: { ...estadoAtualizado.dados, formulario: formularioNormalizado } },
        mensagem: `${avisoData}${montarResumoFormulario(formularioNormalizado)}`,
      }
    }
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

/**
 * Interpreta uma resposta SEM rótulo ("Telefone: ...") como telefone do
 * destinatário — usado só quando o campo ainda está faltando, pra
 * reconhecer "(11) 91234-5678" isolado sem exigir o rótulo (bug real: sem
 * isso a Flora nunca reconhecia a resposta e repetia a pergunta em loop).
 * Nunca confunde um CEP de 8 dígitos com telefone. 'incompleto' só quando a
 * contagem de dígitos está na faixa plausível de um telefone BR (com ou sem
 * DDI) mas não fecha um número válido — nunca reage a uma mensagem
 * claramente de outro tipo (nome, endereço, data).
 */
function interpretarTelefoneLivre(texto: string): { tipo: 'valido'; valor: string } | { tipo: 'incompleto' } | null {
  const digitos = texto.replace(/\D/g, '')
  if (digitos.length === 0 || digitos.length === 8) return null
  const normalizado = normalizarTelefoneDestinatarioBR(texto)
  if (normalizado) return { tipo: 'valido', valor: normalizado }
  if (digitos.length >= 9 && digitos.length <= 13) return { tipo: 'incompleto' }
  return null
}

/** Extrai "123" ou "123, apto 45" / "123 bloco B" de uma resposta livre (sem rótulos) à pergunta do número — usado só quando o CEP já foi resolvido em turno anterior e a mensagem atual não trouxe nenhum campo no formato "Rótulo: valor". Nunca inventa um número: mensagem que não começa com dígitos devolve null e o número continua sendo pedido. */
/**
 * Extrai número (+ complemento opcional) de uma resposta em linguagem
 * natural à pergunta "qual é o número" — com ou sem a palavra "número"
 * (com/sem acento, maiúscula/minúscula) e com ou sem dois-pontos. Aceita
 * "105", "Número 105", "Número: 105", "numero 105 apto 61", "105 apto 61",
 * "número 105 apartamento 61", "número 105 bloco B apartamento 61" —
 * preserva o texto do complemento tal como informado. Nunca confunde
 * telefone/CEP com número: um número de casa real nunca chega a 6 dígitos
 * seguidos (CEP tem 8, telefone BR tem 10-13), então qualquer sequência
 * líder com 6+ dígitos é rejeitada de propósito.
 */
function extrairNumeroComplementoLivre(texto: string): { numero: string; complemento?: string } | null {
  const semRotulo = texto.trim().replace(/^n[uú]mero\s*:?\s*|^n[ºo°.]\s*:?\s*/i, '')
  const digitosLideranca = (semRotulo.match(/^\d[\d-]*/) ?? [''])[0].replace(/-/g, '')
  if (digitosLideranca.length >= 6) return null
  const m = semRotulo.match(/^(\d{1,5}[a-zA-Z]?)(?!\d)[,.\-–]?\s*(.*)$/)
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
  const extraidoRotulado = extrairFormularioEntrega(mensagemCliente)
  // Nenhum campo rotulado ("Rótulo: valor") reconhecido — tenta ler vários
  // campos de uma frase em linguagem natural (ver extrairFormularioEntregaLivre),
  // mas só enquanto ainda estivermos na Etapa 1 (nome/telefone/CEP faltando).
  // Depois que só sobra número/complemento, quem já trata resposta livre
  // corretamente é extrairNumeroComplementoLivre mais abaixo — nunca deixa
  // o reconhecimento genérico competir com ele (bug real: uma resposta como
  // "105 apto 61" capturava só o complemento aqui e nunca mais chegava no
  // fallback certo, porque extraido deixava de estar vazio).
  const CAMPOS_ETAPA1_FORMULARIO = ['nomeComprador', 'nomeDestinatario', 'telefoneDestinatario', 'cep'] as const
  const aindaFaltaAlgoDaEtapa1 = CAMPOS_ETAPA1_FORMULARIO.some(c => !formularioAnterior[c])
  const extraido = Object.keys(extraidoRotulado).length > 0
    ? extraidoRotulado
    : aindaFaltaAlgoDaEtapa1 ? extrairFormularioEntregaLivre(mensagemCliente) : {}
  let formularioAtual: FormularioEntregaDados = { ...formularioAnterior, ...extraido }
  // Reaproveita a data de entrega já informada na etapa de detalhes do
  // produto (produto.dataEntrega, pergunta "Pra quando você precisa da
  // entrega?") — nunca pede de novo o que o cliente já respondeu. Bug real
  // observado em validação interna 2026-07-30: cliente informou "amanhã"
  // ali, preencheu todo o resto do formulário numa mensagem só (sem repetir
  // a data), e a Flora ainda pedia "Data de entrega" de novo — porque
  // formulario.dataEntrega é um campo textualmente separado de
  // produto.dataEntrega, nunca sincronizado entre si. Mesmo texto bruto que
  // o cliente digitaria direto no formulário, validado do mesmo jeito
  // depois (normalizarDataEntregaTexto em etapaConfirmandoFormulario).
  if (!formularioAtual.dataEntrega && estado.dados.produto?.dataEntrega) {
    formularioAtual = { ...formularioAtual, dataEntrega: estado.dados.produto.dataEntrega }
  }
  let cepConsultadoViaApi = estado.dados.cepConsultadoViaApi
  const cepJaConsultadoAntesDesteTurno = !!formularioAnterior.cep && cepConsultadoViaApi === formularioAnterior.cep && formularioAnterior.cep === formularioAtual.cep

  const responder = (mensagem: string): ResultadoEtapa => ({
    estado: { ...estado, fase: 'aguardando_formulario', dados: { ...estado.dados, formulario: formularioAtual, cepConsultadoViaApi } },
    mensagem,
  })

  // Telefone do destinatário: aceita o rótulo "Telefone do destinatário:"
  // OU uma resposta isolada, sem rótulo. Nunca persiste um valor que não
  // passe na validação — bug real: um telefone inválido rotulado (ex.:
  // "Telefone do destinatário: Maria") ficava salvo no estado, e isso
  // bloqueava o reconhecimento de um telefone válido enviado depois
  // (isolado), porque o campo já não estava mais vazio. Um telefone válido
  // sempre substitui um inválido anterior, seja rotulado ou isolado.
  if (extraido.telefoneDestinatario !== undefined) {
    const normalizado = normalizarTelefoneDestinatarioBR(extraido.telefoneDestinatario)
    if (normalizado) {
      formularioAtual = { ...formularioAtual, telefoneDestinatario: normalizado }
    } else {
      formularioAtual = { ...formularioAtual, telefoneDestinatario: undefined }
      return responder('O telefone parece incompleto. Pode enviar novamente com o DDD?')
    }
  } else if (!formularioAtual.telefoneDestinatario && Object.keys(extraido).length === 0) {
    // Só tenta interpretar a mensagem inteira como telefone quando ela não
    // trouxe NENHUM campo rotulado reconhecido — nunca confunde dígitos
    // soltos de outros campos (CEP, número...) numa resposta rotulada de
    // vários campos com um telefone isolado.
    const tentativaTelefone = interpretarTelefoneLivre(mensagemCliente)
    if (tentativaTelefone?.tipo === 'valido') {
      formularioAtual = { ...formularioAtual, telefoneDestinatario: tentativaTelefone.valor }
    } else if (tentativaTelefone?.tipo === 'incompleto') {
      return responder('O telefone parece incompleto. Pode enviar novamente com o DDD?')
    }
  }

  const cepInformadoInvalido = !!formularioAtual.cep && !cepValido(formularioAtual.cep)

  if (cepInformadoInvalido) {
    return responder('O CEP informado não parece válido — pode confirmar (8 dígitos)?')
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

  // Data de entrega: aceita o rótulo "Data de entrega:" OU uma resposta
  // isolada, sem rótulo — mesma regra já aplicada a telefone/número
  // isolados acima. Bug real observado em monitoramento 2026-07-24: "Só
  // faltou completar... Data de entrega:" era a única pergunta pendente, e
  // qualquer resposta sem rótulo ("amanhã", "25/07/2026", "amanhã às 10 da
  // manhã") era ignorada por extrairFormularioEntrega (que só reconhece
  // linhas "Rótulo: valor") — o campo nunca era preenchido e a mesma
  // pergunta se repetia indefinidamente. Só ativa quando data de entrega é
  // literalmente o único campo obrigatório faltando (nunca engole uma
  // resposta destinada a outro campo) e a mensagem parece mesmo uma data —
  // a validação real (reconhecida ou não, passado ou futuro) continua
  // acontecendo depois, em etapaConfirmandoFormulario (Parte 2).
  if (
    Object.keys(extraido).length === 0 &&
    !formularioAtual.dataEntrega &&
    /hoje|amanh[ãa]|\d{1,2}\/\d{1,2}/i.test(mensagemCliente) &&
    camposFaltandoFormulario(formularioAtual).every(c => c === 'dataEntrega')
  ) {
    formularioAtual = { ...formularioAtual, dataEntrega: mensagemCliente.trim() }
  }

  const faltando = camposFaltandoFormulario(formularioAtual)
  if (faltando.length > 0) {
    // Nada foi reconhecido ainda (nem rotulado, nem isolado) — repete o
    // pedido inicial no formato de sempre, nunca a lista de "só faltou
    // completar" (que soa como se algo já tivesse sido informado, quando
    // na verdade nenhum campo foi reconhecido). Bug real observado em
    // monitoramento 2026-07-25: "use os dados do pedido anterior" não foi
    // reconhecido, e a resposta listou os 8 campos como se fosse uma
    // pendência parcial. Checa formularioAnterior+extraido (o que existia
    // ANTES desta mensagem + o que ela trouxe), nunca formularioAtual —
    // que já inclui a data de entrega reaproveitada automaticamente do
    // produto (acima), algo que não veio desta mensagem nem de nenhuma
    // resposta anterior AO FORMULÁRIO em si.
    if (Object.keys(formularioAnterior).length === 0 && Object.keys(extraido).length === 0) {
      return responder(TEXTO_FORMULARIO_ENTREGA)
    }
    return responder(montarMensagemCamposFaltando(faltando))
  }

  // Telefone sempre normalizado pra E.164 antes de seguir — é o formato que
  // a Lalamove exige (Parte 2), nunca enviado "cru" pra frente. Nunca grava
  // null: camposFaltandoFormulario já garante que só chega aqui um telefone
  // normalizável, mas se por algum motivo a normalização falhar mesmo assim,
  // pede de novo em vez de gravar um valor corrompido no estado (bug real:
  // um `!` sem essa guarda deixava telefoneDestinatario virar null e o
  // formulário "completo" silenciosamente perdia o telefone).
  const telefoneE164 = normalizarTelefoneDestinatarioBR(formularioAtual.telefoneDestinatario!)
  if (!telefoneE164) {
    return responder('O telefone parece incompleto. Pode enviar novamente com o DDD?')
  }
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

// ── Correção de campos em confirmando_formulario (linguagem natural) ─────
//
// Bug real: uma correção rotulada com texto de comando junto ("Destinatário:
// Maria. Corrija") salvava a frase inteira, incluindo a palavra de comando,
// como se fosse o nome; e uma correção em linguagem natural sem rótulo
// ("o destinatário é Maria") não era reconhecida de jeito nenhum.

const PALAVRAS_COMANDO_CORRECAO = ['corrija', 'corrigir', 'por favor', 'esta errado', 'altere', 'troque']

/** Remove uma palavra/frase de comando no FINAL do valor (nunca no meio — nunca corrompe nomes compostos), com a pontuação solta ao redor. */
function limparValorCorrecao(valorBruto: string): string {
  let v = valorBruto.trim()
  const padraoComandoFinal = new RegExp(
    `[\\s,.;!]*\\b(${PALAVRAS_COMANDO_CORRECAO.map(p => p.replace(/\s+/g, '\\s+')).join('|')})\\b\\.?$`,
    'i',
  )
  v = v.replace(padraoComandoFinal, '').trim()
  v = v.replace(/[.,;!]+$/, '').trim()
  return v
}

/** Aplica limparValorCorrecao a cada valor de campo extraído — nunca deixa uma palavra de comando (ex.: "Corrija") ser salva como parte do dado. */
function limparCamposCorrecao(campos: Partial<FormularioEntregaDados>): Partial<FormularioEntregaDados> {
  const limpo: Partial<FormularioEntregaDados> = {}
  for (const [campo, valor] of Object.entries(campos)) {
    if (typeof valor !== 'string') continue
    const valorLimpo = limparValorCorrecao(valor)
    if (valorLimpo) (limpo as Record<string, string>)[campo] = valorLimpo
  }
  return limpo
}

// Cada padrão reconhece o campo pelo sinônimo mencionado e captura o valor
// depois do conector "é"/"eh"/"para" — nunca no meio da frase (o `[^\n]*?`
// preguiçoso avança só até o primeiro conector real). Restrito aos campos
// pedidos: remetente, destinatário, telefone, número, complemento, CEP e
// data — nunca tenta adivinhar um campo não mencionado explicitamente.
//
// O conector usa `\s` (espaço) como delimitador, nunca `\b` — "é" é um
// caractere acentuado e `\b` no JS (sem a flag /u com \p{...}) não trata
// letras acentuadas como caractere de palavra, então `\bé\b` nunca bate
// (bug pego pelos próprios testes: o regex nunca casava nada).
const CAMPOS_CORRECAO_LIVRE: { campo: keyof FormularioEntregaDados; padrao: RegExp }[] = [
  { campo: 'nomeDestinatario', padrao: /(?:quem vai receber|destinat[aá]rio)[^\n]*?\s(?:é|eh|para)\s+(.+)$/i },
  { campo: 'nomeComprador', padrao: /(?:remetente|quem est[aá] fazendo o pedido)[^\n]*?\s(?:é|eh|para)\s+(.+)$/i },
  { campo: 'telefoneDestinatario', padrao: /telefone[^\n]*?\s(?:é|eh|para)\s+(.+)$/i },
  { campo: 'numero', padrao: /n[uú]mero[^\n]*?\s(?:é|eh|para)\s+(.+)$/i },
  { campo: 'complemento', padrao: /complemento[^\n]*?\s(?:é|eh|para)\s+(.+)$/i },
  { campo: 'cep', padrao: /\bcep\b[^\n]*?\s(?:é|eh|para)\s+(.+)$/i },
  { campo: 'dataEntrega', padrao: /data(?:\s+de\s+entrega)?[^\n]*?\s(?:é|eh|para)\s+(.+)$/i },
]

/** Reconhece uma correção em linguagem natural, sem rótulo "Campo: valor" — ex.: "o destinatário é Maria", "corrija o destinatário para Maria". Só usado quando extrairFormularioEntrega não achou nada rotulado. */
function extrairCorrecaoLivre(texto: string): Partial<FormularioEntregaDados> | null {
  for (const { campo, padrao } of CAMPOS_CORRECAO_LIVRE) {
    const m = texto.match(padrao)
    if (m) {
      const valor = limparValorCorrecao(m[1])
      if (valor) return { [campo]: valor } as Partial<FormularioEntregaDados>
    }
  }
  return null
}

const FRASES_REJEICAO_SEM_CAMPO = ['esta errado', 'ta errado', 'errado', 'incorreto', 'nao esta certo']

/** true só quando a mensagem é uma rejeição isolada ("tá errado"), sem indicar qual campo — nunca dispara se algum dado real já foi extraído antes (ver ordem de checagem em etapaConfirmandoFormulario). */
function pareceRejeicaoSemCampo(mensagem: string): boolean {
  const n = normalizarFrase(mensagem)
  return FRASES_REJEICAO_SEM_CAMPO.some(f => n === f)
}

/** Coleta a confirmação dos dados do formulário — nunca cota frete antes disso (Parte 3.3/3.4). Cliente pode corrigir um campo em vez de confirmar; nunca perde os dados já certos. */
const CHAVE_GATE_CONFIRMANDO_FORMULARIO = 'confirmando_formulario'
const CHAVE_GATE_CANCELAMENTO_FORMULARIO = 'cancelamento_confirmando_formulario'
const INTENTS_VALIDAS_CONFIRMANDO_FORMULARIO: IntencaoContextual[] = [
  'confirmar', 'negar', 'cancelar', 'desistir', 'trocar_produto',
  'alterar_destinatario', 'alterar_endereco', 'alterar_data', 'alterar_horario',
  'corrigir_informacao', 'substituir_informacao',
  'perguntar_preco', 'perguntar_disponibilidade', 'perguntar_prazo', 'perguntar_entrega', 'falar_com_humano',
  'ambigua', 'incompleta',
]

function configGateConfirmandoFormulario(estado: EstadoConversa): ConfigGateBinario {
  const resumo = montarResumoFormulario(estado.dados.formulario ?? {})
  return {
    chave: CHAVE_GATE_CONFIRMANDO_FORMULARIO,
    perguntaAtual: resumo,
    // Reformulações continuam mostrando o resumo (nunca só a pergunta) —
    // o cliente precisa ver os dados reais pra saber o que está
    // confirmando/corrigindo, mesmo numa 1ª/2ª tentativa sem sucesso.
    perguntaReformulada: `Só confirmando os dados abaixo: eles estão certos, ou algo precisa ser corrigido?\n\n${resumo}`,
    perguntaComOpcoes: `Não consegui identificar sua resposta. Pode escolher uma das opções abaixo (vale número, texto, ou do seu jeito):\n\n1. Sim, os dados estão certos\n2. Não, preciso corrigir algo\n\nSe preferir, também posso te transferir para um atendente.\n\n${resumo}`,
    intentsValidas: INTENTS_VALIDAS_CONFIRMANDO_FORMULARIO,
    linhasContexto: [],
  }
}

/** Aplica ao formulário qualquer campo que o interpretador contextual indicou em camposParaAtualizar com valor em entidades — último recurso, só quando os parsers determinísticos (extrairFormularioEntrega/extrairCorrecaoLivre) já não encontraram nada; nunca inventa um campo fora desta lista. */
function aplicarCamposInterpretados(resultado: ResultadoInterpretacao): Partial<FormularioEntregaDados> {
  const camposValidos: (keyof FormularioEntregaDados)[] = ['nomeComprador', 'nomeDestinatario', 'telefoneDestinatario', 'cep', 'rua', 'numero', 'complemento', 'bairro', 'dataEntrega', 'periodo']
  const aplicado: Partial<FormularioEntregaDados> = {}
  for (const campo of resultado.camposParaAtualizar) {
    if (!camposValidos.includes(campo as keyof FormularioEntregaDados)) continue
    const valor = resultado.entidades[campo]
    if (typeof valor === 'string' && valor.trim()) (aplicado as Record<string, string>)[campo] = limparValorCorrecao(valor)
  }
  return aplicado
}

async function etapaConfirmandoFormulario(estado: EstadoConversa, mensagemCliente: string, deps: DependenciasFunil, agora: Date): Promise<ResultadoEtapa> {
  // Correção determinística (rotulada ou em linguagem livre) tem prioridade
  // sobre qualquer outra leitura da mensagem — nunca descarta uma correção
  // reconhecível só porque a mensagem também soa como confirmação (ex.:
  // "sim destinatário é Maria" corrige o destinatário em vez de confirmar
  // cegamente com o dado antigo).
  const rotulada = extrairFormularioEntrega(mensagemCliente)
  const correcao = Object.keys(rotulada).length > 0 ? limparCamposCorrecao(rotulada) : extrairCorrecaoLivre(mensagemCliente)
  if (correcao && Object.keys(correcao).length > 0) {
    const formularioAtualizado = { ...(estado.dados.formulario ?? {}), ...correcao }
    // Corrigir qualquer campo do formulário invalida uma cotação anterior
    // (Parte 4: "mudança de endereço invalida a cotação") — nunca deixa
    // uma cotação de um endereço/data diferente sobreviver pra aprovação.
    const dadosSemCotacaoAntiga: DadosPedido = {
      ...limparPendenciaInterpretacao(estado.dados),
      formulario: formularioAtualizado,
      valorFrete: undefined, valorTotal: undefined, freteDetalhes: undefined,
      entregaPrometidaEmISO: undefined, despachoEmISO: undefined, entregaImediata: undefined,
    }
    return {
      estado: { ...estado, dados: dadosSemCotacaoAntiga },
      mensagem: montarResumoFormulario(formularioAtualizado),
    }
  }

  // Sub-gate de confirmação de cancelamento, se estava pendente.
  if (estado.dados.ultimaPergunta?.chave === CHAVE_GATE_CANCELAMENTO_FORMULARIO) {
    const decisaoCancelamento = await avaliarGateBinario(
      { chave: CHAVE_GATE_CANCELAMENTO_FORMULARIO, perguntaAtual: mensagemConfirmarCancelamentoPedido(), perguntaReformulada: 'Só confirmando: você quer cancelar este pedido mesmo, ou prefere continuar?', perguntaComOpcoes: '1. Sim, cancelar\n2. Não, continuar o pedido', intentsValidas: INTENTS_VALIDAS_CANCELAMENTO, linhasContexto: [] },
      estado, mensagemCliente, deps,
    )
    const diagCancelamento = (motivo: string): DiagnosticoInterpretacao => ({ ...decisaoCancelamento.diagnostico, gate: CHAVE_GATE_CANCELAMENTO_FORMULARIO, motivo })
    if (decisaoCancelamento.decisao === 'confirmou') {
      return {
        estado: { ...estado, fase: 'encerrado_sem_venda', dados: { ...limparPendenciaInterpretacao(estado.dados), produto: undefined, formulario: undefined } },
        mensagem: 'Seu pedido foi cancelado, sem custo nenhum. Se quiser começar um novo pedido, é só me chamar!',
        diagnosticoInterpretacao: diagCancelamento('cancelamento_confirmado'),
      }
    }
    if (decisaoCancelamento.decisao === 'negou') {
      const dadosSemPendencia = limparPendenciaInterpretacao(estado.dados)
      return { estado: { ...estado, dados: dadosSemPendencia }, mensagem: `Combinado, seguimos com o pedido!\n\n${montarResumoFormulario(dadosSemPendencia.formulario ?? {})}`, diagnosticoInterpretacao: diagCancelamento('cancelamento_desistido') }
    }
    if (decisaoCancelamento.decisao === 'outra' && decisaoCancelamento.resultado.intencaoPrimaria === 'falar_com_humano') {
      return { estado: transferirParaHumano(estado, 'falar_com_humano (confirmação de cancelamento)'), mensagem: mensagemTransferencia(), diagnosticoInterpretacao: diagCancelamento('falar_com_humano') }
    }
    if (decisaoCancelamento.decisao === 'pendente') return { estado: decisaoCancelamento.estado, mensagem: decisaoCancelamento.mensagem, diagnosticoInterpretacao: diagCancelamento('cancelamento_ambiguo_anti_loop') }
    return { estado, mensagem: mensagemConfirmarCancelamentoPedido(), diagnosticoInterpretacao: diagCancelamento('cancelamento_outra_intencao_nao_tratada') }
  }

  const decisao = await avaliarGateBinario(configGateConfirmandoFormulario(estado), estado, mensagemCliente, deps)

  if (decisao.decisao === 'negou') {
    const dadosSemPendencia = limparPendenciaInterpretacao(estado.dados)
    // "está errado"/"tá errado" sozinho, sem indicar qual campo: bug real —
    // a Flora repetia o mesmo resumo sem perguntar nada. Agora pergunta
    // objetivamente qual dado corrigir; só reenvia o resumo depois de uma
    // correção real.
    if (pareceRejeicaoSemCampo(mensagemCliente)) {
      return { estado: { ...estado, dados: dadosSemPendencia }, mensagem: 'Qual dado você deseja corrigir?', diagnosticoInterpretacao: { ...decisao.diagnostico, gate: CHAVE_GATE_CONFIRMANDO_FORMULARIO, motivo: 'negou_sem_campo' } }
    }
    return { estado: { ...estado, dados: dadosSemPendencia }, mensagem: `Sem problemas — me avisa quando os dados estiverem certos.\n\n${montarResumoFormulario(dadosSemPendencia.formulario ?? {})}`, diagnosticoInterpretacao: { ...decisao.diagnostico, gate: CHAVE_GATE_CONFIRMANDO_FORMULARIO, motivo: 'negou' } }
  }

  if (decisao.decisao === 'outra') {
    const resultado = decisao.resultado
    const intencoes = new Set<IntencaoContextual>([resultado.intencaoPrimaria, ...resultado.intencoesSecundarias])
    const diagOutra = (motivo: string, camposAlterados?: string[]): DiagnosticoInterpretacao => ({ ...decisao.diagnostico, gate: CHAVE_GATE_CONFIRMANDO_FORMULARIO, motivo, camposAlterados })

    if (intencoes.has('cancelar') || intencoes.has('desistir')) {
      return {
        estado: { ...estado, dados: { ...limparPendenciaInterpretacao(estado.dados), ultimaPergunta: { chave: CHAVE_GATE_CANCELAMENTO_FORMULARIO, textoExibido: mensagemConfirmarCancelamentoPedido(), intentsValidas: INTENTS_VALIDAS_CANCELAMENTO } } },
        mensagem: mensagemConfirmarCancelamentoPedido(),
        diagnosticoInterpretacao: diagOutra('cancelamento_pendente_confirmacao'),
      }
    }
    if (intencoes.has('falar_com_humano')) {
      return { estado: transferirParaHumano(estado, 'falar_com_humano (gate confirmando_formulario)'), mensagem: mensagemTransferencia(), diagnosticoInterpretacao: diagOutra('falar_com_humano') }
    }
    if (intencoes.has('trocar_produto')) {
      return {
        estado: {
          ...estado,
          fase: 'escolha_categoria',
          dados: { ...limparPendenciaInterpretacao(estado.dados), produto: undefined, valorFrete: undefined, valorTotal: undefined, freteDetalhes: undefined, categoriaEscolhida: undefined, opcoesRecomendadas: undefined, recomendacaoApresentada: undefined },
        },
        mensagem: 'Sem problemas! Me conta o que você procura (cor, estilo, ocasião), ou posso te mostrar as categorias de novo.',
        diagnosticoInterpretacao: diagOutra('trocou_produto'),
      }
    }
    // Correção em formulação inédita, não coberta pelos parsers
    // determinísticos acima — último recurso, só aplica campos que o
    // próprio interpretador aponta explicitamente em camposParaAtualizar.
    const camposInterpretados = aplicarCamposInterpretados(resultado)
    if (Object.keys(camposInterpretados).length > 0) {
      const formularioAtualizado = { ...(estado.dados.formulario ?? {}), ...camposInterpretados }
      const dadosSemCotacaoAntiga: DadosPedido = {
        ...limparPendenciaInterpretacao(estado.dados),
        formulario: formularioAtualizado,
        valorFrete: undefined, valorTotal: undefined, freteDetalhes: undefined,
        entregaPrometidaEmISO: undefined, despachoEmISO: undefined, entregaImediata: undefined,
      }
      return { estado: { ...estado, dados: dadosSemCotacaoAntiga }, mensagem: montarResumoFormulario(formularioAtualizado), diagnosticoInterpretacao: diagOutra('corrigiu_campo_interpretado', Object.keys(camposInterpretados)) }
    }
    if (intencoes.has('perguntar_disponibilidade') || intencoes.has('perguntar_prazo') || intencoes.has('perguntar_entrega') || intencoes.has('perguntar_preco')) {
      const dadosSemPendencia = limparPendenciaInterpretacao(estado.dados)
      return { estado: { ...estado, dados: dadosSemPendencia }, mensagem: `Ainda vamos calcular o frete depois de confirmar os dados de entrega — o total sai na próxima etapa.\n\n${montarResumoFormulario(dadosSemPendencia.formulario ?? {})}`, diagnosticoInterpretacao: diagOutra('respondeu_pergunta') }
    }
    return { estado, mensagem: `Sem problemas — me avisa quando os dados estiverem certos.\n\n${montarResumoFormulario(estado.dados.formulario ?? {})}`, diagnosticoInterpretacao: diagOutra('outra_intencao_nao_tratada') }
  }

  if (decisao.decisao === 'pendente') {
    return { estado: decisao.estado, mensagem: decisao.mensagem, diagnosticoInterpretacao: { ...decisao.diagnostico, gate: CHAVE_GATE_CONFIRMANDO_FORMULARIO, motivo: 'ambiguo_anti_loop' } }
  }

  // decisao.decisao === 'confirmou'
  estado = { ...estado, dados: limparPendenciaInterpretacao(estado.dados) }
  const diagConfirmouFormulario = (motivo: string): DiagnosticoInterpretacao => ({ ...decisao.diagnostico, gate: CHAVE_GATE_CONFIRMANDO_FORMULARIO, motivo })

  if (!estado.dados.formulario || !formularioCompleto(estado.dados.formulario)) {
    // Estado inconsistente (nunca deveria chegar aqui sem formulário
    // completo) — nunca cota frete com dados incompletos, reenvia o formulário.
    return { estado: { ...estado, fase: 'aguardando_formulario' }, mensagem: TEXTO_FORMULARIO_ENTREGA, diagnosticoInterpretacao: diagConfirmouFormulario('confirmou_formulario_incompleto') }
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
      diagnosticoInterpretacao: diagConfirmouFormulario('confirmou_data_invalida'),
    }
  }

  const estadoSincronizado = sincronizarFormularioParaEndereco(estado)
  const dadosComDataTipada: DadosPedido = {
    ...estadoSincronizado.dados,
    dataEntregaSolicitada: dataParseada!,
    periodoEntrega: normalizarPeriodoEntregaTexto(estado.dados.formulario.periodo),
  }
  const resultadoCalculoFrete = await etapaCalculoFrete({ ...estadoSincronizado, dados: dadosComDataTipada, fase: 'calculando_frete' }, deps, agora)
  return { ...resultadoCalculoFrete, diagnosticoInterpretacao: diagConfirmouFormulario('confirmou_avancou_para_frete') }
}

// Chaves estáveis dos gates desta etapa na proteção anti-loop/interpretação
// contextual — nunca o texto da pergunta em si, pra sobreviver a reformulações.
const CHAVE_GATE_APROVACAO_FRETE = 'aprovacao_frete'
const CHAVE_GATE_CANCELAMENTO_APROVACAO_FRETE = 'cancelamento_aprovacao_frete'
const INTENTS_VALIDAS_APROVACAO_FRETE: IntencaoContextual[] = [
  'confirmar', 'negar', 'cancelar', 'desistir', 'trocar_produto', 'alterar_quantidade',
  'alterar_destinatario', 'alterar_endereco', 'alterar_data', 'alterar_horario', 'alterar_mensagem_cartao',
  'corrigir_informacao', 'substituir_informacao',
  'perguntar_preco', 'perguntar_disponibilidade', 'perguntar_prazo', 'perguntar_entrega', 'falar_com_humano',
  'ambigua', 'incompleta',
]
const INTENTS_VALIDAS_CANCELAMENTO: IntencaoContextual[] = ['confirmar', 'negar', 'falar_com_humano', 'ambigua', 'incompleta']

/** Campos do formulário cuja alteração invalida a cotação de frete já feita (Parte 4: endereço/data novos exigem recotar) — nome/telefone/complemento não mudam a entrega em si. */
const CAMPOS_FORMULARIO_QUE_INVALIDAM_COTACAO: (keyof FormularioEntregaDados)[] = ['cep', 'rua', 'numero', 'bairro', 'dataEntrega']

function mensagemConfirmarCancelamentoPedido(): string {
  return 'Você quer mesmo cancelar esse pedido? Nada foi cobrado ainda. Responda "sim" para cancelar, ou "não" para continuar de onde paramos.'
}

function configGateAprovacaoFrete(estado: EstadoConversa): ConfigGateBinario {
  return {
    chave: CHAVE_GATE_APROVACAO_FRETE,
    perguntaAtual: montarMensagemAprovacaoFrete(estado.dados),
    perguntaReformulada: 'Só quero confirmar: posso seguir com o pedido nesses termos, ou você prefere mudar alguma coisa antes?',
    perguntaComOpcoes: 'Não consegui identificar sua resposta. Pode escolher uma das opções abaixo (vale número, texto, ou do seu jeito):\n\n1. Sim, pode seguir\n2. Não, quero mudar algo\n\nSe preferir, também posso te transferir para um atendente.',
    intentsValidas: INTENTS_VALIDAS_APROVACAO_FRETE,
    linhasContexto: [
      `Produto combinado: ${estado.dados.produto?.nome ?? 'não informado'} (quantidade ${estado.dados.produto?.quantidade ?? 1}).`,
      `Total combinado até agora: ${formatarPreco(estado.dados.valorTotal)}.`,
    ],
  }
}

/** Extrai a mesma correção de campo (rotulada ou em linguagem livre) já usada em etapaConfirmandoFormulario — reaproveitada aqui pra nunca duplicar a lógica de reconhecer "o endereço agora é..."/"CEP: ..." etc. */
function extrairCorrecaoFormulario(mensagemCliente: string): Partial<FormularioEntregaDados> {
  const rotulada = extrairFormularioEntrega(mensagemCliente)
  if (Object.keys(rotulada).length > 0) return limparCamposCorrecao(rotulada)
  const livre = extrairCorrecaoLivre(mensagemCliente)
  if (livre) return livre
  // Último recurso: reconhece CEP/número/complemento soltos no texto, sem
  // exigir o conector "é/eh/para" (ex.: "número 55, cep 04204-030") — mesmo
  // parser já usado na coleta inicial do formulário (extrairFormularioEntregaLivre).
  return extrairFormularioEntregaLivre(mensagemCliente)
}

// "entrega amanhã"/"pode ser sábado" — data mencionada solta no meio da
// frase, sem o conector "data... é/para" que extrairCorrecaoFormulario
// exige. Reconhece só os mesmos termos que normalizarDataEntregaTexto sabe
// interpretar (hoje/amanhã/dia da semana/DD-MM) — nunca inventa uma data
// que o texto não traga literalmente.
const REGEX_DATA_LIVRE_EM_MENSAGEM = /\b(hoje|amanha|segunda(?:-?feira)?|terca(?:-?feira)?|quarta(?:-?feira)?|quinta(?:-?feira)?|sexta(?:-?feira)?|sabado|domingo|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i

function extrairDataLivreDeMensagem(mensagemCliente: string): string | undefined {
  const m = normalizar(mensagemCliente).match(REGEX_DATA_LIVRE_EM_MENSAGEM)
  return m?.[1]
}

/** "a mensagem do cartão agora é ..."/"mensagem no cartão: ..." — único campo de texto livre do produto que pode ser alterado nesta etapa, nunca confundido com os campos do formulário de entrega. */
function extrairNovaMensagemCartao(mensagemCliente: string, entidades: Record<string, string | number>): string | undefined {
  const m = mensagemCliente.match(/mensagem(?:\s+d[oe])?\s+cart[ãa]o[^\n]*?\s(?:é|eh|para|:)\s+(.+)$/i)
  if (m) return limparValorCorrecao(m[1])
  return typeof entidades.mensagemCartao === 'string' ? entidades.mensagemCartao.trim() || undefined : undefined
}

function responderPerguntaDuranteAprovacaoFrete(intencoes: Set<IntencaoContextual>, dados: DadosPedido): string {
  const partes: string[] = []
  if (intencoes.has('perguntar_preco')) {
    partes.push(`O valor total combinado é ${formatarPreco(dados.valorTotal)} (produto + frete).`)
  }
  if (intencoes.has('perguntar_disponibilidade')) {
    partes.push(`${dados.produto?.nome ?? 'O produto'} segue disponível, confirmado na revalidação mais recente.`)
  }
  if (intencoes.has('perguntar_prazo') || intencoes.has('perguntar_entrega')) {
    partes.push(dados.entregaPrometidaEmISO ? `Entrega prevista: ${textoJanelaPrometida(dados.entregaPrometidaEmISO)}.` : 'A janela de entrega já cotada continua valendo.')
  }
  return partes.join(' ')
}

/**
 * Aplica a intenção (primária + secundárias) que o interpretador contextual
 * reconheceu na resposta do cliente a esta etapa — nunca descarta nenhuma
 * das intenções detectadas, todas são processadas na mesma mensagem
 * ("mantém o pedido e entrega amanhã", "troca o destinatário e aumenta a
 * quantidade", "não quero cancelar, quero trocar"). Ordem de prioridade:
 * saída (cancelar/desistir/falar_com_humano) > troca de produto > alteração
 * de dados > confirmação (só depois de aplicar qualquer alteração) >
 * pergunta > nenhuma ação reconhecida (volta pro esclarecimento do gate).
 */
async function processarOutraRespostaAprovacaoFrete(
  estado: EstadoConversa,
  resultado: ResultadoInterpretacao,
  mensagemCliente: string,
  deps: DependenciasFunil,
  agora: Date,
): Promise<ResultadoEtapa> {
  const intencoes = new Set<IntencaoContextual>([resultado.intencaoPrimaria, ...resultado.intencoesSecundarias])
  const diagBase = (motivo: string, camposAlterados?: string[]): DiagnosticoInterpretacao => ({
    gate: CHAVE_GATE_APROVACAO_FRETE,
    intencaoPrimaria: resultado.intencaoPrimaria,
    intencoesSecundarias: resultado.intencoesSecundarias,
    confianca: resultado.confianca,
    precisaEsclarecimento: resultado.precisaEsclarecimento,
    fallbackAcionado: false,
    tentativaNumero: estado.dados.tentativasInterpretacao?.[CHAVE_GATE_APROVACAO_FRETE] ?? 0,
    motivo,
    camposAlterados,
  })

  // Cancelamento/desistência nunca é automático — pede confirmação explícita
  // antes de encerrar de fato ("zero cancelamento indevido"), preservando
  // todo o estado enquanto isso.
  if (intencoes.has('cancelar') || intencoes.has('desistir')) {
    return {
      estado: {
        ...estado,
        dados: {
          ...limparPendenciaInterpretacao(estado.dados),
          ultimaPergunta: { chave: CHAVE_GATE_CANCELAMENTO_APROVACAO_FRETE, textoExibido: mensagemConfirmarCancelamentoPedido(), intentsValidas: INTENTS_VALIDAS_CANCELAMENTO },
        },
      },
      mensagem: mensagemConfirmarCancelamentoPedido(),
      diagnosticoInterpretacao: diagBase('cancelamento_pendente_confirmacao'),
    }
  }
  if (intencoes.has('falar_com_humano')) {
    return { estado: transferirParaHumano(estado, 'falar_com_humano (gate aprovacao_frete)'), mensagem: mensagemTransferencia(), diagnosticoInterpretacao: diagBase('falar_com_humano') }
  }

  // Troca de produto: volta pra escolha, preserva o formulário de entrega já
  // coletado (o cliente não pediu pra mudar isso) — nunca obriga a
  // redigitar os dados de entrega só porque o produto mudou.
  if (intencoes.has('trocar_produto')) {
    return {
      estado: {
        ...estado,
        fase: 'escolha_categoria',
        dados: {
          ...limparPendenciaInterpretacao(estado.dados),
          produto: undefined, valorFrete: undefined, valorTotal: undefined, freteDetalhes: undefined,
          categoriaEscolhida: undefined, opcoesRecomendadas: undefined, recomendacaoApresentada: undefined,
        },
      },
      mensagem: 'Sem problemas! Me conta o que você procura (cor, estilo, ocasião), ou posso te mostrar as categorias de novo.',
      diagnosticoInterpretacao: diagBase('trocou_produto'),
    }
  }

  // Alterações de dado — aplicadas em conjunto, sem descartar nenhuma.
  const pedeAlteracaoCampo = ['alterar_destinatario', 'alterar_endereco', 'alterar_data', 'alterar_horario', 'corrigir_informacao', 'substituir_informacao']
    .some(i => intencoes.has(i as IntencaoContextual))
  // Mensagens compostas ("troca o destinatário e aumenta a quantidade para
  // 3") podem ter mais de um conector "para" na mesma frase — os parsers
  // determinísticos (que assumem UM campo por mensagem) podem associar o
  // valor errado ao campo errado. Por isso o valor que o próprio
  // interpretador já indicou em entidades/camposParaAtualizar (contrato de
  // chaves fixo, ver montarPromptGateBinario) tem prioridade; o parser
  // determinístico só preenche os campos que o interpretador não cobriu.
  const correcaoDeterministica = pedeAlteracaoCampo ? extrairCorrecaoFormulario(mensagemCliente) : {}
  const correcaoInterpretada = pedeAlteracaoCampo ? aplicarCamposInterpretados(resultado) : {}
  const correcao: Partial<FormularioEntregaDados> = { ...correcaoDeterministica, ...correcaoInterpretada }
  // "mantém o pedido e entrega amanhã"/"pode ser sábado" — data solta no
  // texto, sem o conector "data... é/para" que extrairCorrecaoFormulario
  // exige. Só tentada quando nada acima já achou uma data, nunca sobrescreve
  // uma correção já reconhecida.
  if ((intencoes.has('alterar_data') || intencoes.has('alterar_horario')) && !correcao.dataEntrega) {
    const dataLivre = extrairDataLivreDeMensagem(mensagemCliente)
    if (dataLivre) correcao.dataEntrega = dataLivre
  }
  const novaMensagemCartao = intencoes.has('alterar_mensagem_cartao') ? extrairNovaMensagemCartao(mensagemCliente, resultado.entidades) : undefined
  const novaQuantidade = intencoes.has('alterar_quantidade')
    ? (typeof resultado.entidades.quantidade === 'number' ? resultado.entidades.quantidade : extrairNumeros(mensagemCliente)[0])
    : undefined

  const temCorrecaoDeCampo = Object.keys(correcao).length > 0
  const cotacaoInvalidada = temCorrecaoDeCampo && CAMPOS_FORMULARIO_QUE_INVALIDAM_COTACAO.some(c => c in correcao)

  if (temCorrecaoDeCampo || novaMensagemCartao || (novaQuantidade != null && novaQuantidade > 0)) {
    const formularioAtualizado = temCorrecaoDeCampo ? { ...(estado.dados.formulario ?? {}), ...correcao } : estado.dados.formulario
    let produtoAtualizado = estado.dados.produto
    if (novaMensagemCartao) produtoAtualizado = { ...produtoAtualizado, mensagemCartao: novaMensagemCartao } as ProdutoSelecionado
    if (novaQuantidade != null && novaQuantidade > 0) produtoAtualizado = { ...produtoAtualizado, quantidade: Math.round(novaQuantidade) } as ProdutoSelecionado

    const totalRecalculado = produtoAtualizado?.preco != null && produtoAtualizado.quantidade != null && estado.dados.valorFrete != null
      ? produtoAtualizado.preco * produtoAtualizado.quantidade + estado.dados.valorFrete
      : estado.dados.valorTotal

    const dadosAtualizados: DadosPedido = {
      ...limparPendenciaInterpretacao(estado.dados),
      formulario: formularioAtualizado,
      produto: produtoAtualizado,
      ...(cotacaoInvalidada
        ? { valorFrete: undefined, valorTotal: undefined, freteDetalhes: undefined, entregaPrometidaEmISO: undefined, despachoEmISO: undefined, entregaImediata: undefined }
        : { valorTotal: totalRecalculado }),
    }

    const camposAlterados = [...Object.keys(correcao), ...(novaMensagemCartao ? ['mensagemCartao'] : []), ...(novaQuantidade != null && novaQuantidade > 0 ? ['quantidade'] : [])]

    // Confirmação junto da alteração ("mantém o pedido e entrega amanhã")
    // só segue direto quando a cotação continua válida (troca não afetou
    // endereço/data) — nunca pula a recotação/reaprovação quando ela mudou.
    if (intencoes.has('confirmar') && !cotacaoInvalidada) {
      const resultadoRecursivo = await etapaAguardandoAprovacaoFrete({ ...estado, dados: dadosAtualizados }, 'sim', deps, agora)
      // A chamada recursiva resolve por confirmação determinística direta
      // (mensagem literal 'sim'), então nunca carrega diagnóstico próprio —
      // preserva aqui o diagnóstico real desta mensagem original, com os
      // campos que de fato mudaram.
      return { ...resultadoRecursivo, diagnosticoInterpretacao: diagBase('confirmou_e_alterou_campo', camposAlterados) }
    }
    if (cotacaoInvalidada) {
      const resultadoRecotacao = await etapaCalculoFrete({ ...estado, dados: dadosAtualizados, fase: 'calculando_frete' }, deps, agora)
      return { ...resultadoRecotacao, diagnosticoInterpretacao: diagBase('alterou_campo_recotando', camposAlterados) }
    }
    return { estado: { ...estado, dados: dadosAtualizados }, mensagem: `Combinado! ${montarMensagemAprovacaoFrete(dadosAtualizados)}`, diagnosticoInterpretacao: diagBase('alterou_campo', camposAlterados) }
  }

  // Perguntas do cliente durante a aprovação (preço/prazo/disponibilidade/
  // entrega) — responde com o que já se sabe, sem perder nada do estado, e
  // volta a pedir a mesma aprovação (nunca avança nem cancela sozinho).
  if (intencoes.has('perguntar_preco') || intencoes.has('perguntar_disponibilidade') || intencoes.has('perguntar_prazo') || intencoes.has('perguntar_entrega')) {
    const resposta = responderPerguntaDuranteAprovacaoFrete(intencoes, estado.dados)
    return { estado, mensagem: `${resposta}\n\n${montarMensagemAprovacaoFrete(estado.dados)}`, diagnosticoInterpretacao: diagBase('respondeu_pergunta') }
  }

  // Nenhuma ação reconhecida com informação suficiente pra agir — nunca
  // assume, devolve pro esclarecimento normal do gate (anti-loop).
  const tentativas = (estado.dados.tentativasInterpretacao?.[CHAVE_GATE_APROVACAO_FRETE] ?? 0) + 1
  return {
    estado: {
      ...estado,
      dados: {
        ...estado.dados,
        ultimaPergunta: { chave: CHAVE_GATE_APROVACAO_FRETE, textoExibido: montarMensagemAprovacaoFrete(estado.dados), intentsValidas: INTENTS_VALIDAS_APROVACAO_FRETE },
        tentativasInterpretacao: { ...estado.dados.tentativasInterpretacao, [CHAVE_GATE_APROVACAO_FRETE]: tentativas },
      },
    },
    mensagem: mensagemGateBinarioPorTentativa(configGateAprovacaoFrete(estado), tentativas),
    diagnosticoInterpretacao: diagBase('acao_nao_reconhecida_anti_loop'),
  }
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

  // Sub-gate de confirmação de cancelamento (aberto por processarOutraRespostaAprovacaoFrete)
  // — checado antes do gate normal, tem prioridade enquanto estiver pendente.
  if (estado.dados.ultimaPergunta?.chave === CHAVE_GATE_CANCELAMENTO_APROVACAO_FRETE) {
    const decisaoCancelamento = await avaliarGateBinario(
      { chave: CHAVE_GATE_CANCELAMENTO_APROVACAO_FRETE, perguntaAtual: mensagemConfirmarCancelamentoPedido(), perguntaReformulada: 'Só confirmando: você quer cancelar este pedido mesmo, ou prefere continuar?', perguntaComOpcoes: '1. Sim, cancelar\n2. Não, continuar o pedido', intentsValidas: INTENTS_VALIDAS_CANCELAMENTO, linhasContexto: [] },
      estado, mensagemCliente, deps,
    )
    const diagCancelamento = (motivo: string): DiagnosticoInterpretacao => ({ ...decisaoCancelamento.diagnostico, gate: CHAVE_GATE_CANCELAMENTO_APROVACAO_FRETE, motivo })
    if (decisaoCancelamento.decisao === 'confirmou') {
      return {
        estado: {
          ...estado,
          fase: 'encerrado_sem_venda',
          dados: { ...limparPendenciaInterpretacao(estado.dados), produto: undefined, formulario: undefined, valorFrete: undefined, valorTotal: undefined, freteDetalhes: undefined, pedidoId: undefined, linkPagamento: undefined },
        },
        mensagem: 'Seu pedido foi cancelado, sem custo nenhum. Se quiser começar um novo pedido, é só me chamar!',
        diagnosticoInterpretacao: diagCancelamento('cancelamento_confirmado'),
      }
    }
    if (decisaoCancelamento.decisao === 'negou') {
      const dadosSemPendencia = limparPendenciaInterpretacao(estado.dados)
      return { estado: { ...estado, dados: dadosSemPendencia }, mensagem: `Combinado, seguimos com o pedido!\n\n${montarMensagemAprovacaoFrete(dadosSemPendencia)}`, diagnosticoInterpretacao: diagCancelamento('cancelamento_desistido') }
    }
    if (decisaoCancelamento.decisao === 'outra' && decisaoCancelamento.resultado.intencaoPrimaria === 'falar_com_humano') {
      return { estado: transferirParaHumano(estado, 'falar_com_humano (confirmação de cancelamento)'), mensagem: mensagemTransferencia(), diagnosticoInterpretacao: diagCancelamento('falar_com_humano') }
    }
    if (decisaoCancelamento.decisao === 'pendente') return { estado: decisaoCancelamento.estado, mensagem: decisaoCancelamento.mensagem, diagnosticoInterpretacao: diagCancelamento('cancelamento_ambiguo_anti_loop') }
    // 'outra' não reconhecida (ambigua/incompleta já tratadas dentro do gate) — repete a pergunta de cancelamento, nunca assume.
    return { estado, mensagem: mensagemConfirmarCancelamentoPedido(), diagnosticoInterpretacao: diagCancelamento('cancelamento_outra_intencao_nao_tratada') }
  }

  const decisao = await avaliarGateBinario(configGateAprovacaoFrete(estado), estado, mensagemCliente, deps)
  if (decisao.decisao === 'negou') {
    return {
      estado: { ...estado, dados: limparPendenciaInterpretacao(estado.dados) },
      mensagem: `Sem problemas — me avisa quando quiser seguir.\n\n${montarMensagemAprovacaoFrete(estado.dados)}`,
      diagnosticoInterpretacao: { ...decisao.diagnostico, gate: CHAVE_GATE_APROVACAO_FRETE, motivo: 'negou' },
    }
  }
  if (decisao.decisao === 'outra') {
    return processarOutraRespostaAprovacaoFrete(estado, decisao.resultado, mensagemCliente, deps, agora)
  }
  if (decisao.decisao === 'pendente') {
    return { estado: decisao.estado, mensagem: decisao.mensagem, diagnosticoInterpretacao: { ...decisao.diagnostico, gate: CHAVE_GATE_APROVACAO_FRETE, motivo: 'ambiguo_anti_loop' } }
  }
  // decisao.decisao === 'confirmou' — segue o fluxo normal abaixo.
  estado = { ...estado, dados: limparPendenciaInterpretacao(estado.dados) }
  const diagConfirmou = (motivo: string): DiagnosticoInterpretacao => ({ ...decisao.diagnostico, gate: CHAVE_GATE_APROVACAO_FRETE, motivo })

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
      diagnosticoInterpretacao: diagConfirmou('confirmou_dados_incompletos'),
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
        diagnosticoInterpretacao: diagConfirmou('confirmou_produto_indisponivel'),
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
        diagnosticoInterpretacao: diagConfirmou('confirmou_preco_mudou'),
      }
    }
    if ((real.fotoUrl && real.fotoUrl !== produtoAtual.fotoUrl) || (real.nome && real.nome !== produtoAtual.nome)) {
      estado = { ...estado, dados: { ...estado.dados, produto: { ...produtoAtual, fotoUrl: real.fotoUrl ?? produtoAtual.fotoUrl, nome: real.nome ?? produtoAtual.nome } } }
    }
  }

  const criado = await deps.criarPedido(estado.dados)
  if (!criado) {
    return { estado: transferirParaHumano(estado, 'Falha ao criar pedido antes do pagamento'), mensagem: mensagemTransferencia(), diagnosticoInterpretacao: diagConfirmou('confirmou_falha_criar_pedido') }
  }

  const dadosComPedido = { ...estado.dados, pedidoId: criado.pedidoId }
  const resultadoPagamento = await gerarPagamentoComPedido(dadosComPedido, deps)
  if (!resultadoPagamento.link) {
    return {
      estado: transferirParaHumano({ ...estado, dados: dadosComPedido }, 'Falha ao gerar link de pagamento'),
      mensagem: resultadoPagamento.mensagem,
      diagnosticoInterpretacao: diagConfirmou('confirmou_falha_gerar_pagamento'),
    }
  }

  const novoEstado: EstadoConversa = {
    ...estado,
    fase: 'aguardando_pagamento',
    dados: { ...dadosComPedido, linkPagamento: resultadoPagamento.link, paymentId: resultadoPagamento.paymentId ?? criado.pedidoId },
  }
  return { estado: novoEstado, mensagem: resultadoPagamento.mensagem, diagnosticoInterpretacao: diagConfirmou('confirmou_pagamento_gerado') }
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

  // Confirmação de cancelamento (aberta por uma frase de cancelamento puro,
  // ver pareceApenasCancelamento abaixo) tem prioridade sobre qualquer outro
  // gate — pode ter sido aberta em qualquer fase da compra, nunca decide
  // sozinha (Prioridade: cancelamento/desistência nunca é automático).
  if (estado.dados.ultimaPergunta?.chave === CHAVE_GATE_CANCELAMENTO_GLOBAL) {
    const decisaoCancelamento = await avaliarGateBinario(
      {
        chave: CHAVE_GATE_CANCELAMENTO_GLOBAL,
        perguntaAtual: mensagemConfirmarCancelamentoPedido(),
        perguntaReformulada: 'Só confirmando: você quer cancelar este pedido mesmo, ou prefere continuar de onde paramos?',
        perguntaComOpcoes: '1. Sim, cancelar\n2. Não, continuar o pedido',
        intentsValidas: INTENTS_VALIDAS_CANCELAMENTO,
        linhasContexto: [],
      },
      estado, mensagemCliente, deps,
    )
    const diagCancelamentoGlobal = (motivo: string): DiagnosticoInterpretacao => ({ ...decisaoCancelamento.diagnostico, gate: CHAVE_GATE_CANCELAMENTO_GLOBAL, motivo })
    if (decisaoCancelamento.decisao === 'confirmou') {
      return {
        estado: { ...estadoInicial(), dados: { jornadaIniciadaEm: new Date().toISOString() } },
        mensagem: 'Seu pedido foi cancelado, sem custo nenhum. Se quiser começar um novo pedido, é só me chamar!',
        diagnosticoInterpretacao: diagCancelamentoGlobal('cancelamento_confirmado'),
      }
    }
    if (decisaoCancelamento.decisao === 'negou') {
      return { estado: { ...estado, dados: limparPendenciaInterpretacao(estado.dados) }, mensagem: 'Combinado, seguimos com o pedido! Me avisa se quiser fazer alguma alteração.', diagnosticoInterpretacao: diagCancelamentoGlobal('cancelamento_desistido') }
    }
    if (decisaoCancelamento.decisao === 'outra' && decisaoCancelamento.resultado.intencaoPrimaria === 'falar_com_humano') {
      return { estado: transferirParaHumano(estado, 'falar_com_humano (confirmação de cancelamento)'), mensagem: mensagemTransferencia(), diagnosticoInterpretacao: diagCancelamentoGlobal('falar_com_humano') }
    }
    if (decisaoCancelamento.decisao === 'pendente') return { estado: decisaoCancelamento.estado, mensagem: decisaoCancelamento.mensagem, diagnosticoInterpretacao: diagCancelamentoGlobal('cancelamento_ambiguo_anti_loop') }
    return { estado, mensagem: mensagemConfirmarCancelamentoPedido(), diagnosticoInterpretacao: diagCancelamentoGlobal('cancelamento_outra_intencao_nao_tratada') }
  }

  // Gate de retomada após intervalo sem interação (Parte 3): verificado
  // antes de qualquer outro gate. Nunca dispara sozinho — só quando chega
  // esta mensagem nova. "nova compra" segue pro reinício normal de jornada
  // logo abaixo (estadoComPedidoInconsistente/pareceNovaIntencaoDeCompra
  // nunca disparam aqui pois a fase é 'retomada_apos_intervalo').
  if (estado.fase === 'retomada_apos_intervalo') {
    const resolucao = await resolverRetomadaAposIntervalo(estado, mensagemCliente, deps, agora)
    if (resolucao) return resolucao
    estado = reiniciarJornada(mensagemCliente)
    intencao = classificarIntencao(mensagemCliente, estado.fase)
  } else if (deveGatilharRetomadaAposIntervalo(estado, agora)) {
    return {
      estado: {
        ...estado,
        fase: 'retomada_apos_intervalo',
        dados: {
          ...estado.dados, faseAntesDoIntervalo: estado.fase, ultimaInteracaoEm: agora.toISOString(),
          ultimaPergunta: { chave: CHAVE_GATE_RETOMADA, textoExibido: mensagemRetomadaAposIntervalo(), intentsValidas: INTENTS_VALIDAS_RETOMADA },
        },
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
      return { estado, mensagem: mensagemAguardandoRespostaForaDoHorario(mensagemCliente) }
    }
  }

  // Gate de reaproveitamento de dados (feedback direto do usuário,
  // monitoramento 2026-07-24): só é resolvido respondendo sim/não — nunca
  // avança sozinho. "sim" restaura o formulário completo salvo antes do
  // reinício (destinatário/endereço/telefone) e segue o fluxo normal a
  // partir do início (escolha do novo produto, formulário já preenchido);
  // "não" descarta os dados antigos e segue pedindo tudo de novo, como já
  // acontecia antes desta correção.
  if (estado.fase === 'aguardando_reaproveitar_dados') {
    if (pareceConfirmacao(mensagemCliente)) {
      estado = {
        ...estado,
        fase: 'inicio',
        dados: { ...estado.dados, formulario: estado.dados.formularioAnterior, formularioAnterior: undefined },
      }
      // segue o fluxo normal abaixo, agora com o formulário reaproveitado.
    } else if (pareceNegacao(mensagemCliente)) {
      estado = { ...estado, fase: 'inicio', dados: { ...estado.dados, formularioAnterior: undefined } }
      // segue o fluxo normal abaixo, pedindo o formulário do zero.
    } else {
      // Nem confirmação nem negação pelo caminho determinístico — antes de
      // só repetir a pergunta, tenta a interpretação contextual (só quando
      // conectada; sem ela, mantém exatamente o comportamento anterior a
      // esta camada). Confiança baixa/composta nunca decide sozinha aqui.
      const interpretado = await interpretarComFallback(deps, montarPromptReaproveitarDados(), mensagemCliente)
      if (interpretado && interpretado.confianca !== 'baixa' && !interpretado.precisaEsclarecimento && interpretado.intencoesSecundarias.length === 0 && interpretado.intencaoPrimaria === 'confirmar') {
        estado = {
          ...estado,
          fase: 'inicio',
          dados: { ...estado.dados, formulario: estado.dados.formularioAnterior, formularioAnterior: undefined },
        }
      } else if (interpretado && interpretado.confianca !== 'baixa' && !interpretado.precisaEsclarecimento && interpretado.intencoesSecundarias.length === 0 && interpretado.intencaoPrimaria === 'negar') {
        estado = { ...estado, fase: 'inicio', dados: { ...estado.dados, formularioAnterior: undefined } }
      } else {
        // Diagnóstico só é anexado aqui (caso ambíguo, com retorno direto) —
        // os casos de sucesso (confirmar/negar) seguem o fluxo normal do
        // dispatcher abaixo, cujo retorno final já pertence a outra etapa;
        // ainda assim continuam contabilizados na telemetria via a fase
        // anterior ('aguardando_reaproveitar_dados'), só sem o diagnóstico
        // detalhado de intenção/confiança nesse caso específico.
        return {
          estado, mensagem: mensagemPerguntaReaproveitarDados(),
          diagnosticoInterpretacao: {
            gate: 'aguardando_reaproveitar_dados', motivo: 'ambiguo',
            intencaoPrimaria: interpretado?.intencaoPrimaria, confianca: interpretado?.confianca, precisaEsclarecimento: interpretado?.precisaEsclarecimento,
            fallbackAcionado: !!deps.interpretarIntencao && !interpretado, tentativaNumero: 0,
          },
        }
      }
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
  } else if (pareceApenasCancelamento(mensagemCliente, estado.fase)) {
    // Cancelamento puro (sem nenhum sinal de "novo pedido"/"trocar" na
    // mesma mensagem) nunca reinicia a jornada silenciosamente — pede
    // confirmação explícita antes de apagar produto/formulário/frete já
    // coletados (ver pareceApenasCancelamento).
    return {
      estado: {
        ...estado,
        dados: { ...estado.dados, ultimaPergunta: { chave: CHAVE_GATE_CANCELAMENTO_GLOBAL, textoExibido: mensagemConfirmarCancelamentoPedido(), intentsValidas: INTENTS_VALIDAS_CANCELAMENTO } },
      },
      mensagem: mensagemConfirmarCancelamentoPedido(),
    }
  } else if (pareceNovaIntencaoDeCompra(mensagemCliente, estado.fase)) {
    // Nova intenção comercial explícita numa fase de compra já avançada —
    // nunca reaproveita CEP/cotação/endereço/pagamento antigos (Parte 1;
    // caso real observado em monitoramento 2026-07-21). Mas se já havia um
    // formulário de entrega COMPLETO, pergunta antes se o cliente quer
    // reaproveitar esses dados (destinatário/endereço/telefone) em vez de
    // descartar direto e obrigar a redigitar tudo — feedback direto do
    // usuário em monitoramento real, 2026-07-24.
    const formularioAnterior = estado.dados.formulario
    const enderecoCompleto = !!formularioAnterior && camposFaltandoFormulario(formularioAnterior).length === 0
    if (enderecoCompleto) {
      const jornadaReiniciada = reiniciarJornada(mensagemCliente)
      return {
        estado: {
          ...jornadaReiniciada,
          fase: 'aguardando_reaproveitar_dados',
          dados: { ...jornadaReiniciada.dados, formularioAnterior },
        },
        mensagem: mensagemPerguntaReaproveitarDados(),
      }
    }
    estado = reiniciarJornada(mensagemCliente)
    intencao = classificarIntencao(mensagemCliente, estado.fase)
  }

  // Nova jornada (primeira mensagem real ou reinício) começando fora do
  // horário — mostra o aviso com opt-in antes de catálogo/formulário
  // (Parte 4). Nunca dispara de novo se esta jornada já foi aceita.
  if (estado.fase === 'inicio' && foraDoHorario && !estado.dados.aceitouForaDoHorario) {
    return { estado: { ...estado, fase: 'aviso_fora_horario' }, mensagem: mensagemAvisoForaDoHorarioComOpcao(mensagemCliente) }
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
  // Nunca dispara em 'aguardando_pagamento': ali já existe um link real
  // pendente (ou uma tentativa recusada) e o cliente falando sobre
  // pagamento ("pix", "gere um novo link", "quero pagar agora") quer
  // retomar ESSE pedido — cai pro case 'aguardando_pagamento' do switch
  // abaixo, que reenvia o link real, nunca esta resposta genérica de FAQ
  // (bug real observado em monitoramento 2026-07-24: a Flora respondia a
  // mesma frase genérica em loop e nunca reenviava o link).
  if (intencao === 'pagamento' && estado.fase !== 'aguardando_pagamento') {
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
    case 'aguardando_pagamento': {
      // Cliente pede Pix explicitamente: gera (ou reaproveita) o QR Code
      // real pro MESMO pedido — nunca substitui o link do Checkout Pro já
      // enviado, só oferece uma segunda forma de pagar o mesmo pedido.
      if (pedeQrCodePix(mensagemCliente) && estado.dados.pedidoId && estado.dados.valorTotal != null) {
        const pix = await deps.gerarPagamentoPix(estado.dados.pedidoId, estado.dados.valorTotal)
        if (pix) {
          return {
            estado,
            mensagem: `Aqui está o QR Code Pix para pagamento (R$ ${estado.dados.valorTotal.toFixed(2).replace('.', ',')}):\n\nPix Copia e Cola:\n${pix.copiaCola}\n\nAssim que identificarmos o pagamento, seu pedido é confirmado automaticamente.`,
            fotoUrl: pix.qrCodeUrl,
          }
        }
      }
      return { estado, mensagem: montarMensagemAguardandoPagamento(estado.dados) }
    }
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
