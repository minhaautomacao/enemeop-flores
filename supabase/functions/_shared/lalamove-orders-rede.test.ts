// Testa criarEntregaLalamove/cancelarEntregaLalamove/consultarStatusEntregaLalamove
// diretamente (não só a primitiva chamarLalamove) — desde que config passou a
// ser um parâmetro OBRIGATÓRIO dessas três funções (nunca mais resolvido
// internamente via Deno.env dentro de resolverConfig()), elas ficaram
// diretamente testáveis com node:test/tsx, sem precisar do runtime Deno.
// Substitui lalamove-cancelamento-rede.test.ts (que só conseguia testar
// chamarLalamove diretamente, porque cancelarEntregaLalamove ainda lia
// Deno.env na época).
//
// Mesmo mock fiel via servidor HTTP local já estabelecido nesta base —
// nenhuma chamada de rede sai deste processo além do servidor local.
//
// Rodar: npx tsx --test supabase/functions/_shared/lalamove-orders-rede.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { type ConfigResolvida } from './lalamove.ts';
import { montarStringAssinatura } from './lalamove-config.ts';
import { criarEntregaLalamove, cancelarEntregaLalamove, consultarStatusEntregaLalamove, type CriarEntregaParams } from './lalamove-orders.ts';

const API_KEY = 'chave-teste-mock';
const API_SECRET = 'segredo-teste-mock';

async function gerarAssinaturaEsperada(secret: string, method: string, path: string, body: string, timestamp: string): Promise<string> {
  const raw = montarStringAssinatura(timestamp, method, path, body);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function subirServidorMock(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function configPara(baseUrl: string, ambiente: 'sandbox' | 'production' = 'sandbox'): ConfigResolvida {
  return { ambiente, baseUrl, market: 'BR' };
}

const PARAMS: CriarEntregaParams = {
  quotationId: 'quotation-123',
  expiresAt: '2099-01-01T00:00:00.00Z',
  remetente: { stopId: 'stop-origem-1', nome: 'Enemeop Flores', telefone: '+5511999990000' },
  destinatario: { stopId: 'stop-destino-1', nome: 'Camila', telefone: '+5511988880000' },
  pedidoId: 'pedido-teste-abc',
};

// ── criarEntregaLalamove ──────────────────────────────────────────────────

test('criarEntregaLalamove: mock responde 200 com orderId -> ok:true', async () => {
  const { server, baseUrl } = await subirServidorMock((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v3/orders');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: { orderId: 'order-teste-123', status: 'ASSIGNING_DRIVER' } }));
  });
  try {
    const resultado = await criarEntregaLalamove(API_KEY, API_SECRET, PARAMS, configPara(baseUrl));
    assert.equal(resultado.ok, true);
    if (resultado.ok) {
      assert.equal(resultado.orderId, 'order-teste-123');
      assert.equal(resultado.status, 'ASSIGNING_DRIVER');
    }
  } finally {
    server.close();
  }
});

test('criarEntregaLalamove: usa exatamente o baseUrl do config passado, nunca um valor hardcoded', async () => {
  const { server, baseUrl } = await subirServidorMock((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: { orderId: 'order-x', status: 'ASSIGNING_DRIVER' } }));
  });
  try {
    // baseUrl é só o do servidor local (127.0.0.1:porta-aleatoria) — se a
    // função algum dia voltasse a resolver a URL sozinha (via Deno.env),
    // esta chamada falharia por não conseguir conectar em rest.lalamove.com.
    const resultado = await criarEntregaLalamove(API_KEY, API_SECRET, PARAMS, configPara(baseUrl));
    assert.equal(resultado.ok, true);
  } finally {
    server.close();
  }
});

test('criarEntregaLalamove: cotação expirada nunca chama a API', async () => {
  let chamouServidor = false;
  const { server, baseUrl } = await subirServidorMock((req, res) => {
    chamouServidor = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: { orderId: 'nunca-deveria-existir' } }));
  });
  try {
    const paramsExpirados: CriarEntregaParams = { ...PARAMS, expiresAt: '2020-01-01T00:00:00.00Z' };
    const resultado = await criarEntregaLalamove(API_KEY, API_SECRET, paramsExpirados, configPara(baseUrl));
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.motivo, 'cotacao_expirada');
    assert.equal(chamouServidor, false, 'nunca deve chamar a API com cotação vencida');
  } finally {
    server.close();
  }
});

test('criarEntregaLalamove: 400 (recusa documentada) -> erro_api, nunca ambiguo', async () => {
  const { server, baseUrl } = await subirServidorMock((req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'INVALID_QUOTATION' }));
  });
  try {
    const resultado = await criarEntregaLalamove(API_KEY, API_SECRET, PARAMS, configPara(baseUrl));
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.motivo, 'erro_api');
  } finally {
    server.close();
  }
});

test('criarEntregaLalamove: conexão derrubada -> ambiguo (nunca "erro_api", nunca assume que não criou)', async () => {
  const { server, baseUrl } = await subirServidorMock((req) => { req.destroy(); });
  try {
    const resultado = await criarEntregaLalamove(API_KEY, API_SECRET, PARAMS, configPara(baseUrl));
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.motivo, 'ambiguo');
  } finally {
    server.close();
  }
});

// ── cancelarEntregaLalamove (migrado de lalamove-cancelamento-rede.test.ts, agora testando a função real) ──

test('cancelarEntregaLalamove: mock responde 200 -> ok:true', async () => {
  const { server, baseUrl } = await subirServidorMock((req, res) => {
    assert.equal(req.method, 'DELETE');
    assert.equal(req.url, '/v3/orders/order-real-simulado-123');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
  });
  try {
    const resultado = await cancelarEntregaLalamove(API_KEY, API_SECRET, 'order-real-simulado-123', configPara(baseUrl));
    assert.equal(resultado.ok, true);
  } finally {
    server.close();
  }
});

test('cancelarEntregaLalamove: mock responde 400 (corrida já coletada) -> recusado_pela_transportadora', async () => {
  const { server, baseUrl } = await subirServidorMock((req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'ORDER_STATUS_NOT_ALLOW_CANCEL' }));
  });
  try {
    const resultado = await cancelarEntregaLalamove(API_KEY, API_SECRET, 'order-ja-coletado', configPara(baseUrl));
    assert.equal(resultado.ok, false);
    if (!resultado.ok) {
      assert.equal(resultado.motivo, 'recusado_pela_transportadora');
      assert.match(resultado.erroSanitizado, /HTTP 400/);
    }
  } finally {
    server.close();
  }
});

test('cancelarEntregaLalamove: conexão derrubada -> ambiguo', async () => {
  const { server, baseUrl } = await subirServidorMock((req) => { req.destroy(); });
  try {
    const resultado = await cancelarEntregaLalamove(API_KEY, API_SECRET, 'order-rede-caiu', configPara(baseUrl));
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.motivo, 'ambiguo');
  } finally {
    server.close();
  }
});

test('cancelarEntregaLalamove: timeout -> ambiguo, erroSanitizado="timeout"', async () => {
  const { server, baseUrl } = await subirServidorMock(() => { /* nunca responde */ });
  try {
    const resultado = await cancelarEntregaLalamove(API_KEY, API_SECRET, 'order-timeout', { ...configPara(baseUrl) });
    assert.equal(resultado.ok, false);
    if (!resultado.ok) {
      assert.equal(resultado.motivo, 'ambiguo');
      assert.equal(resultado.erroSanitizado, 'timeout');
    }
  } finally {
    server.close();
  }
});

// ── consultarStatusEntregaLalamove (nova) ──────────────────────────────────

test('consultarStatusEntregaLalamove: 200 com status/driverId -> ok:true com dados', async () => {
  const { server, baseUrl } = await subirServidorMock((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/v3/orders/order-em-andamento');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: { orderId: 'order-em-andamento', status: 'ON_GOING', driverId: '33522' } }));
  });
  try {
    const resultado = await consultarStatusEntregaLalamove(API_KEY, API_SECRET, 'order-em-andamento', configPara(baseUrl));
    assert.equal(resultado.ok, true);
    if (resultado.ok) {
      assert.equal(resultado.status, 'ON_GOING');
      assert.equal(resultado.driverId, '33522');
    }
  } finally {
    server.close();
  }
});

test('consultarStatusEntregaLalamove: 404 -> nao_encontrado', async () => {
  const { server, baseUrl } = await subirServidorMock((req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'ORDER_NOT_FOUND' }));
  });
  try {
    const resultado = await consultarStatusEntregaLalamove(API_KEY, API_SECRET, 'order-inexistente', configPara(baseUrl));
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.motivo, 'nao_encontrado');
  } finally {
    server.close();
  }
});

test('consultarStatusEntregaLalamove: 500 -> erro_transitorio (motivo DIFERENTE de nao_encontrado, nunca mascarado)', async () => {
  const { server, baseUrl } = await subirServidorMock((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'INTERNAL_ERROR' }));
  });
  try {
    const resultado = await consultarStatusEntregaLalamove(API_KEY, API_SECRET, 'order-erro-servidor', configPara(baseUrl));
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.motivo, 'erro_transitorio');
  } finally {
    server.close();
  }
});

test('consultarStatusEntregaLalamove: timeout/conexão derrubada -> erro_transitorio, nunca nao_encontrado', async () => {
  const { server, baseUrl } = await subirServidorMock((req) => { req.destroy(); });
  try {
    const resultado = await consultarStatusEntregaLalamove(API_KEY, API_SECRET, 'order-rede-caiu', configPara(baseUrl));
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.motivo, 'erro_transitorio');
  } finally {
    server.close();
  }
});

// ── Assinatura HMAC e isolamento de credencial ──────────────────────────────

test('assinatura HMAC no header Authorization bate com o algoritmo real (gerarAssinatura)', async () => {
  let authHeaderRecebido = '';
  const { server, baseUrl } = await subirServidorMock((req, res) => {
    authHeaderRecebido = req.headers['authorization'] ?? '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: { orderId: 'order-assinatura', status: 'ASSIGNING_DRIVER' } }));
  });
  try {
    await criarEntregaLalamove(API_KEY, API_SECRET, PARAMS, configPara(baseUrl));

    const match = authHeaderRecebido.match(/^hmac ([^:]+):(\d+):([0-9a-f]+)$/);
    assert.ok(match, `header Authorization mal formado: "${authHeaderRecebido}"`);
    const [, apiKeyRecebida, timestamp, assinaturaRecebida] = match!;
    assert.equal(apiKeyRecebida, API_KEY);

    const bodyEsperado = JSON.stringify({
      data: {
        quotationId: PARAMS.quotationId,
        sender: { stopId: PARAMS.remetente.stopId, name: PARAMS.remetente.nome, phone: PARAMS.remetente.telefone },
        recipients: [{ stopId: PARAMS.destinatario.stopId, name: PARAMS.destinatario.nome, phone: PARAMS.destinatario.telefone }],
        metadata: { pedidoId: PARAMS.pedidoId },
      },
    });
    const assinaturaEsperada = await gerarAssinaturaEsperada(API_SECRET, 'POST', '/v3/orders', bodyEsperado, timestamp);
    assert.equal(assinaturaRecebida, assinaturaEsperada);
  } finally {
    server.close();
  }
});

test('isolamento de credencial: apiKey/apiSecret diferentes produzem assinaturas HMAC diferentes pro mesmo pedido — nunca reaproveita assinatura entre ambientes', async () => {
  const headersRecebidos: string[] = [];
  const { server, baseUrl } = await subirServidorMock((req, res) => {
    headersRecebidos.push(req.headers['authorization'] ?? '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: { orderId: 'order-isolamento', status: 'ASSIGNING_DRIVER' } }));
  });
  try {
    await criarEntregaLalamove('chave-producao-fake', 'segredo-producao-fake', PARAMS, configPara(baseUrl, 'production'));
    await criarEntregaLalamove('chave-teste-fake', 'segredo-teste-fake', PARAMS, configPara(baseUrl, 'sandbox'));

    assert.equal(headersRecebidos.length, 2);
    assert.notEqual(headersRecebidos[0], headersRecebidos[1], 'credenciais diferentes devem sempre gerar headers Authorization diferentes');
    assert.match(headersRecebidos[0], /^hmac chave-producao-fake:/);
    assert.match(headersRecebidos[1], /^hmac chave-teste-fake:/);
  } finally {
    server.close();
  }
});

test('cancelarEntregaLalamove nunca envia corpo (DELETE sem body)', async () => {
  let bodyRecebido = '';
  const { server, baseUrl } = await subirServidorMock((req, res) => {
    req.on('data', (chunk) => { bodyRecebido += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  try {
    await cancelarEntregaLalamove(API_KEY, API_SECRET, 'order-sem-body', configPara(baseUrl));
    assert.equal(bodyRecebido, '');
  } finally {
    server.close();
  }
});
