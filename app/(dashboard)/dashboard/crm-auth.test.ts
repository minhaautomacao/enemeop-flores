// Confirma que leads/page.tsx e conversas/page.tsx montam o header
// Authorization somente no servidor (Server Component, sem "use client"),
// lendo o segredo de process.env.FACTORY_SECRET — nunca expondo o valor
// ao browser nem usando uma variável NEXT_PUBLIC_ para o segredo.
// Rodar: npx tsx --test "app/(dashboard)/dashboard/crm-auth.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

const PAGINAS = [
  { nome: 'leads', arquivo: join(DIR, 'leads', 'page.tsx') },
  { nome: 'conversas', arquivo: join(DIR, 'conversas', 'page.tsx') },
];

for (const { nome, arquivo } of PAGINAS) {
  const fonte = readFileSync(arquivo, 'utf-8');

  test(`${nome}/page.tsx: continua sendo Server Component (sem "use client")`, () => {
    assert.equal(/^\s*['"]use client['"]/m.test(fonte), false);
  });

  test(`${nome}/page.tsx: lê o segredo de process.env.FACTORY_SECRET`, () => {
    assert.match(fonte, /process\.env\.FACTORY_SECRET/);
  });

  test(`${nome}/page.tsx: envia Authorization: Bearer com o segredo do servidor`, () => {
    assert.match(fonte, /Authorization:\s*`Bearer \$\{factorySecret\}`/);
  });

  test(`${nome}/page.tsx: nunca usa uma variável NEXT_PUBLIC_ para o segredo`, () => {
    assert.equal(/NEXT_PUBLIC_[A-Z_]*FACTORY_SECRET/.test(fonte), false);
  });

  test(`${nome}/page.tsx: sem FACTORY_SECRET configurado, retorna lista vazia com erro explícito (nunca lança nem trava a página)`, () => {
    const semSegredo = new RegExp(`if\\s*\\(!factorySecret\\)\\s*\\{[\\s\\S]*?return \\{ ${nome}: \\[\\], erro:[\\s\\S]*?\\}[\\s\\S]*?\\}`);
    assert.match(fonte, semSegredo);
  });

  test(`${nome}/page.tsx: resposta HTTP não-ok (ex.: 401 por segredo divergente) vira erro visível, nunca lista vazia silenciosa`, () => {
    assert.match(fonte, /if\s*\(!res\.ok\)\s*\{/);
    assert.match(fonte, new RegExp(`return \\{ ${nome}: \\[\\], erro: \``));
    // Guarda o status HTTP no log/erro pra diagnosticar 401 vs 5xx — nunca o
    // corpo ou headers da resposta, que poderiam ecoar o segredo enviado.
    assert.match(fonte, /res\.status/);
  });

  test(`${nome}/page.tsx: nunca loga o corpo ou os headers da resposta de erro (só o status HTTP)`, () => {
    assert.doesNotMatch(fonte, /console\.error\([^)]*res\.(headers|body|json\(\))/);
  });

  test(`${nome}/page.tsx: a página distingue "erro" de "lista realmente vazia" na UI (dois estados visuais diferentes)`, () => {
    assert.match(fonte, /\{erro \? \(/);
  });
}
