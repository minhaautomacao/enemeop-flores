/**
 * lalamove-config.ts — decisões puras da integração Lalamove (ambiente,
 * mercado, string de assinatura, validação de preço/enums), sem I/O, sem
 * Deno.env, sem fetch. Separado de lalamove.ts só pra ser testável com
 * node:test/tsx — mesmo padrão de frete-selecao.ts e mercadopago-assinatura.ts.
 */

export type LalamoveAmbiente = 'sandbox' | 'production';

const BASE_URL_POR_AMBIENTE: Record<LalamoveAmbiente, string> = {
  sandbox: 'https://rest.sandbox.lalamove.com',
  production: 'https://rest.lalamove.com',
};

/**
 * Nunca infere ambiente pelo conteúdo da chave — só aceita exatamente
 * 'sandbox' ou 'production' vindos da secret LALAMOVE_ENVIRONMENT. Qualquer
 * outro valor (incluindo ausente/vazio) falha com uma mensagem sanitizada
 * (nunca ecoa o valor recebido, que pode ser lixo de configuração).
 */
export function resolverAmbiente(raw: string | undefined | null): LalamoveAmbiente {
  if (raw === 'sandbox' || raw === 'production') return raw;
  throw new Error(
    raw
      ? `LALAMOVE_ENVIRONMENT invalido: esperado 'sandbox' ou 'production'`
      : `LALAMOVE_ENVIRONMENT nao configurado`,
  );
}

export function resolverBaseUrl(ambiente: LalamoveAmbiente): string {
  return BASE_URL_POR_AMBIENTE[ambiente];
}

/** LALAMOVE_MARKET vem sempre da configuração — nunca fixado 'BR' no código. */
export function resolverMarket(raw: string | undefined | null): string {
  const market = (raw ?? '').trim().toUpperCase();
  if (!market) throw new Error('LALAMOVE_MARKET nao configurado');
  return market;
}

/**
 * String bruta assinada pela API v3: timestamp \r\n method \r\n path(+query)
 * \r\n \r\n body. `pathComQuery` já deve incluir a query string se houver.
 */
export function montarStringAssinatura(
  timestamp: string,
  method: string,
  pathComQuery: string,
  body: string,
): string {
  return `${timestamp}\r\n${method}\r\n${pathComQuery}\r\n\r\n${body}`;
}

export interface ValidacaoPreco {
  valido: boolean;
  motivo?: string;
}

/**
 * Nunca aceita um preço da Lalamove sem checar: finito, positivo, e na
 * moeda esperada pro mercado configurado. Uma resposta corrompida/parcial
 * da API nunca vira um valor cobrado do cliente.
 */
export function validarPreco(preco: number, moeda: string, moedaEsperada: string): ValidacaoPreco {
  if (!Number.isFinite(preco)) return { valido: false, motivo: 'preco_nao_finito' };
  if (preco <= 0) return { valido: false, motivo: 'preco_nao_positivo' };
  if (!moeda || moeda !== moedaEsperada) return { valido: false, motivo: `moeda_inesperada` };
  return { valido: true };
}

/**
 * Uma cotação com expiresAt vencido nunca pode virar uma corrida real — quem
 * for criar o pedido tem que pedir uma cotação nova antes.
 */
export function cotacaoExpirada(expiresAtIso: string | null, agora: Date = new Date()): boolean {
  if (!expiresAtIso) return true;
  const expira = new Date(expiresAtIso);
  if (Number.isNaN(expira.getTime())) return true;
  return expira.getTime() <= agora.getTime();
}

export interface ServicoDisponivel {
  key: string;
}

/** true só quando a API confirmou (via /v3/cities) que o serviceType existe pro mercado — nunca assume MOTORCYCLE/CAR por padrão. */
export function servicoDisponivel(servicos: ServicoDisponivel[], serviceType: string): boolean {
  return servicos.some((s) => s.key === serviceType);
}

/** Mascara um quotationId pra log/relatório — mostra só os 4 primeiros e 4 últimos caracteres. */
export function mascarar(valor: string | null | undefined): string {
  if (!valor) return '';
  if (valor.length <= 8) return '*'.repeat(valor.length);
  return `${valor.slice(0, 4)}…${valor.slice(-4)}`;
}

// Exigido pela Lalamove pro campo `phone` de sender/recipients — E.164 com o
// sinal "+" obrigatório: "Must be a valid number with region code (ex: +65)",
// validado com a mesma regex documentada por eles pra todos os mercados.
const REGEX_TELEFONE_E164 = /^\+[1-9]\d{1,14}$/;

/** true só quando o telefone está em E.164 válido (+DDI+número, só dígitos depois do +) — nunca envia um telefone mal formatado pra Lalamove. */
export function telefoneE164Valido(telefone: string | null | undefined): boolean {
  return !!telefone && REGEX_TELEFONE_E164.test(telefone);
}

/** Mascara um telefone pra log/relatório — mantém só o prefixo (+DDI) e os 4 últimos dígitos. Ex.: +5511982829083 -> +55•••••••9083. Nunca expõe o número completo. */
export function mascararTelefone(telefone: string | null | undefined): string {
  if (!telefone) return '';
  if (telefone.length <= 7) return '•'.repeat(telefone.length);
  const inicio = telefone.slice(0, 3);
  const fim = telefone.slice(-4);
  const meio = '•'.repeat(telefone.length - 7);
  return `${inicio}${meio}${fim}`;
}
