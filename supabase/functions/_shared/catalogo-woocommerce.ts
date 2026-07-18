/**
 * catalogo-woocommerce.ts — catálogo ao vivo direto da WooCommerce REST API
 * (www.enemeopflores.com.br), sem cache/tabela local. Categorias, produtos
 * por categoria e revalidação pré-pedido sempre em tempo real — nunca usa
 * catalogo_produtos (pode ficar desatualizado) nem valores hardcoded.
 *
 * Credenciais (workspace_credentials, tipo='woocommerce'): consumer_key,
 * consumer_secret — chaves REST somente leitura, armazenadas cifradas
 * (AES-256-GCM, mesmo mecanismo de credentials.ts) e enviadas sempre via
 * header HTTP Basic Auth — nunca em query string (evita ficarem em logs de
 * acesso/proxy) e nunca impressas em log nenhum.
 */

import { buscarCredencial } from './credentials.ts';
import type { ProdutoCatalogo } from './funil.ts';
import { type WooProduct, parsePreco, produtoValido, paraProdutoCatalogo, detectarCodigosDuplicados, construirHeaderBasicAuth } from './catalogo-woocommerce-filtro.ts';

const BASE_URL = 'https://www.enemeopflores.com.br/wp-json/wc/v3';

async function headersAutenticados(workspaceId: string | undefined): Promise<Record<string, string> | null> {
  const key = await buscarCredencial(workspaceId, 'woocommerce', 'consumer_key');
  const secret = await buscarCredencial(workspaceId, 'woocommerce', 'consumer_secret');
  return construirHeaderBasicAuth(key, secret);
}

/** Loga (sem nunca incluir valores de credenciais) quando o mesmo código comercial aparece em produtos com IDs diferentes — cadastro precisa de correção. */
function sinalizarDuplicidade(produtos: ProdutoCatalogo[], origem: string): void {
  const duplicados = detectarCodigosDuplicados(produtos);
  for (const [codigo, ids] of duplicados) {
    console.warn(`[catalogo-woocommerce] duplicidade_cadastral codigo=${codigo} ids=${ids.join(',')} origem=${origem}`);
  }
}

export interface CategoriaCatalogo { id: string; nome: string; }

export async function buscarCategoriasReais(workspaceId: string | undefined): Promise<CategoriaCatalogo[]> {
  const headers = await headersAutenticados(workspaceId);
  if (!headers) return [];
  try {
    const url = `${BASE_URL}/products/categories?per_page=100&hide_empty=true`;
    const resp = await fetch(url, { headers });
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
  const headers = await headersAutenticados(workspaceId);
  if (!headers) return [];
  try {
    const url = `${BASE_URL}/products?category=${encodeURIComponent(categoriaId)}&per_page=50&status=publish&stock_status=instock&orderby=menu_order&order=asc`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) return [];
    const data = await resp.json() as WooProduct[];
    const produtos = data.filter(produtoValido).map(paraProdutoCatalogo);
    sinalizarDuplicidade(produtos, `categoria:${categoriaId}`);
    return produtos;
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
  const headers = await headersAutenticados(workspaceId);
  if (!headers) return [];
  try {
    const url = `${BASE_URL}/products?search=${encodeURIComponent(params.query)}&per_page=20&status=publish&stock_status=instock`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) return [];
    const data = await resp.json() as WooProduct[];
    let validos = data.filter(produtoValido);
    if (params.budget) {
      validos = validos.filter(p => (parsePreco(p) ?? Infinity) <= params.budget! * 1.3);
    }
    const produtos = validos.slice(0, 10).map(paraProdutoCatalogo);
    sinalizarDuplicidade(produtos, `termo:${params.query}`);
    return produtos;
  } catch {
    return [];
  }
}

/**
 * Revalida um produto específico direto na WooCommerce, sempre pelo ID
 * técnico (idExterno) — nunca pelo código comercial, que pode estar
 * duplicado no cadastro. Chamado sempre antes de criar o pedido, nunca
 * confia em preço/disponibilidade já em memória há alguns minutos.
 */
export async function revalidarProdutoReal(
  workspaceId: string | undefined,
  idExterno: string,
): Promise<{ disponivel: boolean; preco?: number; fotoUrl?: string; nome?: string } | null> {
  const headers = await headersAutenticados(workspaceId);
  if (!headers) return null;
  try {
    const resp = await fetch(`${BASE_URL}/products/${encodeURIComponent(idExterno)}`, { headers });
    if (!resp.ok) return { disponivel: false };
    const produto = await resp.json() as WooProduct;
    if (!produtoValido(produto) || produto.stock_status !== 'instock') {
      return { disponivel: false };
    }
    return { disponivel: true, preco: parsePreco(produto), fotoUrl: produto.images?.[0]?.src, nome: produto.name };
  } catch {
    return null;
  }
}
