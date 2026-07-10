/**
 * logistica — Cotação de frete multi-transportadora com markup
 *
 * Lógica de seleção:
 *   - Consulta todas as transportadoras configuradas
 *   - Prefere entrega no mesmo dia (prazo = 0)
 *   - Seleciona a de menor preço dentro do prazo preferido
 *   - Acrescenta R$15 no preço antes de passar ao cliente
 *
 * Payload esperado:
 *   cep_destino / endereco_destino / lat_destino / lng_destino
 *   lat_origem / lng_origem / endereco_origem
 *   telefone — para notificação WhatsApp
 */

import { callClaude } from '../_shared/anthropic.ts';
import { logEvento } from '../_shared/logger.ts';
import { enviarWhatsApp } from '../_shared/whatsapp.ts';
import { consultarFretes, MARKUP_FRETE_REAIS } from '../_shared/transportadoras.ts';
import type { OrquestradorPayload } from '../_shared/types.ts';

const SYSTEM_PROMPT = `Você é o agente de Logística da floricultura Enemeop Flores.
Analise as opções de frete e retorne JSON:
{
  "acao": "calcular_frete"|"agendar_coleta"|"redirecionar_entrega"|"contatar_transportadora"|"nenhuma",
  "transportadora_escolhida": string|null,
  "servico_escolhido": string|null,
  "preco_frete_real": number|null,
  "preco_frete_cliente": number|null,
  "prazo_estimado_dias": number|null,
  "mensagem_cliente": "mensagem WhatsApp (máx 300 chars) com preço ao cliente ou null",
  "notificar_cliente": boolean,
  "instrucoes_operador": "instruções internas",
  "acoes": ["ações executadas"]
}
IMPORTANTE: Use sempre preco_frete_cliente (preço real + R$${MARKUP_FRETE_REAIS} de taxa de serviço) na mensagem ao cliente.
Para entrega no mesmo dia em ${Deno.env.get('STORE_CITY') ?? 'cidade da loja'}, priorize a transportadora com melhor prazo same-day disponível.
Seja cordial e mencione a previsão de entrega (ex: "hoje até as 18h").`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  const inicio = Date.now();
  let body: OrquestradorPayload;
  try { body = await req.json(); } catch { return new Response('JSON inválido', { status: 400 }); }

  const { task_id, escopo, urgencia, payload, workspace_id } = body;
  const acoes: string[] = [];

  try {
    const cepDestino = payload.cep_destino as string | undefined;
    let fretes = null;

    if (cepDestino || payload.endereco_destino || payload.lat_destino) {
      const dadosFrete = {
        cep_origem:     (payload.cep_origem as string | undefined) ?? '',
        cep_destino:    cepDestino ?? '',
        peso_kg:        Number(payload.peso_kg        ?? 0.5),
        valor_declarado: Number(payload.valor_declarado ?? 50),
        largura_cm:     Number(payload.largura_cm     ?? 15),
        altura_cm:      Number(payload.altura_cm      ?? 10),
        comprimento_cm: Number(payload.comprimento_cm ?? 20),
      };

      const lalamoveOpts = {
        lat_origem:       payload.lat_origem       as string | undefined,
        lng_origem:       payload.lng_origem       as string | undefined,
        lat_destino:      payload.lat_destino      as string | undefined,
        lng_destino:      payload.lng_destino      as string | undefined,
        endereco_origem:  payload.endereco_origem  as string | undefined,
        endereco_destino: payload.endereco_destino as string | undefined,
      };

      fretes = await consultarFretes(workspace_id, dadosFrete, lalamoveOpts);

      if (fretes.transportadoras_consultadas.length > 0) {
        acoes.push(`Consultadas: ${fretes.transportadoras_consultadas.join(', ')} — ${fretes.opcoes.length} opção(ões)`);
      }
      if (fretes.melhor_opcao) {
        acoes.push(`Melhor: ${fretes.melhor_opcao.transportadora} R$${fretes.melhor_opcao.preco.toFixed(2)} → cliente R$${fretes.melhor_opcao.preco_cliente.toFixed(2)}`);
      }
      if (Object.keys(fretes.erros).length > 0) {
        acoes.push(`Erros: ${JSON.stringify(fretes.erros)}`);
      }
    }

    const contexto = JSON.stringify({ ...payload, fretes_disponiveis: fretes, markup_reais: MARKUP_FRETE_REAIS }, null, 2);
    const resposta = await callClaude(SYSTEM_PROMPT, `Situação logística:\n${contexto}`);
    const jsonStr = resposta.replace(/```json\n?|\n?```/g, '').trim();
    const resultado = JSON.parse(jsonStr);

    acoes.push(`Análise: ${resultado.acao}`);

    if (resultado.notificar_cliente && resultado.mensagem_cliente) {
      const telefone = payload.telefone as string | undefined;
      const envio = await enviarWhatsApp(workspace_id, telefone, resultado.mensagem_cliente);
      acoes.push(envio.enviado
        ? `Cliente notificado via WhatsApp (${envio.provedor})`
        : `Notificação não enviada: ${envio.erro}`);
    }

    await logEvento({ task_id, escopo, agente: 'logistica', tipo_evento: 'concluido', urgencia, duracao_ms: Date.now() - inicio, workspace_id });

    return new Response(
      JSON.stringify({ sucesso: true, acao: resultado.acao, fretes, melhor_opcao: fretes?.melhor_opcao ?? null, acoes_executadas: acoes }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await logEvento({ task_id, escopo, agente: 'logistica', tipo_evento: 'erro', urgencia, duracao_ms: Date.now() - inicio, erro: msg, workspace_id });
    return new Response(JSON.stringify({ sucesso: false, erro: msg }), { status: 500 });
  }
});
