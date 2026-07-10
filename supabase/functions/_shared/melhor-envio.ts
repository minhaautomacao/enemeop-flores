/**
 * melhor-envio.ts — Cálculo de frete via Melhor Envio API v2
 *
 * Credenciais (workspace_credentials, tipo='logistica'):
 *   melhor_envio_token — Bearer token OAuth2
 *   cep_origem         — CEP do remetente
 */

import type { DadosFrete, OpcaoFrete } from './transportadoras.ts';

export async function calcularFreteMelhorEnvio(
  token: string,
  cepOrigem: string,
  dados: DadosFrete,
): Promise<OpcaoFrete[]> {
  const resp = await fetch('https://www.melhorenvio.com.br/api/v2/me/shipment/calculate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Fabrica de SaaS (minhaautomacao10@gmail.com)',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      from: { postal_code: cepOrigem.replace(/\D/g, '') },
      to:   { postal_code: dados.cep_destino.replace(/\D/g, '') },
      products: [{
        id: 'produto',
        width:    dados.largura_cm,
        height:   dados.altura_cm,
        length:   dados.comprimento_cm,
        weight:   dados.peso_kg,
        insurance_value: dados.valor_declarado,
        quantity: 1,
      }],
    }),
  });

  if (!resp.ok) throw new Error(`Melhor Envio HTTP ${resp.status}`);

  const data = await resp.json() as Array<{
    name: string; company: { name: string }; price: string; delivery_time: number; error?: string;
  }>;

  return data
    .filter((t) => !t.error && t.price)
    .map((t) => ({
      transportadora: 'Melhor Envio',
      servico: t.name,
      preco: parseFloat(t.price),
      prazo_dias: t.delivery_time,
    }));
}
