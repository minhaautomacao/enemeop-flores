/**
 * lalamove.ts — Cotação de frete via Lalamove API v3
 *
 * Credenciais (workspace_credentials, tipo='logistica'):
 *   lalamove_key    — API Key
 *   lalamove_secret — API Secret (para assinatura HMAC-SHA256)
 */

import type { DadosFrete, OpcaoFrete, OpcoesExtras } from './transportadoras.ts';

const BASE_URL = 'https://rest.lalamove.com';

// Ponto de coleta padrão da loja — configurável por workspace (ver .env.example)
const ORIGEM_LAT = Deno.env.get('STORE_LATITUDE') ?? '';
const ORIGEM_LNG = Deno.env.get('STORE_LONGITUDE') ?? '';
const ORIGEM_ENDERECO = Deno.env.get('STORE_ADDRESS') ?? '';

async function gerarAssinatura(
  apiKey: string,
  apiSecret: string,
  method: string,
  path: string,
  body: string,
  timestamp: string,
): Promise<string> {
  const rawSignature = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`;
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

async function cotarServico(
  apiKey: string,
  apiSecret: string,
  serviceType: string,
  stops: Array<{ coordinates: { lat: string; lng: string }; address: string }>,
  item: Record<string, unknown>,
): Promise<number> {
  const path = '/v3/quotations';
  const timestamp = String(Date.now());

  const bodyObj = { data: { serviceType, language: 'pt_BR', stops, item } };
  const bodyStr = JSON.stringify(bodyObj);
  const signature = await gerarAssinatura(apiKey, apiSecret, 'POST', path, bodyStr, timestamp);

  const resp = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `hmac ${apiKey}:${timestamp}:${signature}`,
      'Market': 'BR',
    },
    body: bodyStr,
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.status.toString());
    throw new Error(`Lalamove ${serviceType} HTTP ${resp.status}: ${err}`);
  }

  const data = await resp.json() as {
    data?: { priceBreakdown?: { total: string } };
  };
  return parseFloat(data.data?.priceBreakdown?.total ?? '0');
}

export async function calcularFreteLalamove(
  apiKey: string,
  apiSecret: string,
  dados: DadosFrete,
  opcoes?: OpcoesExtras,
): Promise<OpcaoFrete[]> {
  const stops = [
    {
      coordinates: {
        lat: opcoes?.lat_origem ?? ORIGEM_LAT,
        lng: opcoes?.lng_origem ?? ORIGEM_LNG,
      },
      address: opcoes?.endereco_origem ?? ORIGEM_ENDERECO,
    },
    {
      coordinates: {
        lat: opcoes?.lat_destino ?? '',
        lng: opcoes?.lng_destino ?? '',
      },
      address: opcoes?.endereco_destino ?? dados.cep_destino,
    },
  ];

  if (!stops[1].coordinates.lat) {
    throw new Error('Lalamove: coordenadas do destino não fornecidas');
  }

  const item = {
    quantity: '1',
    weight: 'LESS_THAN_3KG',
    categories: ['FLOWER'],
    handlingInstructions: ['FRAGILE'],
  };

  // Tenta moto primeiro (mais barato e rápido para flores em SP)
  // Se moto falhar, usa carro como fallback
  let preco = 0;
  let servico = 'Moto';

  try {
    preco = await cotarServico(apiKey, apiSecret, 'MOTORCYCLE', stops, item);
    console.log(`[lalamove] MOTORCYCLE: R$ ${preco}`);
  } catch (e) {
    console.warn(`[lalamove] MOTORCYCLE falhou (${e}), tentando CAR`);
  }

  if (!preco) {
    try {
      preco = await cotarServico(apiKey, apiSecret, 'CAR', stops, item);
      servico = 'Carro';
      console.log(`[lalamove] CAR: R$ ${preco}`);
    } catch (e) {
      console.error(`[lalamove] CAR também falhou: ${e}`);
    }
  }

  if (!preco) return [];

  return [{
    transportadora: 'Lalamove',
    servico,
    preco,
    prazo_dias: 0,
  }];
}
