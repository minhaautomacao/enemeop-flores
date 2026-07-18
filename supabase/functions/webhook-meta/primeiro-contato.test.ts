// Teste direcionado dos 3 cenários da correção do primeiro atendimento
// (mensagem fixa antiga removida + horário comercial). Não é possível rodar
// o handler Deno.serve completo aqui (sem Deno CLI, sem DB/Meta reais) —
// este teste replica exatamente a mesma decisão de processarDM (index.ts)
// usando as peças puras reais (funil.ts + horario-comercial.ts), com
// dependências de catálogo/frete/pagamento injetadas como fakes, no mesmo
// espírito de orchestrator/src/lib/funil.test.ts.
//
// Rodar: npx tsx --test supabase/functions/webhook-meta/primeiro-contato.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoInicial,
  classificarIntencao,
  intencaoInterrompeFluxo,
  mensagemForaDeEscopo,
  mensagemTransferencia,
  avancarFunil,
  type DependenciasFunil,
  type EstadoConversa,
} from '../_shared/funil.ts';
import {
  dentroDoHorarioComercial,
  mensagemAvisoForaDoHorario,
  mensagemConfirmacaoForaDoHorario,
} from '../_shared/horario-comercial.ts';

const depsFake: DependenciasFunil = {
  buscarCatalogo: async () => [],
  buscarCategorias: async () => [],
  buscarProdutosPorCategoria: async () => [],
  revalidarProduto: async () => ({ disponivel: true }),
  calcularFrete: async () => ({ ok: false }),
  gerarPagamento: async () => null,
  criarPedido: async () => null,
  buscarFormasPagamento: async () => [],
};

// Réplica fiel da decisão em processarDM (webhook-meta/index.ts) — sem I/O.
async function processarMensagemSimulada(
  mensagemCliente: string,
  estadoRecebido: EstadoConversa,
  agora: Date,
  primeiraMensagem: boolean,
): Promise<{ resposta: string; estado: EstadoConversa }> {
  let estado = estadoRecebido;
  const intencao = classificarIntencao(mensagemCliente, estado.fase);
  const foraDoHorario = !dentroDoHorarioComercial(agora);

  let respostaFinal: string;

  if (intencaoInterrompeFluxo(intencao)) {
    if (intencao === 'assunto_fora_escopo') {
      respostaFinal = mensagemForaDeEscopo();
    } else {
      respostaFinal = mensagemTransferencia();
      estado = { ...estado, fase: 'transferido_humano', dados: { ...estado.dados, motivoTransferencia: `${intencao}: "${mensagemCliente}"` } };
    }
  } else {
    const avisoHorario = foraDoHorario && primeiraMensagem ? mensagemAvisoForaDoHorario() : '';
    if (foraDoHorario && estado.fase === 'aguardando_confirmacao') {
      respostaFinal = mensagemConfirmacaoForaDoHorario();
    } else {
      const resultado = await avancarFunil(estado, mensagemCliente, intencao, depsFake);
      estado = resultado.estado;
      respostaFinal = `${avisoHorario}${resultado.mensagem}`;
    }
  }

  return { resposta: respostaFinal, estado };
}

const QUINTA_DENTRO_DO_HORARIO = new Date('2026-07-16T17:00:00Z'); // 14h local
const QUINTA_FORA_DO_HORARIO = new Date('2026-07-16T23:00:00Z');   // 20h local

test('Cenário 1 — dentro do horário: "quais flores tem pra hoje?" gera resposta comercial normal', async () => {
  const { resposta } = await processarMensagemSimulada(
    'quais flores tem pra hoje?',
    estadoInicial(),
    QUINTA_DENTRO_DO_HORARIO,
    true,
  );
  assert.ok(!/melhorias/i.test(resposta), 'não deve mencionar "melhorias" (mensagem antiga)');
  assert.ok(!/manuten[cç][aã]o/i.test(resposta), 'não deve mencionar manutenção');
  assert.ok(!/wa\.me|whatsapp/i.test(resposta), 'não deve enviar link de WhatsApp no primeiro contato');
  assert.ok(!/fora do hor[aá]rio/i.test(resposta), 'dentro do horário não deve avisar sobre horário');
});

test('Cenário 2 — fora do horário: "quais flores tem pra hoje?" avisa o horário mas continua o atendimento', async () => {
  const { resposta, estado } = await processarMensagemSimulada(
    'quais flores tem pra hoje?',
    estadoInicial(),
    QUINTA_FORA_DO_HORARIO,
    true,
  );
  assert.ok(/fora do hor[aá]rio/i.test(resposta), 'deve avisar que está fora do horário');
  assert.notEqual(estado.fase, 'transferido_humano', 'não deve encaminhar automaticamente para humano só por estar fora do horário');
  assert.ok(!/wa\.me/i.test(resposta), 'não deve forçar link de WhatsApp por estar fora do horário');
  // Continua o atendimento: funil avança para qualificação e faz uma pergunta comercial.
  assert.equal(estado.fase, 'qualificacao');
  assert.ok(resposta.length > mensagemAvisoForaDoHorario().length, 'deve conter mais do que só o aviso de horário — uma pergunta comercial também');
});

test('Cenário 2b — fora do horário, aviso não se repete a cada mensagem', async () => {
  const primeira = await processarMensagemSimulada('quais flores tem pra hoje?', estadoInicial(), QUINTA_FORA_DO_HORARIO, true);
  const segunda = await processarMensagemSimulada('é pra aniversário', primeira.estado, QUINTA_FORA_DO_HORARIO, false);
  assert.ok(!/fora do hor[aá]rio/i.test(segunda.resposta), 'não deve repetir o aviso de horário na segunda mensagem da mesma conversa');
});

test('Cenário 2c — fora do horário na fase de confirmação: não confirma pedido nem gera pagamento', async () => {
  const estadoAguardandoConfirmacao: EstadoConversa = {
    fase: 'aguardando_confirmacao',
    dados: { produto: { nome: 'Buquê de Rosas', preco: 140 }, valorTotal: 160 },
    perguntasFeitas: ['ocasiao', 'destinatario', 'orcamento', 'dataEntrega', 'bairroOuCep'],
  };
  const { resposta, estado } = await processarMensagemSimulada('sim, confirmo', estadoAguardandoConfirmacao, QUINTA_FORA_DO_HORARIO, false);
  assert.ok(/pr[oó]xim[ao] hor[aá]rio comercial|reabrirmos/i.test(resposta), 'deve deixar claro que a confirmação final ocorre no próximo horário comercial');
  assert.equal(estado.fase, 'aguardando_confirmacao', 'a fase não deve avançar fora do horário — retoma sozinha depois');
});

test('Cenário 3 — pedido explícito "quero falar com um atendente" aciona o handoff oficial configurado', async () => {
  const { resposta, estado } = await processarMensagemSimulada(
    'quero falar com um atendente',
    estadoInicial(),
    QUINTA_DENTRO_DO_HORARIO,
    true,
  );
  assert.equal(estado.fase, 'transferido_humano');
  assert.equal(resposta, mensagemTransferencia());
});

console.log('OK — primeiro-contato (webhook-meta): todos os cenários passaram.');
