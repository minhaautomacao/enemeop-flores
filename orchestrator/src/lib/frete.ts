/**
 * Cálculo real de frete — adapta o Melhor Envio (lib/melhor-envio.ts) ao
 * contrato CalculadorFrete de lib/funil.ts (CEP → ResultadoFrete).
 *
 * Nunca estima: se a origem da loja não estiver configurada, se o CEP não
 * puder ser resolvido para cidade/UF (ViaCEP) ou se o Melhor Envio não
 * retornar nenhuma opção válida, devolve { ok: false } — quem chama
 * (funil.ts) transfere para atendimento humano, nunca inventa um valor.
 *
 * Variáveis de ambiente:
 *   STORE_CEP, STORE_CITY, STORE_STATE — endereço de coleta da loja
 */

import { calcularFrete as calcularMelhorEnvio } from './melhor-envio.js'
import type { ResultadoFrete } from './funil.js'

const STORE_CEP   = process.env.STORE_CEP ?? ''
const STORE_CITY  = process.env.STORE_CITY ?? ''
const STORE_STATE = process.env.STORE_STATE ?? ''

// Pacote padrão para um arranjo/buquê — o catálogo ao vivo não traz peso e
// dimensões por produto, então usamos uma caixa conservadora única.
// Pendência real (ver relatório final): calibrar por categoria de produto
// quando o catálogo passar a expor essas dimensões.
const PACOTE_PADRAO_FLORES = { height: 30, width: 25, length: 35, weight: 1.5 }

interface ViaCepResponse {
  localidade?: string
  uf?: string
  erro?: boolean
}

async function resolverCidadeUf(cep: string): Promise<{ cidade: string; uf: string } | null> {
  const limpo = cep.replace(/\D/g, '')
  if (limpo.length !== 8) return null
  try {
    const res = await fetch(`https://viacep.com.br/ws/${limpo}/json/`)
    if (!res.ok) return null
    const data = await res.json() as ViaCepResponse
    if (data.erro || !data.localidade || !data.uf) return null
    return { cidade: data.localidade, uf: data.uf }
  } catch (err) {
    console.error('[Frete] Falha ao resolver cidade/UF via ViaCEP:', err)
    return null
  }
}

/**
 * Calcula o frete real para um CEP de destino via Melhor Envio. Implementa
 * o tipo CalculadorFrete de funil.ts (cep) => Promise<ResultadoFrete> —
 * valorDeclarado é fornecido separadamente pelo chamador (sdr.ts), que tem
 * acesso ao valor do produto no momento da chamada.
 */
export async function calcularFreteReal(cep: string, valorDeclarado: number): Promise<ResultadoFrete> {
  if (!STORE_CEP || !STORE_CITY || !STORE_STATE) {
    console.error('[Frete] STORE_CEP/STORE_CITY/STORE_STATE ausentes — não é possível calcular frete real')
    return { ok: false }
  }

  const destino = await resolverCidadeUf(cep)
  if (!destino) {
    console.warn(`[Frete] Não foi possível resolver cidade/UF para o CEP ${cep}`)
    return { ok: false }
  }

  try {
    const opcoes = await calcularMelhorEnvio({
      from: { postal_code: STORE_CEP.replace('-', ''), city: STORE_CITY, state_abbr: STORE_STATE },
      to:   { postal_code: cep.replace('-', ''), city: destino.cidade, state_abbr: destino.uf },
      package:  PACOTE_PADRAO_FLORES,
      products: [{ id: '1', ...PACOTE_PADRAO_FLORES, insurance_value: valorDeclarado, quantity: 1 }],
    })

    const validas = opcoes.filter(o => !o.error && Number(o.price) > 0)
    if (validas.length === 0) {
      console.warn(`[Frete] Melhor Envio não retornou nenhuma opção válida para ${cep}`)
      return { ok: false }
    }

    const maisBarata = validas.reduce((a, b) => (Number(a.price) <= Number(b.price) ? a : b))
    return { ok: true, valor: Number(maisBarata.price) }
  } catch (err) {
    console.error(`[Frete] Falha ao consultar Melhor Envio para ${cep}:`, err)
    return { ok: false }
  }
}
