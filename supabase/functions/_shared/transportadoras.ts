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
import { MARKUP_FRETE_REAIS, selecionarMelhor, type OpcaoFrete, type OpcaoFreteComMarkup } from './frete-selecao.ts';
import { CHAVE_LALAMOVE_KEY, CHAVE_LALAMOVE_SECRET, type LalamoveAmbiente } from './lalamove-config.ts';

export { MARKUP_FRETE_REAIS, type OpcaoFrete, type OpcaoFreteComMarkup };

export interface DadosFrete {
  cep_origem: string;
  cep_destino: string;
  peso_kg: number;
  valor_declarado: number;
  largura_cm: number;
  altura_cm: number;
  comprimento_cm: number;
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
 * Consulta todas as transportadoras configuradas e retorna opções agregadas por preço.
 * Transportadoras sem credenciais são silenciosamente ignoradas.
 */
export async function consultarFretes(
  workspaceId: string | undefined,
  dados: DadosFrete,
  extras?: OpcoesExtras,
  // Só passado explicitamente por flora-internal-test (canal de teste
  // interno) — tráfego real de cliente nunca passa isso, cai no
  // comportamento de sempre (resolverConfig cai no LALAMOVE_ENVIRONMENT
  // global). Melhor Envio não tem separação de ambiente, fora do escopo.
  ambiente?: LalamoveAmbiente,
): Promise<ResultadoFrete> {
  const dbCreds = await buscarTodasCredenciais(workspaceId, 'logistica');

  const chaveLalamoveKey = ambiente ? CHAVE_LALAMOVE_KEY[ambiente] : 'lalamove_key';
  const chaveLalamoveSecret = ambiente ? CHAVE_LALAMOVE_SECRET[ambiente] : 'lalamove_secret';

  // Fallback: env vars para credenciais não cadastradas no banco — só pra
  // produção (a chave _teste nunca tem fallback de env, tem que estar
  // cadastrada em workspace_credentials pra existir).
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
      // Se ambiente==='sandbox' e as chaves _teste não estiverem cadastradas,
      // esta transportadora é silenciosamente ignorada (mesmo comportamento
      // de sempre pra credencial ausente, linha abaixo) — nunca cai pra
      // credencial de produção por analogia.
      chaves: [chaveLalamoveKey, chaveLalamoveSecret],
      calcular: (c: Record<string, string>, d: DadosFrete) =>
        calcularFreteLalamove(c[chaveLalamoveKey], c[chaveLalamoveSecret], d, extras, ambiente),
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
