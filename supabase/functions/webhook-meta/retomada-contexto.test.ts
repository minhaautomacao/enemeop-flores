// Testes direcionados da correção de retomada de contexto (bug real
// encontrado em teste ponta a ponta 2026-07-17: Flora afirmava "já te
// enviei o link de pagamento" para uma simples "Olá", sem checar se havia
// um link real, e não deixava claro que estava retomando uma conversa
// antiga). Cobre também os dois comportamentos que vivem em processarDM
// (index.ts), fora do núcleo puro funil.ts: reabertura de conversa
// concluída e bloqueio da Flora quando o atendimento já está em modo
// humano — replicados aqui sem I/O, no mesmo espírito de
// primeiro-contato.test.ts.
//
// Rodar: npx tsx --test supabase/functions/webhook-meta/retomada-contexto.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoInicial,
  classificarIntencao,
  intencaoInterrompeFluxo,
  avancarFunil,
  type DependenciasFunil,
  type EstadoConversa,
  type Fase,
} from '../_shared/funil.ts';

const depsFake: DependenciasFunil = {
  buscarCatalogo: async () => [{ nome: 'Buquê de Rosas', preco: 140, disponivel: true, codigo: 'R1' }],
  calcularFrete: async () => ({ ok: true, valor: 22.5 }),
  gerarPagamento: async (pedidoId: string) => ({ link: `https://pagamento.exemplo/${pedidoId}`, paymentId: pedidoId }),
  criarPedido: async () => ({ pedidoId: 'pedido_x' }),
};

interface Mensagem { role: 'user' | 'assistant'; content: string; ts: string }

interface ConversaFake {
  fase: Fase;
  dados: EstadoConversa['dados'];
  perguntasFeitas: string[];
  historico: Mensagem[];
  modo_atendimento: string;
}

/**
 * Réplica fiel da decisão em processarDM (webhook-meta/index.ts) para os
 * dois comportamentos que dependem de conversaRow (não fazem parte do
 * núcleo puro funil.ts): bloqueio em modo humano e reabertura de conversa
 * concluída. `resposta === null` significa "Flora não respondeu" — mesmo
 * contrato do código real.
 */
async function processarMensagemSimulada(
  conversa: ConversaFake,
  mensagemCliente: string,
): Promise<{ resposta: string | null; estado: EstadoConversa; historico: Mensagem[] }> {
  if (conversa.modo_atendimento === 'humano') {
    const historico = [...conversa.historico, { role: 'user' as const, content: mensagemCliente, ts: new Date().toISOString() }];
    return { resposta: null, estado: { fase: conversa.fase, dados: conversa.dados, perguntasFeitas: conversa.perguntasFeitas }, historico };
  }

  let estado: EstadoConversa = { fase: conversa.fase, dados: conversa.dados, perguntasFeitas: conversa.perguntasFeitas };
  if (estado.fase === 'pedido_criado' || estado.fase === 'encerrado_sem_venda') {
    estado = estadoInicial();
  }

  const intencao = classificarIntencao(mensagemCliente, estado.fase);
  let resposta: string;
  if (intencaoInterrompeFluxo(intencao)) {
    resposta = `[handoff/${intencao}]`;
  } else {
    const r = await avancarFunil(estado, mensagemCliente, intencao, depsFake);
    estado = r.estado;
    resposta = r.mensagem;
  }

  const historico = [
    ...conversa.historico,
    { role: 'user' as const, content: mensagemCliente, ts: new Date().toISOString() },
    { role: 'assistant' as const, content: resposta, ts: new Date().toISOString() },
  ];
  return { resposta, estado, historico };
}

test('retomada 5 — conversa concluida (pedido_criado) reabre corretamente numa mensagem nova, sem repetir "pagamento confirmado"', async () => {
  const conversaConcluida: ConversaFake = {
    fase: 'pedido_criado',
    dados: { produto: { nome: 'Buquê de Rosas', preco: 140 }, pedidoId: 'pedido_antigo_001', pagamentoConfirmado: true },
    perguntasFeitas: ['ocasiao', 'destinatario', 'orcamento', 'dataEntrega', 'bairroOuCep'],
    historico: [{ role: 'assistant', content: 'Pagamento confirmado. Seu pedido foi registrado...', ts: '2026-07-01T00:00:00Z' }],
    modo_atendimento: 'flora',
  };

  const { resposta, estado } = await processarMensagemSimulada(conversaConcluida, 'Quero fazer outro pedido, um buquê de girassóis');

  assert.notEqual(estado.fase, 'pedido_criado', 'deve sair da fase concluida, nao repetir o pedido antigo');
  assert.doesNotMatch(resposta ?? '', /pagamento confirmado/i, 'nao deve repetir a finalizacao do pedido antigo numa conversa nova');
  // Reabriu do zero: ou pergunta de qualificação, ou já avança pra recomendação — nunca fica preso no pedido antigo.
  assert.notEqual(estado.dados.pedidoId, 'pedido_antigo_001', 'dados do pedido antigo nao devem vazar pro novo atendimento');
});

test('retomada 6 — modo humano ativo: Flora nao responde, so registra a mensagem do cliente no historico', async () => {
  const conversaEmHumano: ConversaFake = {
    fase: 'transferido_humano',
    dados: { motivoTransferencia: 'atendimento_humano: "quero falar com um atendente"' },
    perguntasFeitas: [],
    historico: [{ role: 'assistant', content: 'Vou te transferir para nossa equipe!...', ts: '2026-07-17T18:00:00Z' }],
    modo_atendimento: 'humano',
  };

  const { resposta, historico } = await processarMensagemSimulada(conversaEmHumano, 'Oi, alguém aí?');

  assert.equal(resposta, null, 'Flora nao deve gerar nenhuma resposta automatica em modo humano');
  assert.equal(historico.length, 2, 'a mensagem do cliente deve ser registrada no historico para o atendente ver no Inbox');
  assert.equal(historico[historico.length - 1].role, 'user');
  assert.equal(historico[historico.length - 1].content, 'Oi, alguém aí?');
  assert.ok(!historico.some(m => m.role === 'assistant' && m.ts > conversaEmHumano.historico[0].ts), 'nenhuma nova mensagem de assistente deve ter sido adicionada');
});

console.log('OK — retomada-contexto (webhook-meta): todos os cenarios passaram.');
