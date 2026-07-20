/**
 * frete-selecao.ts — seleção pura da melhor opção de frete entre
 * transportadoras (sem I/O, sem Deno.env). Separado de transportadoras.ts
 * só pra ser testável com node:test/tsx sem arrastar a cadeia
 * credentials.ts -> supabase.ts ('npm:@supabase/supabase-js', specifier só
 * resolvível em Deno) — mesmo motivo de catalogo-woocommerce-filtro.ts e
 * mercadopago-assinatura.ts.
 */

export const MARKUP_FRETE_REAIS = 15;

export interface OpcaoFrete {
  transportadora: string;
  servico?: string;
  preco: number;
  prazo_dias: number;
  /** Campos de rastreio da cotação real (só preenchidos pela Lalamove hoje) — usados para persistência (ver Parte E), nunca para a seleção pura abaixo. */
  quotationId?: string;
  moeda?: string;
  expiresAt?: string | null;
  distanciaMetros?: number | null;
  ambiente?: string;
  mercado?: string;
  stops?: Array<{ stopId: string; lat: string; lng: string; address: string }>;
}

export interface OpcaoFreteComMarkup extends OpcaoFrete {
  preco_cliente: number; // preco + MARKUP_FRETE_REAIS
}

/**
 * Seleciona a melhor opção de frete:
 * - Prioridade 1: entrega no mesmo dia (prazo_dias = 0), menor preço
 * - Prioridade 2: qualquer prazo, menor preço
 * Adiciona markup de R$15 no preço final ao cliente. Nunca inventa uma
 * opção quando a lista está vazia (nenhuma transportadora respondeu).
 */
export function selecionarMelhor(opcoes: OpcaoFrete[]): OpcaoFreteComMarkup | null {
  if (opcoes.length === 0) return null;

  const mesmodia = opcoes.filter((o) => o.prazo_dias === 0);
  const candidatos = mesmodia.length > 0 ? mesmodia : opcoes;

  const melhor = [...candidatos].sort((a, b) => {
    if (a.preco !== b.preco) return a.preco - b.preco;
    return a.prazo_dias - b.prazo_dias;
  })[0];

  // Arredonda pra 2 casas — sem isso, preco_cliente carrega erro de ponto
  // flutuante (ex.: 44.629999999999995) que nunca deve aparecer num valor
  // cobrado do cliente nem persistido em pedidos.valor.
  return { ...melhor, preco_cliente: Math.round((melhor.preco + MARKUP_FRETE_REAIS) * 100) / 100 };
}
