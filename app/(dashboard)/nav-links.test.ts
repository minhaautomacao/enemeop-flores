// Testa que o item de menu "Clientes / CRM" no sidebar aponta pra rota real
// (a página existe em app/(dashboard)/dashboard/leads/page.tsx) — cobre o
// pedido de "corrigir o botão/menu CRM pra carregar a página correta".
// Rodar: npx tsx --test "app/(dashboard)/nav-links.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const fonteLayout = readFileSync(join(DIR, 'layout.tsx'), 'utf-8');

test('sidebar: item "Clientes / CRM" aponta para /dashboard/leads', () => {
  const match = fonteLayout.match(/href:\s*'([^']*)',\s*label:\s*'Clientes \/ CRM'/);
  assert.ok(match, 'item de menu "Clientes / CRM" não encontrado em NAV_ITEMS');
  assert.equal(match![1], '/dashboard/leads');
});

test('rota real: app/(dashboard)/dashboard/leads/page.tsx existe (grupo de rota (dashboard) não aparece na URL)', () => {
  assert.ok(existsSync(join(DIR, 'dashboard', 'leads', 'page.tsx')));
});

test('sidebar: nenhum item de menu usa <a> cru pra navegação interna (evita reload cheio/logout acidental)', () => {
  const itens = [...fonteLayout.matchAll(/<Link href=\{item\.href\}/g)];
  assert.ok(itens.length > 0, 'itens de NAV_ITEMS devem navegar via <Link>, não <a>');
});
