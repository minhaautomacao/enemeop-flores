/**
 * flora-internal-test — canal interno para validar a Flora em produção sem
 * depender do WhatsApp (2026-07-30: número de testes 5511966439190
 * temporariamente indisponível, número oficial 5511982829083 protegido e
 * intocado). Reusa o MESMO motor determinístico (../_shared/funil.ts,
 * avancarFunil/classificarIntencao/intencaoInterrompeFluxo) e as mesmas
 * integrações reais de catálogo/frete/CEP/pedido usadas por
 * webhook-whatsapp e webhook-meta — mesmo padrão já existente no
 * repositório de cada canal ter sua própria construirDependenciasFunil
 * (nenhuma lógica da Flora é duplicada, só a fiação de dependências, igual
 * webhook-meta/webhook-whatsapp já fazem cada um separadamente).
 *
 * NUNCA:
 *   - chama Z-API/Evolution ou qualquer envio externo de mensagem;
 *   - dispara captacao-leads/whatsapp-sdr (SDR/campanha);
 *   - cria corrida real na Lalamove (calcularFrete só cota — cotação real,
 *     nunca corrida; corrida real só existe num processo totalmente
 *     separado, pós-pagamento + aprovação humana, nunca acionado aqui);
 *   - cria ticket real em atendimentos_humanos (canal check constraint só
 *     aceita whatsapp/instagram/facebook — handoff aqui só muda
 *     conversas.modo_atendimento diretamente, nunca entra na fila real de
 *     atendimento humano).
 *
 * Pagamento: mockado por padrão (gerarPagamentoMock, nunca cobrança real).
 * Só quando FLORA_INTERNAL_REAL_ORDER='true' (além de FLORA_INTERNAL_TEST_MODE
 * já ativo) o pagamento passa a usar a MESMA função real de
 * webhook-whatsapp/webhook-meta (gerarOuReusarPreference +
 * criarPreferenciaMercadoPago, ver ../_shared/pedido-repositorio.ts) — gera
 * preference/cobrança real no Mercado Pago, no ambiente decidido por
 * FLORA_INTERNAL_REAL_ORDER_AMBIENTE (default 'teste' — nunca dinheiro real
 * sem uma segunda flag explícita apontando 'producao'). Usado só em teste
 * controlado (um pedido por vez, sob supervisão direta), nunca por padrão.
 *
 * Dados de teste são sempre conversas.canal='internal_test' — nunca se
 * mistura com conversas reais, fácil de identificar/filtrar depois. Em modo
 * FLORA_INTERNAL_REAL_ORDER, o pedido real criado carrega cliente_nome
 * ='TESTE REAL CONTROLADO (MP <ambiente>)' (além de canal/canal_origem=
 * 'internal_test' e pedidos.mp_ambiente gravado), pra nunca ser confundido
 * com um pedido de cliente real na tela de pedidos.
 *
 * Variáveis de ambiente:
 *   FLORA_INTERNAL_TEST_MODE — precisa ser exatamente 'true'; qualquer
 *     outro valor (ou ausente) bloqueia o endpoint inteiro (acesso negado).
 *   FLORA_INTERNAL_TEST_TOKEN — obrigatório, comparado em tempo constante
 *     (ver ../_shared/auth-crm.ts, mesmo mecanismo do FACTORY_SECRET do
 *     CRM) via header "Authorization: Bearer <token>". Nunca logado.
 *   FLORA_INTERNAL_REAL_ORDER — 'true' liga o pagamento real (ver acima);
 *     qualquer outro valor (ou ausente) mantém o pagamento mockado.
 *   FLORA_INTERNAL_REAL_ORDER_AMBIENTE — só relevante quando REAL_ORDER=true;
 *     'producao' cobra de verdade com a credencial de produção; qualquer
 *     outro valor (ou ausente) usa a credencial de TESTE — default seguro,
 *     nunca dinheiro real por omissão.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { autorizacaoValida } from '../_shared/auth-crm.ts';
import { mensagemDuplicada } from '../_shared/dedup.ts';
import { mensagemDeOptOut, mensagemConfirmacaoOptOut } from '../_shared/whatsapp-guard.ts';
import { buscarCategoriasReais, buscarProdutosPorCategoriaReal, buscarProdutosPorTermoReal, revalidarProdutoReal } from '../_shared/catalogo-woocommerce.ts';
import { calcularAgendamentoEntrega } from '../_shared/agendamento-entrega.ts';
import { criarPreferenciaMercadoPago, criarPagamentoPixMercadoPago } from '../_shared/mercadopago.ts';
import { criarOuReusarPedido, gerarOuReusarPreference, gerarOuReusarPagamentoPix, buscarFormasPagamentoReal, type DadosClientePedido } from '../_shared/pedido-repositorio.ts';
import { criarChamadorInterpretacao } from '../_shared/interpretador-chamador.ts';
import { registrarEventoInterpretacao, gateDeInterpretacaoEnvolvido, eventoDoResultado } from '../_shared/interpretador-telemetria.ts';
import {
  type EstadoConversa,
  type DadosPedido,
  type ProdutoCatalogo,
  type DependenciasFunil,
  type Fase,
  type ResultadoFrete,
  estadoInicial,
  reiniciarJornada,
  classificarIntencao,
  intencaoInterrompeFluxo,
  mensagemForaDeEscopo,
  mensagemTransferencia,
  avancarFunil,
} from '../_shared/funil.ts';

const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const WORKSPACE_ID = Deno.env.get('SAAS_WORKSPACE_ID') ?? Deno.env.get('WORKSPACE_NAME') ?? '';
const LEAD_TIME_MINUTOS = Number(Deno.env.get('LOGISTICA_LEAD_TIME_MINUTOS') ?? '30');
const FACTORY_SECRET = Deno.env.get('FACTORY_SECRET') ?? '';
const TIMEOUT_FRETE_MS = 25_000;
// 'true' liga pagamento real (ver cabeçalho do arquivo) — qualquer outro
// valor (padrão) mantém gerarPagamentoMock.
const REAL_ORDER = Deno.env.get('FLORA_INTERNAL_REAL_ORDER') === 'true';
// Ambiente do Mercado Pago usado quando REAL_ORDER=true — variável DEDICADA
// (mesmo raciocínio de FLORA_INTERNAL_TEST_INTERPRETACAO_ATIVA logo abaixo:
// nunca reaproveitar nome genérico entre canais). Default SEGURO: 'teste' —
// antes desta mudança, REAL_ORDER=true sozinho já cobrava dinheiro real de
// produção; agora, ligar pedido real nunca mais cobra de verdade sem uma
// segunda flag explícita apontando 'producao'.
const REAL_ORDER_AMBIENTE: 'producao' | 'teste' =
  Deno.env.get('FLORA_INTERNAL_REAL_ORDER_AMBIENTE') === 'producao' ? 'producao' : 'teste';
// Ativa a camada de interpretação contextual de intenção (ver Parte
// "correção estrutural" em funil.ts) — flag de rollout por canal: ausente
// (padrão), o comportamento é 100% determinístico, idêntico ao anterior a
// essa camada. flora-internal-test é o primeiro canal do rollout gradual
// (teste interno -> SDR -> Instagram/Facebook -> WhatsApp).
//
// Variável DEDICADA a este canal (nunca FUNIL_INTERPRETACAO_CONTEXTUAL_ATIVA):
// Edge Function Secrets no Supabase são compartilhados por todo o projeto,
// não por função — webhook-whatsapp e webhook-meta também rodam neste
// mesmo projeto e leem FUNIL_INTERPRETACAO_CONTEXTUAL_ATIVA. Usar o mesmo
// nome aqui ativaria a camada contextual nos canais reais também, mesmo
// sem nenhum deploy neles. Achado da preparação do rollout controlado —
// ver relatório da tarefa.
const INTERPRETACAO_CONTEXTUAL_ATIVA = Deno.env.get('FLORA_INTERNAL_TEST_INTERPRETACAO_ATIVA') === 'true';

function getDb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

// ── Persistência (conversas.canal='internal_test' — nunca mistura com dados reais) ──

interface Mensagem { role: 'user' | 'assistant' | 'human'; content: string; ts: string; mid?: string; }

interface ConversaRow {
  id: string;
  canal_id: string;
  canal: string;
  fase: string;
  historico: Mensagem[];
  pedido_info: { dados?: DadosPedido; perguntasFeitas?: string[] } | null;
  nome_cliente: string | null;
  modo_atendimento?: string;
  status_atendimento?: string;
  motivo_handoff?: string | null;
  whatsapp_opt_out?: boolean;
}

async function buscarOuCriarConversaTeste(conversaId: string): Promise<ConversaRow> {
  const db = getDb();
  const { data } = await db.from('conversas').select('*').eq('canal_id', conversaId).eq('canal', 'internal_test').single();
  if (data) return data as ConversaRow;
  const { data: nova } = await db.from('conversas')
    .insert({ canal_id: conversaId, canal: 'internal_test', workspace_id: WORKSPACE_ID || null, fase: estadoInicial().fase, nome_cliente: 'TESTE INTERNO' })
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

function handoffRealmenteAtivo(row: ConversaRow): boolean {
  return row.modo_atendimento === 'humano' &&
    (row.status_atendimento === 'aguardando_humano' || row.status_atendimento === 'humano_atendendo');
}

// ── Dependências reais (mesmo padrão de webhook-whatsapp/webhook-meta,
// cada canal com sua própria fiação) — pagamento é o único mock. ──────────

async function buscarCatalogoReal(params: { query: string; occasion?: string; budget?: number; color?: string }): Promise<ProdutoCatalogo[]> {
  return buscarProdutosPorTermoReal(WORKSPACE_ID, { query: [params.query, params.color].filter(Boolean).join(' '), budget: params.budget });
}

async function calcularFreteReal(cep: string): Promise<ResultadoFrete> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/agente-logistica`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${FACTORY_SECRET}` },
      body: JSON.stringify({ endereco: { cep }, workspace_id: WORKSPACE_ID }),
      signal: AbortSignal.timeout(TIMEOUT_FRETE_MS),
    });
    if (!res.ok) return { ok: false };
    const data = await res.json() as { disponivel?: boolean; preco_real?: number; preco_cliente?: number; transportadora?: string; servico?: string };
    if (!data.disponivel || data.preco_cliente == null) return { ok: false };
    return {
      ok: true,
      valor: data.preco_cliente,
      detalhes: { transportadora: data.transportadora, servico: data.servico, precoReal: data.preco_real, markup: data.preco_real != null ? data.preco_cliente - data.preco_real : undefined },
    };
  } catch {
    return { ok: false };
  }
}

async function consultarCepReal(cep: string): Promise<{ rua?: string; bairro?: string; cidade?: string; uf?: string } | null> {
  const cepLimpo = cep.replace(/\D/g, '');
  if (cepLimpo.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const data = await res.json() as { logradouro?: string; bairro?: string; localidade?: string; uf?: string; erro?: boolean };
    if (data.erro) return null;
    return { rua: data.logradouro || undefined, bairro: data.bairro || undefined, cidade: data.localidade || undefined, uf: data.uf || undefined };
  } catch {
    return null;
  }
}

/** Pagamento mockado — comportamento padrão (REAL_ORDER=false), nunca cria preference real. */
async function gerarPagamentoMock(pedidoId: string, valorTotal: number): Promise<{ link: string; paymentId: string } | null> {
  return { link: `https://mock-pagamento.teste-interno.invalid/pedido/${pedidoId}?valor=${valorTotal}`, paymentId: `mock-${pedidoId}` };
}

/** Pagamento real — mesma função usada por webhook-whatsapp/webhook-meta. Só chamada quando REAL_ORDER=true (teste real controlado). Ambiente decidido por REAL_ORDER_AMBIENTE, nunca fixo em produção. */
async function gerarPagamentoReal(pedidoId: string): Promise<{ link: string; paymentId: string } | null> {
  return gerarOuReusarPreference(getDb(), pedidoId, WORKSPACE_ID, SUPABASE_URL, 'flora-internal-test', criarPreferenciaMercadoPago);
}

/** QR Code Pix mockado — nunca cria pagamento real (comportamento padrão, REAL_ORDER=false). */
async function gerarPagamentoPixMock(pedidoId: string): Promise<{ qrCodeUrl: string; copiaCola: string } | null> {
  return { qrCodeUrl: `https://mock-pagamento.teste-interno.invalid/pix/${pedidoId}.png`, copiaCola: `00020126-mock-${pedidoId}` };
}

/** QR Code Pix real — mesma função usada por webhook-whatsapp/webhook-meta. Só chamada quando REAL_ORDER=true. */
async function gerarPagamentoPixReal(pedidoId: string): Promise<{ qrCodeUrl: string; copiaCola: string } | null> {
  return gerarOuReusarPagamentoPix(getDb(), pedidoId, WORKSPACE_ID, SUPABASE_URL, 'flora-internal-test', criarPagamentoPixMercadoPago);
}

function construirDependenciasFunilTeste(cliente: DadosClientePedido): DependenciasFunil {
  return {
    buscarCatalogo: buscarCatalogoReal,
    buscarCategorias: () => buscarCategoriasReais(WORKSPACE_ID),
    buscarProdutosPorCategoria: (categoriaId) => buscarProdutosPorCategoriaReal(WORKSPACE_ID, categoriaId),
    revalidarProduto: (idExterno) => revalidarProdutoReal(WORKSPACE_ID, idExterno),
    calcularFrete: calcularFreteReal,
    consultarCep: consultarCepReal,
    calcularAgendamento: (dataEntrega, periodoEntrega) => {
      const r = calcularAgendamentoEntrega(dataEntrega, periodoEntrega, new Date(), { leadTimeMinutos: LEAD_TIME_MINUTOS });
      return { entregaPrometidaEmISO: r.entregaPrometidaEm.toISOString(), despachoEmISO: r.despachoEm.toISOString(), imediato: r.imediato };
    },
    gerarPagamento: REAL_ORDER ? gerarPagamentoReal : gerarPagamentoMock,
    gerarPagamentoPix: REAL_ORDER ? gerarPagamentoPixReal : gerarPagamentoPixMock,
    // Ambiente gravado uma única vez na criação (imutável depois, ver
    // migration mp_ambiente) — só importa quando REAL_ORDER=true (pedido
    // mockado nunca toca credencial nenhuma, 'producao' aqui é só neutro).
    criarPedido: (dados) => criarOuReusarPedido(getDb(), dados, cliente, WORKSPACE_ID, 'flora-internal-test', REAL_ORDER ? REAL_ORDER_AMBIENTE : 'producao'),
    buscarFormasPagamento: () => buscarFormasPagamentoReal(getDb(), WORKSPACE_ID, REAL_ORDER ? REAL_ORDER_AMBIENTE : 'producao'),
    interpretarIntencao: INTERPRETACAO_CONTEXTUAL_ATIVA ? criarChamadorInterpretacao() : undefined,
  };
}

// ── Processamento — mesmo fluxo de decisão de webhook-whatsapp/webhook-meta ─

async function processarMensagemTeste(conversaId: string, mensagemCliente: string, mid?: string): Promise<{ mensagem: string; fase: string; fotoUrl?: string | null }> {
  const conversaRow = await buscarOuCriarConversaTeste(conversaId);

  if (mensagemDuplicada(conversaRow.historico ?? [], mensagemCliente, mid)) {
    console.log(`[TESTE INTERNO] mensagem_duplicada_ignorada conversa=${conversaId} mid=${mid ?? '(sem mid)'}`);
    return { mensagem: '', fase: conversaRow.fase };
  }

  if (conversaRow.whatsapp_opt_out) {
    const novaMsg: Mensagem = { role: 'user', content: mensagemCliente, ts: new Date().toISOString(), mid };
    await salvarConversa(conversaRow.id, { historico: [...(conversaRow.historico ?? []), novaMsg].slice(-20) });
    console.log(`[TESTE INTERNO] opt_out_ativo conversa=${conversaId} — Flora nao responde`);
    return { mensagem: '', fase: conversaRow.fase };
  }
  if (mensagemDeOptOut(mensagemCliente)) {
    const novaMsg: Mensagem = { role: 'user', content: mensagemCliente, ts: new Date().toISOString(), mid };
    const historico = [...(conversaRow.historico ?? []), novaMsg, { role: 'assistant' as const, content: mensagemConfirmacaoOptOut(), ts: new Date().toISOString() }].slice(-20);
    await salvarConversa(conversaRow.id, { historico, whatsapp_opt_out: true, whatsapp_opt_out_em: new Date().toISOString() } as Partial<ConversaRow>);
    console.log(`[TESTE INTERNO] opt_out_registrado conversa=${conversaId}`);
    return { mensagem: mensagemConfirmacaoOptOut(), fase: conversaRow.fase };
  }

  if (handoffRealmenteAtivo(conversaRow)) {
    const novaMsg: Mensagem = { role: 'user', content: mensagemCliente, ts: new Date().toISOString(), mid };
    await salvarConversa(conversaRow.id, { historico: [...(conversaRow.historico ?? []), novaMsg].slice(-20) });
    console.log(`[TESTE INTERNO] handoff_humano_ativo conversa=${conversaId} — Flora nao responde`);
    return { mensagem: '', fase: conversaRow.fase };
  }

  let estado = estadoDaConversa(conversaRow);
  if (estado.fase === 'pedido_criado' || estado.fase === 'encerrado_sem_venda') {
    estado = reiniciarJornada(mensagemCliente);
  }

  const novaMsg: Mensagem = { role: 'user', content: mensagemCliente, ts: new Date().toISOString(), mid };
  const historico = [...(conversaRow.historico ?? []), novaMsg].slice(-20);

  const intencao = classificarIntencao(mensagemCliente, estado.fase);
  let respostaFinal: string;
  let fotoUrl: string | null | undefined;

  if (intencaoInterrompeFluxo(intencao)) {
    if (intencao === 'assunto_fora_escopo') {
      respostaFinal = mensagemForaDeEscopo();
    } else {
      // atendimento_humano/reclamacao: nunca cria ticket real (canal
      // 'internal_test' não é aceito pelo check constraint de
      // atendimentos_humanos, e mesmo que fosse, não deve entrar na fila
      // real de atendimento) — só muda o estado da conversa de teste,
      // suficiente pra validar que a Flora pausa e marca corretamente
      // (FLUXO 9).
      console.log(`[TESTE INTERNO] handoff_simulado conversa=${conversaId} motivo=${intencao}`);
      await salvarConversa(conversaRow.id, { modo_atendimento: 'humano', status_atendimento: 'aguardando_humano', motivo_handoff: `${intencao}: "${mensagemCliente}"` } as Partial<ConversaRow>);
      respostaFinal = mensagemTransferencia();
      estado = { ...estado, fase: 'transferido_humano' };
    }
  } else {
    const deps = construirDependenciasFunilTeste({
      nome: REAL_ORDER ? `TESTE REAL CONTROLADO (MP ${REAL_ORDER_AMBIENTE})` : 'Cliente Teste',
      canal: 'internal_test',
      canalId: conversaId,
      conversaId: conversaRow.id,
    });
    const faseAntes = estado.fase;
    const inicioMs = Date.now();
    const resultado = await avancarFunil(estado, mensagemCliente, intencao, deps, false, undefined);
    const duracaoMs = Date.now() - inicioMs;
    estado = resultado.estado;
    respostaFinal = resultado.mensagem;
    fotoUrl = resultado.fotoUrl;

    // Telemetria só quando algum gate da camada de interpretação contextual
    // esteve envolvido (fatia 1: retomada_apos_intervalo; fatia 2: aprovação
    // de frete, confirmação de formulário, reaproveitamento de dados,
    // confirmação de cancelamento) — nunca em toda mensagem, que poluiria a
    // tabela sem sinal nenhum das etapas que ainda não usam esta camada.
    // Fire-and-forget: nunca aguardado de forma bloqueante, nunca atrasa a
    // resposta ao cliente.
    if (gateDeInterpretacaoEnvolvido(faseAntes, estado)) {
      void registrarEventoInterpretacao(eventoDoResultado(resultado, faseAntes, conversaRow.id, duracaoMs));
    }
  }

  const historicoFinal = [...historico, { role: 'assistant' as const, content: respostaFinal, ts: new Date().toISOString() }].slice(-20);
  await salvarConversa(conversaRow.id, {
    historico: historicoFinal,
    fase: estado.fase,
    pedido_info: { dados: estado.dados, perguntasFeitas: estado.perguntasFeitas },
  } as Partial<ConversaRow>);

  console.log(`[TESTE INTERNO] conversa=${conversaId} fase=${conversaRow.fase}→${estado.fase} resposta="${respostaFinal.slice(0, 60)}"`);
  return { mensagem: respostaFinal, fase: estado.fase, fotoUrl };
}

// ── Handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response('ok', { status: 200 });

  if (Deno.env.get('FLORA_INTERNAL_TEST_MODE') !== 'true') {
    console.error('[TESTE INTERNO] acesso_negado motivo=FLORA_INTERNAL_TEST_MODE_desativado');
    return new Response(JSON.stringify({ erro: 'acesso negado' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  // Nunca loga o header nem o token — só o resultado booleano da validação.
  const autorizado = await autorizacaoValida(req.headers.get('Authorization'), Deno.env.get('FLORA_INTERNAL_TEST_TOKEN'));
  if (!autorizado) {
    console.error('[TESTE INTERNO] acesso_negado motivo=token_invalido_ou_ausente');
    return new Response(JSON.stringify({ erro: 'acesso negado' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  let body: { conversaId?: string; mensagem?: string; mid?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ erro: 'JSON inválido' }), { status: 400 }); }

  const conversaId = (body.conversaId ?? '').trim();
  const mensagem = (body.mensagem ?? '').trim();
  if (!conversaId || !mensagem) {
    return new Response(JSON.stringify({ erro: 'conversaId e mensagem são obrigatórios' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const resultado = await processarMensagemTeste(conversaId, mensagem, body.mid);
    return new Response(JSON.stringify({ ...resultado, origem: 'internal_test', conversaId }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[TESTE INTERNO] erro_processamento:', e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ erro: 'falha ao processar mensagem de teste' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
