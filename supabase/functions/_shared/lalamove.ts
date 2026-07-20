/**
 * lalamove.ts — Cotação de frete via Lalamove API v3.
 *
 * Credenciais (workspace_credentials, tipo='logistica', com fallback pra
 * env vars — ver transportadoras.ts):
 *   lalamove_key    — API Key
 *   lalamove_secret — API Secret (para assinatura HMAC-SHA256)
 *
 * Configuração de ambiente (Edge Function secrets, nunca inferida):
 *   LALAMOVE_ENVIRONMENT — 'sandbox' ou 'production', exatamente.
 *   LALAMOVE_MARKET      — código do mercado (ex.: 'BR'), nunca fixado aqui.
 *
 * Só chama POST /v3/quotations — nunca POST /v3/orders (nenhuma corrida é
 * criada por este arquivo). Criação real de entrega vive em lalamove-orders.ts,
 * chamada só depois de pagamento aprovado e reconciliado (ver Parte H).
 */

import type { DadosFrete, OpcaoFrete, OpcoesExtras } from './transportadoras.ts';
import {
  resolverAmbiente, resolverBaseUrl, resolverMarket, montarStringAssinatura,
  validarPreco, servicoDisponivel, mascarar, type LalamoveAmbiente,
} from './lalamove-config.ts';

const MOEDA_ESPERADA = 'BRL';
const TIMEOUT_CIDADES_MS = 5_000;
const TIMEOUT_COTACAO_MS = 7_000;

// Cache em memória (por isolate quente) da lista de serviços disponíveis —
// evita pagar uma chamada extra a /v3/cities em toda cotação. TTL curto o
// bastante pra não carregar config desatualizada por muito tempo.
let cacheServicos: { ambiente: LalamoveAmbiente; market: string; servicos: { key: string }[]; expiraEm: number } | null = null;
const TTL_CACHE_SERVICOS_MS = 15 * 60_000;

export interface ConfigResolvida {
  ambiente: LalamoveAmbiente;
  baseUrl: string;
  market: string;
}

/** Lê e valida LALAMOVE_ENVIRONMENT/LALAMOVE_MARKET — usada por qualquer chamada autenticada à Lalamove (cotação e, em lalamove-orders.ts, criação real da entrega). */
export function resolverConfig(): ConfigResolvida {
  const ambiente = resolverAmbiente(Deno.env.get('LALAMOVE_ENVIRONMENT'));
  const market = resolverMarket(Deno.env.get('LALAMOVE_MARKET'));
  return { ambiente, baseUrl: resolverBaseUrl(ambiente), market };
}

async function gerarAssinatura(
  apiSecret: string,
  method: string,
  pathComQuery: string,
  body: string,
  timestamp: string,
): Promise<string> {
  const rawSignature = montarStringAssinatura(timestamp, method, pathComQuery, body);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(rawSignature));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function chamarLalamove(
  config: ConfigResolvida,
  apiKey: string,
  apiSecret: string,
  method: string,
  path: string,
  bodyObj: unknown,
  timeoutMs: number,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; erroSanitizado: string }> {
  const timestamp = String(Date.now());
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
  const signature = await gerarAssinatura(apiSecret, method, path, bodyStr, timestamp);
  const requestId = crypto.randomUUID();

  let resp: Response;
  try {
    resp = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `hmac ${apiKey}:${timestamp}:${signature}`,
        'Market': config.market,
        'Request-ID': requestId,
      },
      body: bodyStr || undefined,
      // Nunca trava silenciosamente esperando a Lalamove — sem timeout, uma
      // chamada pendurada deixava o cliente esperando indefinidamente.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const motivo = e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'falha_rede';
    return { ok: false, status: 0, erroSanitizado: motivo };
  }

  if (!resp.ok) {
    // Nunca loga corpo bruto (pode conter dados do request ecoados) além do
    // necessário pra diagnosticar — status + um trecho curto do corpo de erro.
    const err = await resp.text().catch(() => '');
    const trecho = err.slice(0, 200).replace(/[\r\n]+/g, ' ');
    return { ok: false, status: resp.status, erroSanitizado: `HTTP ${resp.status}${trecho ? `: ${trecho}` : ''}` };
  }

  const data = await resp.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: true, data };
}

/** Consulta GET /v3/cities pra descobrir quais serviceTypes existem de verdade pro mercado configurado — nunca assume MOTORCYCLE/CAR sem confirmação. Cache curto por isolate; se a chamada falhar, devolve null (chamador decide o fallback). */
async function buscarServicosDisponiveis(
  config: ConfigResolvida,
  apiKey: string,
  apiSecret: string,
): Promise<{ key: string }[] | null> {
  const agora = Date.now();
  if (cacheServicos && cacheServicos.ambiente === config.ambiente && cacheServicos.market === config.market && cacheServicos.expiraEm > agora) {
    return cacheServicos.servicos;
  }

  const resultado = await chamarLalamove(config, apiKey, apiSecret, 'GET', '/v3/cities', null, TIMEOUT_CIDADES_MS);
  if (!resultado.ok) {
    console.warn(`[lalamove] falha ao consultar /v3/cities (${resultado.erroSanitizado}) — seguindo com fallback conservador`);
    return null;
  }

  const cidades = (resultado.data['data'] as Array<{ services?: { key: string }[] }> | undefined) ?? [];
  const servicos = cidades.flatMap((c) => c.services ?? []);
  cacheServicos = { ambiente: config.ambiente, market: config.market, servicos, expiraEm: agora + TTL_CACHE_SERVICOS_MS };
  return servicos;
}

export interface CotacaoLalamove {
  quotationId: string;
  serviceType: string;
  transportadora: 'Lalamove';
  servico: string;
  preco: number;
  moeda: string;
  expiresAt: string | null;
  stops: Array<{ stopId: string; lat: string; lng: string; address: string }>;
  distanciaMetros: number | null;
  ambiente: LalamoveAmbiente;
  mercado: string;
  prazo_dias: number;
}

const ROTULO_SERVICO: Record<string, string> = { MOTORCYCLE: 'Moto', CAR: 'Carro' };

async function cotarServico(
  config: ConfigResolvida,
  apiKey: string,
  apiSecret: string,
  serviceType: string,
  stops: Array<{ coordinates: { lat: string; lng: string }; address: string }>,
  item: Record<string, unknown> | undefined,
): Promise<{ ok: true; cotacao: CotacaoLalamove } | { ok: false; erroSanitizado: string }> {
  const bodyObj = { data: { serviceType, language: 'pt_BR', stops, ...(item ? { item } : {}) } };
  const resultado = await chamarLalamove(config, apiKey, apiSecret, 'POST', '/v3/quotations', bodyObj, TIMEOUT_COTACAO_MS);
  if (!resultado.ok) return { ok: false, erroSanitizado: `${serviceType} ${resultado.erroSanitizado}` };

  const data = resultado.data['data'] as {
    quotationId?: string;
    expiresAt?: string;
    stops?: Array<{ stopId: string; coordinates: { lat: string; lng: string }; address: string }>;
    priceBreakdown?: { total: string; currency: string };
    distance?: { value: string; unit: string };
  } | undefined;

  if (!data?.quotationId || !data.priceBreakdown) {
    return { ok: false, erroSanitizado: `${serviceType} resposta sem quotationId/priceBreakdown` };
  }

  const preco = parseFloat(data.priceBreakdown.total);
  const moeda = data.priceBreakdown.currency;
  const validacao = validarPreco(preco, moeda, MOEDA_ESPERADA);
  if (!validacao.valido) {
    return { ok: false, erroSanitizado: `${serviceType} preco invalido (${validacao.motivo})` };
  }

  return {
    ok: true,
    cotacao: {
      quotationId: data.quotationId,
      serviceType,
      transportadora: 'Lalamove',
      servico: ROTULO_SERVICO[serviceType] ?? serviceType,
      preco,
      moeda,
      expiresAt: data.expiresAt ?? null,
      stops: (data.stops ?? []).map((s) => ({ stopId: s.stopId, lat: s.coordinates.lat, lng: s.coordinates.lng, address: s.address })),
      distanciaMetros: data.distance ? Number(data.distance.value) : null,
      ambiente: config.ambiente,
      mercado: config.market,
      prazo_dias: 0,
    },
  };
}

export async function calcularFreteLalamove(
  apiKey: string,
  apiSecret: string,
  dados: DadosFrete,
  opcoes?: OpcoesExtras,
): Promise<OpcaoFrete[]> {
  if (!apiKey || !apiSecret) return [];

  let config: ConfigResolvida;
  try {
    config = resolverConfig();
  } catch (e) {
    console.error(`[lalamove] configuracao invalida: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }

  const origemLat = opcoes?.lat_origem ?? Deno.env.get('STORE_LATITUDE') ?? '';
  const origemLng = opcoes?.lng_origem ?? Deno.env.get('STORE_LONGITUDE') ?? '';
  const origemEndereco = opcoes?.endereco_origem ?? Deno.env.get('STORE_ADDRESS') ?? '';

  if (!origemLat || !origemLng || !opcoes?.lat_destino || !opcoes?.lng_destino) {
    console.error('[lalamove] coordenadas de origem ou destino ausentes — cotacao nao solicitada');
    return [];
  }

  const stops = [
    { coordinates: { lat: origemLat, lng: origemLng }, address: origemEndereco },
    { coordinates: { lat: opcoes.lat_destino, lng: opcoes.lng_destino }, address: opcoes.endereco_destino ?? dados.cep_destino },
  ];

  // Enums de item (weight/categories/handlingInstructions) variam por
  // mercado. A resposta de /v3/cities não documenta esses enums por item
  // pro Brasil (só serviceTypes), então não há como comprová-los pela API.
  // Mantém os valores já usados em produção — comprovados por uma cotação
  // real bem-sucedida (R$30,47, 2026-07-20) para o mesmo mercado — em vez de
  // omitir `item` e arriscar regressão numa integração que já funciona.
  // Continua sinalizado como não-verificado contra metadados oficiais
  // (ver relatório da tarefa, ressalva pendente).
  const item = { quantity: '1', weight: 'LESS_THAN_3KG', categories: ['FLOWER'], handlingInstructions: ['FRAGILE'] };

  const servicosDisponiveis = await buscarServicosDisponiveis(config, apiKey, apiSecret);
  const candidatos = servicosDisponiveis
    ? ['MOTORCYCLE', 'CAR'].filter((s) => servicoDisponivel(servicosDisponiveis, s))
    : ['MOTORCYCLE', 'CAR']; // /v3/cities indisponível — fallback conservador com o comportamento anterior, log já emitido acima

  if (servicosDisponiveis && candidatos.length === 0) {
    console.error(`[lalamove] nenhum serviceType disponivel para o mercado ${config.market} segundo /v3/cities`);
    return [];
  }

  let ultimaCotacao: CotacaoLalamove | null = null;
  for (const serviceType of candidatos) {
    const resultado = await cotarServico(config, apiKey, apiSecret, serviceType, stops, item);
    if (resultado.ok) {
      ultimaCotacao = resultado.cotacao;
      console.log(`[lalamove] ${serviceType}: R$ ${resultado.cotacao.preco} quotationId=${mascarar(resultado.cotacao.quotationId)} ambiente=${config.ambiente}`);
      break;
    }
    // Log sanitizado do motivo — nunca a chave/secret/assinatura/Authorization.
    console.warn(`[lalamove] ${resultado.erroSanitizado}`);
  }

  if (!ultimaCotacao) return [];

  return [{
    transportadora: 'Lalamove',
    servico: ultimaCotacao.servico,
    preco: ultimaCotacao.preco,
    prazo_dias: 0,
    quotationId: ultimaCotacao.quotationId,
    moeda: ultimaCotacao.moeda,
    expiresAt: ultimaCotacao.expiresAt,
    distanciaMetros: ultimaCotacao.distanciaMetros,
    ambiente: ultimaCotacao.ambiente,
    mercado: ultimaCotacao.mercado,
    stops: ultimaCotacao.stops,
  }];
}
