/**
 * captacao-leads
 *
 * Recebe leads de qualquer canal (WhatsApp, Instagram, Facebook, Site)
 * via orquestrador, classifica com IA e persiste no banco.
 * Extrai dados CRM: nome, telefone, email, endereço, bairro, cidade, CEP.
 */

import { callClaude } from '../_shared/anthropic.ts';
import { getSupabaseAdmin } from '../_shared/supabase.ts';
import { logEvento } from '../_shared/logger.ts';
import type { OrquestradorPayload } from '../_shared/types.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { maiorIntencao, montarAtualizacaoLead } from '../_shared/leads-idempotencia.ts';

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const FACTORY_SECRET = Deno.env.get('FACTORY_SECRET') ?? '';

async function dispararLeadQualificado(params: {
  task_id: string;
  escopo: string;
  workspace_id: string;
  lead_id: string;
  intencao: string;
  canal_id: string | null;
  canal: string;
  payload: unknown;
}): Promise<void> {
  const authKey = FACTORY_SECRET || SERVICE_KEY;
  if (!authKey || !SUPABASE_URL) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/orquestrador`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authKey}` },
      body: JSON.stringify({
        tipo: 'lead-qualificado',
        task_id: crypto.randomUUID(),
        escopo: params.escopo,
        urgencia: params.intencao === 'urgente' ? 'critica' : params.intencao === 'alta' ? 'alta' : 'normal',
        workspace_id: params.workspace_id,
        lead_id: params.lead_id,
        payload: {
          lead_id: params.lead_id,
          intencao: params.intencao,
          canal: params.canal,
          canal_id: params.canal_id,
          tipo_evento: 'abordagem_inicial',
          payload_original: params.payload,
        },
      }),
    });
  } catch (e) {
    console.error(`[captacao-leads] erro ao disparar lead-qualificado: ${e}`);
  }
}

// Identidade idempotente do lead — nunca cria um novo registro para o
// mesmo workspace+canal+canal_id (correção 2026-07-20: cada mensagem do
// mesmo cliente virava um lead novo, pois nenhum chamador passa lead_id;
// 13 leads foram criados numa única conversa de teste). workspace_id não é
// coluna própria da tabela — vive em metadata (jsonb), daí o filtro
// "metadata->>workspace_id".
async function encontrarLeadExistente(
  sb: SupabaseClient,
  workspaceId: string,
  canal: string,
  canalId: string,
): Promise<string | null> {
  const { data } = await sb
    .from('leads')
    .select('id')
    .eq('canal', canal)
    .eq('canal_id', canalId)
    .eq('metadata->>workspace_id', workspaceId)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

const SYSTEM_PROMPT = `Você é o agente de Captação de Leads da floricultura Enemeop Flores.
Analise os dados do lead e retorne APENAS JSON válido (sem markdown):
{
  "intencao": "urgente" | "alta" | "media" | "baixa",
  "status": "novo" | "em_atendimento",
  "nome": "nome completo extraído da mensagem ou null",
  "telefone": "telefone extraído (somente dígitos, ex: 5511999999999) ou null",
  "email": "email extraído ou null",
  "endereco": "endereço completo extraído ou null",
  "bairro": "bairro extraído ou null",
  "cidade": "cidade extraída (padrão: ${Deno.env.get('STORE_CITY') ?? 'cidade da loja'}) ou null",
  "cep": "CEP extraído (somente dígitos) ou null",
  "notas": "observações sobre o lead e pedido em até 200 caracteres",
  "acoes": ["ações recomendadas"]
}

Critérios de intenção:
- urgente: compra para hoje, entrega urgente, precisa agora
- alta: evento especial (casamento, formatura, aniversário, namorados), corporativo
- media: cotação de frete, pergunta de preço, consulta de produto
- baixa: curiosidade, comentário geral, sem intenção de compra clara

Extração de dados CRM:
- Se a mensagem mencionar rua, avenida, número, bairro → extrair endereço completo
- Se mencionar CEP → extrair sem traços ou pontos
- Se o lead vier de WhatsApp e tiver canal_id → esse é o telefone normalizado`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  const inicio = Date.now();
  let body: OrquestradorPayload;
  try { body = await req.json(); } catch { return new Response('JSON inválido', { status: 400 }); }

  const { task_id, escopo, urgencia, payload, workspace_id } = body;
  const sb = getSupabaseAdmin();

  try {
    const contexto = JSON.stringify(payload, null, 2);
    let r: any = {};
    try {
      const resposta = await callClaude(SYSTEM_PROMPT, `Dados do lead:\n${contexto}`);
      const jsonStr = resposta.replace(/```json\n?|\n?```/g, '').trim();
      r = JSON.parse(jsonStr);
    } catch (e) {
      console.warn(`[captacao-leads] IA indisponivel, classificando como desconhecida: ${e}`);
    }

    const intencoesValidas = ['urgente', 'alta', 'media', 'baixa', 'desconhecida'];
    const intencao = intencoesValidas.includes(r.intencao) ? r.intencao : 'desconhecida';

    const statusValidos = ['novo', 'em_atendimento', 'proposta_enviada', 'aguardando_pagamento', 'convertido', 'perdido', 'inativo'];
    // null quando a IA não deu um status confiável — nunca regride um lead
    // existente de volta pra 'novo' só porque uma mensagem seguinte falhou
    // na classificação (ver uso abaixo: só sobrescreve em UPDATE quando presente).
    const statusExtraido: string | null = statusValidos.includes(r.status) ? r.status : null;

    // Telefone: prioridade ao extraído pela IA, fallback no canal_id (WhatsApp) ou payload
    const telefone = r.telefone
      ?? (payload?.canal === 'whatsapp' ? (payload?.canal_id as string | undefined) : undefined)
      ?? (payload?.telefone as string | undefined)
      ?? null;

    const canal = (payload?.canal as string) ?? 'outro';
    const canalId = payload?.canal_id as string | undefined;

    let leadId = payload?.lead_id as string | undefined;
    if (!leadId && canalId) {
      leadId = (await encontrarLeadExistente(sb, workspace_id ?? '', canal, canalId)) ?? undefined;
    }

    if (leadId) {
      const { data: leadAtual } = await sb.from('leads').select('intencao').eq('id', leadId).single();
      const intencaoFinal = maiorIntencao((leadAtual as { intencao?: string } | null)?.intencao, intencao);

      await sb.from('leads').update({
        ...montarAtualizacaoLead({ notas: r.notas, nome: r.nome, telefone, email: r.email, endereco: r.endereco, bairro: r.bairro, cidade: r.cidade, cep: r.cep, status: statusExtraido }, intencaoFinal),
        atualizado_em: new Date().toISOString(),
      }).eq('id', leadId);

      console.log(`[captacao-leads] lead_reutilizado workspace=${workspace_id ?? '(nenhum)'} canal=${canal}`);
    } else {
      const { data: novoLead } = await sb.from('leads').insert({
        canal,
        nome:             r.nome ?? (payload?.nome as string | undefined) ?? null,
        telefone:         telefone,
        email:            r.email ?? (payload?.email as string | undefined) ?? null,
        endereco:         r.endereco ?? null,
        bairro:           r.bairro ?? null,
        cidade:           r.cidade ?? null,
        cep:              r.cep ?? null,
        mensagem_inicial: (payload?.mensagem as string | undefined) ?? null,
        canal_id:         canalId ?? null,
        utm_source:       (payload?.utm_source as string | undefined) ?? canal,
        historico_canal:  (payload?.historico_canal as string | undefined) ?? null,
        notas:            r.notas ?? null,
        intencao,
        status: statusExtraido ?? 'novo',
        metadata:         { task_id, workspace_id, payload_original: payload },
      }).select('id').single();

      leadId = novoLead?.id;
      console.log(`[captacao-leads] lead_criado workspace=${workspace_id ?? '(nenhum)'} canal=${canal}`);
    }

    // Dispara lead-qualificado → orquestrador → whatsapp-sdr (apenas para canais com telefone)
    const canalDoLead = (payload?.canal as string) ?? 'outro';
    if (leadId && canalDoLead !== 'instagram' && canalDoLead !== 'facebook') {
      await dispararLeadQualificado({
        task_id, escopo,
        workspace_id: workspace_id ?? '',
        lead_id: leadId,
        intencao,
        canal_id: (payload?.canal_id as string | undefined) ?? null,
        canal: (payload?.canal as string | undefined) ?? 'outro',
        payload,
      });
    }

    await logEvento({ task_id, escopo, agente: 'captacao-leads', tipo_evento: 'concluido', urgencia, duracao_ms: Date.now() - inicio, workspace_id });

    return new Response(
      JSON.stringify({ sucesso: true, lead_id: leadId, intencao, acoes_executadas: r.acoes ?? [] }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await logEvento({ task_id, escopo, agente: 'captacao-leads', tipo_evento: 'erro', urgencia, duracao_ms: Date.now() - inicio, erro: msg, workspace_id });
    return new Response(JSON.stringify({ sucesso: false, erro: msg }), { status: 500 });
  }
});
