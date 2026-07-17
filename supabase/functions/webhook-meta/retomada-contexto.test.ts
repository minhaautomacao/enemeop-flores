// Testes direcionados da correção de retomada de contexto e de handoff
// humano real (dois bugs reais encontrados em testes ponta a ponta
// 2026-07-17):
//
// 1) Flora afirmava "já te enviei o link de pagamento" para uma simples
//    "Olá", sem checar se havia um link real (ver retomada 1-4 em
//    ../../orchestrator/src/lib/funil.test.ts).
// 2) fase="transferido_humano" ficava órfã pra sempre: o texto "vou te
//    transferir" era enviado por `default:` do switch em avancarFunil (e
//    outros pontos internos: falha de CEP/frete, falha de pagamento) sem
//    NUNCA criar um ticket real nem marcar modo_atendimento='humano' — a
//    cada mensagem seguinte a mesma fase fantasma repetia a mesma frase,
//    para sempre, sem jamais chegar a um atendente de verdade.
//
// Este arquivo replica sem I/O as partes de processarDM (webhook-meta/
// index.ts) que dependem de conversaRow/atendimentos_humanos — o núcleo
// puro (avancarFunil) é testado diretamente em funil.test.ts.
//
// Rodar: npx tsx --test supabase/functions/webhook-meta/retomada-contexto.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoInicial,
  classificarIntencao,
  intencaoInterrompeFluxo,
  avancarFunil,
  mensagemTransferencia,
  mensagemTransferenciaLimitacaoTecnica,
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
  id: string;
  fase: Fase;
  dados: EstadoConversa['dados'];
  perguntasFeitas: string[];
  historico: Mensagem[];
  modo_atendimento: string;
}

type OrigemHandoff = 'cliente_solicitou' | 'flora_sem_confianca' | 'limite_tecnico';
interface AtendimentoFake { conversaId: string; codigo: string; status: string; origem: OrigemHandoff }

let seqCodigo = 0;
function gerarCodigo(): string { return `TCK${String(++seqCodigo).padStart(3, '0')}`; }

/** Réplica de criarOuReusarAtendimento (index.ts): índice único garante que
 * uma conversa nunca tem 2 tickets abertos ao mesmo tempo — reusa o código. */
function criarOuReusarAtendimento(atendimentos: AtendimentoFake[], conversaId: string, origem: OrigemHandoff): string {
  const aberto = atendimentos.find(a => a.conversaId === conversaId && ['aguardando_humano', 'em_atendimento'].includes(a.status));
  if (aberto) return aberto.codigo;
  const codigo = gerarCodigo();
  atendimentos.push({ conversaId, codigo, status: 'aguardando_humano', origem });
  return codigo;
}

/** Réplica de iniciarHandoffHumano (index.ts): só aqui a mensagem de
 * transição é enviada, sempre junto da criação/reuso real do ticket e da
 * marcação de modo_atendimento='humano'. */
function iniciarHandoffSimulado(conversa: ConversaFake, atendimentos: AtendimentoFake[], origem: OrigemHandoff): string {
  conversa.modo_atendimento = 'humano';
  const base = origem === 'limite_tecnico' ? mensagemTransferenciaLimitacaoTecnica() : mensagemTransferencia();
  const codigo = criarOuReusarAtendimento(atendimentos, conversa.id, origem);
  return `${base} Seu código de atendimento é ${codigo}.`;
}

/** Réplica fiel da decisão em processarDM (webhook-meta/index.ts): bloqueio
 * em modo humano, reparo de fase órfã (pedido_criado/encerrado_sem_venda/
 * transferido_humano sem handoff ativo) e criação do handoff real no
 * exato momento em que o funil decide transferir — nunca antes disso. */
async function processarMensagemSimulada(
  conversa: ConversaFake,
  atendimentos: AtendimentoFake[],
  mensagemCliente: string,
): Promise<{ resposta: string | null; estado: EstadoConversa }> {
  if (conversa.modo_atendimento === 'humano') {
    conversa.historico.push({ role: 'user', content: mensagemCliente, ts: new Date().toISOString() });
    return { resposta: null, estado: { fase: conversa.fase, dados: conversa.dados, perguntasFeitas: conversa.perguntasFeitas } };
  }

  let estado: EstadoConversa = { fase: conversa.fase, dados: conversa.dados, perguntasFeitas: conversa.perguntasFeitas };
  if (estado.fase === 'pedido_criado' || estado.fase === 'encerrado_sem_venda' || estado.fase === 'transferido_humano') {
    // transferido_humano só chega aqui se modo_atendimento !== 'humano' (o
    // gate acima já teria retornado) — ou seja, é sempre fase órfã: nunca
    // existiu handoff real, ou ele foi concluído/devolvido/cancelado.
    estado = estadoInicial();
  }

  const intencao = classificarIntencao(mensagemCliente, estado.fase);
  let resposta: string;
  if (intencaoInterrompeFluxo(intencao)) {
    const origem: OrigemHandoff = intencao === 'atendimento_humano' ? 'cliente_solicitou' : 'flora_sem_confianca';
    resposta = iniciarHandoffSimulado(conversa, atendimentos, origem);
    estado = { ...estado, fase: 'transferido_humano', dados: { ...estado.dados, motivoTransferencia: `${intencao}: "${mensagemCliente}"` } };
  } else {
    const r = await avancarFunil(estado, mensagemCliente, intencao, depsFake);
    estado = r.estado;
    if (estado.fase === 'transferido_humano') {
      // avancarFunil decidiu internamente transferir (CEP/pagamento falhou,
      // fase inesperada) — só agora, na hora exata, o handoff real é criado.
      const motivo = estado.dados.motivoTransferencia ?? 'transferencia solicitada pelo funil';
      resposta = iniciarHandoffSimulado(conversa, atendimentos, 'flora_sem_confianca');
      void motivo;
    } else {
      resposta = r.mensagem;
    }
  }

  conversa.fase = estado.fase;
  conversa.dados = estado.dados;
  conversa.perguntasFeitas = estado.perguntasFeitas;
  conversa.historico.push({ role: 'user', content: mensagemCliente, ts: new Date().toISOString() });
  conversa.historico.push({ role: 'assistant', content: resposta, ts: new Date().toISOString() });
  return { resposta, estado };
}

test('retomada 5 — conversa concluida (pedido_criado) reabre corretamente numa mensagem nova, sem repetir "pagamento confirmado"', async () => {
  const conversaConcluida: ConversaFake = {
    id: 'c-pedido-criado',
    fase: 'pedido_criado',
    dados: { produto: { nome: 'Buquê de Rosas', preco: 140 }, pedidoId: 'pedido_antigo_001', pagamentoConfirmado: true },
    perguntasFeitas: ['ocasiao', 'destinatario', 'orcamento', 'dataEntrega', 'bairroOuCep'],
    historico: [{ role: 'assistant', content: 'Pagamento confirmado. Seu pedido foi registrado...', ts: '2026-07-01T00:00:00Z' }],
    modo_atendimento: 'flora',
  };

  const { resposta, estado } = await processarMensagemSimulada(conversaConcluida, [], 'Quero fazer outro pedido, um buquê de girassóis');

  assert.notEqual(estado.fase, 'pedido_criado', 'deve sair da fase concluida, nao repetir o pedido antigo');
  assert.doesNotMatch(resposta ?? '', /pagamento confirmado/i, 'nao deve repetir a finalizacao do pedido antigo numa conversa nova');
  assert.notEqual(estado.dados.pedidoId, 'pedido_antigo_001', 'dados do pedido antigo nao devem vazar pro novo atendimento');
});

test('cenario 1 — fase transferido_humano orfa (sem handoff ativo) + "Tem girassol pra hoje?" -> Flora retoma e consulta disponibilidade', async () => {
  const conversaOrfa: ConversaFake = {
    id: 'c-girassol',
    fase: 'transferido_humano',
    dados: { motivoTransferencia: 'Fase inesperada: transferido_humano' },
    perguntasFeitas: [],
    historico: [],
    modo_atendimento: 'flora', // nunca chegou a ser 'humano' de verdade
  };

  const { resposta, estado } = await processarMensagemSimulada(conversaOrfa, [], 'Tem girassol pra hoje');

  assert.doesNotMatch(resposta ?? '', /vou te transferir|nossa equipe/i, 'nao deve repetir a transferencia fantasma');
  assert.notEqual(estado.fase, 'transferido_humano', 'a fase orfa deve ser reparada');
  assert.match(resposta ?? '', /Buquê de Rosas/, 'deve consultar o catalogo real, nao so devolver texto fixo');
});

test('cenario 2 — handoff realmente ativo: Flora nao responde, so registra a mensagem do cliente no historico', async () => {
  const conversaEmHumano: ConversaFake = {
    id: 'c-humano-ativo',
    fase: 'transferido_humano',
    dados: { motivoTransferencia: 'atendimento_humano: "quero falar com um atendente"' },
    perguntasFeitas: [],
    historico: [{ role: 'assistant', content: 'Vou te transferir para nossa equipe! Seu código de atendimento é TCK001.', ts: '2026-07-17T18:00:00Z' }],
    modo_atendimento: 'humano',
  };
  const atendimentos: AtendimentoFake[] = [{ conversaId: 'c-humano-ativo', codigo: 'TCK001', status: 'em_atendimento', origem: 'cliente_solicitou' }];

  const { resposta } = await processarMensagemSimulada(conversaEmHumano, atendimentos, 'Oi, alguém aí?');

  assert.equal(resposta, null, 'Flora nao deve gerar nenhuma resposta automatica em modo humano');
  assert.equal(atendimentos.length, 1, 'nao deve criar novo ticket enquanto o atendimento humano esta ativo');
  assert.equal(conversaEmHumano.historico[conversaEmHumano.historico.length - 1].role, 'user');
});

test('cenario 3 — criacao do handoff: uma unica mensagem de transicao, com o codigo do ticket recem-criado', async () => {
  const conversaNova: ConversaFake = {
    id: 'c-novo-handoff',
    fase: 'inicio',
    dados: {},
    perguntasFeitas: [],
    historico: [],
    modo_atendimento: 'flora',
  };
  const atendimentos: AtendimentoFake[] = [];

  const { resposta } = await processarMensagemSimulada(conversaNova, atendimentos, 'Quero falar com um atendente');

  assert.equal(atendimentos.length, 1, 'deve criar exatamente um ticket');
  assert.match(resposta ?? '', new RegExp(`código de atendimento é ${atendimentos[0].codigo}`));
  assert.equal(conversaNova.modo_atendimento, 'humano');
});

test('cenario 4 — segunda mensagem durante o handoff: transicao nao se repete, nenhum ticket duplicado', async () => {
  const conversaNova: ConversaFake = {
    id: 'c-sem-duplicar',
    fase: 'inicio',
    dados: {},
    perguntasFeitas: [],
    historico: [],
    modo_atendimento: 'flora',
  };
  const atendimentos: AtendimentoFake[] = [];

  await processarMensagemSimulada(conversaNova, atendimentos, 'Quero falar com um atendente');
  assert.equal(atendimentos.length, 1);

  const { resposta } = await processarMensagemSimulada(conversaNova, atendimentos, 'Alguém aí?');
  assert.equal(resposta, null, 'segunda mensagem durante o handoff nao deve gerar nova transicao');
  assert.equal(atendimentos.length, 1, 'nao deve criar um segundo ticket');
});

test('cenario 5 — handoff concluido/devolvido (modo_atendimento voltou a flora) + "Tem lírios?" -> Flora retoma', async () => {
  const conversaConcluida: ConversaFake = {
    id: 'c-concluido',
    fase: 'transferido_humano', // fase nunca foi resetada quando o atendente concluiu
    dados: { motivoTransferencia: 'atendimento_humano: "quero falar com um atendente"' },
    perguntasFeitas: [],
    historico: [],
    modo_atendimento: 'flora', // atendente já concluiu/devolveu — voltou pra Flora
  };
  const atendimentos: AtendimentoFake[] = [{ conversaId: 'c-concluido', codigo: 'TCK009', status: 'concluido', origem: 'cliente_solicitou' }];

  const { resposta, estado } = await processarMensagemSimulada(conversaConcluida, atendimentos, 'Tem lírios');

  assert.doesNotMatch(resposta ?? '', /vou te transferir|nossa equipe/i);
  assert.notEqual(estado.fase, 'transferido_humano');
  assert.equal(atendimentos.length, 1, 'nao deve criar novo ticket so por retomar apos handoff concluido');
});

test('cenario 6 — produto realmente indisponivel no catalogo: resposta honesta, sem handoff automatico', async () => {
  const depsSemCatalogo: DependenciasFunil = { ...depsFake, buscarCatalogo: async () => [] };
  const conversa: ConversaFake = { id: 'c-indisponivel', fase: 'inicio', dados: {}, perguntasFeitas: [], historico: [], modo_atendimento: 'flora' };
  const estado: EstadoConversa = { fase: conversa.fase, dados: conversa.dados, perguntasFeitas: conversa.perguntasFeitas };

  const intencao = classificarIntencao('Tem orquídea azul', estado.fase);
  const r = await avancarFunil(estado, 'Tem orquídea azul', intencao, depsSemCatalogo);

  assert.notEqual(r.estado.fase, 'transferido_humano', 'produto nao encontrado nunca aciona handoff automatico');
  assert.doesNotMatch(r.mensagem, /vou te transferir|nossa equipe/i);
  assert.match(r.mensagem, /não temos orquídea azul|preferência/i);
});

test('cenario 7 — WhatsApp so aparece (com link clicavel) na transferencia por limitacao tecnica real, nunca nos outros motivos', () => {
  const atendimentos: AtendimentoFake[] = [];
  const conversaTecnica: ConversaFake = { id: 'c-tecnica', fase: 'inicio', dados: {}, perguntasFeitas: [], historico: [], modo_atendimento: 'flora' };
  const conversaPedido: ConversaFake = { id: 'c-pedido-cliente', fase: 'inicio', dados: {}, perguntasFeitas: [], historico: [], modo_atendimento: 'flora' };

  const msgTecnica = iniciarHandoffSimulado(conversaTecnica, atendimentos, 'limite_tecnico');
  const msgClienteSolicitou = iniciarHandoffSimulado(conversaPedido, atendimentos, 'cliente_solicitou');

  assert.match(msgTecnica, /https:\/\/wa\.me\/5511982829083/);
  assert.doesNotMatch(msgClienteSolicitou, /wa\.me|WhatsApp/i);
});

console.log('OK — retomada-contexto (webhook-meta): todos os cenarios passaram.');
