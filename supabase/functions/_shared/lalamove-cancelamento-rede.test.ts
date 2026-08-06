// Isolamento de teste pro cancelamento de logística na Lalamove (Fase de
// planejamento pediu: nenhuma corrida real deve ser criada/cancelada para
// testar isso — usar sandbox, credenciais separadas, função isolada ou mock
// fiel da API). Não existe hoje credencial de sandbox Lalamove separada nem
// forma de isolar LALAMOVE_ENVIRONMENT por função nos Secrets do Supabase
// (são globais ao projeto), então a opção escolhida foi "mock fiel da API":
// um servidor HTTP local que responde exatamente como a Lalamove real
// responderia a um DELETE /v3/orders/{orderId} (200 sucesso, 4xx recusa,
// timeout/rede indisponível → ambíguo).
//
// Testa chamarLalamove() diretamente (a função de rede genérica que
// cancelarEntregaLalamove usa por baixo) — cancelarEntregaLalamove() em si
// não é chamada aqui porque ela lê LALAMOVE_ENVIRONMENT via Deno.env dentro
// de resolverConfig(), inacessível sob node:test (mesma razão documentada em
// mercadopago.test.ts pra não testar unitariamente adaptadores de borda que
// tocam Deno.env). Construindo o ConfigResolvida manualmente aqui (sem
// Deno.env) e comparando com http://127.0.0.1, exercitamos exatamente a
// mesma assinatura HMAC, o mesmo verbo/path e a mesma classificação de erro
// (status 0 = ambíguo, status >0 = recusa) que cancelarEntregaLalamove usa —
// só pulamos a leitura do env var, que é puramente configuração de qual URL
// chamar. Nenhuma chamada de rede sai deste processo além do servidor local.
//
// Rodar: npx tsx --test supabase/functions/_shared/lalamove-cancelamento-rede.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { chamarLalamove, type ConfigResolvida } from './lalamove.ts';
import { montarStringAssinatura } from './lalamove-config.ts';

const API_KEY = 'chave-teste-mock';
const API_SECRET = 'segredo-teste-mock';

async function gerarAssinaturaEsperada(method: string, path: string, body: string, timestamp: string): Promise<string> {
  const raw = montarStringAssinatura(timestamp, method, path, body);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(API_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
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

function configPara(baseUrl: string): ConfigResolvida {
  return { ambiente: 'sandbox', baseUrl, market: 'BR' };
}

test('DELETE /v3/orders/{id} — mock responde 200 (Lalamove confirmou cancelamento) → ok:true', async () => {
  const { server, baseUrl } = await subirServidorMock((req, res) => {
    assert.equal(req.method, 'DELETE');
    assert.equal(req.url, '/v3/orders/order-real-simulado-123');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
  });
  try {
    const resultado = await chamarLalamove(configPara(baseUrl), API_KEY, API_SECRET, 'DELETE', '/v3/orders/order-real-simulado-123', null, 5000);
    assert.equal(resultado.ok, true);
  } finally {
    server.close();
  }
});

test('DELETE /v3/orders/{id} — mock responde 400 (corrida já coletada, recusa documentada da transportadora) → ok:false, status>0', async () => {
  const { server, baseUrl } = await subirServidorMock((req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'ORDER_STATUS_NOT_ALLOW_CANCEL' }));
  });
  try {
    const resultado = await chamarLalamove(configPara(baseUrl), API_KEY, API_SECRET, 'DELETE', '/v3/orders/order-ja-coletado', null, 5000);
    assert.equal(resultado.ok, false);
    if (!resultado.ok) {
      assert.equal(resultado.status, 400);
      assert.match(resultado.erroSanitizado, /HTTP 400/);
      assert.match(resultado.erroSanitizado, /ORDER_STATUS_NOT_ALLOW_CANCEL/);
    }
  } finally {
    server.close();
  }
});

test('DELETE /v3/orders/{id} — servidor derruba a conexão (rede indisponível) → ok:false, status:0 (ambíguo — nunca "recusado")', async () => {
  const { server, baseUrl } = await subirServidorMock((req, res) => {
    req.destroy();
  });
  try {
    const resultado = await chamarLalamove(configPara(baseUrl), API_KEY, API_SECRET, 'DELETE', '/v3/orders/order-rede-caiu', null, 5000);
    assert.equal(resultado.ok, false);
    if (!resultado.ok) {
      assert.equal(resultado.status, 0);
    }
  } finally {
    server.close();
  }
});

test('DELETE /v3/orders/{id} — timeout (sem resposta) → ok:false, status:0, erroSanitizado="timeout"', async () => {
  const { server, baseUrl } = await subirServidorMock(() => {
    // nunca responde — força o AbortSignal.timeout do lado do chamador
  });
  try {
    const resultado = await chamarLalamove(configPara(baseUrl), API_KEY, API_SECRET, 'DELETE', '/v3/orders/order-timeout', null, 200);
    assert.equal(resultado.ok, false);
    if (!resultado.ok) {
      assert.equal(resultado.status, 0);
      assert.equal(resultado.erroSanitizado, 'timeout');
    }
  } finally {
    server.close();
  }
});

test('assinatura HMAC enviada no header Authorization é exatamente a esperada (mesmo algoritmo real de gerarAssinatura)', async () => {
  let authHeaderRecebido = '';
  const { server, baseUrl } = await subirServidorMock((req, res) => {
    authHeaderRecebido = req.headers['authorization'] ?? '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  try {
    await chamarLalamove(configPara(baseUrl), API_KEY, API_SECRET, 'DELETE', '/v3/orders/order-assinatura', null, 5000);

    const match = authHeaderRecebido.match(/^hmac ([^:]+):(\d+):([0-9a-f]+)$/);
    assert.ok(match, `header Authorization mal formado: "${authHeaderRecebido}"`);
    const [, apiKeyRecebida, timestamp, assinaturaRecebida] = match!;
    assert.equal(apiKeyRecebida, API_KEY);

    const assinaturaEsperada = await gerarAssinaturaEsperada('DELETE', '/v3/orders/order-assinatura', '', timestamp);
    assert.equal(assinaturaRecebida, assinaturaEsperada);
  } finally {
    server.close();
  }
});

test('nunca envia corpo (DELETE sem body) — Content-Length ausente ou zero', async () => {
  let bodyRecebido = '';
  const { server, baseUrl } = await subirServidorMock((req, res) => {
    req.on('data', (chunk) => { bodyRecebido += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  try {
    await chamarLalamove(configPara(baseUrl), API_KEY, API_SECRET, 'DELETE', '/v3/orders/order-sem-body', null, 5000);
    assert.equal(bodyRecebido, '');
  } finally {
    server.close();
  }
});
