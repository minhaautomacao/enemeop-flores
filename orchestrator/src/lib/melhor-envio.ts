const BASE_URL = process.env.MELHOR_ENVIO_SANDBOX === 'true'
  ? 'https://sandbox.melhorenvio.com.br/api/v2'
  : 'https://melhorenvio.com.br/api/v2'

const TOKEN = process.env.MELHOR_ENVIO_TOKEN ?? ''

async function meRequest<T>(method: string, path: string, body?: object): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'fabrica-saas/1.0 (minhaautomacao10@gmail.com)',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`MelhorEnvio ${method} ${path} → ${res.status}: ${err}`)
  }

  return res.json() as Promise<T>
}

export interface MEPacote {
  height: number
  width: number
  length: number
  weight: number
}

export interface MEEndereco {
  postal_code: string
  address?: string
  number?: string
  complement?: string
  district?: string
  city: string
  state_abbr: string
}

export interface MEProduto {
  id: string
  width: number
  height: number
  length: number
  weight: number
  insurance_value: number
  quantity: number
}

export interface MEShipmentRequest {
  from: MEEndereco
  to: MEEndereco
  package?: MEPacote
  products?: MEProduto[]
  options?: {
    receipt?: boolean
    own_hand?: boolean
    collect?: boolean
    reverse?: boolean
    non_commercial?: boolean
  }
  services?: string   // ex: "1,2,3" — IDs dos serviços para filtrar
}

export interface MEShipmentOption {
  id: number
  name: string
  company: { id: number; name: string; picture: string }
  currency: string
  delivery_time: number
  delivery_range: { min: number; max: number }
  price: string
  custom_price: string
  discount: string
  currency_symbol: string
  packages: unknown[]
  additional_services?: { receipt: boolean; own_hand: boolean; collect: boolean }
  error?: string
}

export async function calcularFrete(req: MEShipmentRequest): Promise<MEShipmentOption[]> {
  return meRequest<MEShipmentOption[]>('POST', '/me/shipment/calculate', req)
}

// Carrinho de compras (necessário antes de gerar etiqueta)
export interface MECarrinhoItem {
  from: MEEndereco & { name: string; email?: string; document?: string; phone?: string }
  to: MEEndereco & { name: string; email?: string; document?: string; phone?: string }
  service: number
  products: MEProduto[]
  volumes: MEPacote[]
  options?: {
    insurance_value?: number
    receipt?: boolean
    own_hand?: boolean
    collect?: boolean
    reverse?: boolean
    non_commercial?: boolean
    invoice?: { key: string }
    platform?: string
    tags?: { tag: string; url: string | null }[]
  }
}

export interface MECarrinhoResposta {
  id: string
  protocol: string
  service_id: number
  price: string
  // demais campos retornados pela API
}

export async function adicionarAoCarrinho(item: MECarrinhoItem): Promise<MECarrinhoResposta> {
  return meRequest<MECarrinhoResposta>('POST', '/me/cart', item)
}

export async function comprarEtiqueta(orderIds: string[]): Promise<unknown> {
  return meRequest('POST', '/me/shipment/checkout', { orders: orderIds })
}

export async function gerarEtiqueta(orderIds: string[]): Promise<unknown> {
  return meRequest('POST', '/me/shipment/generate', { orders: orderIds })
}

export async function imprimirEtiqueta(
  orderIds: string[],
  mode: 'public' | 'private' = 'public',
): Promise<{ url: string }> {
  return meRequest<{ url: string }>('POST', '/me/shipment/print', { mode, orders: orderIds })
}

export async function rastrearEnvio(orderIds: string[]): Promise<unknown> {
  return meRequest('POST', '/me/shipment/tracking', { orders: orderIds })
}
