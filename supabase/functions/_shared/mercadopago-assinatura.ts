/**
 * mercadopago-assinatura.ts — núcleo puro da validação de assinatura do
 * webhook do Mercado Pago (sem I/O: sem DB, sem fetch, sem Deno.env).
 *
 * Separado de mercadopago.ts só pra ser testável com node:test/tsx sem
 * arrastar a cadeia credentials.ts -> supabase.ts, que importa
 * 'npm:@supabase/supabase-js' (specifier só resolvível em Deno).
 *
 * Algoritmo: HMAC-SHA256 em hex sobre o manifesto
 * "id:{dataId};request-id:{requestId};ts:{ts};" (dataId sempre em
 * minúsculas) — ver documentação oficial do Mercado Pago (Your
 * integrations → Webhooks → Configurar notificações → chave secreta).
 */

export async function validarAssinaturaComSegredo(
  secret: string,
  xSignature: string | null,
  xRequestId: string | null,
  dataId: string,
): Promise<'valida' | 'invalida'> {
  if (!xSignature || !xRequestId || !dataId) return 'invalida';

  const partes: Record<string, string> = {};
  for (const par of xSignature.split(',')) {
    const [chave, valor] = par.split('=').map(s => s.trim());
    if (chave && valor) partes[chave] = valor;
  }
  const ts = partes['ts'];
  const v1 = partes['v1'];
  if (!ts || !v1) return 'invalida';

  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
    const hex = Array.from(new Uint8Array(signed)).map(b => b.toString(16).padStart(2, '0')).join('');
    return hex === v1 ? 'valida' : 'invalida';
  } catch {
    return 'invalida';
  }
}
