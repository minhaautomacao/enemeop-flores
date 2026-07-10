/**
 * cielo.ts (Node/orchestrator) — Geração de Link de Pagamento via Cielo
 * SuperLink API.
 *
 * Réplica mínima e deliberada de supabase/functions/_shared/cielo.ts para o
 * runtime Node do orchestrator. Não importa aquele arquivo porque ele lê
 * credenciais de supabase/functions/_shared/credentials.ts (tabela
 * workspace_credentials criptografada, específica do Supabase/Deno) — aqui
 * as credenciais vêm de variáveis de ambiente do próprio serviço Render.
 * Ver relatório final: decisão de duplicação documentada, não uma tentativa
 * de reimplementar a integração do zero.
 *
 * Variáveis de ambiente:
 *   CIELO_CLIENT_ID, CIELO_CLIENT_SECRET
 */

const TOKEN_URL = 'https://cieloecommerce.cielo.com.br/api/public/v2/token'
const LINK_URL  = 'https://cieloecommerce.cielo.com.br/api/public/v1/products/'

export interface ItemLinkCielo {
  nome: string
  valorCentavos: number
  quantidade?: number
}

export interface OpcoesLinkCielo {
  numeroPedido: string
  item: ItemLinkCielo
  parcelasMax?: number
  expiracaoDias?: number
}

export interface ResultadoLinkCielo {
  criado: boolean
  link?: string
  linkId?: string
  erro?: string
}

async function obterToken(clientId: string, clientSecret: string): Promise<string> {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  })
  if (!resp.ok) {
    const err = await resp.text().catch(() => String(resp.status))
    throw new Error(`Token Cielo: HTTP ${resp.status}: ${err}`)
  }
  const data = await resp.json() as { access_token: string }
  return data.access_token
}

/** Gera um link de pagamento Cielo (Pix + Crédito + Débito). Nunca deve ser
 * chamado sem numeroPedido/valor reais — quem chama (funil.ts, via a
 * dependência gerarPagamento) só invoca isto depois do resumo confirmado. */
export async function gerarLinkPagamentoCielo(opcoes: OpcoesLinkCielo): Promise<ResultadoLinkCielo> {
  const clientId     = process.env.CIELO_CLIENT_ID ?? ''
  const clientSecret = process.env.CIELO_CLIENT_SECRET ?? ''

  if (!clientId || !clientSecret) {
    console.error('[Cielo] CIELO_CLIENT_ID/CIELO_CLIENT_SECRET ausentes — link não gerado')
    return { criado: false, erro: 'Credenciais Cielo não configuradas' }
  }

  try {
    const token = await obterToken(clientId, clientSecret)

    const expiracao = new Date()
    expiracao.setDate(expiracao.getDate() + (opcoes.expiracaoDias ?? 1))
    const expiracaoStr = `${expiracao.toISOString().split('T')[0]} 23:59`

    const payload = {
      OrderNumber: opcoes.numeroPedido,
      SoftDescriptor: 'Enemeop Flores',
      Cart: {
        Discount: { Type: 'Percent', Value: 0 },
        Items: [{
          Name: opcoes.item.nome,
          Description: opcoes.item.nome,
          UnitPrice: opcoes.item.valorCentavos,
          Quantity: opcoes.item.quantidade ?? 1,
          Type: 'Asset',
        }],
      },
      Payment: {
        BoletoOptions: {},
        MaxNumberOfInstallments: opcoes.parcelasMax ?? 3,
        ExpirationDate: expiracaoStr,
      },
    }

    const resp = await fetch(LINK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })

    if (!resp.ok) {
      const err = await resp.text().catch(() => String(resp.status))
      return { criado: false, erro: `HTTP ${resp.status}: ${err}` }
    }

    const data = await resp.json() as { id?: string; url?: string; shortUrl?: string }
    return { criado: true, linkId: data.id, link: data.shortUrl ?? data.url }
  } catch (e) {
    return { criado: false, erro: e instanceof Error ? e.message : String(e) }
  }
}
