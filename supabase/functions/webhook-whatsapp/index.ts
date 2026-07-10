/**
 * webhook-whatsapp — Recebe mensagens do Z-API e responde com IA + fotos dos produtos
 *
 * Quando a IA sugere ou o cliente confirma um produto, a foto real é enviada via Z-API.
 * Fotos e códigos ficam na tabela catalogo_produtos.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
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

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Mensagem { role: 'user' | 'assistant'; content: string; ts: string; }
interface Conversa { id: string; canal_id: string; canal: string; fase: string; historico: Mensagem[]; pedido_info: Record<string, unknown> | null; lead_id: string | null; nome_cliente: string | null; }
interface Produto { codigo: string; nome: string; preco: number; foto_url: string; }

// ── Catálogo (codigos para a IA usar) ─────────────────────────────────────────

// Catálogo compacto com códigos — a IA usa esses códigos no JSON de resposta
// IMPORTANTE: Use APENAS os códigos abaixo. Eles existem no banco com foto_url.
// Projeto real: gftnjvdzgjkhwxnxnwl. NUNCA inventar códigos.
const CATALOGO_IA = `
ENEMEOP FLORES — Ipiranga, SP, desde 1997. Seg–Sáb 9h–19h | Dom/Feriados 10h–14h.
Entrega até 3h após pagamento. São Paulo e Grande SP.

PRODUTOS (use o CÓDIGO exato no campo codigos_produtos):
RAMALHETES / MINI:
  095 Ramalhete Rosa+Girassol R$145 | 096 6 Rosas+Ferrero Rocher R$185

BUQUÊS:
  032 Buquê Rosas Vermelhas R$140 | 033 12 Rosas Vermelhas R$280 | 034 24 Rosas Vermelhas R$560
  045 Romance em Flor (12 Rosas Rosa+Alstroemêrias) R$370 | 046 12 Rosas Rosa Nacionais+Alstroemêrias R$370
  047 Buquê Mix de Flores R$745 | 052 12 Girassóis Premium R$435 | 054 Mix Girassóis+Flores do Campo R$295
  056 100 Rosas Vermelhas R$1490 | 061 Buquê Luxuoso Alstroemêrias Coloridas R$395
  067 Buquê de Tulipas R$790 | 093 Buquê Lírios Rosa R$395 | 039 Buquê Mix Flores Nobre R$590

ARRANJOS:
  M01 Arranjo Vaso Vidro R$70 | M09 Girassol Solitário R$75 | 002 2 Rosas+Junco R$105
  010 Girassol+Ferrero R$120 | 011 Girassol no Vaso R$135 | 003 Coração 2 Rosas+Ferrero R$140
  M08 Mix Flores do Campo R$145 | M20 Arranjo Laranja R$145 | 027 Alstroemêrias no Vaso R$155
  M07 Arranjo de Rosas R$160 | 006 4 Rosas Brancas+Alstroemêrias R$225 | M05 Rosas Pink no Vaso R$225
  004 Buquê Rosas no Vaso de Vidro R$295

ORQUÍDEAS:
  083 Orquídea Branca 1 haste R$170 | 091 Orquídea Pink 1 haste R$225
  012 Orquídeas Brancas Frente Única R$225 | 013 Orquídeas Pink Vaso R$225
  014 Orquídeas Brancas+Ruscus R$225 | 094O Orquídeas Brancas Vaso Barro R$225
  087 Mini Orquídea Vaso de Vidro R$215 | 084 Phalaenópsis Branca 2 hastes R$290
  085 Phalaenópsis Pink R$300 | 088 Phalaenópsis Pink no Vaso R$315
  086 Phalaenópsis Cascata Branca R$390 | 094B Tulipas Brancas Noiva R$720

FORMAS DE PAGAMENTO: Cartão, PIX, online.
PERSONALIZAÇÃO: encomendas sob medida disponíveis.
`.trim();

// ── Memória de conversa ───────────────────────────────────────────────────────

async function buscarOuCriarConversa(canalId: string): Promise<Conversa> {
  const db = getDb();
  const { data } = await db.from('conversas').select('*').eq('canal_id', canalId).eq('canal', 'whatsapp').single();
  if (data) return data as Conversa;
  const { data: nova } = await db.from('conversas')
    .insert({ canal_id: canalId, canal: 'whatsapp', workspace_id: WORKSPACE_ID })
    .select('*').single();
  return nova as Conversa;
}

async function salvarConversa(id: string, updates: Partial<Conversa>): Promise<void> {
  await getDb().from('conversas').update({ ...updates, atualizado_em: new Date().toISOString() }).eq('id', id);
}

// ── Busca fotos no banco ──────────────────────────────────────────────────────

async function buscarProdutos(codigos: string[]): Promise<Produto[]> {
  if (!codigos || codigos.length === 0) return [];
  const { data } = await getDb()
    .from('catalogo_produtos')
    .select('codigo, nome, preco, foto_url')
    .in('codigo', codigos)
    .eq('ativo', true)
    .not('foto_url', 'is', null);
  return (data ?? []) as Produto[];
}

// ── IA ────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(fase: string, pedidoInfo: Record<string, unknown> | null, nomeCliente: string | null, ultimaMsgTs?: string): string {
  const freteInfo = pedidoInfo?.frete as Record<string, unknown> | null | undefined;
  const freteDisponivel = freteInfo?.disponivel === true;
  const fretePreco = freteDisponivel ? (freteInfo?.preco_cliente as number) : null;
  const produtoPreco = pedidoInfo?.produto_preco as number | null | undefined;
  const totalPedido = fretePreco && produtoPreco ? (produtoPreco + fretePreco) : null;
  const agora = Date.now();
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const minutosSilencio = ultimaMsgTs
    ? Math.floor((agora - new Date(ultimaMsgTs).getTime()) / 60000)
    : null;
  const primeiroContato = fase === 'descoberta' && !ultimaMsgTs;
  const voltouDepoisDeTempo = minutosSilencio !== null && minutosSilencio > 360; // +6h

  return `Você é Flor, atendente da Enemeop Flores — floricultura em São Paulo desde 1997.
Você atende pelo WhatsApp como se fosse uma pessoa real, simpática e atenciosa.
${nomeCliente ? `O cliente se chama ${nomeCliente}. Trate-o pelo primeiro nome sempre que soar natural.` : ''}

REGRAS DE OURO:
- Seja breve. Máximo 2 frases por mensagem. Nunca escreva parágrafos longos.
- Uma pergunta por vez. Nunca faça duas perguntas na mesma mensagem.
- Tom natural, como um atendente humano simpático. Nada de robótico.
- ZERO emojis. Nenhum. Em nenhuma mensagem. Jamais.
- Nunca mencione ligação, nunca diga que é IA.
- Se o cliente pedir atendente humano: "Claro! Em breve alguém da nossa equipe entra em contato por aqui."
- Sempre que souber o nome do cliente, use-o na mensagem quando soar natural.

SAUDAÇÃO — REGRA ABSOLUTA:
${primeiroContato
  ? `É o primeiro contato. OBRIGATÓRIO: comece com "${saudacao}, ${nomeCliente ?? '[nome]'}!" e pergunte como pode ajudar.${!nomeCliente ? ' Se não souber o nome, cumprimente sem ele e pergunte o nome na sequência.' : ''}`
  : voltouDepoisDeTempo
  ? `O cliente ficou ${Math.floor(minutosSilencio! / 60)}h sem responder. Comece com uma saudação breve e retome de onde parou.`
  : `PROIBIDO começar com "Bom dia", "Boa tarde", "Boa noite" ou qualquer saudação. A conversa está em andamento — continue de onde parou sem cumprimentos.`
}

FLUXO NATURAL (siga esta ordem, avance sempre que possível):
1. PRIMEIRO CONTATO: cumprimente com "${saudacao}" + nome se souber, pergunte como pode ajudar
2. OCASIÃO: descubra para quem é e a ocasião (aniversário, namoro, luto, decoração...)
3. PRODUTO: sugira até 3 opções adequadas com nome e preço. Aguarde o cliente escolher.
4. UPSELL: após o cliente escolher as flores, ofereça os complementos disponíveis:
   - Ferrero Rocher 100g (código: ferrero100) R$45
   - Ferrero Rocher 50g (código: ferrero50) R$25
   - Pelúcia Urso Pequeno (código: pelucia_urso_p) R$35
   - Pelúcia Urso Grande (código: pelucia_urso_g) R$65
   Inclua os códigos dos itens citados em "codigos_produtos" para as fotos aparecerem.
   Diga algo como: "Quer adicionar um Ferrero Rocher ou uma pelúcia para deixar ainda mais especial?"
   Aguarde a resposta — cliente pode recusar, e tudo bem.
5. ENDEREÇO: envie o formulário com "enviar_formulario": true nos seguintes casos — SEM EXCEÇÃO, OBRIGATÓRIO:
   - Cliente confirmar o produto (disse "quero esse", "pode ser", "gostei", "esse mesmo", "fechado", etc.)
   - Cliente perguntar QUALQUER COISA sobre entrega, frete, prazo ou valor ("qual o frete?", "quanto custa?", "qual o valor da entrega?", "e qual o valor?", "como é a entrega?", "qual o prazo?")
   REGRA ABSOLUTA: quando o cliente perguntar sobre entrega ou valor de entrega, a resposta NUNCA é texto explicativo — é SEMPRE o formulário com "enviar_formulario": true.
   NÃO responda "nossa entrega é X". Envie o formulário imediatamente.
   NÃO invente preços. Use SEMPRE o preço que está em "PREÇO DO PRODUTO" acima.
6. FRETE: após receber endereço preenchido, o sistema calcula automaticamente — apresente o total
7. PAGAMENTO: pergunte a forma preferida (PIX, cartão crédito ou débito)
8. FECHAMENTO: confirme tudo e informe que o pedido foi registrado

ESTADO ATUAL DA CONVERSA:
- Fase: ${fase}
${pedidoInfo?.produto_confirmado ? `- PRODUTO CONFIRMADO: código ${pedidoInfo.produto_confirmado}` : ''}
${pedidoInfo?.produto_preco ? `- PREÇO DO PRODUTO: R$ ${Number(pedidoInfo.produto_preco).toFixed(2).replace('.', ',')} — USE SEMPRE ESTE VALOR, NUNCA INVENTE OUTRO` : ''}
${freteDisponivel && fretePreco ? `- FRETE COTADO: R$ ${fretePreco.toFixed(2).replace('.', ',')} (carro, hoje ~2h)` : ''}
${totalPedido ? `- TOTAL (produto + frete): R$ ${totalPedido.toFixed(2).replace('.', ',')}` : ''}
${pedidoInfo && Object.keys(pedidoInfo).length > 0 ? `- Contexto completo: ${JSON.stringify(pedidoInfo)}` : '- Nenhum pedido em andamento ainda'}

${CATALOGO_IA}

FOTOS — REGRAS ABSOLUTAS:
- Ao sugerir opções ou perguntar o que o cliente busca: codigos_produtos deve ser [] (vazio). NÃO envie fotos antes do cliente escolher.
- Quando o cliente CONFIRMAR ou ESCOLHER um produto específico ("quero esse", "pode ser o 033", "esse mesmo"): coloque o código escolhido em codigos_produtos (1 código apenas).
- Quando o cliente pedir foto explicitamente ("manda uma foto", "tem foto?", "como é?", "me mostra"): coloque o código do produto sendo discutido em codigos_produtos. NUNCA diga que não pode mandar foto.
- Quando enviar_formulario for true: codigos_produtos DEVE ser [] — nunca mande foto junto com o formulário.
- Após o cliente confirmar dados de endereço ou frete: codigos_produtos deve ser [] — nessa fase a foto já foi enviada.

ENDEREÇO — FORMULÁRIO E CONFIRMAÇÃO:
- Quando for pedir o endereço, diga algo natural como "Claro! Preciso de alguns dados para calcular o frete." e inclua "enviar_formulario": true no JSON. O sistema envia o formulário automaticamente.
- Quando o cliente responder com os dados de endereço (texto livre ou formulário preenchido): EXTRAIA os campos. NUNCA envie o formulário novamente ("enviar_formulario" deve ser false). Se CEP ou Rua estiver faltando, peça só o campo que faltou.
- Com todos os dados extraídos: inclua "confirmar_dados": true e preencha "dados_para_confirmacao". O sistema envia o resumo — você NÃO precisa digitar o resumo, apenas diga "Confere?" ou "Está tudo certo?".
- Só preencha "endereco_entrega" no JSON APÓS o cliente confirmar os dados ("sim", "correto", "pode ser", "tá certo", etc.). Aí o frete é calculado automaticamente.
${fase === 'coletando_endereco' ? `\nATENÇÃO FASE ATUAL (coletando_endereco): O cliente acabou de enviar os dados de endereço. Extraia os campos e responda com confirmar_dados: true. NÃO envie o formulário de novo (enviar_formulario deve ser false obrigatoriamente).` : ''}

FRETE (após cotação automática):
- Quando o frete estiver em "FRETE JÁ COTADO" acima, apresente ao cliente de forma natural com o total.
- Ex: "O frete ficou R$ X,XX — o total fica R$ Y,YY. Posso confirmar o pedido?"

PAGAMENTO:
- Quando cliente confirmar o total: pergunte a forma (PIX, cartão crédito ou débito).
- Inclua "solicitar_pagamento": true e "forma_pagamento" no JSON.

FORMATO DE RESPOSTA — JSON válido, sempre:
{
  "mensagem": "texto curto e natural para o cliente",
  "codigos_produtos": [],
  "fase": "descoberta|interesse|proposta|confirmar_produto|coletando_endereco|confirmando_dados|confirmar_frete|aguardando_pagamento|concluido|perdido",
  "enviar_formulario": false,
  "confirmar_dados": false,
  "dados_para_confirmacao": {
    "remetente": "",
    "destinatario": "",
    "rua": "",
    "complemento": "",
    "bairro": "",
    "cep": "",
    "mensagem_cartao": ""
  },
  "endereco_entrega": { "cep": "", "logradouro": "", "numero": "", "complemento": "", "bairro": "", "cidade": "São Paulo", "uf": "SP" },
  "produto_confirmado": "",
  "produto_preco": 0,
  "solicitar_pagamento": false,
  "forma_pagamento": ""
}
Omita campos vazios ou irrelevantes.
Quando o cliente preencher o formulário: extraia os campos em "dados_para_confirmacao" e inclua "confirmar_dados": true.
Só preencha "endereco_entrega" após o cliente confirmar os dados.
codigos_produtos: sugerindo → até 3 códigos | confirmado → 1 código | sem produto → [].
Use EXATAMENTE os códigos do catálogo (ex: "033", "M07", "032", "095").`;
}

async function chamarGroq(groqKey: string, systemPrompt: string, mensagens: Array<{role: string; content: string}>, maxTokens: number, modelo = 'llama-3.3-70b-versatile'): Promise<string | null> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    body: JSON.stringify({
      model: modelo,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: systemPrompt }, ...mensagens],
    }),
  });
  if (res.ok) return ((await res.json()).choices?.[0]?.message?.content as string)?.trim() ?? null;
  const errText = await res.text();
  if (res.status === 429) throw new Error('rate_limit');
  console.error(`[ia] Groq ${modelo} status ${res.status}:`, errText.slice(0, 200));
  return null;
}

async function chamarIA(systemPrompt: string, mensagens: Array<{role: string; content: string}>, maxTokens = 400): Promise<string | null> {
  const groqKey = Deno.env.get('GROQ_API_KEY') || await buscarConfigDB('GROQ_API_KEY');

  if (groqKey) {
    // Tentativa 1: modelo principal (70b — melhor qualidade)
    try {
      const r = await chamarGroq(groqKey, systemPrompt, mensagens, maxTokens, 'llama-3.3-70b-versatile');
      if (r) return r;
    } catch (e) {
      if (String(e).includes('rate_limit')) {
        console.warn('[ia] Groq rate limit — aguardando 4s e tentando novamente...');
        await new Promise(r => setTimeout(r, 4000));
        // Tentativa 2: retry no 70b após espera
        try {
          const r = await chamarGroq(groqKey, systemPrompt, mensagens, maxTokens, 'llama-3.3-70b-versatile');
          if (r) return r;
        } catch {
          // Tentativa 3: fallback para modelo menor se 70b ainda travado
          try {
            const r = await chamarGroq(groqKey, systemPrompt, mensagens, maxTokens, 'llama-3.1-8b-instant');
            if (r) return r;
          } catch { /* segue para Anthropic */ }
        }
      }
    }
  }

  // Fallback final: Anthropic Claude Haiku
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') || await buscarConfigDB('ANTHROPIC_API_KEY');
  if (anthropicKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens,
          system: systemPrompt + '\nRetorne APENAS o JSON, sem texto adicional.',
          messages: mensagens,
        }),
      });
      if (res.ok) return ((await res.json()).content?.[0]?.text as string)?.trim() ?? null;
    } catch {}
  }

  return null;
}

// ── Resumo de confirmação de dados ────────────────────────────────────────────

function montarResumoConfirmacao(dados: Record<string, string>): string {
  const linhas = [
    '*Verifique se as informações estão corretas:*',
    '',
    `*Remetente:* ${dados.remetente || '-'}`,
    `*Destinatário:* ${dados.destinatario || '-'}`,
    `*Rua:* ${dados.rua || '-'}`,
    dados.complemento ? `*Complemento:* ${dados.complemento}` : null,
    `*Bairro:* ${dados.bairro || '-'}`,
    `*CEP:* ${dados.cep || '-'}`,
    dados.mensagem_cartao ? `*Mensagem no cartão:* ${dados.mensagem_cartao}` : null,
  ].filter(Boolean);
  return linhas.join('\n');
}

// ── Formulário de entrega ─────────────────────────────────────────────────────

const FORMULARIO_ENTREGA = `📋 *Dados para entrega*

*Remetente:*
*Destinatário:*
*Rua:*
*Complemento:*
*Bairro:*
*CEP:*

Quer que enviemos um cartão impresso com uma mensagem personalizada? Se sim, deixe a sua mensagem aqui 💌
*Mensagem para o cartão:*`;

// ── Transcrição de áudio (Groq Whisper) ──────────────────────────────────────

async function transcreverAudio(audioUrl: string): Promise<string | null> {
  const groqKey = Deno.env.get('GROQ_API_KEY') || await buscarConfigDB('GROQ_API_KEY');
  if (!groqKey) return null;

  try {
    // Baixa o áudio da URL do Z-API
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
      console.error('[audio] Groq Whisper status:', res.status, await res.text().catch(() => ''));
      return null;
    }

    const transcricao = (await res.text()).trim();
    console.log(`[audio] transcrito: "${transcricao.slice(0, 80)}"`);
    return transcricao || null;
  } catch (e) {
    console.error('[audio] erro na transcrição:', e);
    return null;
  }
}

// ── Normalização de telefone ──────────────────────────────────────────────────

function normalizarTelefone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // Já tem código do país 55 e tem 12-13 dígitos → correto
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  // Número brasileiro sem código do país (10-11 dígitos) → adiciona 55
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}

// ── Envio Z-API ───────────────────────────────────────────────────────────────

async function enviarTexto(phone: string, message: string): Promise<void> {
  await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT },
    body: JSON.stringify({ phone, message }),
  }).catch(e => console.error('[zapi] falha texto:', e));
}

async function enviarImagem(phone: string, imageUrl: string, caption: string): Promise<void> {
  await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT },
    body: JSON.stringify({ phone, image: imageUrl, caption }),
  }).catch(e => console.error('[zapi] falha imagem:', e));
}

// ── Processar mensagem ────────────────────────────────────────────────────────

interface EnderecoEntrega {
  cep: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
}

interface DadosFormulario {
  remetente: string;
  destinatario: string;
  rua: string;
  complemento: string;
  bairro: string;
  cep: string;
  mensagem_cartao: string;
}

async function extrairDadosEndereco(groqKey: string, texto: string): Promise<DadosFormulario | null> {
  const prompt = `Extraia os dados de entrega do texto abaixo e retorne SOMENTE um JSON válido com estes campos:
{
  "remetente": "nome de quem envia",
  "destinatario": "nome de quem recebe",
  "rua": "logradouro com número (ex: Rua do Boticário, 105)",
  "complemento": "apto, bloco, casa etc (vazio se não informado)",
  "bairro": "bairro",
  "cep": "CEP formatado (apenas dígitos ou com hífen)",
  "mensagem_cartao": "mensagem para o cartão (vazio se não informado)"
}
Se algum campo não estiver no texto, deixe como string vazia "".
Texto: "${texto.replace(/"/g, "'")}"`

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? '';
    const parsed = JSON.parse(raw) as DadosFormulario;
    // Só retorna se pelo menos CEP ou rua foram extraídos
    if (parsed.cep || parsed.rua) return parsed;
    return null;
  } catch { return null; }
}

async function gerarLinkPagamento(pedidoInfo: Record<string, unknown>, phone: string): Promise<{ link: string; preference_id: string } | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/agente-financeiro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ pedido_info: pedidoInfo, phone, canal_id: phone, workspace_id: WORKSPACE_ID }),
    });
    if (!res.ok) { console.error('[webhook-whatsapp] agente-financeiro status:', res.status); return null; }
    return await res.json() as { link: string; preference_id: string };
  } catch (e) {
    console.error('[webhook-whatsapp] erro ao gerar link pagamento:', e);
    return null;
  }
}

async function cotarFrete(endereco: EnderecoEntrega): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/agente-logistica`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ endereco, workspace_id: WORKSPACE_ID }),
    });
    return await res.json() as Record<string, unknown>;
  } catch (e) {
    console.error('[webhook-whatsapp] erro ao cotar frete:', e);
    return null;
  }
}

async function processarMensagem(phone: string, nomeRemetente: string | null, texto: string): Promise<void> {
  const conversa = await buscarOuCriarConversa(phone);

  // Se conversa estava concluída e cliente voltou → reinicia mantendo o nome
  if (conversa.fase === 'concluido') {
    await getDb().from('conversas').update({
      fase: 'descoberta',
      historico: [],
      pedido_info: null,
      atualizado_em: new Date().toISOString(),
    }).eq('id', conversa.id);
    conversa.fase = 'descoberta';
    conversa.historico = [];
    conversa.pedido_info = null;
    console.log(`[webhook-whatsapp] ${phone} voltou após concluído — reiniciando conversa`);
  }

  const novaMsg: Mensagem = { role: 'user', content: texto, ts: new Date().toISOString() };
  const historico = [...(conversa.historico ?? []), novaMsg].slice(-20);
  const nomeCliente = conversa.nome_cliente ?? nomeRemetente ?? null;
  let pedidoInfo = conversa.pedido_info ?? {};

  const ultimaMsgAnterior = conversa.historico?.slice(-1)[0]?.ts ?? undefined;

  const hora = new Date().getHours();
  const saudacaoFallback = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const nomeFallback = nomeCliente ? `, ${nomeCliente.split(' ')[0]}` : '';
  let mensagem = `${saudacaoFallback}${nomeFallback}! Como posso ajudar?`;
  let codigosProdutos: string[] = [];
  let novaFase = conversa.fase;
  let enderecoEntrega: EnderecoEntrega | null = null;
  let produtoConfirmado: string | null = null;
  let produtoPreco: number | null = null;
  let enviarFormulario = false;
  let dadosParaConfirmar: Record<string, string> | null = null;

  // Palavras que indicam confirmação — nesse caso não roda o extrator
  const textoConfirmacao = /^(sim|ok|s|correto|certo|pode|tá|ta|isso|exato|perfeito|confirmo|confirmado|é isso|e isso|prosseguir|continuar|seguir|pode prosseguir|pode seguir|pode continuar)\b/i.test(texto.trim());

  // Confirmação de endereço → vai direto para cotação de frete sem chamar IA
  // Evita que a IA peça confirmação de novo (double-confirm bug)
  if (textoConfirmacao && conversa.fase === 'confirmando_dados' && pedidoInfo.dados_formulario) {
    const dados = pedidoInfo.dados_formulario as Record<string, string>;
    enderecoEntrega = {
      cep: dados.cep ?? '',
      logradouro: dados.rua ?? '',
      bairro: dados.bairro ?? '',
      cidade: 'São Paulo',
      uf: 'SP',
    };
    novaFase = 'confirmar_frete';
    console.log(`[webhook-whatsapp] ${phone} confirmou endereço → cotando frete CEP ${enderecoEntrega.cep}`);
  }

  // Extração dedicada de endereço — roda ANTES da IA principal quando fase=coletando_endereco
  if (!textoConfirmacao && !enderecoEntrega && (conversa.fase === 'coletando_endereco' || conversa.fase === 'confirmando_dados')) {
    const groqKey = Deno.env.get('GROQ_API_KEY') || await buscarConfigDB('GROQ_API_KEY');
    if (groqKey) {
      const dadosExtraidos = await extrairDadosEndereco(groqKey, texto);
      if (dadosExtraidos) {
        console.log('[webhook-whatsapp] dados de endereço extraídos:', JSON.stringify(dadosExtraidos));
        pedidoInfo = { ...pedidoInfo, dados_formulario: dadosExtraidos };
        dadosParaConfirmar = dadosExtraidos as unknown as Record<string, string>;
        mensagem = 'Confere?';
        novaFase = 'confirmando_dados';

        const msgAssistente2: Mensagem = { role: 'assistant', content: mensagem, ts: new Date().toISOString() };
        await enviarTexto(phone, mensagem);
        await new Promise(r => setTimeout(r, 600));
        await enviarTexto(phone, montarResumoConfirmacao(dadosParaConfirmar));

        await salvarConversa(conversa.id, {
          historico: [...historico, msgAssistente2].slice(-20),
          fase: novaFase,
          nome_cliente: nomeCliente ?? undefined,
          pedido_info: pedidoInfo,
        });
        return;
      }
    }
  }

  // Pula IA principal quando endereço já foi confirmado deterministicamente
  const respostaRaw = enderecoEntrega ? null : await chamarIA(
    buildSystemPrompt(conversa.fase, pedidoInfo, nomeCliente, ultimaMsgAnterior),
    historico.map(m => ({ role: m.role, content: m.content })),
    500,
  );

  if (respostaRaw) {
    try {
      const parsed = JSON.parse(respostaRaw.replace(/```json\n?|\n?```/g, '').trim());
      mensagem          = parsed.mensagem ?? mensagem;
      codigosProdutos   = Array.isArray(parsed.codigos_produtos) ? parsed.codigos_produtos.slice(0, 3) : [];
      novaFase          = parsed.fase ?? conversa.fase;
      produtoConfirmado = parsed.produto_confirmado ?? null;
      produtoPreco      = parsed.produto_preco ? Number(parsed.produto_preco) : null;
      enviarFormulario  = parsed.enviar_formulario === true;

      // Dados do formulário preenchido pelo cliente
      if (parsed.confirmar_dados === true && parsed.dados_para_confirmacao) {
        const dados = parsed.dados_para_confirmacao as Record<string, string>;
        pedidoInfo = { ...pedidoInfo, dados_formulario: dados };
        dadosParaConfirmar = dados;
      }

      if (parsed.endereco_entrega?.cep) {
        enderecoEntrega = parsed.endereco_entrega as EnderecoEntrega;
      }

      if (produtoConfirmado) pedidoInfo = { ...pedidoInfo, produto_confirmado: produtoConfirmado };
      if (produtoPreco)      pedidoInfo = { ...pedidoInfo, produto_preco: produtoPreco };
      if (parsed.forma_pagamento) pedidoInfo = { ...pedidoInfo, forma_pagamento: parsed.forma_pagamento };
      if (parsed.solicitar_pagamento === true) pedidoInfo = { ...pedidoInfo, solicitar_pagamento: true };
    } catch {
      mensagem = respostaRaw.slice(0, 400);
    }
  }

  // Se a IA coletou endereço completo, aciona agente de logística
  if (enderecoEntrega && !pedidoInfo.frete) {
    console.log(`[webhook-whatsapp] cotando frete para CEP ${enderecoEntrega.cep}`);
    pedidoInfo = { ...pedidoInfo, endereco_entrega: enderecoEntrega };

    const resultadoFrete = await cotarFrete(enderecoEntrega);
    if (resultadoFrete) {
      pedidoInfo = { ...pedidoInfo, frete: resultadoFrete };

      if (resultadoFrete.disponivel) {
        const precoFrete = resultadoFrete.preco_cliente as number;
        const precoTotal = (pedidoInfo.produto_preco as number | undefined ?? 0) + precoFrete;
        pedidoInfo = { ...pedidoInfo, total: precoTotal };

        // Injeta info de frete na conversa para a IA apresentar ao cliente
        const msgFrete = `[Sistema] Frete cotado: R$ ${precoFrete.toFixed(2).replace('.', ',')} (Lalamove, carro, hoje ~2h). Total do pedido: R$ ${precoTotal.toFixed(2).replace('.', ',')}.`;
        const histComFrete = [...historico, { role: 'assistant' as const, content: mensagem, ts: new Date().toISOString() }, { role: 'user' as const, content: msgFrete, ts: new Date().toISOString() }].slice(-20);

        const respostaFreteRaw = await chamarIA(
          buildSystemPrompt('confirmar_frete', pedidoInfo, nomeCliente, ultimaMsgAnterior),
          histComFrete.map(m => ({ role: m.role, content: m.content })),
          300,
        );

        if (respostaFreteRaw) {
          try {
            const parsedFrete = JSON.parse(respostaFreteRaw.replace(/```json\n?|\n?```/g, '').trim());
            mensagem  = parsedFrete.mensagem ?? mensagem;
            novaFase  = parsedFrete.fase ?? 'confirmar_frete';
          } catch { /* mantém mensagem anterior */ }
        }
      } else {
        mensagem = `Não consegui calcular o frete para esse endereço. Pode confirmar o CEP? ${resultadoFrete.erro ? `(${resultadoFrete.erro})` : ''}`;
        novaFase = 'coletando_endereco';
      }
    }
  }

  // Gera link de pagamento quando forma de pagamento foi definida e total existe
  const deveGerarPagamento = pedidoInfo.solicitar_pagamento === true
    && pedidoInfo.forma_pagamento
    && pedidoInfo.total
    && !pedidoInfo.preference_id; // não gera novamente se já existe

  if (deveGerarPagamento) {
    console.log(`[webhook-whatsapp] gerando link MP para ${phone} | forma: ${pedidoInfo.forma_pagamento}`);
    const resultadoPag = await gerarLinkPagamento(pedidoInfo, phone);
    if (resultadoPag?.link) {
      pedidoInfo = { ...pedidoInfo, preference_id: resultadoPag.preference_id, link_pagamento: resultadoPag.link };
      novaFase = 'aguardando_pagamento';
      mensagem = `Aqui esta o seu link de pagamento: ${resultadoPag.link}\n\nAssim que o pagamento for confirmado, avisamos por aqui.`;
    } else {
      mensagem = 'Tive um problema ao gerar o link de pagamento. Pode tentar novamente em instantes?';
    }
  }

  const msgAssistente: Mensagem = { role: 'assistant', content: mensagem, ts: new Date().toISOString() };

  // Fotos só são enviadas quando o cliente escolheu/confirmou um produto ou pediu foto explicitamente.
  // Nunca junto com formulário, confirmação de dados ou frete.
  const podeEnviarFotos = !enviarFormulario && !dadosParaConfirmar && !enderecoEntrega;
  const produtos = podeEnviarFotos ? await buscarProdutos(codigosProdutos) : [];

  await enviarTexto(phone, mensagem);
  if (enviarFormulario) {
    await new Promise(r => setTimeout(r, 800));
    await enviarTexto(phone, FORMULARIO_ENTREGA);
  }
  if (dadosParaConfirmar && Object.keys(dadosParaConfirmar).some(k => dadosParaConfirmar![k])) {
    await new Promise(r => setTimeout(r, 600));
    await enviarTexto(phone, montarResumoConfirmacao(dadosParaConfirmar));
  }
  for (const produto of produtos) {
    if (produto.foto_url) {
      await new Promise(r => setTimeout(r, 400));
      const caption = `${produto.nome} — R$ ${Number(produto.preco).toFixed(2).replace('.', ',')}`;
      await enviarImagem(phone, produto.foto_url, caption);
    }
  }

  await Promise.all([
    salvarConversa(conversa.id, {
      historico: [...historico, msgAssistente].slice(-20),
      fase: novaFase,
      nome_cliente: nomeCliente ?? undefined,
      pedido_info: pedidoInfo,
    }),
    fetch(`${SUPABASE_URL}/functions/v1/captacao-leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        tipo: 'mensagem-recebida', task_id: crypto.randomUUID(), escopo: 'producao',
        urgencia: 'normal', workspace_id: WORKSPACE_ID,
        payload: { canal: 'whatsapp', canal_id: phone, telefone: phone, nome: nomeCliente, mensagem: texto },
      }),
    }).catch(() => {}),
  ]);

  console.log(`[webhook-whatsapp] ${phone} | ${conversa.fase}->${novaFase} | fotos: ${produtos.length} | frete: ${pedidoInfo.frete ? 'sim' : 'não'} | ${mensagem.slice(0, 60)}`);
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'GET') return new Response('webhook-whatsapp ok', { status: 200 });
  if (req.method !== 'POST') return new Response('ok', { status: 200 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return new Response('ok', { status: 200 }); }

  if (body['fromMe'] === true) return new Response('ok', { status: 200 });

  const phoneRaw      = String(body['phone'] ?? '');
  const nomeRemetente = (body['senderName'] ?? body['chatName'] ?? null) as string | null;

  if (!phoneRaw) return new Response('ok', { status: 200 });

  // Extrai texto — mensagem de texto normal
  let texto: string = (body['text'] as Record<string, string> | null)?.['message']
    ?? (body['message'] as string | null)
    ?? '';

  // Detecta mensagem de áudio (Z-API envia campo "audio" com "audioUrl")
  const audioPayload = body['audio'] as Record<string, string> | null;
  const audioUrl = audioPayload?.['audioUrl'] ?? audioPayload?.['url'] ?? null;

  if (!texto && audioUrl) {
    console.log(`[webhook-whatsapp] áudio recebido de ${phoneRaw}, transcrevendo...`);
    const phone = normalizarTelefone(phoneRaw);
    EdgeRuntime.waitUntil((async () => {
      const transcricao = await transcreverAudio(audioUrl);
      if (transcricao) {
        await processarMensagem(phone, nomeRemetente, transcricao);
      } else {
        await enviarTexto(phone, 'Desculpe, não consegui ouvir seu áudio. Pode escrever sua mensagem?');
      }
    })());
    return new Response('ok', { status: 200 });
  }

  if (!texto) return new Response('ok', { status: 200 });

  const phone = normalizarTelefone(phoneRaw);
  console.log(`[webhook-whatsapp] texto de ${phoneRaw} → normalizado: ${phone}`);

  EdgeRuntime.waitUntil(processarMensagem(phone, nomeRemetente, texto));

  return new Response('ok', { status: 200 });
});
