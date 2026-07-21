/**
 * webhook-whatsapp — Z-API, usando o funil comercial determinístico
 * compartilhado (ver ../_shared/funil.ts) — mesma arquitetura de
 * webhook-meta/index.ts (Instagram/Messenger), adaptada só na camada de
 * canal (Z-API em vez de Graph API).
 *
 * Reescrita completa (Correção P0 "fechar bloqueios do agendamento", Parte
 * 5/6): a versão anterior misturava um LLM (Groq) decidindo fase/catálogo
 * hardcoded (CATALOGO_IA com preços fixos no prompt) com um bloco
 * determinístico parcial só pro formulário — duas implementações comerciais
 * divergentes no mesmo produto. Agora о LLM não é mais chamado para nada do
 * fluxo comercial: catálogo, preço, frete, aprovação e pagamento são 100%
 * responsabilidade do dispatcher avancarFunil, exatamente como no
 * Instagram/Messenger — nunca duas fontes de verdade pro mesmo negócio.
 *
 * Áudio (Z-API) continua sendo transcrito (Groq Whisper) e tratado como
 * texto normal a partir daí — a transcrição em si não decide nada, só vira
 * a mensagem de entrada do funil.
 *
 * ATENÇÃO — não foi possível rodar `deno check`/testes deste arquivo no
 * ambiente onde esta integração foi construída (sem Deno CLI disponível).
 *
 * Variáveis de ambiente:
 *   ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN
 *   FACTORY_SECRET, SAAS_WORKSPACE_ID
 *   GROQ_API_KEY — usado só pra transcrição de áudio (Whisper), nunca para
 *     decidir fase/catálogo/preço.
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injetados)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { criarPreferenciaMercadoPago } from '../_shared/mercadopago.ts';
import { mensagemDuplicada } from '../_shared/dedup.ts';
import { buscarCategoriasReais, buscarProdutosPorCategoriaReal, buscarProdutosPorTermoReal, revalidarProdutoReal } from '../_shared/catalogo-woocommerce.ts';
import { dentroDoHorarioComercial, textoProximaAberturaComercial } from '../_shared/horario-comercial.ts';
import {
  type EstadoConversa,
  type DadosPedido,
  type ProdutoCatalogo,
  type DependenciasFunil,
  type Fase,
  type ResultadoFrete,
  type FreteDetalhes,
  estadoInicial,
  classificarIntencao,
  intencaoInterrompeFluxo,
  mensagemForaDeEscopo,
  mensagemTransferencia,
  avancarFunil,
  dataCalendarioParaISO,
} from '../_shared/funil.ts';

const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const FACTORY_SECRET = Deno.env.get('FACTORY_SECRET') ?? '';
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? '';
const WORKSPACE_ID  = Deno.env.get('SAAS_WORKSPACE_ID') ?? Deno.env.get('WORKSPACE_NAME') ?? '';
const ZAPI_INSTANCE = Deno.env.get('ZAPI_INSTANCE_ID') ?? '';
const ZAPI_TOKEN    = Deno.env.get('ZAPI_TOKEN') ?? '';
const ZAPI_CLIENT   = Deno.env.get('ZAPI_CLIENT_TOKEN') ?? '';

function getDb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function buscarConfigDB(chave: string): Promise<string> {
  try {
    const { data } = await getDb().from('funcao_configs').select('valor').eq('chave', chave).single();
    return (data?.valor as string) ?? '';
  } catch { return ''; }
}

// ── Tipos de persistência (tabela conversas — mesma usada por webhook-meta) ─

interface Mensagem { role: 'user' | 'assistant' | 'human'; content: string; ts: string; mid?: string; }

interface ConversaRow {
  id: string;
  canal_id: string;
  canal: string;
  fase: string;
  historico: Mensagem[];
  pedido_info: { dados?: DadosPedido; perguntasFeitas?: string[] } | null;
  lead_id: string | null;
  nome_cliente: string | null;
}

async function buscarOuCriarConversa(canalId: string): Promise<ConversaRow> {
  const db = getDb();
  const { data } = await db.from('conversas').select('*').eq('canal_id', canalId).eq('canal', 'whatsapp').single();
  if (data) return data as ConversaRow;
  const { data: nova } = await db.from('conversas')
    .insert({ canal_id: canalId, canal: 'whatsapp', workspace_id: WORKSPACE_ID || null, fase: estadoInicial().fase })
    .select('*').single();
  return nova as ConversaRow;
}

async function salvarConversa(id: string, updates: Partial<ConversaRow>): Promise<void> {
  await getDb().from('conversas').update({ ...updates, atualizado_em: new Date().toISOString() }).eq('id', id);
}

function estadoDaConversa(row: ConversaRow): EstadoConversa {
  return {
    fase: (row.fase as Fase) || 'inicio',
    dados: row.pedido_info?.dados ?? {},
    perguntasFeitas: row.pedido_info?.perguntasFeitas ?? [],
  };
}

// ── Catálogo real (WooCommerce ao vivo — nunca preço/catálogo hardcoded) ───

async function buscarCatalogoReal(params: { query: string; occasion?: string; budget?: number; color?: string }): Promise<ProdutoCatalogo[]> {
  return buscarProdutosPorTermoReal(WORKSPACE_ID, { query: [params.query, params.color].filter(Boolean).join(' '), budget: params.budget });
}

// ── Frete real (agente-logistica) ──────────────────────────────────────────

const TIMEOUT_FRETE_MS = 25_000;

interface RespostaAgenteLogistica {
  disponivel?: boolean;
  preco_real?: number;
  preco_cliente?: number;
  transportadora?: string;
  servico?: string;
  cotacao?: {
    quotationId?: string;
    moeda?: string;
    expiresAt?: string | null;
    ambiente?: string;
    mercado?: string;
    cotado_em: string;
    origem: { lat: string; lng: string; endereco: string };
    destino: { lat: string; lng: string; endereco: string; cep: string };
    stopIdOrigem?: string;
    stopIdDestino?: string;
  };
}

async function calcularFreteReal(cep: string): Promise<ResultadoFrete> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/agente-logistica`, {
      method: 'POST',
      // agente-logistica exige o segredo interno do orquestrador (não é
      // autenticação de usuário Supabase) — ver _shared/auth-crm.ts.
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${FACTORY_SECRET}` },
      body: JSON.stringify({ endereco: { cep }, workspace_id: WORKSPACE_ID }),
      signal: AbortSignal.timeout(TIMEOUT_FRETE_MS),
    });
    if (!res.ok) {
      console.error(`[webhook-whatsapp] falha ao calcular frete real: status=${res.status} cep=${cep}`);
      return { ok: false };
    }
    const data = await res.json() as RespostaAgenteLogistica;
    if (!data.disponivel || data.preco_cliente == null) return { ok: false };

    const detalhes: FreteDetalhes = {
      transportadora: data.transportadora,
      servico: data.servico,
      precoReal: data.preco_real,
      markup: data.preco_real != null ? data.preco_cliente - data.preco_real : undefined,
      quotationId: data.cotacao?.quotationId,
      moeda: data.cotacao?.moeda,
      expiresAt: data.cotacao?.expiresAt,
      ambiente: data.cotacao?.ambiente,
      mercado: data.cotacao?.mercado,
      cotadoEm: data.cotacao?.cotado_em,
      origem: data.cotacao?.origem,
      destino: data.cotacao?.destino,
      stopIdOrigem: data.cotacao?.stopIdOrigem,
      stopIdDestino: data.cotacao?.stopIdDestino,
    };
    return { ok: true, valor: data.preco_cliente, detalhes };
  } catch (e) {
    const motivo = e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : String(e);
    console.error(`[webhook-whatsapp] falha ao calcular frete real: ${motivo} cep=${cep}`);
    return { ok: false };
  }
}

// ── Pedido (rascunho) e pagamento real (Mercado Pago) ──────────────────────

interface DadosClientePedido { nome: string; telefone?: string; canal: string; canalId?: string; }

async function criarPedidoProvisorio(dados: DadosPedido, cliente: DadosClientePedido): Promise<{ pedidoId: string } | null> {
  const produto = dados.produto;
  if (!produto || dados.valorTotal == null) {
    console.error('[webhook-whatsapp] criarPedidoProvisorio chamado sem produto/valorTotal');
    return null;
  }
  const enderecoTexto = dados.endereco
    ? [dados.endereco.rua, dados.endereco.numero, dados.endereco.bairro, dados.endereco.cidade].filter(Boolean).join(', ')
    : null;
  // Gerado aqui (em vez de esperar o default do banco) porque o external_reference
  // enviado ao Mercado Pago precisa existir já na criação do pedido.
  const pedidoId = crypto.randomUUID();
  try {
    const { data, error } = await getDb()
      .from('pedidos')
      .insert({
        id: pedidoId,
        cliente_nome: cliente.nome || 'Cliente',
        cliente_telefone: cliente.telefone ?? '',
        canal: cliente.canal,
        canal_id: cliente.canalId ?? null,
        canal_origem: cliente.canal,
        produto: produto.nome,
        produtos: [{ nome: produto.nome, codigo: produto.codigo, woocommerce_product_id: produto.idExterno ?? null, preco: produto.preco, quantidade: produto.quantidade ?? 1 }],
        valor: dados.valorTotal,
        valor_frete: dados.valorFrete ?? null,
        status: 'aguardando_pagamento',
        provedor_pagamento: 'mercadopago',
        external_reference: `enemeop-${pedidoId}`,
        horario_entrega: produto.dataEntrega ?? null,
        // Data/período tipados (Parte 2 "agendar pela data prometida") —
        // nunca o texto livre acima é usado pra decisão operacional de
        // quando despachar a corrida real; ver webhook-mercadopago.
        data_entrega_solicitada: dados.dataEntregaSolicitada ? dataCalendarioParaISO(dados.dataEntregaSolicitada) : null,
        periodo_entrega: dados.periodoEntrega ?? null,
        nome_destinatario: dados.endereco?.nomeDestinatario ?? null,
        telefone_destinatario: dados.endereco?.telefoneDestinatario ?? null,
        endereco_entrega: enderecoTexto,
        cep: dados.endereco?.cep ?? null,
        numero: dados.endereco?.numero ?? null,
        complemento: dados.endereco?.complemento ?? null,
        bairro: dados.endereco?.bairro ?? null,
        cidade: dados.endereco?.cidade ?? null,
        uf: dados.endereco?.uf ?? null,
        nome_comprador: dados.nomeComprador ?? null,
        mensagem_cartao: produto.mensagemCartao ?? null,
        workspace_id: WORKSPACE_ID,
        lalamove_quotation_id: dados.freteDetalhes?.quotationId ?? null,
        frete_transportadora: dados.freteDetalhes?.transportadora ?? null,
        frete_servico: dados.freteDetalhes?.servico ?? null,
        frete_preco_real: dados.freteDetalhes?.precoReal ?? null,
        frete_markup: dados.freteDetalhes?.markup ?? null,
        frete_moeda: dados.freteDetalhes?.moeda ?? null,
        frete_expires_at: dados.freteDetalhes?.expiresAt ?? null,
        frete_cotado_em: dados.freteDetalhes?.cotadoEm ?? null,
        frete_ambiente: dados.freteDetalhes?.ambiente ?? null,
        frete_mercado: dados.freteDetalhes?.mercado ?? null,
        frete_origem: dados.freteDetalhes?.origem ?? null,
        frete_destino: dados.freteDetalhes?.destino ?? null,
        lalamove_stop_id_origem: dados.freteDetalhes?.stopIdOrigem ?? null,
        lalamove_stop_id_destino: dados.freteDetalhes?.stopIdDestino ?? null,
      })
      .select('id')
      .single();
    if (error || !data) {
      console.error('[webhook-whatsapp] falha ao criar pedido provisorio:', error?.message);
      return null;
    }
    return { pedidoId: data.id as string };
  } catch (e) {
    console.error('[webhook-whatsapp] excecao ao criar pedido provisorio:', e);
    return null;
  }
}

/** Idempotente: reaproveita mp_preference_id/link_pagamento já persistidos em vez de criar uma preference nova — nunca duas cobranças pro mesmo pedido. */
async function gerarPagamentoReal(pedidoId: string, _valorTotal: number): Promise<{ link: string; paymentId: string } | null> {
  const { data: pedido, error } = await getDb()
    .from('pedidos')
    .select('produtos, valor_frete, external_reference, mp_preference_id, link_pagamento')
    .eq('id', pedidoId)
    .single();
  if (error || !pedido) {
    console.error('[webhook-whatsapp] gerarPagamentoReal: pedido nao encontrado:', error?.message);
    return null;
  }

  if (pedido.mp_preference_id && pedido.link_pagamento) {
    return { link: pedido.link_pagamento as string, paymentId: pedido.mp_preference_id as string };
  }

  const produtos = (pedido.produtos as Array<{ nome: string; preco: number; quantidade?: number }> | null) ?? [];
  const itens = produtos
    .filter(p => p.preco > 0)
    .map(p => ({ titulo: p.nome, quantidade: p.quantidade ?? 1, precoUnitarioReais: p.preco }));
  const frete = Number(pedido.valor_frete ?? 0);
  if (frete > 0) itens.push({ titulo: 'Frete', quantidade: 1, precoUnitarioReais: frete });
  if (itens.length === 0) {
    console.error('[webhook-whatsapp] gerarPagamentoReal: pedido sem itens cobraveis, preference nao criada');
    return null;
  }

  const externalReference = (pedido.external_reference as string | null) ?? `enemeop-${pedidoId}`;
  const resultado = await criarPreferenciaMercadoPago(WORKSPACE_ID, {
    externalReference,
    itens,
    notificationUrl: `${SUPABASE_URL}/functions/v1/webhook-mercadopago`,
    backUrls: {
      success: 'https://enemeopflores.com.br/pagamento/sucesso',
      failure: 'https://enemeopflores.com.br/pagamento/falha',
      pending: 'https://enemeopflores.com.br/pagamento/pendente',
    },
    metadata: { pedido_id: pedidoId, workspace_id: WORKSPACE_ID },
  });
  if (!resultado.criado || !resultado.initPoint || !resultado.preferenceId) {
    console.error('[webhook-whatsapp] falha ao criar preference Mercado Pago:', resultado.erro);
    return null;
  }

  try {
    await getDb().from('pedidos').update({
      mp_preference_id: resultado.preferenceId,
      external_reference: externalReference,
      link_pagamento: resultado.initPoint,
      link_pagamento_id: resultado.preferenceId,
    }).eq('id', pedidoId);
  } catch (e) {
    console.error('[webhook-whatsapp] falha ao registrar preference no pedido:', e);
  }
  return { link: resultado.initPoint, paymentId: resultado.preferenceId };
}

// Nunca inventa Pix/cartão/dinheiro — só responde o que está realmente
// habilitado (mesma credencial que gerarPagamentoReal usa de verdade).
async function buscarFormasPagamentoReal(): Promise<string[]> {
  try {
    const { data } = await getDb()
      .from('workspace_credentials')
      .select('chave')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('tipo', 'financeiro')
      .eq('ativo', true);
    const chaves = new Set((data ?? []).map((r: { chave: string }) => r.chave));
    return chaves.has('mp_access_token')
      ? ['Pix', 'cartão de crédito', 'cartão de débito']
      : [];
  } catch {
    return [];
  }
}

function construirDependenciasFunil(cliente: DadosClientePedido): DependenciasFunil {
  return {
    buscarCatalogo: buscarCatalogoReal,
    buscarCategorias: () => buscarCategoriasReais(WORKSPACE_ID),
    buscarProdutosPorCategoria: (categoriaId) => buscarProdutosPorCategoriaReal(WORKSPACE_ID, categoriaId),
    revalidarProduto: (idExterno) => revalidarProdutoReal(WORKSPACE_ID, idExterno),
    calcularFrete: calcularFreteReal,
    gerarPagamento: gerarPagamentoReal,
    criarPedido: (dados) => criarPedidoProvisorio(dados, cliente),
    buscarFormasPagamento: buscarFormasPagamentoReal,
  };
}

// ── Transcrição de áudio (Groq Whisper) — vira texto normal, nunca decide nada ─

async function transcreverAudio(audioUrl: string): Promise<string | null> {
  const groqKey = Deno.env.get('GROQ_API_KEY') || await buscarConfigDB('GROQ_API_KEY');
  if (!groqKey) return null;

  try {
    const audioResp = await fetch(audioUrl);
    if (!audioResp.ok) throw new Error(`Falha ao baixar áudio: ${audioResp.status}`);
    const audioBlob = await audioResp.blob();

    const form = new FormData();
    form.append('file', audioBlob, 'audio.ogg');
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'pt');
    form.append('response_format', 'text');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}` },
      body: form,
    });

    if (!res.ok) {
      console.error('[webhook-whatsapp] Groq Whisper status:', res.status, await res.text().catch(() => ''));
      return null;
    }

    const transcricao = (await res.text()).trim();
    console.log(`[webhook-whatsapp] audio transcrito: "${transcricao.slice(0, 80)}"`);
    return transcricao || null;
  } catch (e) {
    console.error('[webhook-whatsapp] erro na transcricao de audio:', e);
    return null;
  }
}

// ── Normalização de telefone ────────────────────────────────────────────────

function normalizarTelefone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}

// ── Envio Z-API ──────────────────────────────────────────────────────────────

async function enviarTexto(phone: string, message: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT },
      body: JSON.stringify({ phone, message }),
    });
    if (!res.ok) { console.error(`[webhook-whatsapp] falha ao enviar texto status=${res.status}`); return false; }
    return true;
  } catch (e) {
    console.error('[webhook-whatsapp] falha ao enviar texto:', e);
    return false;
  }
}

async function enviarImagem(phone: string, imageUrl: string, caption: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT },
      body: JSON.stringify({ phone, image: imageUrl, caption }),
    });
    if (!res.ok) { console.error(`[webhook-whatsapp] falha ao enviar imagem status=${res.status}`); return false; }
    return true;
  } catch (e) {
    console.error('[webhook-whatsapp] falha ao enviar imagem:', e);
    return false;
  }
}

// ── Processar mensagem — usa o funil determinístico compartilhado ──────────

async function processarMensagem(phone: string, nomeRemetente: string | null, mensagemCliente: string, mid?: string): Promise<void> {
  const conversaRow = await buscarOuCriarConversa(phone);

  if (mensagemDuplicada(conversaRow.historico ?? [], mensagemCliente, mid)) {
    console.log(`[webhook-whatsapp] mensagem_duplicada_ignorada phone=${phone} mid=${mid ?? '(sem mid)'}`);
    return;
  }

  let estado = estadoDaConversa(conversaRow);

  if (estado.fase === 'pedido_criado' || estado.fase === 'encerrado_sem_venda') {
    console.log(`[webhook-whatsapp] conversa_reaberta phone=${phone}`);
    estado = estadoInicial();
  } else if (estado.fase === 'transferido_humano') {
    // fase="transferido_humano" órfã (nunca existiu handoff real ativo pra
    // WhatsApp neste fluxo — sem sistema de ticket aqui) nunca deve travar o
    // cliente recebendo a mesma mensagem de transferência pra sempre.
    console.log(`[webhook-whatsapp] fase_transferido_humano_reparada phone=${phone}`);
    estado = estadoInicial();
  }

  const nomeCliente = conversaRow.nome_cliente ?? nomeRemetente ?? null;

  const novaMsg: Mensagem = { role: 'user', content: mensagemCliente, ts: new Date().toISOString(), mid };
  const historico = [...(conversaRow.historico ?? []), novaMsg].slice(-20);

  // Portão de escopo — determinístico, roda antes de qualquer avanço de
  // funil (mesma regra do Instagram/Messenger, ver webhook-meta/index.ts).
  const intencao = classificarIntencao(mensagemCliente, estado.fase);
  const foraDoHorario = !dentroDoHorarioComercial();
  const proximoHorarioTexto = foraDoHorario ? textoProximaAberturaComercial() : undefined;

  let respostaFinal: string;
  let fotoUrl: string | null | undefined;
  let fotos: { codigo?: string; nome: string; url: string }[] | undefined;

  if (intencaoInterrompeFluxo(intencao)) {
    if (intencao === 'assunto_fora_escopo') {
      respostaFinal = mensagemForaDeEscopo();
      // fase/dados não mudam — cliente pode voltar ao fluxo comercial depois.
    } else {
      const motivo = `${intencao}: "${mensagemCliente}"`;
      respostaFinal = mensagemTransferencia();
      estado = { ...estado, fase: 'transferido_humano', dados: { ...estado.dados, motivoTransferencia: motivo } };
    }
  } else {
    const primeiraMensagem = (conversaRow.historico ?? []).length === 0;

    // Fora do horário logo na primeira mensagem: o próprio funil mostra o
    // aviso com opt-in (Parte 4) antes de qualquer coisa, inclusive antes de
    // perguntar o nome.
    if (primeiraMensagem && !nomeCliente && !foraDoHorario) {
      respostaFinal = 'Oi! Pode me dizer seu nome pra eu te atender melhor?';
    } else {
      const deps = construirDependenciasFunil({ nome: nomeCliente ?? 'Cliente', telefone: phone, canal: 'whatsapp', canalId: phone });
      const resultado = await avancarFunil(estado, mensagemCliente, intencao, deps, foraDoHorario, proximoHorarioTexto);
      estado = resultado.estado;
      if (estado.fase === 'transferido_humano') {
        // O funil decidiu internamente transferir (CEP/frete falhou, falha
        // ao gerar pagamento, ou fase inesperada) — nunca finge que criou um
        // ticket que não existe: só a mensagem fixa de transferência.
        respostaFinal = mensagemTransferencia();
      } else {
        const saudacaoNome = primeiraMensagem && nomeCliente && estado.fase !== 'aviso_fora_horario' ? `Oi, ${nomeCliente}! ` : '';
        respostaFinal = `${saudacaoNome}${resultado.mensagem}`;
        fotoUrl = resultado.fotoUrl;
        fotos = resultado.fotos;
      }
    }
  }

  const msgAssistente: Mensagem = { role: 'assistant', content: respostaFinal, ts: new Date().toISOString() };
  const historicoFinal = [...historico, msgAssistente].slice(-20);

  await Promise.all([
    salvarConversa(conversaRow.id, {
      historico: historicoFinal,
      fase: estado.fase,
      nome_cliente: nomeCliente ?? undefined,
      pedido_info: { dados: estado.dados, perguntasFeitas: estado.perguntasFeitas },
    } as Partial<ConversaRow>),
    fetch(`${SUPABASE_URL}/functions/v1/captacao-leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        tipo: 'mensagem-recebida', task_id: crypto.randomUUID(), escopo: 'producao',
        urgencia: 'normal', workspace_id: WORKSPACE_ID,
        payload: { canal: 'whatsapp', canal_id: phone, telefone: phone, nome: nomeCliente, mensagem: mensagemCliente },
      }),
    }).catch(() => {}),
  ]);

  console.log(`[webhook-whatsapp] ${phone} | fase: ${conversaRow.fase}→${estado.fase} | resposta: ${respostaFinal.slice(0, 60)}`);

  // Fotos nunca são enviadas junto com o formulário de entrega (Parte 2,
  // cenário 19) — resultado.fotoUrl/fotos só vêm preenchidos quando o
  // cliente pediu foto explicitamente ou confirmou um produto, nunca
  // enquanto enviaFormulario está em jogo (funil.ts nunca popula os dois ao
  // mesmo tempo).
  if (fotos && fotos.length > 0) {
    let algumaFalhou = false;
    for (const foto of fotos) {
      console.log(`[webhook-whatsapp] enviando foto produto codigo=${foto.codigo ?? '(sem codigo)'} nome="${foto.nome}"`);
      const enviado = await enviarImagem(phone, foto.url, foto.nome);
      if (!enviado) { algumaFalhou = true; break; }
    }
    await enviarTexto(phone, algumaFalhou ? mensagemTransferencia() : respostaFinal);
  } else if (fotoUrl) {
    const enviado = await enviarImagem(phone, fotoUrl, respostaFinal);
    if (!enviado) await enviarTexto(phone, mensagemTransferencia());
    // legenda da imagem já carrega o texto — nada mais a enviar quando ok.
  } else {
    await enviarTexto(phone, respostaFinal);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'GET') return new Response('webhook-whatsapp ok', { status: 200 });
  if (req.method !== 'POST') return new Response('ok', { status: 200 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return new Response('ok', { status: 200 }); }

  if (body['fromMe'] === true) return new Response('ok', { status: 200 });

  const phoneRaw      = String(body['phone'] ?? '');
  const nomeRemetente = (body['senderName'] ?? body['chatName'] ?? null) as string | null;
  const mid           = (body['messageId'] as string | undefined) ?? undefined;

  if (!phoneRaw) return new Response('ok', { status: 200 });

  let texto: string = (body['text'] as Record<string, string> | null)?.['message']
    ?? (body['message'] as string | null)
    ?? '';

  const audioPayload = body['audio'] as Record<string, string> | null;
  const audioUrl = audioPayload?.['audioUrl'] ?? audioPayload?.['url'] ?? null;

  if (!texto && audioUrl) {
    console.log(`[webhook-whatsapp] audio recebido de ${phoneRaw}, transcrevendo...`);
    const phone = normalizarTelefone(phoneRaw);
    EdgeRuntime.waitUntil((async () => {
      const transcricao = await transcreverAudio(audioUrl);
      if (transcricao) {
        await processarMensagem(phone, nomeRemetente, transcricao, mid);
      } else {
        await enviarTexto(phone, 'Desculpe, não consegui ouvir seu áudio. Pode escrever sua mensagem?');
      }
    })());
    return new Response('ok', { status: 200 });
  }

  if (!texto) return new Response('ok', { status: 200 });

  const phone = normalizarTelefone(phoneRaw);
  console.log(`[webhook-whatsapp] texto de ${phoneRaw} → normalizado: ${phone}`);

  EdgeRuntime.waitUntil(processarMensagem(phone, nomeRemetente, texto, mid));

  return new Response('ok', { status: 200 });
});
