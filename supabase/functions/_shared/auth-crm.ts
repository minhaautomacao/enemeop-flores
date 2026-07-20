// Validação de acesso às Edge Functions do CRM interno (leads-enemeop,
// conversas-enemeop) via header "Authorization: Bearer <FACTORY_SECRET>".
// Comparação em tempo constante via digest SHA-256 (Web Crypto nativo do
// runtime) — nunca compara nem loga o segredo em texto puro.
//
// autorizacaoValida() é pura (sem Deno.env, sem I/O) — separada só pra ser
// testável com node:test/tsx, mesmo padrão de catalogo-woocommerce-filtro.ts
// e mercadopago-assinatura.ts.

async function sha256Hex(valor: string): Promise<string> {
  const bytes = new TextEncoder().encode(valor);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function comparacaoSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function autorizacaoValida(
  authHeader: string | null | undefined,
  factorySecret: string | null | undefined,
): Promise<boolean> {
  if (!factorySecret) return false;

  const match = /^Bearer\s+(.+)$/.exec(authHeader ?? '');
  if (!match) return false;

  const [recebidoHash, esperadoHash] = await Promise.all([
    sha256Hex(match[1]),
    sha256Hex(factorySecret),
  ]);
  return comparacaoSegura(recebidoHash, esperadoHash);
}

export async function factorySecretValido(req: Request): Promise<boolean> {
  return autorizacaoValida(req.headers.get('Authorization'), Deno.env.get('FACTORY_SECRET'));
}
