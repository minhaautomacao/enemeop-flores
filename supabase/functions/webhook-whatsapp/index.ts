/**
 * webhook-whatsapp — Z-API, usando o funil comercial determinístico
 * compartilhado (ver ../_shared/funil.ts) — mesma arquitetura de
 * webhook-meta/index.ts (Instagram/Messenger), adaptada só na camada de
 * canal (Z-API em vez de Graph API).
 *
 * GO-LIVE (Partes 1, 2, 3):
 *   - Pedido/preference agora usam a implementação idempotente compartilhada
 *     com webhook-meta (ver _shared/pedido-repositorio.ts) — duas aprovações
 *     concorrentes da mesma jornada nunca criam dois pedidos nem duas
 *     cobranças.
 *   - Handoff humano agora cria um ticket real em atendimentos_humanos
 *     (ver _shared/handoff.ts) — antes só enviava a mensagem de
 *     transferência sem nenhum registro, então nenhum atendente via nada.
 *   - Toda chamada POST passa a exigir um token secreto (ZAPI_WEBHOOK_SECRET)
 *     na URL do webhook — Z-API não assina/autentica chamadas de webhook por
 *     conta própria (confirmado na documentação oficial: só é possível
 *     configurar a URL, sem headers/assinatura custom), então esse token é a
 *     única forma real de impedir que uma chamada forjada dispare respostas
 *     pra telefones arbitrários. ENQUANTO ZAPI_WEBHOOK_SECRET não estiver
 *     configurado (ação manual, fora deste repositório — precisa também
 *     atualizar a URL cadastrada no painel Z-API), o webhook aceita
 *     qualquer chamada sem autenticação real, só com um alerta alto no log
 *     — pra nunca derrubar o canal WhatsApp em produção só por causa deste
 *     deploy. Ver "Roteiro de configuração Z-API" no
 *     relatório final do GO-LIVE para a URL exata a cadastrar no painel.
 *
 * Áudio (Z-API) continua sendo transcrito (Groq Whisper) e tratado como
 * texto normal a partir daí — a transcrição em si não decide nada, só vira
 * a mensagem de entrada do funil.
 *
 * Variáveis de ambiente:
 *   ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN
 *   ZAPI_WEBHOOK_SECRET — token exclusivo exigido na URL do webhook
 *     (?token=...), obrigatório pra aceitar qualquer POST.
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
import { type DadosClientePedido, criarOuReusarPedido, gerarOuReusarPreference, buscarFormasPagamentoReal } from '../_shared/pedido-repositorio.ts';
import { type OrigemHandoff, criarOuReusarAtendimento } from '../_shared/handoff.ts';
import { calcularAgendamentoEntrega } from '../_shared/agendamento-entrega.ts';
import { validarTokenWebhook } from '../_shared/zapi-auth.ts';
import {
  type EstadoConversa,
  type DadosPedido,
  type ProdutoCatalogo,
  type DependenciasFunil,
  type Fase,
  type ResultadoFrete,
  type FreteDetalhes,
  estadoInicial,
  reiniciarJornada,
  classificarIntencao,
  intencaoInterrompeFluxo,
  mensagemForaDeEscopo,
  mensagemTransferencia,
  avancarFunil,
} from '../_shared/funil.ts';

const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const FACTORY_SECRET = Deno.env.get('FACTORY_SECRET') ?? '';
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? '';
const WORKSPACE_ID  = Deno.env.get('SAAS_WORKSPACE_ID') ?? Deno.env.get('WORKSPACE_NAME') ?? '';
const ZAPI_INSTANCE = Deno.env.get('ZAPI_INSTANCE_ID') ?? '';
const ZAPI_TOKEN    = Deno.env.get('ZAPI_TOKEN') ?? '';
const ZAPI_CLIENT   = Deno.env.get('ZAPI_CLIENT_TOKEN') ?? '';
// Preferência: variável de ambiente (Edge Function secret) — mesmo padrão
// das demais credenciais deste arquivo. Fallback pra funcao_configs (mesma
// tabela já usada como fallback de GROQ_API_KEY abaixo) só porque não há
// como definir um Edge Function secret a partir deste ambiente de
// desenvolvimento; o valor real gerado é o mesmo em ambos os casos, nunca
// hardcoded no código.
async function resolverWebhookSecret(): Promise<string> {
  return Deno.env.get('ZAPI_WEBHOOK_SECRET') || await buscarConfigDB('ZAPI_WEBHOOK_SECRET');
}
// Minutos de antecedência necessários pra preparar/coletar o pedido antes do
// início da janela de entrega prometida — calculado ANTES da aprovação do
// frete/pagamento, pra nunca prometer uma janela impossível (GO-LIVE Parte 4).
const LEAD_TIME_MINUTOS = Number(Deno.env.get('LOGISTICA_LEAD_TIME_MINUTOS') ?? '30');

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
  modo_atendimento?: string;
  status_atendimento?: string;
  motivo_handoff?: string | null;
  handoff_em?: string | null;
  atendente_id?: string | null;
  assumido_em?: string | null;
}

// Mesmo critério de "handoff realmente ativo" que webhook-meta usa — ver
// _shared/handoff.ts para a criação do ticket.
function handoffRealmenteAtivo(row: ConversaRow): boolean {
  return row.modo_atendimento === 'humano' &&
    (row.status_atendimento === 'aguardando_humano' || row.status_atendimento === 'humano_atendendo');
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

// ── Handoff humano — implementação compartilhada com webhook-meta, ver
// _shared/handoff.ts (GO-LIVE Parte 2: "reutilizar o módulo compartilhado
// de handoff" — antes esta função só mandava mensagemTransferencia() e
// marcava fase='transferido_humano' sem nunca criar nenhum ticket real). ──

async function iniciarHandoffHumano(
  conversaRow: ConversaRow,
  canal: string,
  canalId: string,
  telefone: string,
  origem: OrigemHandoff,
  motivo: string,
): Promise<{ mensagem: string; sucesso: boolean }> {
  const resultado = await criarOuReusarAtendimento(getDb(), conversaRow.id, canal, canalId, conversaRow.nome_cliente, origem, motivo, telefone, 'webhook-whatsapp');

  if (!resultado.ok) {
    // Nunca declara handoff concluído se o INSERT falhou de verdade —
    // informa indisponibilidade honesta e não muda modo_atendimento,
    // deixando a conversa recuperável pra próxima mensagem tentar de novo.
    console.error(`[webhook-whatsapp] handoff_falhou conversa=${conversaRow.id} motivo="${motivo}"`);
    return { mensagem: 'No momento não consegui abrir seu atendimento com um humano — pode tentar de novo em instantes, por favor.', sucesso: false };
  }

  await salvarConversa(conversaRow.id, {
    modo_atendimento: 'humano',
    status_atendimento: 'aguardando_humano',
    motivo_handoff: motivo,
    handoff_em: new Date().toISOString(),
  } as Partial<ConversaRow>);

  const mensagem = resultado.codigo
    ? `${mensagemTransferencia()} Seu código de atendimento é ${resultado.codigo}.`
    : mensagemTransferencia();
  return { mensagem, sucesso: true };
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

// ── Pedido (rascunho) e pagamento real — implementação compartilhada com
// webhook-meta, ver _shared/pedido-repositorio.ts (GO-LIVE Parte 1). ───────

function construirDependenciasFunil(cliente: DadosClientePedido): DependenciasFunil {
  return {
    buscarCatalogo: buscarCatalogoReal,
    buscarCategorias: () => buscarCategoriasReais(WORKSPACE_ID),
    buscarProdutosPorCategoria: (categoriaId) => buscarProdutosPorCategoriaReal(WORKSPACE_ID, categoriaId),
    revalidarProduto: (idExterno) => revalidarProdutoReal(WORKSPACE_ID, idExterno),
    calcularFrete: calcularFreteReal,
    calcularAgendamento: (dataEntrega, periodoEntrega) => {
      const r = calcularAgendamentoEntrega(dataEntrega, periodoEntrega, new Date(), { leadTimeMinutos: LEAD_TIME_MINUTOS });
      return { entregaPrometidaEmISO: r.entregaPrometidaEm.toISOString(), despachoEmISO: r.despachoEm.toISOString(), imediato: r.imediato };
    },
    gerarPagamento: (pedidoId) => gerarOuReusarPreference(getDb(), pedidoId, WORKSPACE_ID, SUPABASE_URL, 'webhook-whatsapp', criarPreferenciaMercadoPago),
    criarPedido: (dados) => criarOuReusarPedido(getDb(), dados, cliente, WORKSPACE_ID, 'webhook-whatsapp'),
    buscarFormasPagamento: () => buscarFormasPagamentoReal(getDb(), WORKSPACE_ID),
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
//
// STORE_WHATSAPP_NUMBER nunca é usado aqui como destinatário — esta função
// só envia para `phone`, sempre o remetente da mensagem recebida (nunca o
// número da própria loja), o que por construção já impede o loop "a loja
// manda mensagem pra si mesma" (ver _shared/handoff.ts, que só registra
// ticket, nunca envia WhatsApp pro operador).

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

  // Handoff humano ativo: só registra a mensagem no histórico para o
  // atendente ver no painel — Flora não responde enquanto um humano
  // estiver responsável pela conversa (mesma regra do webhook-meta).
  if (conversaRow.modo_atendimento === 'humano') {
    if (handoffRealmenteAtivo(conversaRow)) {
      const novaMsgHumano: Mensagem = { role: 'user', content: mensagemCliente, ts: new Date().toISOString(), mid };
      const historicoHumano = [...(conversaRow.historico ?? []), novaMsgHumano].slice(-20);
      await salvarConversa(conversaRow.id, { historico: historicoHumano });
      console.log(`[webhook-whatsapp] ${phone} | modo humano ativo — Flora nao responde`);
      return;
    }
    console.log(`[webhook-whatsapp] handoff_fantasma_reparado phone=${phone} status_atendimento=${conversaRow.status_atendimento ?? '(nulo)'}`);
    await salvarConversa(conversaRow.id, { modo_atendimento: 'flora', atendente_id: null, assumido_em: null } as Partial<ConversaRow>);
    conversaRow.modo_atendimento = 'flora';
    conversaRow.atendente_id = null;
    conversaRow.assumido_em = null;
  }

  let estado = estadoDaConversa(conversaRow);

  if (estado.fase === 'pedido_criado' || estado.fase === 'encerrado_sem_venda') {
    console.log(`[webhook-whatsapp] conversa_reaberta phone=${phone}`);
    // reiniciarJornada (não estadoInicial puro) marca uma nova fronteira em
    // jornadaIniciadaEm — é o que dá ao próximo pedido desta conversa uma
    // jornada_key diferente da do pedido anterior (GO-LIVE Parte 1).
    estado = reiniciarJornada(mensagemCliente);
  } else if (estado.fase === 'transferido_humano' && !handoffRealmenteAtivo(conversaRow)) {
    // fase="transferido_humano" órfã (sem handoff realmente ativo) nunca
    // deve travar o cliente recebendo a mesma mensagem de transferência pra
    // sempre — repara e devolve a conversa pra Flora com jornada nova.
    console.log(`[webhook-whatsapp] fase_transferido_humano_orfa_reparada phone=${phone}`);
    estado = reiniciarJornada(mensagemCliente);
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
      const origem: OrigemHandoff = intencao === 'atendimento_humano' ? 'cliente_solicitou' : 'flora_sem_confianca';
      const handoff = await iniciarHandoffHumano(conversaRow, 'whatsapp', phone, phone, origem, motivo);
      respostaFinal = handoff.mensagem;
      if (handoff.sucesso) {
        estado = { ...estado, fase: 'transferido_humano', dados: { ...estado.dados, motivoTransferencia: motivo } };
      }
    }
  } else {
    const primeiraMensagem = (conversaRow.historico ?? []).length === 0;

    // Fora do horário logo na primeira mensagem: o próprio funil mostra o
    // aviso com opt-in (Parte 4) antes de qualquer coisa, inclusive antes de
    // perguntar o nome.
    if (primeiraMensagem && !nomeCliente && !foraDoHorario) {
      respostaFinal = 'Oi! Pode me dizer seu nome pra eu te atender melhor?';
    } else {
      const deps = construirDependenciasFunil({ nome: nomeCliente ?? 'Cliente', telefone: phone, canal: 'whatsapp', canalId: phone, conversaId: conversaRow.id });
      const resultado = await avancarFunil(estado, mensagemCliente, intencao, deps, foraDoHorario, proximoHorarioTexto);
      estado = resultado.estado;
      if (estado.fase === 'transferido_humano') {
        // O funil decidiu internamente transferir (CEP/frete falhou, falha
        // ao gerar pagamento, ou fase inesperada) — a mensagem de
        // transferência só pode ser enviada no momento em que um handoff
        // real é criado, nunca como texto solto sem ticket.
        const motivo = estado.dados.motivoTransferencia ?? 'transferencia solicitada pelo funil';
        const handoff = await iniciarHandoffHumano(conversaRow, 'whatsapp', phone, phone, 'flora_sem_confianca', motivo);
        respostaFinal = handoff.mensagem;
        // Falha no ticket não desfaz a decisão do funil de não prosseguir
        // sozinho — só significa modo_atendimento não vira 'humano', então
        // o reparo de fase órfã acima reinicia a jornada na próxima mensagem.
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
    if (!algumaFalhou) {
      await enviarTexto(phone, respostaFinal);
    } else {
      const handoffFalhaMidia = await iniciarHandoffHumano(conversaRow, 'whatsapp', phone, phone, 'limite_tecnico', 'falha ao enviar mídia do produto');
      await enviarTexto(phone, handoffFalhaMidia.mensagem);
    }
  } else if (fotoUrl) {
    const enviado = await enviarImagem(phone, fotoUrl, respostaFinal);
    if (!enviado) {
      const handoffFalhaMidia = await iniciarHandoffHumano(conversaRow, 'whatsapp', phone, phone, 'limite_tecnico', 'falha ao enviar mídia do produto');
      await enviarTexto(phone, handoffFalhaMidia.mensagem);
    }
    // legenda da imagem já carrega o texto — nada mais a enviar quando ok.
  } else {
    await enviarTexto(phone, respostaFinal);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // GET fica aberto só como health-check de infraestrutura (não carrega
  // nenhum dado pessoal nem aciona nenhuma ação) — Z-API só faz POST.
  if (req.method === 'GET') return new Response('webhook-whatsapp ok', { status: 200 });
  if (req.method !== 'POST') return new Response('ok', { status: 200 });

  // Autenticação (GO-LIVE Parte 3) — rejeita ANTES de ler/processar
  // qualquer dado pessoal do corpo. Nunca loga o token recebido.
  const url = new URL(req.url);
  const tokenRecebido = url.searchParams.get('token') ?? '';
  const webhookSecret = await resolverWebhookSecret();
  const autenticacao = await validarTokenWebhook(webhookSecret, tokenRecebido);
  if (autenticacao === 'invalido') {
    console.error('[webhook-whatsapp] token_webhook_invalido_ou_ausente');
    return new Response('Unauthorized', { status: 401 });
  }
  if (autenticacao === 'sem_segredo_configurado') {
    // Só até ZAPI_WEBHOOK_SECRET ser configurado E a URL do painel Z-API
    // ser atualizada com o token — nenhuma das duas coisas é possível daqui
    // (fora do repositório). Loga bem alto pra não passar despercebido: o
    // webhook aceita QUALQUER chamada, sem autenticação real, nesse estado.
    console.error('[webhook-whatsapp] ALERTA: ZAPI_WEBHOOK_SECRET nao configurado — webhook aceitando chamadas sem autenticacao real. Configure o secret e a URL no painel Z-API o quanto antes.');
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return new Response('ok', { status: 200 }); }

  if (body['fromMe'] === true) return new Response('ok', { status: 200 });
  // Eventos de status de entrega/leitura e outros tipos irrelevantes (ex.:
  // "type": "DeliveryCallback"/"ReadCallback") não carregam texto nem
  // áudio — caem naturalmente no `if (!texto) return` abaixo sem processar
  // nada.

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
