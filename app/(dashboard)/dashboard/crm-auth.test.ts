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

  test(`${nome}/page.tsx: sem FACTORY_SECRET configurado, retorna lista vazia (nunca lança nem trava a página)`, () => {
    const semSegredo = /if\s*\(!factorySecret\)\s*\{[\s\S]*?return \[\];[\s\S]*?\}/;
    assert.match(fonte, semSegredo);
  });
}
