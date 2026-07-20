/**
 * agente-logistica — Cotação de frete para entregas da Enemeop Flores
 *
 * Fluxo:
 *   1. Recebe endereço de entrega do webhook-whatsapp
 *   2. Geocodifica destino via Nominatim (OpenStreetMap)
 *   3. Consulta Lalamove (CAR) — ponto de coleta fixo: Enemeop, Ipiranga, SP
 *   4. Adiciona markup de R$15
 *   5. Retorna melhor opção formatada para o webhook-whatsapp apresentar ao cliente
 */

import { consultarFretes } from '../_shared/transportadoras.ts';

const WORKSPACE_ID = Deno.env.get('SAAS_WORKSPACE_ID') ?? Deno.env.get('WORKSPACE_NAME') ?? '';

// CEP de coleta da loja — configurável por workspace (ver .env.example)
const CEP_ORIGEM = Deno.env.get('STORE_CEP') ?? '';

interface EnderecoEntrega {
  cep: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
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

  // Geocodifica destino
  const coords = await geocodificarEndereco(endereco);
  if (!coords) {
    const resposta: RespostaLogistica = {
      disponivel: false,
      erro: 'Não foi possível localizar o endereço de entrega. Verifique o CEP.',
    };
    return new Response(JSON.stringify(resposta), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const enderecoCompleto = formatarEnderecoCompleto(endereco);

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
