// Testa que o logo compartilhado (usado no header do Dashboard e das telas
// de Produção) vira um link interno do Next.js para /dashboard quando a
// prop href é passada, e permanece não clicável quando não é (ex.: login).
// Checagem por código-fonte — mesmo padrão de crm-auth.test.ts — evita
// arrastar um pipeline de JSX/DOM só pra este teste.
// Rodar: npx tsx --test components/enemeop-logo.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const fonte = readFileSync(join(DIR, 'enemeop-logo.tsx'), 'utf-8');

test('EnumeopLogo importa Link do next/navigation interno (nunca <a> cru pra navegação interna)', () => {
  assert.match(fonte, /import Link from ['"]next\/link['"]/);
});

test('EnumeopLogo só renderiza <Link> quando a prop href é passada — sem href, permanece não clicável', () => {
  assert.match(fonte, /if \(!href\) return conteudo/);
  assert.match(fonte, /<Link href=\{href\}/);
});

test('EnumeopLogo: link tem aria-label e cursor de link quando clicável', () => {
  assert.match(fonte, /aria-label="Ir para o Dashboard"/);
  assert.match(fonte, /cursor-pointer/);
});

test('EnumeopLogo: o conteúdo visual (svg + texto) é o mesmo com ou sem link — só o wrapper muda', () => {
  // A mesma variável `conteudo` é usada tanto no retorno direto quanto
  // dentro do Link — nunca duas árvores JSX divergentes (uma por caminho).
  const ocorrencias = fonte.match(/conteudo/g) ?? [];
  assert.ok(ocorrencias.length >= 3, 'conteudo deve ser definido uma vez e reaproveitado nos dois caminhos (com/sem href)');
});

const NAV_LAYOUT_DIR = join(DIR, '..', 'app', '(dashboard)');
const PAGINAS_COM_LOGO_CLICAVEL = [
  { nome: 'layout do dashboard', arquivo: join(NAV_LAYOUT_DIR, 'layout.tsx') },
  { nome: 'painel de produção', arquivo: join(DIR, '..', 'app', '(producao)', 'producao', 'page.tsx') },
  { nome: 'tela de status', arquivo: join(DIR, '..', 'app', '(producao)', 'producao', 'status', 'page.tsx') },
];

for (const { nome, arquivo } of PAGINAS_COM_LOGO_CLICAVEL) {
  test(`${nome}: EnumeopLogo recebe href="/dashboard"`, () => {
    const src = readFileSync(arquivo, 'utf-8');
    assert.match(src, /<EnumeopLogo[^>]*href="\/dashboard"/);
  });
}

test('tela de login: EnumeopLogo NUNCA recebe href (não é uma página autenticada)', () => {
  const src = readFileSync(join(DIR, '..', 'app', '(auth)', 'login', 'page.tsx'), 'utf-8');
  assert.doesNotMatch(src, /<EnumeopLogo[^>]*href=/);
});

test('Monitor Social: marca no topo esquerdo é um Link do Next.js pra /dashboard (não usa EnumeopLogo, header não foi duplicado nem reescrito)', () => {
  const src = readFileSync(join(DIR, '..', 'app', 'monitor-social', 'page.tsx'), 'utf-8');
  assert.match(src, /<Link href="\/dashboard"[^>]*>[\s\S]*?<\/Link>/);
  assert.match(src, /import Link from ['"]next\/link['"]/);
});
