/**
 * catalogo-woocommerce-filtro.ts — regras puras de validade/mapeamento de
 * produto WooCommerce (sem I/O, sem Deno.env). Separado de
 * catalogo-woocommerce.ts só pra ser testável com node:test/tsx sem
 * arrastar a cadeia credentials.ts -> supabase.ts ('npm:@supabase/supabase-js',
 * specifier só resolvível em Deno) — mesmo motivo de mercadopago-assinatura.ts.
 *
 * Identidade do produto (verificado em produtos reais do site — description
 * e short_description NUNCA contêm um código; SKU está sempre vazio):
 *   - código comercial (o que a produção usa pra montar o arranjo) = prefixo
 *     alfanumérico curto no início do NOME, no padrão real do site
 *     ("002 - Arranjo...", "096 - Buque...", "M08 - ..."). Sem esse prefixo,
 *     não há código inequívoco — o produto é sinalizado e excluído (nunca
 *     inventa um código).
 *   - ID do WooCommerce = identificador técnico interno, sempre presente,
 *     usado pra revalidar preço/estoque/nome/foto direto na fonte. Nunca
 *     substitui o código comercial nem é exibido ao cliente.
 */

import type { ProdutoCatalogo } from './funil.ts';

export interface WooProduct {
  id: number;
  name: string;
  sku: string;
  status: string;
  stock_status: string;
  price: string;
  regular_price: string;
  sale_price: string;
  permalink: string;
  images: { src: string }[];
}

export function parsePreco(p: WooProduct): number | undefined {
  const raw = p.sale_price || p.price || p.regular_price;
  const n = parseFloat(String(raw).replace(',', '.'));
  return isNaN(n) || n <= 0 ? undefined : n;
}

/**
 * Código comercial a partir do padrão real do nome ("XXX - Resto do nome").
 * 1 a 6 caracteres alfanuméricos, seguido de " - " e mais texto — nunca um
 * número solto no meio da frase. Retorna null quando o nome não segue esse
 * padrão (produto sem código inequívoco).
 */
export function extrairCodigoDoNome(nome: string): string | null {
  const m = nome.match(/^\s*([A-Za-z0-9]{1,6})\s*-\s+\S/);
  return m ? m[1] : null;
}

/** true quando o produto tem um SKU cadastrado que diverge do código extraído do nome — sinal de cadastro inconsistente. */
export function divergeSkuDoCodigo(p: WooProduct): boolean {
  const sku = p.sku?.trim();
  const doNome = extrairCodigoDoNome(p.name);
  return !!sku && !!doNome && sku.toLowerCase() !== doNome.toLowerCase();
}

/** Produto de teste/rascunho/fora de estoque/sem preço/sem imagem/sem código comercial reconhecível — nunca aparece pro cliente. */
export function produtoValido(p: WooProduct): boolean {
  if (p.status !== 'publish') return false;
  if (p.stock_status !== 'instock') return false;
  if (/\bteste\b/i.test(p.name) || /n[aã]o\s+dispon[ií]vel/i.test(p.name)) return false;
  if (parsePreco(p) == null) return false;
  if (!p.images || p.images.length === 0) return false;
  if (extrairCodigoDoNome(p.name) == null) return false;
  return true;
}

/** Header HTTP Basic Auth para a WooCommerce REST API — nunca em query string. null quando alguma credencial falta (sem lançar exceção, sem vazar nada). */
export function construirHeaderBasicAuth(key: string | null | undefined, secret: string | null | undefined): Record<string, string> | null {
  if (!key || !secret) return null;
  return { 'Authorization': `Basic ${btoa(`${key}:${secret}`)}` };
}

export function paraProdutoCatalogo(p: WooProduct): ProdutoCatalogo {
  return {
    nome: p.name,
    preco: parsePreco(p),
    fotoUrl: p.images[0]?.src,
    disponivel: true,
    codigo: extrairCodigoDoNome(p.name) ?? undefined,
    idExterno: String(p.id),
    url: p.permalink,
    origem: 'woocommerce',
  };
}

/**
 * Agrupa por código comercial e devolve os códigos usados por mais de um
 * produto (IDs diferentes) — cadastro duplicado, precisa de correção. Nunca
 * remove nem funde os produtos: cada um mantém seu próprio ID/nome/foto/preço.
 */
export function detectarCodigosDuplicados(produtos: ProdutoCatalogo[]): Map<string, string[]> {
  const porCodigo = new Map<string, string[]>();
  for (const p of produtos) {
    if (!p.codigo || !p.idExterno) continue;
    const ids = porCodigo.get(p.codigo) ?? [];
    if (!ids.includes(p.idExterno)) ids.push(p.idExterno);
    porCodigo.set(p.codigo, ids);
  }
  const duplicados = new Map<string, string[]>();
  for (const [codigo, ids] of porCodigo) {
    if (ids.length > 1) duplicados.set(codigo, ids);
  }
  return duplicados;
}
