/**
 * catalogo-woocommerce-filtro.ts — regras puras de validade/mapeamento de
 * produto WooCommerce (sem I/O, sem Deno.env). Separado de
 * catalogo-woocommerce.ts só pra ser testável com node:test/tsx sem
 * arrastar a cadeia credentials.ts -> supabase.ts ('npm:@supabase/supabase-js',
 * specifier só resolvível em Deno) — mesmo motivo de mercadopago-assinatura.ts.
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

/** Produto de teste/rascunho/indisponível/sem preço/sem imagem — nunca aparece pro cliente. */
export function produtoValido(p: WooProduct): boolean {
  if (p.status !== 'publish') return false;
  if (/\bteste\b/i.test(p.name) || /n[aã]o\s+dispon[ií]vel/i.test(p.name)) return false;
  if (parsePreco(p) == null) return false;
  if (!p.images || p.images.length === 0) return false;
  return true;
}

/** Código oficial e estável: SKU real quando existe, senão o ID numérico — nunca inventado. */
export function codigoOficial(p: WooProduct): string {
  return p.sku?.trim() || String(p.id);
}

export function paraProdutoCatalogo(p: WooProduct): ProdutoCatalogo {
  return {
    nome: p.name,
    preco: parsePreco(p),
    fotoUrl: p.images[0]?.src,
    disponivel: true,
    codigo: codigoOficial(p),
    url: p.permalink,
    origem: 'woocommerce',
  };
}
