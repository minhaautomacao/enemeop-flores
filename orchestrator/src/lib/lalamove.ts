import crypto from 'crypto'

const BASE_URL = {
  sandbox: 'https://rest.sandbox.lalamove.com/v3',
  production: 'https://rest.lalamove.com/v3',
}

const env = (process.env.LALAMOVE_ENVIRONMENT as 'sandbox' | 'production') ?? 'sandbox'
const API_KEY = process.env.LALAMOVE_API_KEY ?? ''
const API_SECRET = process.env.LALAMOVE_API_SECRET ?? ''
const MARKET = process.env.LALAMOVE_MARKET ?? 'BR'

function sign(method: string, path: string, body: string, timestamp: string): string {
  const message = `${timestamp}\r\n${method.toUpperCase()}\r\n${path}\r\n\r\n${body}`
  return crypto.createHmac('sha256', API_SECRET).update(message).digest('hex')
}

function authHeaders(method: string, path: string, body = ''): Record<string, string> {
  const timestamp = Date.now().toString()
  const signature = sign(method, path, body, timestamp)
  const token = `${API_KEY}:${timestamp}:${signature}`
  return {
    Authorization: `hmac ${token}`,
    Market: MARKET,
    'Request-ID': crypto.randomUUID(),
    'Content-Type': 'application/json',
  }
}

async function lalamoveRequest<T>(
  method: string,
  path: string,
  body?: object,
): Promise<T> {
  const bodyStr = body ? JSON.stringify(body) : ''
  const headers = authHeaders(method, path, bodyStr)
  const url = BASE_URL[env] + path

  const res = await fetch(url, {
    method,
    headers,
    body: bodyStr || undefined,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Lalamove ${method} ${path} → ${res.status}: ${err}`)
  }

  return res.json() as Promise<T>
}

// ── Cotação ────────────────────────────────────────────────────────

export interface LalamoveStop {
  coordinates: { lat: string; lng: string }
  address: string
}

export interface LalamoveQuotationRequest {
  serviceType: string
  stops: LalamoveStop[]
  item?: { quantity: string; weight: string; categories: string[] }
}

export async function getQuotation(req: LalamoveQuotationRequest) {
  return lalamoveRequest('POST', '/v3/quotations', req)
}

// ── Pedido ─────────────────────────────────────────────────────────

export interface LalamoveOrderRequest {
  quotationId: string
  sender: { stopId: string; name: string; phone: string }
  recipients: { stopId: string; name: string; phone: string; remarks?: string }[]
}

export async function placeOrder(req: LalamoveOrderRequest) {
  return lalamoveRequest('POST', '/v3/orders', req)
}

export async function getOrder(orderId: string) {
  return lalamoveRequest('GET', `/v3/orders/${orderId}`)
}

export async function cancelOrder(orderId: string) {
  return lalamoveRequest('DELETE', `/v3/orders/${orderId}`)
}
