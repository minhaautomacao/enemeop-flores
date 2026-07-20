/**
 * agente-logistica — Cotação de frete para entregas da Enemeop Flores
 *
 * Fluxo:
 *   1. Recebe endereço de entrega do webhook-whatsapp/webhook-meta
 *   2. Resolve o CEP num endereço oficial via ViaCEP, geocodifica via
 *      Nominatim (OpenStreetMap) e checa divergência grave entre CEP/cidade
 *   3. Consulta Lalamove (moto/carro, conforme disponibilidade real do
 *      mercado) — ponto de coleta fixo: Enemeop, Ipiranga, SP
 *   4. Adiciona markup de R$15
 *   5. Retorna melhor opção (com dados completos da cotação, pra persistência)
 *
 * Chamada só internamente (webhook-meta/webhook-whatsapp) — publicada com
 * --no-verify-jwt porque não roda sob autenticação de usuário Supabase, mas
 * exige "Authorization: Bearer <FACTORY_SECRET>" (ver _shared/auth-crm.ts).
 */

import { consultarFretes } from '../_shared/transportadoras.ts';
import { factorySecretValido } from '../_shared/auth-crm.ts';

const WORKSPACE_ID = Deno.env.get('SAAS_WORKSPACE_ID') ?? Deno.env.get('WORKSPACE_NAME') ?? '';

// CEP de coleta da loja — configurável por workspace (ver .env.example)
const CEP_ORIGEM = Deno.env.get('STORE_CEP') ?? '';

const TIMEOUT_VIACEP_MS = 5_000;

interface EnderecoEntrega {
  cep: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
}

interface EnderecoOficialViaCep {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

/** Resolve o CEP num endereço oficial via ViaCEP — nunca confia só no que o cliente digitou pra bairro/cidade quando o CEP diverge. */
async function resolverCep(cep: string): Promise<EnderecoOficialViaCep | null> {
  const cepLimpo = cep.replace(/\D/g, '');
  if (cepLimpo.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`, {
      signal: AbortSignal.timeout(TIMEOUT_VIACEP_MS),
    });
    if (!res.ok) return null;
    const data = await res.json() as EnderecoOficialViaCep;
    if (data.erro) return null;
    return data;
  } catch {
    return null;
  }
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/** Divergência grave: cliente informou uma cidade e o CEP resolve pra outra cidade completamente diferente — nunca cota/entrega num endereço que não bate com o CEP informado. */
function divergenciaGrave(informado: EnderecoEntrega, oficial: EnderecoOficialViaCep): boolean {
  if (!informado.cidade || !oficial.localidade) return false;
  return normalizar(informado.cidade) !== normalizar(oficial.localidade);
}

interface RespostaLogistica {
  disponivel: boolean;
  preco_real?: number;
  preco_cliente?: number;    // com markup R$15
  transportadora?: string;
  servico?: string;
  tempo_estimado?: string;   // ex: "hoje, ~2h"
  mensagem_cliente?: string; // texto pronto para a Flor apresentar
  erro?: string;
  // Dados completos da cotação real, para persistência no pedido (Parte E) —
  // nunca expostos ao cliente final, só usados internamente.
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

async function geocodificarEndereco(
  endereco: EnderecoEntrega,
): Promise<{ lat: string; lng: string } | null> {
  const partes = [
    endereco.logradouro && endereco.numero
      ? `${endereco.logradouro} ${endereco.numero}`
      : endereco.logradouro,
    endereco.bairro,
    endereco.cidade ?? 'São Paulo',
    'Brasil',
  ].filter(Boolean).join(', ');

  const tentativas = [
    // 1. Endereço completo
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(partes)}`,
    // 2. Só o CEP
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&postalcode=${endereco.cep.replace(/\D/g, '')}&country=BR`,
  ];

  for (const url of tentativas) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'EnemeOpFlores/1.0 (minhaautomacao10@gmail.com)' },
        signal: AbortSignal.timeout(8_000),
      });
      const data = await res.json() as Array<{ lat: string; lon: string }>;
      if (data?.[0]?.lat) {
        return { lat: data[0].lat, lng: data[0].lon };
      }
    } catch { /* tenta próxima */ }
  }

  return null;
}

function formatarEnderecoCompleto(e: EnderecoEntrega): string {
  return [e.logradouro, e.numero, e.bairro, e.cidade ?? 'São Paulo', e.uf ?? 'SP']
    .filter(Boolean).join(', ');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ erro: 'método não suportado' }), { status: 405 });
  }

  // Publicada com --no-verify-jwt (não roda sob autenticação de usuário
  // Supabase) — exige o segredo interno do orquestrador. Nunca revela no
  // corpo/log se o motivo foi header ausente ou segredo errado.
  if (!(await factorySecretValido(req))) {
    return new Response(JSON.stringify({ erro: 'não autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: { endereco: EnderecoEntrega; workspace_id?: string };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ disponivel: false, erro: 'payload inválido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { endereco } = payload;
  const workspaceId = payload.workspace_id ?? WORKSPACE_ID;

  if (!endereco?.cep) {
    const resposta: RespostaLogistica = {
      disponivel: false,
      erro: 'CEP não informado',
    };
    return new Response(JSON.stringify(resposta), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Resolve o CEP num endereço oficial (ViaCEP) antes de geocodificar —
  // nunca confia só no que o cliente digitou pra bairro/cidade quando há um
  // CEP conhecido (Parte C.2). Endereço geocodificado usa sempre o
  // logradouro/bairro/cidade oficiais quando disponíveis.
  const oficial = await resolverCep(endereco.cep);
  if (oficial && divergenciaGrave(endereco, oficial)) {
    console.warn(`[agente-logistica] divergencia grave: cidade informada difere da cidade do CEP (cep=${endereco.cep})`);
    const resposta: RespostaLogistica = {
      disponivel: false,
      erro: 'A cidade informada não confere com o CEP. Pode confirmar o CEP correto?',
    };
    return new Response(JSON.stringify(resposta), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const enderecoResolvido: EnderecoEntrega = oficial
    ? {
        ...endereco,
        logradouro: endereco.logradouro || oficial.logradouro,
        bairro: endereco.bairro || oficial.bairro,
        cidade: endereco.cidade || oficial.localidade,
        uf: endereco.uf || oficial.uf,
      }
    : endereco;

  // Geocodifica destino
  const coords = await geocodificarEndereco(enderecoResolvido);
  if (!coords) {
    const resposta: RespostaLogistica = {
      disponivel: false,
      erro: 'Não foi possível localizar o endereço de entrega. Verifique o CEP.',
    };
    return new Response(JSON.stringify(resposta), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const enderecoCompleto = formatarEnderecoCompleto(enderecoResolvido);
  const origemEndereco = Deno.env.get('STORE_ADDRESS') ?? '';
  const origemLat = Deno.env.get('STORE_LATITUDE') ?? '';
  const origemLng = Deno.env.get('STORE_LONGITUDE') ?? '';

  try {
    const resultado = await consultarFretes(
      workspaceId,
      {
        cep_origem: CEP_ORIGEM,
        cep_destino: endereco.cep,
        peso_kg: 1.5,
        valor_declarado: 200,
        largura_cm: 30,
        altura_cm: 40,
        comprimento_cm: 30,
      },
      {
        lat_destino: coords.lat,
        lng_destino: coords.lng,
        endereco_destino: enderecoCompleto,
      },
    );

    if (!resultado.melhor_opcao) {
      const erros = Object.values(resultado.erros).join('; ');
      const resposta: RespostaLogistica = {
        disponivel: false,
        erro: erros || 'Nenhuma transportadora disponível para este endereço',
      };
      return new Response(JSON.stringify(resposta), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const opcao = resultado.melhor_opcao;
    const precoFormatado = opcao.preco_cliente.toFixed(2).replace('.', ',');

    const resposta: RespostaLogistica = {
      disponivel: true,
      preco_real: opcao.preco,
      preco_cliente: opcao.preco_cliente,
      transportadora: opcao.transportadora,
      servico: opcao.servico,
      tempo_estimado: 'hoje, ~2h',
      mensagem_cliente: `Frete para ${endereco.bairro ?? endereco.cidade ?? 'o seu endereço'}: R$ ${precoFormatado} (entrega hoje, ~2h via ${opcao.transportadora}).`,
      cotacao: {
        quotationId: opcao.quotationId,
        moeda: opcao.moeda,
        expiresAt: opcao.expiresAt ?? null,
        ambiente: opcao.ambiente,
        mercado: opcao.mercado,
        cotado_em: new Date().toISOString(),
        origem: { lat: origemLat, lng: origemLng, endereco: origemEndereco },
        destino: { lat: coords.lat, lng: coords.lng, endereco: enderecoCompleto, cep: endereco.cep },
        stopIdOrigem: opcao.stops?.[0]?.stopId,
        stopIdDestino: opcao.stops?.[1]?.stopId,
      },
    };

    console.log(`[agente-logistica] ${enderecoCompleto} → R$ ${opcao.preco_real} + R$15 = R$ ${opcao.preco_cliente}`);

    return new Response(JSON.stringify(resposta), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[agente-logistica] erro:', e);
    const resposta: RespostaLogistica = {
      disponivel: false,
      erro: String(e),
    };
    return new Response(JSON.stringify(resposta), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
