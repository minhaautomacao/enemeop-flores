/**
 * webhook-meta — Instagram Direct + Messenger, usando o funil comercial
 * determinístico compartilhado (ver ../_shared/funil.ts).
 *
 * Reescrito para parar de deixar o LLM decidir fase, preço, frete, total ou
 * status de pagamento — isso agora é 100% responsabilidade do dispatcher
 * avancarFunil (mesma lógica usada pelo orchestrator Node, ver
 * orchestrator/src/lib/sdr.ts e o teste de paridade
 * orchestrator/src/lib/funil.parity.test.ts). O LLM não é mais chamado
 * neste fluxo comercial — toda mensagem ao cliente é texto fixo, deste
 * arquivo ou do funil.
 *
 * ATENÇÃO — não foi possível rodar `deno check`/testes deste arquivo no
 * ambiente onde esta integração foi construída (sem Deno CLI disponível).
 * Ver o relatório final da integração para o que isso implica antes de
 * deploy.
 *
 * Variáveis de ambiente:
 *   META_VERIFY_TOKEN, META_APP_SECRET, META_IG_APP_SECRET, META_IG_ACCESS_TOKEN
 *   META_INSTAGRAM_ID, META_PAGE_ACCESS_TOKEN
 *   FACTORY_SECRET, SAAS_WORKSPACE_ID
 *   GROQ_API_KEY (ou ANTHROPIC_API_KEY como fallback) — usado só para
 *     respostas de comentário público, não para o fluxo de DM comercial.
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injetados)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { gerarLinkPagamento } from '../_shared/cielo.ts';
import { dentroDoHorarioComercial, mensagemAvisoForaDoHorario, mensagemConfirmacaoForaDoHorario } from '../_shared/horario-comercial.ts';
import {
  type EstadoConversa,
  type DadosPedido,
  type ProdutoCatalogo,
  type DependenciasFunil,
  type Fase,
  estadoInicial,
  classificarIntencao,
  intencaoInterrompeFluxo,
  mensagemForaDeEscopo,
  mensagemTransferencia,
  mensagemTransferenciaLimitacaoTecnica,
  avancarFunil,
} from '../_shared/funil.ts';

const VERIFY_TOKEN   = Deno.env.get('META_VERIFY_TOKEN') ?? '';
const APP_SECRET     = Deno.env.get('META_APP_SECRET') ?? '';
const IG_APP_SECRET  = Deno.env.get('META_IG_APP_SECRET') ?? '';
const FACTORY_SECRET = Deno.env.get('FACTORY_SECRET') ?? '';
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WORKSPACE_ID   = Deno.env.get('SAAS_WORKSPACE_ID') ?? '';
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? '';
const IG_TOKEN       = Deno.env.get('META_IG_ACCESS_TOKEN') ?? '';
const PAGE_TOKEN     = Deno.env.get('META_PAGE_ACCESS_TOKEN') ?? '';
const WHATSAPP_NUM   = Deno.env.get('STORE_WHATSAPP_NUMBER') ?? '';

// ── Supabase client ───────────────────────────────────────────────────────

function getDb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function buscarConfigDB(chave: string): Promise<string> {
  try {
    const { data } = await getDb().from('funcao_configs').select('valor').eq('chave', chave).single();
    return (data?.valor as string) ?? '';
  } catch { return ''; }
}

// ── Tipos de persistência (tabela conversas — sem migration nova) ─────────
//
// fase usa diretamente os valores de Fase (funil.ts). dados/perguntasFeitas
// do EstadoConversa vão dentro do jsonb pedido_info, já existente.

interface Mensagem { role: 'user' | 'assistant' | 'human'; content: string; ts: string; autor_id?: string; }

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
}

async function buscarNomeCliente(canalId: string): Promise<string | null> {
  const token = IG_TOKEN || await buscarConfigDB('META_IG_ACCESS_TOKEN');
  if (!token) return null;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${canalId}?fields=name&access_token=${token}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data.name as string)?.split(' ')[0] ?? null;
  } catch { return null; }
}

async function buscarOuCriarConversa(canalId: string, canal: string): Promise<ConversaRow> {
  const db = getDb();
  const { data } = await db
    .from('conversas')
    .select('*')
    .eq('canal_id', canalId)
    .eq('canal', canal)
    .single();

  if (data) return data as ConversaRow;

  const { data: nova } = await db
    .from('conversas')
    .insert({ canal_id: canalId, canal, workspace_id: WORKSPACE_ID || null, fase: estadoInicial().fase })
    .select('*')
    .single();

  return nova as ConversaRow;
}

async function salvarConversa(id: string, updates: Partial<ConversaRow>): Promise<void> {
  const db = getDb();
  await db.from('conversas').update({ ...updates, atualizado_em: new Date().toISOString() }).eq('id', id);
}

function estadoDaConversa(row: ConversaRow): EstadoConversa {
  return {
    fase: (row.fase as Fase) || 'inicio',
    dados: row.pedido_info?.dados ?? {},
    perguntasFeitas: row.pedido_info?.perguntasFeitas ?? [],
  };
}

// ── Catálogo real (tabela catalogo_produtos — nunca inventado) ───────────

interface ProdutoRow { codigo: string; nome: string; preco: number; foto_url: string | null; categoria: string | null; }

function pontuarProduto(p: ProdutoRow, params: { query: string; budget?: number; color?: string }): number {
  let score = 0;
  const nome = p.nome.toLowerCase();
  for (const palavra of params.query.toLowerCase().split(/\s+/)) {
    if (palavra.length > 3 && nome.includes(palavra)) score += 2;
  }
  if (params.budget) {
    if (p.preco <= params.budget) score += 4;
    if (p.preco <= params.budget * 0.8) score += 2;
    if (p.preco > params.budget * 1.25) score -= 4;
  }
  if (params.color && nome.includes(params.color.toLowerCase())) score += 5;
  return score;
}

async function buscarCatalogoReal(params: { query: string; occasion?: string; budget?: number; color?: string }): Promise<ProdutoCatalogo[]> {
  let query = getDb().from('catalogo_produtos').select('codigo, nome, preco, foto_url, categoria').eq('ativo', true);
  if (params.budget) query = query.lte('preco', params.budget * 1.3);
  const { data, error } = await query.limit(30);
  if (error || !data) return [];

  const produtos = data as ProdutoRow[];
  return produtos
    .map(p => ({ p, score: pontuarProduto(p, params) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ p }) => ({
      nome: p.nome,
      preco: Number(p.preco),
      fotoUrl: p.foto_url ?? undefined,
      disponivel: true,
      codigo: p.codigo,
      origem: 'catalogo_produtos',
    }));
}

// ── Frete real (agente-logistica — mesma Edge Function do WhatsApp) ──────

async function calcularFreteReal(cep: string): Promise<{ ok: true; valor: number } | { ok: false }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/agente-logistica`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ endereco: { cep }, workspace_id: WORKSPACE_ID }),
    });
    if (!res.ok) return { ok: false };
    const data = await res.json() as { disponivel?: boolean; preco_cliente?: number };
    if (!data.disponivel || data.preco_cliente == null) return { ok: false };
    return { ok: true, valor: data.preco_cliente };
  } catch (e) {
    console.error('[webhook-meta] falha ao calcular frete real:', e);
    return { ok: false };
  }
}

// ── Pedido (rascunho) e pagamento real (Cielo, via _shared/cielo.ts) ────

interface DadosClientePedido { nome: string; telefone?: string; canal: string; canalId?: string; }

async function criarPedidoProvisorio(dados: DadosPedido, cliente: DadosClientePedido): Promise<{ pedidoId: string } | null> {
  const produto = dados.produto;
  if (!produto || dados.valorTotal == null) {
    console.error('[webhook-meta] criarPedidoProvisorio chamado sem produto/valorTotal');
    return null;
  }
  const enderecoTexto = dados.endereco
    ? [dados.endereco.rua, dados.endereco.numero, dados.endereco.bairro, dados.endereco.cidade].filter(Boolean).join(', ')
    : null;
  try {
    const { data, error } = await getDb()
      .from('pedidos')
      .insert({
        cliente_nome: cliente.nome || 'Cliente',
        cliente_telefone: cliente.telefone ?? '',
        canal: cliente.canal,
        canal_id: cliente.canalId ?? null,
        canal_origem: cliente.canal,
        produto: produto.nome,
        produtos: [{ nome: produto.nome, codigo: produto.codigo, preco: produto.preco, quantidade: produto.quantidade ?? 1 }],
        valor: dados.valorTotal,
        status: 'pendente',
        horario_entrega: produto.dataEntrega ?? null,
        nome_destinatario: dados.endereco?.nomeDestinatario ?? null,
        endereco_entrega: enderecoTexto,
        bairro: dados.endereco?.bairro ?? null,
        workspace_id: WORKSPACE_ID,
      })
      .select('id')
      .single();
    if (error || !data) {
      console.error('[webhook-meta] falha ao criar pedido provisorio:', error?.message);
      return null;
    }
    return { pedidoId: data.id as string };
  } catch (e) {
    console.error('[webhook-meta] excecao ao criar pedido provisorio:', e);
    return null;
  }
}

async function gerarPagamentoReal(pedidoId: string, valorTotal: number): Promise<{ link: string; paymentId: string } | null> {
  const resultado = await gerarLinkPagamento(WORKSPACE_ID, {
    numeroPedido: pedidoId,
    item: { nome: 'Pedido Enemeop Flores', valor: Math.round(valorTotal * 100) },
    parcelasMax: 3,
    expiracaoDias: 1,
  });
  if (!resultado.criado || !resultado.linkPagamento) return null;
  const linkFinal = resultado.shortLink ?? resultado.linkPagamento;
  const linkId = resultado.linkId ?? pedidoId;
  try {
    await getDb().from('pedidos').update({ link_pagamento: linkFinal, link_pagamento_id: linkId }).eq('id', pedidoId);
  } catch (e) {
    console.error('[webhook-meta] falha ao registrar link de pagamento no pedido:', e);
  }
  return { link: linkFinal, paymentId: linkId };
}

function construirDependenciasFunil(cliente: DadosClientePedido): DependenciasFunil {
  return {
    buscarCatalogo: buscarCatalogoReal,
    calcularFrete: calcularFreteReal,
    gerarPagamento: gerarPagamentoReal,
    criarPedido: (dados) => criarPedidoProvisorio(dados, cliente),
  };
}

// ── Envio de foto real via Graph API (attachment de imagem) ──────────────

async function enviarFotoInstagramOuFacebook(canal: string, canalId: string, imagemUrl: string): Promise<boolean> {
  const pageToken = PAGE_TOKEN || await buscarConfigDB('META_PAGE_ACCESS_TOKEN');
  const igId = Deno.env.get('META_INSTAGRAM_ID') || await buscarConfigDB('META_INSTAGRAM_ID');
  const isInstagram = canal === 'instagram' && !!igId && !!IG_TOKEN;
  const endpoint = isInstagram
    ? `https://graph.instagram.com/v21.0/${igId}/messages`
    : `https://graph.facebook.com/v21.0/me/messages`;
  const token = isInstagram ? IG_TOKEN : (pageToken || IG_TOKEN);

  try {
    const res = await fetch(`${endpoint}?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: canalId },
        message: { attachment: { type: 'image', payload: { url: imagemUrl, is_reusable: true } } },
        messaging_type: 'RESPONSE',
      }),
    });
    if (!res.ok) {
      console.error(`[webhook-meta] erro ao enviar foto status=${res.status} canal=${canal}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[webhook-meta] falha ao enviar foto:', e);
    return false;
  }
}

async function enviarTextoInstagramOuFacebook(canal: string, canalId: string, texto: string): Promise<boolean> {
  const pageToken = PAGE_TOKEN || await buscarConfigDB('META_PAGE_ACCESS_TOKEN');
  const igId = Deno.env.get('META_INSTAGRAM_ID') || await buscarConfigDB('META_INSTAGRAM_ID');
  const isInstagram = canal === 'instagram' && !!igId && !!IG_TOKEN;
  const endpoint = isInstagram
    ? `https://graph.instagram.com/v21.0/${igId}/messages`
    : `https://graph.facebook.com/v21.0/me/messages`;
  const token = isInstagram ? IG_TOKEN : (pageToken || IG_TOKEN);

  try {
    const res = await fetch(`${endpoint}?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: canalId },
        message: { text: texto },
        messaging_type: 'RESPONSE',
      }),
    });
    if (!res.ok) {
      const erroBody = await res.text().catch(() => '');
      console.error(`[webhook-meta] erro DM status=${res.status} endpoint=${isInstagram ? 'ig' : 'fb'} recipient=${canalId} corpo=${erroBody}`);
      return false;
    }
    console.log(`[webhook-meta] DM enviado canal=${canal} endpoint=${isInstagram ? 'ig' : 'fb'} para=${canalId}`);
    return true;
  } catch (e) {
    console.error(`[webhook-meta] falha DM: ${e}`);
    return false;
  }
}

// ── Handoff humano — cria (ou reusa) o atendimentos_humanos aberto ──────
//
// Índice único parcial (conversa_id) WHERE status IN ('aguardando_humano',
// 'em_atendimento') garante no banco que só existe um ticket aberto por
// conversa. Se duas chamadas concorrentes tentarem criar ao mesmo tempo
// (ex.: duas mensagens seguidas do cliente disparando handoff), a segunda
// recebe violação de unicidade (23505) e cai no fallback: busca o ticket
// já aberto e reusa o código — nunca gera um segundo.

type OrigemHandoff = 'cliente_solicitou' | 'flora_sem_confianca' | 'limite_tecnico';

async function criarOuReusarAtendimento(
  conversaId: string,
  canal: string,
  canalId: string,
  nomeCliente: string | null,
  origem: OrigemHandoff,
  motivo: string,
): Promise<string | null> {
  const db = getDb();
  const { data: inserted, error: insertError } = await db
    .from('atendimentos_humanos')
    .insert({
      conversa_id: conversaId,
      canal,
      canal_cliente_id: canalId,
      nome_cliente: nomeCliente,
      origem_handoff: origem,
      motivo_transferencia: motivo,
    })
    .select('codigo')
    .single();

  if (!insertError && inserted) return (inserted as { codigo: string }).codigo;

  const { data: existente } = await db
    .from('atendimentos_humanos')
    .select('codigo')
    .eq('conversa_id', conversaId)
    .in('status', ['aguardando_humano', 'em_atendimento'])
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (existente as { codigo: string } | null)?.codigo ?? null;
}

async function iniciarHandoffHumano(
  conversaRow: ConversaRow,
  canal: string,
  canalId: string,
  origem: OrigemHandoff,
  motivo: string,
): Promise<string> {
  await salvarConversa(conversaRow.id, {
    modo_atendimento: 'humano',
    status_atendimento: 'aguardando_humano',
    motivo_handoff: motivo,
    handoff_em: new Date().toISOString(),
  } as Partial<ConversaRow>);

  // Só 'limite_tecnico' (ex.: falha real ao enviar mídia pela API) oferece
  // WhatsApp com link clicável — qualquer outro motivo de transferência
  // continua no mesmo canal, sem sair por padrão.
  const mensagemBase = origem === 'limite_tecnico' ? mensagemTransferenciaLimitacaoTecnica() : mensagemTransferencia();
  const codigo = await criarOuReusarAtendimento(conversaRow.id, canal, canalId, conversaRow.nome_cliente, origem, motivo);
  return codigo
    ? `${mensagemBase} Seu código de atendimento é ${codigo}.`
    : mensagemBase;
}

// ── Processar DM — usa o funil determinístico compartilhado ─────────────

async function processarDM(canalId: string, canal: string, mensagemCliente: string): Promise<void> {
  const igToken = IG_TOKEN || await buscarConfigDB('META_IG_ACCESS_TOKEN');
  if (!igToken) return;

  const conversaRow = await buscarOuCriarConversa(canalId, canal);

  // Handoff humano ativo: só registra a mensagem no histórico para o
  // atendente ver no Inbox Flora — Flora não gera nem envia resposta
  // automática enquanto um humano estiver responsável pela conversa.
  if (conversaRow.modo_atendimento === 'humano') {
    const novaMsgHumano: Mensagem = { role: 'user', content: mensagemCliente, ts: new Date().toISOString() };
    const historicoHumano = [...(conversaRow.historico ?? []), novaMsgHumano].slice(-20);
    await salvarConversa(conversaRow.id, { historico: historicoHumano });
    console.log(`[webhook-meta] ${canalId} | modo humano ativo — Flora nao responde`);
    return;
  }

  let estado = estadoDaConversa(conversaRow);

  if (estado.fase === 'pedido_criado' || estado.fase === 'encerrado_sem_venda') {
    console.log(`[webhook-meta] conversa_reaberta canal_id=${canalId} canal=${canal}`);
    estado = estadoInicial();
  } else if (estado.fase === 'transferido_humano') {
    // Chegamos aqui só porque o gate de "modo_atendimento === 'humano'" já
    // passou acima — ou seja, não existe (mais) um handoff real ativo pra
    // essa conversa (nunca existiu, ou foi concluído/devolvido/cancelado).
    // fase="transferido_humano" órfã é estado fantasma: nunca deve travar o
    // cliente recebendo a mesma mensagem de transferência pra sempre — repara
    // e devolve a conversa pra Flora.
    console.log(`[webhook-meta] fase_transferido_humano_orfa_reparada canal_id=${canalId} canal=${canal}`);
    estado = estadoInicial();
  }

  let nomeCliente = conversaRow.nome_cliente ?? null;
  if (!nomeCliente && (conversaRow.historico ?? []).length === 0) {
    nomeCliente = await buscarNomeCliente(canalId);
    if (nomeCliente) await salvarConversa(conversaRow.id, { nome_cliente: nomeCliente });
  }

  const novaMsg: Mensagem = { role: 'user', content: mensagemCliente, ts: new Date().toISOString() };
  const historico = [...(conversaRow.historico ?? []), novaMsg].slice(-20);

  // Portão de escopo — determinístico, roda antes de qualquer avanço de
  // funil (mesma regra do orchestrator Node, ver sdr.ts).
  const intencao = classificarIntencao(mensagemCliente, estado.fase);
  const foraDoHorario = !dentroDoHorarioComercial();

  let respostaFinal: string;
  let fotoUrl: string | null | undefined;

  if (intencaoInterrompeFluxo(intencao)) {
    if (intencao === 'assunto_fora_escopo') {
      respostaFinal = mensagemForaDeEscopo();
      // fase/dados não mudam — cliente pode voltar ao fluxo comercial depois.
    } else {
      const motivo = `${intencao}: "${mensagemCliente}"`;
      const origem: OrigemHandoff = intencao === 'atendimento_humano' ? 'cliente_solicitou' : 'flora_sem_confianca';
      respostaFinal = await iniciarHandoffHumano(conversaRow, canal, canalId, origem, motivo);
      estado = { ...estado, fase: 'transferido_humano', dados: { ...estado.dados, motivoTransferencia: motivo } };
    }
  } else {
    const primeiraMensagem = (conversaRow.historico ?? []).length === 0;
    // Aviso de horário só na primeira mensagem da conversa — nunca repetido a cada troca.
    const avisoHorario = foraDoHorario && primeiraMensagem
      ? mensagemAvisoForaDoHorario()
      : '';

    if (primeiraMensagem && !nomeCliente) {
      respostaFinal = `${avisoHorario}Oi! Pode me dizer seu nome pra eu te atender melhor?`;
    } else if (foraDoHorario && estado.fase === 'aguardando_confirmacao') {
      // Fora do horário comercial a loja não confirma pedido nem gera pagamento.
      // A fase não avança — a conversa retoma sozinha exatamente daqui na
      // próxima mensagem dentro do horário comercial (sem handoff automático).
      respostaFinal = mensagemConfirmacaoForaDoHorario();
    } else {
      const deps = construirDependenciasFunil({ nome: nomeCliente ?? 'Cliente', canal, canalId });
      const resultado = await avancarFunil(estado, mensagemCliente, intencao, deps);
      estado = resultado.estado;
      if (estado.fase === 'transferido_humano') {
        // O funil decidiu internamente transferir (CEP/frete falhou, falha
        // ao gerar pagamento, ou fase inesperada) — a mensagem de
        // transferência só pode ser enviada no momento em que um handoff
        // real é criado, nunca como texto solto sem ticket. Mesmo mecanismo
        // do portão externo, pra nunca duplicar nem deixar órfã de novo.
        const motivo = estado.dados.motivoTransferencia ?? 'transferencia solicitada pelo funil';
        respostaFinal = `${avisoHorario}${await iniciarHandoffHumano(conversaRow, canal, canalId, 'flora_sem_confianca', motivo)}`;
      } else {
        const saudacaoNome = primeiraMensagem && nomeCliente ? `Oi, ${nomeCliente}! ` : '';
        respostaFinal = `${avisoHorario}${saudacaoNome}${resultado.mensagem}`;
        fotoUrl = resultado.fotoUrl;
      }
    }
  }

  const msgAssistente: Mensagem = { role: 'assistant', content: respostaFinal, ts: new Date().toISOString() };
  const historicoFinal = [...historico, msgAssistente].slice(-20);

  await salvarConversa(conversaRow.id, {
    historico: historicoFinal,
    fase: estado.fase,
    pedido_info: { dados: estado.dados, perguntasFeitas: estado.perguntasFeitas },
  });

  console.log(`[webhook-meta] ${canalId} | fase: ${conversaRow.fase}→${estado.fase} | resposta: ${respostaFinal.slice(0, 60)}`);

  // ── Envio — foto primeiro (se houver), depois o texto (ver seção 6) ────
  if (fotoUrl) {
    const enviado = await enviarFotoInstagramOuFacebook(canal, canalId, fotoUrl);
    if (enviado) {
      await enviarTextoInstagramOuFacebook(canal, canalId, respostaFinal);
    } else {
      // Falha definitiva no envio de mídia: nunca finge que enviou —
      // encaminha para atendimento humano.
      const mensagemFalha = await iniciarHandoffHumano(conversaRow, canal, canalId, 'limite_tecnico', 'falha ao enviar mídia do produto');
      await enviarTextoInstagramOuFacebook(canal, canalId, mensagemFalha);
    }
  } else {
    await enviarTextoInstagramOuFacebook(canal, canalId, respostaFinal);
  }
}

// ── Processar comentário — fora do escopo do funil comercial, mantém IA ──
// (baixo risco: nunca cita preço/frete/pagamento, apenas convida ao DM/WhatsApp)

const SYSTEM_COMENTARIO = 'Você é a Flor, atendente da Enemeop Flores. Alguém comentou numa publicação. Responda de forma calorosa e curta (máx. 2 linhas). Nunca cite preços em comentários públicos. Se for elogio: agradeça e convide para o DM. Se for dúvida: responda brevemente e direcione ao DM. Português brasileiro natural. Máx. 1 emoji. RETORNE APENAS o texto.';

async function chamarIAComentario(mensagemUsuario: string): Promise<string | null> {
  const groqKey = Deno.env.get('GROQ_API_KEY') || await buscarConfigDB('GROQ_API_KEY');
  if (groqKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          max_tokens: 100,
          messages: [{ role: 'system', content: SYSTEM_COMENTARIO }, { role: 'user', content: mensagemUsuario }],
        }),
      });
      if (res.ok) return ((await res.json()).choices?.[0]?.message?.content as string)?.trim() ?? null;
    } catch (e) { console.error('[webhook-meta] falha IA comentario:', e); }
  }
  return null;
}

async function processarComentario(evento: MetaEvento): Promise<void> {
  if (!evento.comment_id) return;
  const token = IG_TOKEN || await buscarConfigDB('META_IG_ACCESS_TOKEN');
  if (!token) return;

  const resposta = await chamarIAComentario(evento.mensagem)
    ?? `Obrigada pelo comentário! Manda um DM pra gente ou chama no WhatsApp: wa.me/${WHATSAPP_NUM}`;

  try {
    const endpoint = evento.canal === 'instagram'
      ? `https://graph.facebook.com/v19.0/${evento.comment_id}/replies`
      : `https://graph.facebook.com/v19.0/${evento.comment_id}/comments`;
    const res = await fetch(`${endpoint}?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: resposta }),
    });
    if (!res.ok) console.error(`[webhook-meta] erro comentario reply: ${await res.text()}`);
    else console.log(`[webhook-meta] comentario respondido: ${resposta.slice(0, 60)}`);
  } catch (e) { console.error(`[webhook-meta] falha comentario reply: ${e}`); }
}

// ── Validação de assinatura HMAC ───────────────────────────────────────────

async function hmacOk(body: string, secret: string, expected: string): Promise<boolean> {
  if (!secret) return false;
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    const hex = Array.from(new Uint8Array(signed)).map(b => b.toString(16).padStart(2, '0')).join('');
    return hex === expected;
  } catch { return false; }
}

async function validarAssinatura(body: string, signature: string | null): Promise<boolean> {
  if (!signature) return true;
  const expected = signature.replace('sha256=', '');
  if (IG_APP_SECRET && await hmacOk(body, IG_APP_SECRET, expected)) return true;
  if (APP_SECRET    && await hmacOk(body, APP_SECRET,    expected)) return true;
  return false;
}

// ── Extração de eventos ───────────────────────────────────────────────────

interface MetaEvento { canal: 'instagram' | 'facebook'; tipo: 'dm' | 'comentario'; canal_id: string; comment_id?: string; nome: string | null; mensagem: string; post_id?: string; timestamp: string; }

function extrairEventos(body: Record<string, unknown>): MetaEvento[] {
  const eventos: MetaEvento[] = [];
  const objectType = body['object'] as string | undefined;
  const entries = body['entry'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(entries)) return eventos;

  for (const entry of entries) {
    const messaging = entry['messaging'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(messaging)) {
      for (const msg of messaging) {
        const sender  = msg['sender']  as Record<string, unknown> | undefined;
        const message = msg['message'] as Record<string, unknown> | undefined;
        if (!sender || !message) continue;
        const texto = (message['text'] as string) ?? '';
        if (!texto) continue;
        const senderId = String(sender['id'] ?? '');
        const pageId   = String(entry['id'] ?? '');
        if (senderId === pageId) continue;
        const canal: 'instagram' | 'facebook' = objectType === 'instagram' ? 'instagram' : 'facebook';
        eventos.push({ canal, tipo: 'dm', canal_id: senderId, nome: null, mensagem: texto, timestamp: new Date().toISOString() });
      }
    }

    const changes = entry['changes'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(changes)) {
      for (const change of changes) {
        const field = change['field'] as string | undefined;
        if (field !== 'feed' && field !== 'comments' && field !== 'instagram_comments') continue;
        const val = change['value'] as Record<string, unknown> | undefined;
        if (!val) continue;
        const msg = ((val['message'] ?? val['text']) as string) ?? '';
        if (!msg) continue;
        const from = val['from'] as Record<string, unknown> | undefined;
        const canal: 'instagram' | 'facebook' = objectType === 'instagram' || field === 'instagram_comments' ? 'instagram' : 'facebook';
        const commentId = ((val['id'] ?? val['comment_id']) as string) ?? undefined;
        eventos.push({ canal, tipo: 'comentario', canal_id: String(from?.['id'] ?? ''), comment_id: commentId, nome: (from?.['name'] as string) ?? null, mensagem: msg, post_id: (val['post_id'] as string) ?? undefined, timestamp: new Date().toISOString() });
      }
    }
  }
  return eventos;
}

// ── Envia ao orquestrador (só para log/roteamento de lead, não gera resposta) ─

async function enviarAoOrquestrador(evento: MetaEvento): Promise<void> {
  if (!SERVICE_KEY || !SUPABASE_URL) return;
  await fetch(`${SUPABASE_URL}/functions/v1/orquestrador`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({
      tipo: 'novo-lead',
      task_id: crypto.randomUUID(),
      escopo: 'producao',
      urgencia: 'normal',
      workspace_id: WORKSPACE_ID,
      payload: { canal: evento.canal, tipo_interacao: evento.tipo, canal_id: evento.canal_id, nome: evento.nome, mensagem: evento.mensagem, utm_source: evento.canal, timestamp: evento.timestamp },
    }),
  }).catch(() => {});
}

// ── send-human-message — Inbox Flora envia pelo mesmo canal do cliente ───
//
// Chamada interna do Next.js (app/api/atendimento/conversas/[id]/mensagens),
// não é payload da Meta — por isso é despachada ANTES da validação de
// assinatura HMAC, que não se aplica aqui. Autenticação própria:
// Authorization: Bearer FACTORY_SECRET (mesma variável já declarada no
// topo do arquivo, sem uso real até agora).

interface SendHumanMessageBody {
  conversa_id?: string;
  mensagem?: string;
  autor_id?: string;
  idempotency_key?: string;
}

async function handleSendHumanMessage(req: Request): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  if (!FACTORY_SECRET || auth !== `Bearer ${FACTORY_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  let body: SendHumanMessageBody;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { conversa_id, mensagem, autor_id, idempotency_key } = body;
  if (!conversa_id || !mensagem?.trim() || !autor_id || !idempotency_key) {
    return new Response(JSON.stringify({ error: 'conversa_id, mensagem, autor_id e idempotency_key são obrigatórios' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const db = getDb();
  const { data: conversa, error } = await db
    .from('conversas')
    .select('id, canal, canal_id, historico, modo_atendimento, status_atendimento, atendente_id')
    .eq('id', conversa_id)
    .single();
  if (error || !conversa) {
    return new Response(JSON.stringify({ error: 'Conversa não encontrada' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  const row = conversa as ConversaRow;
  if (!['instagram', 'facebook'].includes(row.canal)) {
    return new Response(JSON.stringify({ error: 'Canal não suportado por esta ação' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  if (row.modo_atendimento !== 'humano' || row.status_atendimento !== 'humano_atendendo' || row.atendente_id !== autor_id) {
    return new Response(JSON.stringify({ error: 'Conversa não está assumida por este atendente' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  // Idempotência: PK em idempotency_key garante que a mesma chave nunca
  // dispara um segundo envio real, mesmo sob retry/duplo clique.
  const { error: idempError } = await db
    .from('atendimento_mensagens_enviadas')
    .insert({ idempotency_key, conversa_id });
  if (idempError) {
    return new Response(JSON.stringify({ ok: true, duplicado: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const enviado = await enviarTextoInstagramOuFacebook(row.canal, row.canal_id, mensagem.trim());
  if (!enviado) {
    return new Response(JSON.stringify({ error: 'Falha ao enviar pelo canal Meta' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }

  const msgHumano: Mensagem = { role: 'human', content: mensagem.trim(), ts: new Date().toISOString(), autor_id };
  const historicoFinal = [...(row.historico ?? []), msgHumano].slice(-20);
  await salvarConversa(conversa_id, { historico: historicoFinal } as Partial<ConversaRow>);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// ── Handler principal ─────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' } });

  if (req.headers.get('x-flora-inbox-action') === 'send-human-message') {
    return await handleSendHumanMessage(req);
  }

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode'), token = url.searchParams.get('hub.verify_token'), challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN && challenge) return new Response(challenge, { status: 200 });
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const rawBody = await req.text();
  if (!await validarAssinatura(rawBody, req.headers.get('x-hub-signature-256'))) return new Response('Forbidden', { status: 403 });

  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody); } catch { return new Response('ok', { status: 200 }); }

  const eventos = extrairEventos(body);
  console.log(`[webhook-meta] ${eventos.length} evento(s)`);

  await Promise.allSettled(
    eventos.map(async (ev) => {
      if (ev.tipo === 'dm') {
        await Promise.allSettled([
          processarDM(ev.canal_id, ev.canal, ev.mensagem),
          enviarAoOrquestrador(ev),
        ]);
      } else if (ev.tipo === 'comentario') {
        await Promise.allSettled([
          processarComentario(ev),
          enviarAoOrquestrador(ev),
        ]);
      }
    }),
  );

  return new Response('ok', { status: 200 });
});
