// Testa as regras puras de validade/mapeamento de produto WooCommerce (sem
// I/O — sem fetch, sem DB). Rodar: npx tsx --test supabase/functions/_shared/catalogo-woocommerce-filtro.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { produtoValido, codigoOficial, paraProdutoCatalogo, type WooProduct } from './catalogo-woocommerce-filtro.ts';

function produtoBase(overrides: Partial<WooProduct> = {}): WooProduct {
  return {
    id: 4207,
    name: '004 - Buquê de rosas no vaso de vidro',
    sku: '004',
    status: 'publish',
    stock_status: 'instock',
    price: '295.00',
    regular_price: '295.00',
    sale_price: '',
    permalink: 'https://www.enemeopflores.com.br/produto/forma-rubra-buque-de-rosas-no-vaso-de-vidro/',
    images: [{ src: 'https://www.enemeopflores.com.br/img/004.webp' }],
    ...overrides,
  };
}

test('produtoValido: produto publicado, com preco e foto reais e valido', () => {
  assert.equal(produtoValido(produtoBase()), true);
});

test('exclusao do produto de teste: nome "Produto Teste - Nao disponivel para venda" nunca aparece pro cliente', () => {
  const produtoTeste = produtoBase({
    id: 4412,
    name: 'Produto Teste - Não disponível para venda',
    sku: '',
    price: '1.00',
    regular_price: '1.00',
  });
  assert.equal(produtoValido(produtoTeste), false);
});

test('exclusao por rascunho: status diferente de publish nunca aparece', () => {
  assert.equal(produtoValido(produtoBase({ status: 'draft' })), false);
});

test('exclusao por preco invalido: sem preco (0 ou vazio) nunca aparece', () => {
  assert.equal(produtoValido(produtoBase({ price: '0', regular_price: '0', sale_price: '' })), false);
  assert.equal(produtoValido(produtoBase({ price: '', regular_price: '', sale_price: '' })), false);
});

test('exclusao por falta de imagem real: sem foto nunca aparece', () => {
  assert.equal(produtoValido(produtoBase({ images: [] })), false);
});

test('correspondencia exata produto-foto-preco: paraProdutoCatalogo nunca troca campos entre produtos', () => {
  const p1 = produtoBase({ id: 3656, name: '002 - Arranjo com 02 Rosas', sku: '002', price: '105.00', regular_price: '105.00', images: [{ src: 'https://site/002.jpg' }] });
  const p2 = produtoBase({ id: 4207, name: '004 - Buquê de rosas no vaso de vidro', sku: '004', price: '295.00', regular_price: '295.00', images: [{ src: 'https://site/004.jpg' }] });

  const c1 = paraProdutoCatalogo(p1);
  const c2 = paraProdutoCatalogo(p2);

  assert.equal(c1.codigo, '002');
  assert.equal(c1.preco, 105);
  assert.equal(c1.fotoUrl, 'https://site/002.jpg');

  assert.equal(c2.codigo, '004');
  assert.equal(c2.preco, 295);
  assert.equal(c2.fotoUrl, 'https://site/004.jpg');
});

test('codigoOficial: usa o SKU real quando existe', () => {
  assert.equal(codigoOficial(produtoBase({ sku: 'M08' })), 'M08');
});

test('codigoOficial: cai pro ID numerico do WooCommerce quando nao ha SKU cadastrado — nunca inventa um código', () => {
  assert.equal(codigoOficial(produtoBase({ sku: '' })), '4207');
});

test('preco prioriza sale_price (promocional) sobre o preco cheio, quando presente', () => {
  const c = paraProdutoCatalogo(produtoBase({ price: '90.00', regular_price: '105.00', sale_price: '90.00' }));
  assert.equal(c.preco, 90);
});
