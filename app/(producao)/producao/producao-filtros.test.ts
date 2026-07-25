// Testa (por código-fonte) que o painel de Produção e a tela de Status:
//   - filtram a lista real (não é só efeito visual);
//   - restauram o filtro da query string ao montar (refresh preserva);
//   - persistem o filtro selecionado na URL;
//   - mostram estado vazio por filtro;
//   - nunca alteram o status de um pedido só por clicar num filtro.
// A lógica pura de classificação já é coberta em lib/status-pedido.test.ts;
// aqui só garantimos que as duas páginas realmente usam essa lógica em vez
// de reimplementar (ou divergir) por conta própria.
// Rodar: npx tsx --test "app/(producao)/producao/producao-filtros.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

const PAGINAS = [
  {
    nome: 'painel de Produção',
    arquivo: join(DIR, 'page.tsx'),
    ler: 'lerFiltroProducaoDaUrl',
    filtraPor: /pedidos\.filter\(p => p\.filtro === filtro\)/,
  },
  {
    nome: 'tela de Status',
    arquivo: join(DIR, 'status', 'page.tsx'),
    ler: 'lerFiltroStatusDaUrl',
    filtraPor: /pedidoNoFiltroStatus\(p\.status, filtro\)/,
  },
];

for (const { nome, arquivo, ler, filtraPor } of PAGINAS) {
  const fonte = readFileSync(arquivo, 'utf-8');

  test(`${nome}: a lista exibida é sempre filtrada pelo status selecionado (nunca mostra tudo)`, () => {
    assert.match(fonte, filtraPor);
  });

  test(`${nome}: restaura o filtro da query string ao montar — refresh nunca perde o filtro`, () => {
    assert.match(fonte, new RegExp(`setFiltro\\(${ler}\\(window\\.location\\.search\\)\\)`));
  });

  test(`${nome}: ao selecionar um filtro, persiste na URL via query string (sem navegação/reload cheio)`, () => {
    assert.match(fonte, /url\.searchParams\.set\(PARAM_FILTRO_STATUS, novo\)/);
    assert.match(fonte, /window\.history\.replaceState/);
  });

  test(`${nome}: mostra mensagem de estado vazio quando o filtro não tem nenhum pedido`, () => {
    assert.match(fonte, /length === 0/);
    assert.match(fonte, /Nenhum pedido em/);
  });

  test(`${nome}: selecionar um filtro nunca envia PATCH/PUT (nunca altera status de pedido só por clicar)`, () => {
    const corpoSelecionarFiltro = fonte.match(/function selecionarFiltro[\s\S]*?\n {2}\}/)
      ?? fonte.match(/const selecionarFiltro = useCallback\(\(novo: \w+\) => \{[\s\S]*?\n {2}\}, \[\]\)/);
    assert.ok(corpoSelecionarFiltro, 'função selecionarFiltro não encontrada');
    assert.doesNotMatch(corpoSelecionarFiltro![0], /method:\s*['"](PATCH|PUT|POST)['"]/);
    assert.doesNotMatch(corpoSelecionarFiltro![0], /fetch\(/);
  });
}
