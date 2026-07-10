/**
 * webhook-meta — Agente de Vendas com Memória de Conversa
 *
 * Variáveis de ambiente:
 *   META_VERIFY_TOKEN, META_APP_SECRET, META_IG_APP_SECRET, META_IG_ACCESS_TOKEN
 *   META_INSTAGRAM_ID, META_PAGE_ACCESS_TOKEN
 *   FACTORY_SECRET, SAAS_WORKSPACE_ID
 *   GROQ_API_KEY (ou ANTHROPIC_API_KEY como fallback)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injetados)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

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

// ── Catálogo de produtos ──────────────────────────────────────────────────

const CATALOGO = `
SOBRE A ENEMEOP FLORES:
Fundada em 1997 por Clean Espindula e Luis Evangelista. "ENEMEOP" vem do Tupi-Guarani e significa "perfume das flores".
Missão: "Prover produtos e serviços com alta qualidade e estilo próprio, garantindo a excelência no atendimento."
Localização: Rua Costa Aguiar, 1184 — Ipiranga, São Paulo, SP.
Telefone: (11) 98282-9083 / (11) 2272-3158.
Funcionamento: Seg–Sáb 9h–19h | Dom e Feriados 9h30–14h.
Entrega: até 3h após confirmação de pagamento. Área: São Paulo e Grande SP.
Entrega disponível: Seg–Sex 9h–18h | Sáb, Dom e Feriados 9h–14h.

CATÁLOGO COMPLETO DE PRODUTOS:

RAMALHETES:
- Mini Ramalhete (Mod.28): R$ 55
- Ramalhete Girassol e Alstroemerias (051): R$ 70
- Ramalhete de Rosas (030): R$ 70
- Mini Ramalhete + Ferrero Rocher (Mod.29): R$ 100
- Ramalhete 3 Rosas + Chocolates (094): R$ 95
- Ramalhete Rosas Brancas (057): R$ 105
- Ramalhete 3 Rosas Nacionais Rosa (Mod.31): R$ 105
- Ramalhete Mix Rosas + Ferrero Rocher (081): R$ 150

ARRANJOS FLORAIS:
- Modelo 01 – Arranjo no Vaso de Vidro: R$ 70
- Arranjo Girassol Solitário (Mod.09): R$ 75
- Arranjo Flores Luto Hortênsias (Mod.17): R$ 155
- Arranjo com Alstroemerias no Vaso de Vidro (027): R$ 155
- Arranjo de Rosas (Mod.07): R$ 160
- Arranjo Girassol em Vaso + Ferrero Rocher (010): R$ 120
- Arranjo Mix Flores do Campo (Mod.08): R$ 145
- Arranjo Girassol no Vaso (011): R$ 135
- Arranjo 2 Rosas Nacionais e Junco (002): R$ 105
- Arranjo Coração 2 Rosas + Ferrero Rocher (003): R$ 140
- Arranjo 4 Rosas Brancas e Alstroemerias (006): R$ 225
- Arranjo Orquídeas Brancas Frente Única (012): R$ 225
- Arranjo Orquídeas Pink Vaso de Vidro (013): R$ 225
- Arranjo Orquídeas Brancas e Ruscus (014): R$ 225
- Arranjo Rosas Rosa no Vaso (Mod.05): R$ 225
- Arranjo de Alstroemerias (Mod.24): R$ 265
- Arranjo Girassóis (Mod.26): R$ 255
- Mini Arranjo Branco (Mod.16): R$ 220
- Arranjo Branco (Mod.19): R$ 255
- Arranjo Laranja (Mod.20): R$ 145
- Arranjo Girassol e Flores do Campo (Mod.25): R$ 295
- Arranjo Rosas Vermelhas Nacionais no Vidro (Mod.18): R$ 425
- Buquê de Rosas no Vaso de Vidro (004): R$ 295
- Buquê 12 Rosas Rosa no Vaso de Vidro (Mod.58): R$ 425
- Arranjo Exclusivo Orquídeas Cymbidium (Mod.22): R$ 225
- Arranjo Orquídeas Cymbidium Amarelas (Mod.23): R$ 225
- Arranjo Permanente (Mod.15): R$ 1.280
- Arranjo Permanente Grande (Mod.14): R$ 2.550

BUQUÊS DE FLORES:
- Buquê de Rosas Vermelhas (032): R$ 140
- Buquê 6 Rosas Vermelhas Nacionais (Mod.35): R$ 185
- Buquê 6 Rosas Nacionais (Mod.44): R$ 185
- Buquê de Rosas Vermelhas + Coração (Mod.59): R$ 205
- Buquê Rosas Nacionais Vermelhas (Mod.43): R$ 245
- Buquê de Rosas Brancas (Mod.55): R$ 280
- Buquê 12 Rosas Vermelhas (033): R$ 280
- Buquê Rosas Nacionais + Ferrero Rocher (Mod.36): R$ 290
- Buquê Mix Alstroemerias (Mod.40): R$ 295
- Buquê Mix Flores com Girassóis e Campo (054): R$ 295
- Buquê Luto Rosas Brancas (Mod.50): R$ 390
- Buquê com Lírios Rosa (093): R$ 395
- Buquê Luxuoso Alstroemerias Coloridas (061): R$ 395
- Buquê 12 Rosas Rosa Nacionais e Alstroemerias (045/046): R$ 370
- Buquê 12 Rosas Pink Nacionais (Mod.38): R$ 370
- Buquê 12 Rosas Nacionais Rosa (Mod.41): R$ 370
- Buquê Mix Flores Nacionais + Ferrero (Mod.37): R$ 150
- Buquê Especial Rosas e Juncos (Mod.48): R$ 420
- Buquê Mix Flores Nobre + Vinho Importado (Mod.60): R$ 425
- Buquê Mix de Flores (Mod.42): R$ 495
- Buquê 24 Rosas Vermelhas (034): R$ 560
- Buquê de Noiva Rosas Pink (062): R$ 565
- Buquê Mix Flores Nobre (039): R$ 590
- Buquê Mix de Flores (047): R$ 745
- Buquê 12 Girassóis Premium (052): R$ 435
- Buquê 100 Rosas Vermelhas (056): R$ 1.490

BUQUÊS DE NOIVA:
- Buquê Noiva Natural Branco (Mod.74): R$ 445
- Buquê Noiva Mix Flores Brancas (Mod.78): R$ 490
- Buquê Noiva (Mod.73/065): R$ 590
- Buquê Noiva Noiva Rosas Lilás (Mod.75): R$ 720
- Buquê Noiva Orquídeas Brancas M (066): R$ 740
- Buquê Noiva Orquídeas e Juncos (068): R$ 740
- Buquê Tulipas Brancas Noiva (094): R$ 720
- Buquê Tulipas (067): R$ 790
- Buquê Noiva Natural Rosas Brancas e Spray (Mod.76): R$ 570
- Buquê Noiva Mix Nobre (Mod.70): R$ 730
- Buquê Noiva com Callas Branco (Mod.71): R$ 880
- Buquê Noiva Mix (069): R$ 640
- Buquê Noiva com Ervas e Flores (077): R$ 645
- Buquê Noiva Flores Desidratadas (080): R$ 770
- Buquê Noiva Mix Flores Nobres (079): R$ 980
- Buquê Noiva Cascata de Orquídeas (063): R$ 1.180
- Buquê Noiva Flores Brancas e Folhagens (064): R$ 670

ORQUÍDEAS:
- Mini Orquídea no Vaso de Vidro (Mod.87): R$ 215
- Orquídea Phalaenópsis Mescla pequena 2 hastes (Mod.90): R$ 145
- Orquídea Phalaenópsis Mescla em Vaso (Mod.89): R$ 195
- Orquídea Branca Phalaenópsis 1 haste (083): R$ 170
- Orquídea Phalaenópsis Pink 1 haste (Mod.91): R$ 225
- Orquídea Phalaenópsis Branca 1 haste (Mod.92): R$ 290
- Orquídea Phalaenópsis Branca 2 hastes (084): R$ 290
- Orquídea Phalaenópsis Pink (Mod.85): R$ 300
- Orquídea Phalaenópsis Pink no Vaso de Vidro (Mod.88): R$ 315
- Orquídea Phalaenópsis Cascata Branca 2 hastes (Mod.86): R$ 390
- Arranjo Orquídeas Brancas Frente Única (012): R$ 225

MATERNIDADE E BEBÊ:
- Kit Maternidade Flores e Pelúcia (Mod.21): R$ 410
- Buquê Mix Flores Nobres Maternidade (Mod.49): R$ 980

KITS E PRESENTES:
- Ferrero Rocher 100g: R$ 45
- Cesta de Queijos e Vinho Especial (082): R$ 890

FORMAS DE PAGAMENTO: Cartão de crédito, PIX, online seguro.
PERSONALIZAÇÃO: arranjos sob encomenda disponíveis.
`.trim();

// ── Supabase client ───────────────────────────────────────────────────────

function getDb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function buscarConfigDB(chave: string): Promise<string> {
  try {
    const db = getDb();
    const { data } = await db.from('funcao_configs').select('valor').eq('chave', chave).single();
    return (data?.valor as string) ?? '';
  } catch { return ''; }
}

// ── Tipos ──────────────────────────────────────────────────────────────────

interface Mensagem { role: 'user' | 'assistant'; content: string; ts: string; }

interface Conversa {
  id: string;
  canal_id: string;
  canal: string;
  fase: string;
  historico: Mensagem[];
  pedido_info: Record<string, unknown> | null;
  lead_id: string | null;
  nome_cliente: string | null;
}

// ── Busca nome do cliente ──────────────────────────────────────────────────

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

// ── Gerenciamento de conversa ──────────────────────────────────────────────

async function buscarOuCriarConversa(canalId: string, canal: string): Promise<Conversa> {
  const db = getDb();
  const { data } = await db
    .from('conversas')
    .select('*')
    .eq('canal_id', canalId)
    .eq('canal', canal)
    .single();

  if (data) return data as Conversa;

  const { data: nova } = await db
    .from('conversas')
    .insert({ canal_id: canalId, canal, workspace_id: WORKSPACE_ID || null })
    .select('*')
    .single();

  return nova as Conversa;
}

async function salvarConversa(id: string, updates: Partial<Conversa>): Promise<void> {
  const db = getDb();
  await db.from('conversas').update({ ...updates, atualizado_em: new Date().toISOString() }).eq('id', id);
}

// ── Prompt do agente ──────────────────────────────────────────────────────

function buildSystemPrompt(fase: string, pedidoInfo: Record<string, unknown> | null, nomeCliente: string | null): string {
  const nome = nomeCliente ?? null;
  return `Você é uma consultora virtual especializada em atendimento premium para floricultura. Representa a Enemeop Flores — floricultura no Ipiranga, São Paulo, desde 1997. Seu nome é Flor.

${nome ? `O cliente se chama ${nome}. Use o nome de forma natural e moderada durante a conversa.` : ''}

${CATALOGO}

FASE ATUAL DA CONVERSA: ${fase}
${pedidoInfo ? `PEDIDO EM ANDAMENTO: ${JSON.stringify(pedidoInfo)}` : ''}

IDENTIDADE E COMPORTAMENTO:
Você age como uma atendente real experiente — natural, humana, fluida, educada, sofisticada e acolhedora. Nunca parece um robô. No máximo 1 emoji por mensagem.

OBJETIVO: Descobrir na ordem certa (UMA pergunta por vez):
1. Ocasião (aniversário, namoro, casamento, maternidade, condolências)
2. Para quem é
3. Perfil da pessoa presenteada
4. Preferências (flores, cores, estilo)
5. Data e horário da entrega
6. Região da entrega
7. Faixa de valor

RECOMENDAÇÃO: Até 3 opções com preços do catálogo. Sugira upgrade natural sem pressionar.

ESCALONAMENTO: Reclamação, pagamento com problema, cliente irritado → acionar atendente humana.

RETORNE APENAS O TEXTO DA RESPOSTA — sem aspas, sem prefixo, sem JSON.`;
}

// ── Análise de fase ────────────────────────────────────────────────────────

function buildFasePrompt(historico: Mensagem[], ultimaMensagem: string, faseAtual: string): string {
  return `Analise a conversa de venda de floricultura e determine:
1. A nova fase
2. Detalhes do pedido se definido
3. Nome do cliente se mencionado

Fases: descoberta | interesse | proposta | aguardando_pagamento | concluido | perdido

Histórico: ${historico.slice(-4).map(m => `${m.role}: ${m.content}`).join(' | ')}
Última mensagem: "${ultimaMensagem}"
Fase atual: ${faseAtual}

Retorne APENAS JSON válido:
{
  "nova_fase": "string",
  "pedido_info": { "produto": "", "quantidade": 1, "data_entrega": "", "endereco": "", "valor": 0 } | null,
  "pronto_para_pagamento": false,
  "nome_cliente": null
}`;
}

// ── Chamada IA ─────────────────────────────────────────────────────────────

async function chamarIA(systemPrompt: string, mensagens: Array<{role: string; content: string}>, maxTokens = 120): Promise<string | null> {
  const groqKey = Deno.env.get('GROQ_API_KEY') || await buscarConfigDB('GROQ_API_KEY');
  if (groqKey) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            max_tokens: maxTokens,
            messages: [{ role: 'system', content: systemPrompt }, ...mensagens],
          }),
        });
        if (res.ok) {
          const data = await res.json();
          return (data.choices?.[0]?.message?.content as string)?.trim() ?? null;
        }
        if (res.status !== 429) { console.error(`[ia] Groq ${res.status}`); break; }
        console.warn('[ia] Groq rate limit, retry...');
      } catch (e) { console.error('[ia] Groq falhou:', e); break; }
    }
  }

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') || await buscarConfigDB('ANTHROPIC_API_KEY');
  if (anthropicKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: mensagens,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return (data.content?.[0]?.text as string)?.trim() ?? null;
      }
      console.error(`[ia] Anthropic ${res.status}: ${await res.text()}`);
    } catch (e) { console.error('[ia] Anthropic falhou:', e); }
  }

  return null;
}

// ── Gerar link de pagamento ────────────────────────────────────────────────

async function gerarLinkPagamento(pedidoInfo: Record<string, unknown>): Promise<string | null> {
  const mpToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');
  if (!mpToken) return null;
  try {
    const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mpToken}` },
      body: JSON.stringify({
        items: [{ title: String(pedidoInfo['produto'] ?? 'Arranjo Floral'), quantity: 1, unit_price: Number(pedidoInfo['valor'] ?? 0) }],
        payment_methods: { default_payment_method_id: 'pix' },
        statement_descriptor: 'Enemeop Flores',
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.init_point as string;
    }
  } catch (e) { console.error('[pagamento] Mercado Pago falhou:', e); }
  return null;
}

// ── Processar DM ──────────────────────────────────────────────────────────

const MSG_FALLBACK_POR_FASE: Record<string, string> = {
  descoberta: 'Oi! Para qual ocasião é?',
  interesse: 'Me conta um pouco mais sobre quem vai receber, pra eu sugerir as melhores opções?',
  proposta: 'Ainda estou por aqui! Alguma das opções que te passei fez sentido pra você?',
  aguardando_pagamento: 'Só um instante, já confirmo os detalhes do seu pagamento.',
};
const MSG_FALLBACK_GENERICO = 'Desculpa a demora! Pode repetir sua última mensagem que eu continuo com você.';

async function processarDM(canalId: string, canal: string, mensagemCliente: string): Promise<void> {
  const igToken = IG_TOKEN || await buscarConfigDB('META_IG_ACCESS_TOKEN');
  if (!igToken) return;

  const conversa = await buscarOuCriarConversa(canalId, canal);
  if (conversa.fase === 'concluido') {
    console.log(`[webhook-meta] conversa_reaberta_de_concluido canal_id=${canalId} canal=${canal}`);
    conversa.fase = 'descoberta';
  }

  let nomeCliente = conversa.nome_cliente ?? null;
  if (!nomeCliente && conversa.historico.length === 0) {
    nomeCliente = await buscarNomeCliente(canalId);
    if (nomeCliente) await salvarConversa(conversa.id, { nome_cliente: nomeCliente } as Partial<Conversa>);
  }

  const novaMsg: Mensagem = { role: 'user', content: mensagemCliente, ts: new Date().toISOString() };
  const historico = [...(conversa.historico ?? []), novaMsg].slice(-20);

  const [respostaIA, analiseRaw] = await Promise.all([
    chamarIA(
      buildSystemPrompt(conversa.fase, conversa.pedido_info, nomeCliente),
      historico.map(m => ({ role: m.role, content: m.content })),
      350,
    ),
    chamarIA(
      buildFasePrompt(historico, mensagemCliente, conversa.fase),
      [{ role: 'user', content: mensagemCliente }],
      200,
    ),
  ]);

  let novaFase = conversa.fase;
  let pedidoInfo = conversa.pedido_info ?? null;
  let prontoParaPagamento = false;

  if (analiseRaw) {
    try {
      const analise = JSON.parse(analiseRaw.replace(/```json\n?|\n?```/g, '').trim());
      novaFase = analise.nova_fase ?? conversa.fase;
      if (analise.pedido_info?.produto) pedidoInfo = analise.pedido_info;
      prontoParaPagamento = analise.pronto_para_pagamento ?? false;
      const nomeDetectado = (analise.nome_cliente as string | null)?.trim() || null;
      if (nomeDetectado && !nomeCliente) {
        nomeCliente = nomeDetectado;
        const db = getDb();
        await Promise.allSettled([
          salvarConversa(conversa.id, { nome_cliente: nomeDetectado }),
          db.from('leads').update({ nome: nomeDetectado }).eq('canal_id', canalId).is('nome', null),
        ]);
      }
    } catch { /* mantém fase atual */ }
  }

  let respostaFinal = respostaIA;
  if (!respostaFinal) {
    const candidato = MSG_FALLBACK_POR_FASE[novaFase] ?? MSG_FALLBACK_POR_FASE[conversa.fase] ?? MSG_FALLBACK_GENERICO;
    const ultimaAssistente = [...historico].reverse().find(m => m.role === 'assistant');
    respostaFinal = ultimaAssistente?.content === candidato ? MSG_FALLBACK_GENERICO : candidato;
  }

  if (prontoParaPagamento && pedidoInfo) {
    const linkPagamento = await gerarLinkPagamento(pedidoInfo);
    if (linkPagamento) {
      respostaFinal = `Perfeito! Seu arranjo: ${pedidoInfo['produto']}. Link de pagamento PIX: ${linkPagamento} ✅`;
      novaFase = 'aguardando_pagamento';
    } else {
      respostaFinal = `Ótimo! Me chama no WhatsApp para confirmar os detalhes e gerar o PIX: wa.me/${WHATSAPP_NUM}`;
      novaFase = 'proposta';
    }
  }

  const msgAssistente: Mensagem = { role: 'assistant', content: respostaFinal, ts: new Date().toISOString() };
  const historicoFinal = [...historico, msgAssistente].slice(-20);

  await salvarConversa(conversa.id, {
    historico: historicoFinal,
    fase: novaFase,
    pedido_info: pedidoInfo ?? undefined,
  } as Partial<Conversa>);

  console.log(`[webhook-meta] ${canalId} | fase: ${conversa.fase}→${novaFase} | resposta: ${respostaFinal.slice(0, 60)}`);

  // ── Envio de resposta via Graph API ─────────────────────────────────
  // Instagram Business Login (Caminho B): POST /{ig-user-id}/messages via host graph.instagram.com
  //   (obrigatório para Instagram User Access Token — ver docs/KNOWN_ISSUES.md)
  // Facebook/Messenger (Caminho A):       POST /me/messages via host graph.facebook.com
  try {
    const pageToken = PAGE_TOKEN || await buscarConfigDB('META_PAGE_ACCESS_TOKEN');
    const igId = Deno.env.get('META_INSTAGRAM_ID') || await buscarConfigDB('META_INSTAGRAM_ID');

    const isInstagram = canal === 'instagram' && !!igId && !!igToken;
    const endpoint = isInstagram
      ? `https://graph.instagram.com/v21.0/${igId}/messages`
      : `https://graph.facebook.com/v21.0/me/messages`;
    const dmToken = isInstagram ? igToken : (pageToken || igToken);

    // ── DIAGNÓSTICO TEMPORÁRIO — remover após validar token (não loga o valor do token) ──
    const trimmedIgToken = igToken.trim();
    console.log(
      `[diag-token] igTokenPresente=${!!igToken} length=${igToken.length} trimLength=${trimmedIgToken.length} ` +
      `leadingWhitespace=${igToken !== igToken.trimStart()} trailingWhitespace=${igToken !== igToken.trimEnd()} ` +
      `hasQuote=${/['"]/.test(igToken)} hasNewline=${/[\r\n]/.test(igToken)} ` +
      `looksLikeJson=${trimmedIgToken.startsWith('{') || trimmedIgToken.startsWith('[')} ` +
      `igIdPresente=${!!igId} igIdUsado=${isInstagram} endpointUsado=${isInstagram ? 'ig' : 'fb'}`
    );
    // ── FIM DIAGNÓSTICO TEMPORÁRIO ────────────────────────────────────────────────────────

    const res = await fetch(`${endpoint}?access_token=${dmToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: canalId },
        message: { text: respostaFinal },
        messaging_type: 'RESPONSE',
      }),
    });
    if (!res.ok) {
      const erroBody = await res.text();
      console.error(`[webhook-meta] erro DM status=${res.status} endpoint=${isInstagram ? 'ig' : 'fb'} url=${endpoint} recipient=${canalId} corpo=${erroBody}`);
    } else {
      console.log(`[webhook-meta] DM enviado canal=${canal} endpoint=${isInstagram ? 'ig' : 'fb'} para=${canalId}`);
    }
  } catch (e) { console.error(`[webhook-meta] falha DM: ${e}`); }
}

// ── Processar comentário ───────────────────────────────────────────────────

async function processarComentario(evento: MetaEvento): Promise<void> {
  if (!evento.comment_id) return;
  const token = IG_TOKEN || await buscarConfigDB('META_IG_ACCESS_TOKEN');
  if (!token) return;

  const SYSTEM_COMENTARIO = `Você é a Flor, atendente da Enemeop Flores. Alguém comentou numa publicação. Responda de forma calorosa e curta (máx. 2 linhas). Nunca cite preços em comentários públicos. Se for elogio: agradeça e convide para o DM. Se for dúvida: responda brevemente e direcione ao DM. Português brasileiro natural. Máx. 1 emoji. RETORNE APENAS o texto.`;

  const resposta = await chamarIA(SYSTEM_COMENTARIO, [{ role: 'user', content: evento.mensagem }], 100);
  if (!resposta) return;

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

// ── Envia ao orquestrador ─────────────────────────────────────────────────

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

// ── Handler principal ─────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' } });

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
