// Helpers de teste compartilhados entre funil.test.ts, funil.interpretacao.test.ts
// e funil.conversas.test.ts — extraídos de funil.test.ts pra nunca duplicar o
// fake de DependenciasFunil (sem rede, sem Groq/Redis/Supabase/Meta/WhatsApp
// reais) entre os três arquivos.

import type { DependenciasFunil, FormularioEntregaDados } from './funil.js'

// Texto no formato "Rótulo: valor" (Parte 2, formulário rotulado) — reflete
// exatamente como um cliente real preenche o formulário pedido pela Flora.
export function formularioTexto(overrides: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    'Nome de quem está fazendo o pedido': 'Ana',
    'Nome de quem vai receber': 'Camila',
    'Telefone de quem vai receber, com DDD': '11999990000',
    'CEP': '04204-030',
    'Rua ou avenida': 'Rua das Flores',
    'Número': '123',
    'Bairro': 'Ipiranga',
    'Cidade': 'São Paulo',
    'UF': 'SP',
    'Data desejada para entrega': 'amanhã',
  }
  const merged = { ...base, ...overrides }
  return Object.entries(merged).map(([k, v]) => `${k}: ${v}`).join('\n')
}

// Mesmos dados de formularioTexto(), já como objeto — pra fixtures que
// montam EstadoConversa diretamente (sem passar pelo parser).
export function formularioFixture(overrides: Partial<FormularioEntregaDados> = {}): FormularioEntregaDados {
  return {
    nomeComprador: 'Ana',
    nomeDestinatario: 'Camila',
    telefoneDestinatario: '+5511999990000',
    cep: '04204-030',
    rua: 'Rua das Flores',
    numero: '123',
    bairro: 'Ipiranga',
    cidade: 'São Paulo',
    uf: 'SP',
    dataEntrega: 'amanhã',
    ...overrides,
  }
}

export function depsFake(overrides?: Partial<DependenciasFunil>): DependenciasFunil {
  return {
    buscarCatalogo: async () => [
      { nome: 'Buquê de Rosas', preco: 140, disponivel: true, fotoUrl: 'https://site/rosas.jpg' },
      { nome: 'Arranjo Girassóis', preco: 135, disponivel: true },
    ],
    // [] por padrão faz etapaEscolhaCategoria cair no fluxo antigo de busca
    // direta por texto (etapaRecomendacao) — testes que não mexem com
    // categoria continuam passando sem precisar mockar isso explicitamente.
    buscarCategorias: async () => [],
    buscarProdutosPorCategoria: async () => [],
    revalidarProduto: async () => ({ disponivel: true }),
    // detalhes: {} garante que etapaCalculoFrete grava cotadoEm (cotação real
    // sempre traz detalhes reais em produção — ver cotacaoFreteVencida/Parte 4).
    calcularFrete: async () => ({ ok: true, valor: 22.5, detalhes: {} }),
    // ViaCEP fake: por padrão sempre localiza um endereço completo — testes
    // que já informam rua/bairro no formulário mantêm o valor do cliente
    // (só preenche o que estiver vazio, ver etapaFormulario); testes que
    // exercitam CEP inválido/parcial sobrescrevem isso explicitamente.
    consultarCep: async () => ({ rua: 'Rua das Flores', bairro: 'Ipiranga', cidade: 'São Paulo', uf: 'SP' }),
    // Fake determinístico e simples (não precisa reproduzir a lógica real de
    // horário comercial de _shared/agendamento-entrega.ts, usada só pelas
    // Edge Functions Deno) — só devolve datas ISO válidas e coerentes pra
    // exercitar o fluxo do funil.
    calcularAgendamento: (dataEntrega) => {
      const iso = new Date(Date.UTC(dataEntrega.ano, dataEntrega.mes, dataEntrega.dia, 12, 0)).toISOString()
      return { entregaPrometidaEmISO: iso, despachoEmISO: iso, imediato: true }
    },
    gerarPagamento: async (pedidoId) => ({ link: `https://pagamento.exemplo/${pedidoId}`, paymentId: pedidoId }),
    gerarPagamentoPix: async (pedidoId) => ({ qrCodeUrl: `https://storage.exemplo/${pedidoId}.png`, copiaCola: `00020126${pedidoId}` }),
    criarPedido: async () => ({ pedidoId: 'pedido_fake_001' }),
    buscarFormasPagamento: async () => ['Pix', 'cartão de crédito', 'cartão de débito'],
    // interpretarIntencao NÃO é preenchido por padrão — o mesmo comportamento
    // de "canal sem rollout do interpretador" (ver DependenciasFunil em
    // funil.ts): testes que não mexem com a camada contextual continuam
    // 100% determinísticos, sem precisar mockar isso explicitamente. Testes
    // que exercitam a camada contextual passam um `interpretarIntencao` fake
    // via overrides (ver criarInterpretadorFake em funil.interpretacao.test.ts).
    ...overrides,
  }
}

/**
 * Fake determinístico de `interpretarIntencao` pra testes que exercitam a
 * camada contextual sem nunca chamar rede/modelo real — mapeia trechos do
 * `systemPrompt` (que sempre inclui a intenção esperada como parte do texto
 * fixo de cada gate, ver `montarPromptInterpretacaoRetomada`) pra uma
 * resposta JSON fixa por cenário. `respostas` é uma lista ordenada de
 * `{ quando(mensagem, systemPrompt) => boolean, resultado }` — a primeira que
 * bater decide a resposta; nenhuma bate = devolve `null` (mesmo contrato de
 * indisponibilidade do modelo real).
 */
export interface CenarioInterpretacaoFake {
  quando: (mensagemCliente: string, systemPrompt: string) => boolean
  resultado: Record<string, unknown> | null
}

export function criarInterpretadorFake(cenarios: CenarioInterpretacaoFake[]) {
  return async (systemPrompt: string, mensagemCliente: string, _timeoutMs: number): Promise<string | null> => {
    for (const cenario of cenarios) {
      if (cenario.quando(mensagemCliente, systemPrompt)) {
        return cenario.resultado === null ? null : JSON.stringify(cenario.resultado)
      }
    }
    return null
  }
}
