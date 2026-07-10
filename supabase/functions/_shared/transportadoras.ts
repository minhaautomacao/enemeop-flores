/**
 * transportadoras.ts — Interface comum e dispatcher multi-transportadora
 *
 * Para adicionar nova transportadora:
 *   1. Criar _shared/<nome>.ts implementando `calcularFrete`
 *   2. Registrar em TRANSPORTADORAS com as chaves de credencial necessárias
 *
 * Credenciais (workspace_credentials, tipo='logistica'):
 *   melhor_envio_token, cep_origem   → Melhor Envio
 *   lalamove_key, lalamove_secret    → Lalamove
 */

import { buscarTodasCredenciais } from './credentials.ts';
import { calcularFreteMelhorEnvio } from './melhor-envio.ts';
import { calcularFreteLalamove } from './lalamove.ts';

export const MARKUP_FRETE_REAIS = 15;

export interface DadosFrete {
  cep_origem: string;
  cep_destino: string;
  peso_kg: number;
  valor_declarado: number;
  largura_cm: number;
  altura_cm: number;
  comprimento_cm: number;
}

export interface OpcaoFrete {
  transportadora: string;
  servico?: string;
  preco: number;
  prazo_dias: number;
}

export interface OpcaoFreteComMarkup extends OpcaoFrete {
  preco_cliente: number; // preco + MARKUP_FRETE_REAIS
}

export interface ResultadoFrete {
  opcoes: OpcaoFrete[];
  melhor_opcao: OpcaoFreteComMarkup | null;
  transportadoras_consultadas: string[];
  erros: Record<string, string>;
}

export interface OpcoesExtras {
  lat_origem?: string;
  lng_origem?: string;
  lat_destino?: string;
  lng_destino?: string;
  endereco_origem?: string;
  endereco_destino?: string;
}

/**
 * Seleciona a melhor opção de frete:
 * - Prioridade 1: entrega no mesmo dia (prazo_dias = 0), menor preço
 * - Prioridade 2: qualquer prazo, menor preço
 * Adiciona markup de R$15 no preço final ao cliente.
 */
function selecionarMelhor(opcoes: OpcaoFrete[]): OpcaoFreteComMarkup | null {
  if (opcoes.length === 0) return null;

  // Prefere entrega no mesmo dia (prazo = 0)
  const mesmodia = opcoes.filter((o) => o.prazo_dias === 0);
  const candidatos = mesmodia.length > 0 ? mesmodia : opcoes;

  // Ordenar: menor preço, desempate por maior rapidez (menor prazo)
  const melhor = candidatos.sort((a, b) => {
    if (a.preco !== b.preco) return a.preco - b.preco;
    return a.prazo_dias - b.prazo_dias;
  })[0];

  return { ...melhor, preco_cliente: melhor.preco + MARKUP_FRETE_REAIS };
}

/**
 * Consulta todas as transportadoras configuradas e retorna opções agregadas por preço.
 * Transportadoras sem credenciais são silenciosamente ignoradas.
 */
export async function consultarFretes(
  workspaceId: string | undefined,
  dados: DadosFrete,
  extras?: OpcoesExtras,
): Promise<ResultadoFrete> {
  const dbCreds = await buscarTodasCredenciais(workspaceId, 'logistica');

  // Fallback: env vars para credenciais não cadastradas no banco
  const creds: Record<string, string> = {
    lalamove_key:        Deno.env.get('LALAMOVE_API_KEY')    ?? '',
    lalamove_secret:     Deno.env.get('LALAMOVE_API_SECRET') ?? '',
    melhor_envio_token:  Deno.env.get('MELHOR_ENVIO_TOKEN')  ?? '',
    cep_origem:          Deno.env.get('CEP_ORIGEM')           ?? '',
    ...dbCreds,
  };

  const opcoes: OpcaoFrete[] = [];
  const consultadas: string[] = [];
  const erros: Record<string, string> = {};

  const transportadoras = [
    {
      nome: 'Melhor Envio',
      chaves: ['melhor_envio_token', 'cep_origem'],
      calcular: (c: Record<string, string>, d: DadosFrete) =>
        calcularFreteMelhorEnvio(c['melhor_envio_token'], c['cep_origem'] ?? d.cep_origem, d),
    },
    {
      nome: 'Lalamove',
      chaves: ['lalamove_key', 'lalamove_secret'],
      calcular: (c: Record<string, string>, d: DadosFrete) =>
        calcularFreteLalamove(c['lalamove_key'], c['lalamove_secret'], d, extras),
    },
  ];

  await Promise.all(
    transportadoras.map(async (t) => {
      if (!t.chaves.every((k) => !!creds[k])) return;
      consultadas.push(t.nome);
      try {
        opcoes.push(...await t.calcular(creds, dados));
      } catch (e) {
        erros[t.nome] = String(e);
      }
    }),
  );

  opcoes.sort((a, b) => a.preco - b.preco);

  return {
    opcoes,
    melhor_opcao: selecionarMelhor(opcoes),
    transportadoras_consultadas: consultadas,
    erros,
  };
}
