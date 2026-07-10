/**
 * cielo.ts — Geração de Link de Pagamento via Cielo SuperLink API
 *
 * Credenciais necessárias (workspace_credentials, tipo='cielo'):
 *   client_id     — ClientId fornecido pela Cielo (suporte: 4002-5472)
 *   client_secret — ClientSecret fornecido pela Cielo
 *   ec            — Número do estabelecimento (2897449769)
 *
 * Documentação: https://developercielo.github.io/manual/linkdepagamentos5
 */

import { buscarCredencial } from './credentials.ts';

const TOKEN_URL  = 'https://cieloecommerce.cielo.com.br/api/public/v2/token';
const LINK_URL   = 'https://cieloecommerce.cielo.com.br/api/public/v1/products/';

export interface ItemLink {
  nome: string;
  valor: number;       // em centavos
  quantidade?: number;
}

export interface LinkPagamentoOpcoes {
  numeroPedido: string;
  item: ItemLink;
  parcelasMax?: number;
  expiracaoDias?: number;
  softDescriptor?: string;
}

export interface ResultadoCielo {
  criado: boolean;
  linkPagamento?: string;
  shortLink?: string;
  linkId?: string;
  erro?: string;
}

async function obterToken(clientId: string, clientSecret: string): Promise<string> {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.status.toString());
    throw new Error(`Token Cielo: HTTP ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return data.access_token as string;
}

/**
 * Gera um link de pagamento Cielo com Pix + Crédito + Débito disponíveis.
 * workspaceId é usado para buscar as credenciais criptografadas no banco.
 */
export async function gerarLinkPagamento(
  workspaceId: string | undefined,
  opcoes: LinkPagamentoOpcoes,
): Promise<ResultadoCielo> {
  const [clientId, clientSecret] = await Promise.all([
    buscarCredencial(workspaceId, 'cielo', 'client_id'),
    buscarCredencial(workspaceId, 'cielo', 'client_secret'),
  ]);

  if (!clientId || !clientSecret) {
    return {
      criado: false,
      erro: 'Credenciais Cielo não configuradas. Adicione client_id e client_secret no painel.',
    };
  }

  try {
    const token = await obterToken(clientId, clientSecret);

    const expiracao = new Date();
    expiracao.setDate(expiracao.getDate() + (opcoes.expiracaoDias ?? 1));
    const expiracaoStr = expiracao.toISOString().split('T')[0] + ' 23:59';

    const payload = {
      OrderNumber: opcoes.numeroPedido,
      SoftDescriptor: opcoes.softDescriptor ?? 'Enemeop Flores',
      Cart: {
        Discount: { Type: 'Percent', Value: 0 },
        Items: [
          {
            Name: opcoes.item.nome,
            Description: opcoes.item.nome,
            UnitPrice: opcoes.item.valor,
            Quantity: opcoes.item.quantidade ?? 1,
            Type: 'Asset',
          },
        ],
      },
      Payment: {
        BoletoOptions: {},
        MaxNumberOfInstallments: opcoes.parcelasMax ?? 3,
        ExpirationDate: expiracaoStr,
      },
    };

    const resp = await fetch(LINK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => resp.status.toString());
      return { criado: false, erro: `HTTP ${resp.status}: ${err}` };
    }

    const data = await resp.json();
    return {
      criado: true,
      linkId: data.id,
      linkPagamento: data.url,
      shortLink: data.shortUrl ?? data.url,
    };
  } catch (e) {
    return { criado: false, erro: String(e) };
  }
}
