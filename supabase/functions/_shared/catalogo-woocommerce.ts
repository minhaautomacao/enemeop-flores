/**
 * catalogo-woocommerce.ts — catálogo ao vivo direto da WooCommerce REST API
 * (www.enemeopflores.com.br), sem cache/tabela local. Categorias, produtos
 * por categoria e revalidação pré-pedido sempre em tempo real — nunca usa
 * catalogo_produtos (pode ficar desatualizado) nem valores hardcoded.
 *
 * Credenciais (workspace_credentials, tipo='woocommerce'): consumer_key,
 * consumer_secret — chaves REST somente leitura.
 */

import { buscarCredencial } from './credentials.ts';
import type { ProdutoCatalogo } from './funil.ts';
import { type WooProduct, parsePreco, produtoValido, paraProdutoCatalogo } from './catalogo-woocommerce-filtro.ts';

const BASE_URL = 'https://www.enemeopflores.com.br/wp-json/wc/v3';

async function credenciais(workspaceId: string | undefined): Promise<{ key: string; secret: string } | null> {
  const key = await buscarCredencial(workspaceId, 'woocommerce', 'consumer_key');
  const secret = await buscarCredencial(workspaceId, 'woocommerce', 'consumer_secret');
  if (!key || !secret) return null;
  return { key, secret };
}

export interface CategoriaCatalogo { id: string; nome: string; }

export async function buscarCategoriasReais(workspaceId: string | undefined): Promise<CategoriaCatalogo[]> {
  const creds = await credenciais(workspaceId);
  if (!creds) return [];
  try {
    const url = `${BASE_URL}/products/categories?per_page=100&hide_empty=true&consumer_key=${creds.key}&consumer_secret=${creds.secret}`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json() as Array<{ id: number; name: string; count: number }>;
    return data.filter(c => c.count > 0).map(c => ({ id: String(c.id), nome: c.name }));
  } catch {
    return [];
  }
}

export async function buscarProdutosPorCategoriaReal(
  workspaceId: string | undefined,
  categoriaId: string,
): Promise<ProdutoCatalogo[]> {
  const creds = await credenciais(workspaceId);
  if (!creds) return [];
  try {
    const url = `${BASE_URL}/products?category=${encodeURIComponent(categoriaId)}&per_page=50&status=publish&stock_status=instock&orderby=menu_order&order=asc&consumer_key=${creds.key}&consumer_secret=${creds.secret}`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json() as WooProduct[];
    return data.filter(produtoValido).map(paraProdutoCatalogo);
  } catch {
    return [];
  }
}

/**
 * Busca por palavra-chave livre (usado pela pergunta direta "tem X?" e como
 * fallback quando não há categorias reais no momento) — mesma fonte, mesmo
 * filtro de validade, nunca a tabela catalogo_produtos.
 */
export async function buscarProdutosPorTermoReal(
  workspaceId: string | undefined,
  params: { query: string; budget?: number },
): Promise<ProdutoCatalogo[]> {
  const creds = await credenciais(workspaceId);
  if (!creds) return [];
  try {
    const url = `${BASE_URL}/products?search=${encodeURIComponent(params.query)}&per_page=20&status=publish&stock_status=instock&consumer_key=${creds.key}&consumer_secret=${creds.secret}`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json() as WooProduct[];
    let validos = data.filter(produtoValido);
    if (params.budget) {
      validos = validos.filter(p => (parsePreco(p) ?? Infinity) <= params.budget! * 1.3);
    }
    return validos.slice(0, 10).map(paraProdutoCatalogo);
  } catch {
    return [];
  }
}

/**
 * Revalida um produto específico direto na WooCommerce — sempre chamado
 * antes de criar o pedido, nunca confia em preço/disponibilidade já em
 * memória há alguns minutos. Tenta por SKU (código real) primeiro, e só
 * cai pro ID numérico quando o código já É numérico (produtos sem SKU
 * cadastrado usam o próprio ID como código).
 */
export async function revalidarProdutoReal(
  workspaceId: string | undefined,
  codigo: string,
): Promise<{ disponivel: boolean; preco?: number; fotoUrl?: string } | null> {
  const creds = await credenciais(workspaceId);
  if (!creds) return null;
  try {
    const urlSku = `${BASE_URL}/products?sku=${encodeURIComponent(codigo)}&status=publish&consumer_key=${creds.key}&consumer_secret=${creds.secret}`;
    const respSku = await fetch(urlSku);
    let produto: WooProduct | undefined;
    if (respSku.ok) {
      const encontrados = await respSku.json() as WooProduct[];
      produto = encontrados[0];
    }
    if (!produto && /^\d+$/.test(codigo)) {
      const respId = await fetch(`${BASE_URL}/products/${codigo}?consumer_key=${creds.key}&consumer_secret=${creds.secret}`);
      if (respId.ok) produto = await respId.json() as WooProduct;
    }
    if (!produto || !produtoValido(produto) || produto.stock_status !== 'instock') {
      return { disponivel: false };
    }
    return { disponivel: true, preco: parsePreco(produto), fotoUrl: produto.images?.[0]?.src };
  } catch {
    return null;
  }
}
