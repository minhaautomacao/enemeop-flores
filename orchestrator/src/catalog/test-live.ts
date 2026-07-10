/**
 * Teste real contra www.enemeopflores.com.br
 * Executar: npx tsx src/catalog/test-live.ts
 */

import 'dotenv/config'
import { searchLiveProductsFromSite } from './liveSiteCatalog.js'

const CASOS = [
  { label: 'flores vermelhas para aniversário', params: { query: 'quero flores vermelhas para aniversário', occasion: 'aniversario', color: 'vermelha' } },
  { label: 'buquê até R$200',                  params: { query: 'tem um buquê até 200 reais?', budget: 200 } },
  { label: 'orquídea branca',                  params: { query: 'quero uma orquídea branca', occasion: 'orquidea', color: 'branca' } },
  { label: 'flores para condolências',          params: { query: 'preciso de flores para condolências', occasion: 'luto' } },
  { label: 'presente para maternidade',         params: { query: 'quero um presente para maternidade', occasion: 'maternidade' } },
]

async function main() {
  let passados = 0
  let falhos   = 0

  for (const { label, params } of CASOS) {
    console.log('\n' + '─'.repeat(60))
    console.log(`TESTE: "${label}"`)
    console.log('─'.repeat(60))
    const t0 = Date.now()
    try {
      const produtos = await searchLiveProductsFromSite({ ...params, limit: 3 })
      const elapsed  = Date.now() - t0

      if (produtos.length === 0) {
        console.error(`  FALHOU — nenhum produto retornado (${elapsed}ms)`)
        falhos++
        continue
      }

      console.log(`  OK — ${produtos.length} produto(s) em ${elapsed}ms`)
      for (const p of produtos) {
        const preco  = p.price != null ? `R$${p.price.toFixed(2)}` : 'sem preço'
        const cores  = p.colors.length  ? p.colors.join(', ')  : 'nenhuma'
        const flores = p.flowers.length ? p.flowers.join(', ') : 'nenhuma'
        const desc   = p.description ? p.description.substring(0, 80) + '...' : 'sem descrição'
        console.log(`  → ${p.name}`)
        console.log(`    Preço:   ${preco}`)
        console.log(`    Cores:   ${cores}`)
        console.log(`    Flores:  ${flores}`)
        console.log(`    Desc:    ${desc}`)
        console.log(`    Link:    ${p.url}`)

        // Validações
        if (!p.name)  console.warn('    AVISO: nome vazio')
        if (!p.url)   console.warn('    AVISO: url vazia')
        if (!p.url?.startsWith('https://www.enemeopflores.com.br'))
          console.warn('    AVISO: URL não pertence ao site oficial')
      }
      passados++
    } catch (err) {
      console.error(`  ERRO INESPERADO: ${err instanceof Error ? err.message : String(err)}`)
      falhos++
    }
  }

  console.log('\n' + '═'.repeat(60))
  console.log(`RESULTADO: ${passados}/${CASOS.length} passaram, ${falhos} falharam`)
  console.log('═'.repeat(60))
  process.exit(falhos > 0 ? 1 : 0)
}

main()
