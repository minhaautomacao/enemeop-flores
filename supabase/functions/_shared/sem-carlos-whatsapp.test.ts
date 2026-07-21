// Guarda de regressão: CARLOS_WHATSAPP foi removido de todo o código de
// produção (substituído por STORE_PHONE / registro em atendimentos_humanos
// — ver handoff-whatsapp-sdr.ts). Este teste falha se a string voltar a
// aparecer em qualquer arquivo de código/config versionado, pra nunca
// reintroduzir silenciosamente o fallback antigo.
// Rodar: npx tsx --test supabase/functions/_shared/sem-carlos-whatsapp.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const IGNORAR_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.vercel']);
const EXTENSOES = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.env.example', '.md', '.sql']);

function listarArquivos(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (IGNORAR_DIRS.has(nome)) continue;
    const caminho = join(dir, nome);
    const info = statSync(caminho);
    if (info.isDirectory()) {
      listarArquivos(caminho, out);
    } else if (EXTENSOES.has(extname(nome)) || nome.endsWith('.env.example')) {
      out.push(caminho);
    }
  }
  return out;
}

const ESTE_ARQUIVO = fileURLToPath(import.meta.url);
const NOME_VARIAVEL_ANTIGA = ['CARLOS', 'WHATSAPP'].join('_'); // nunca aparece literal aqui, senão o próprio guard se acusaria

test('CARLOS_WHATSAPP nao aparece em nenhum arquivo de codigo/config versionado', () => {
  const arquivos = listarArquivos(RAIZ).filter((f) => f !== ESTE_ARQUIVO);
  const comReferencia = arquivos.filter((f) => {
    try {
      return readFileSync(f, 'utf8').includes(NOME_VARIAVEL_ANTIGA);
    } catch {
      return false;
    }
  });
  assert.deepEqual(comReferencia, [], `CARLOS_WHATSAPP ainda referenciado em: ${comReferencia.join(', ')}`);
});
