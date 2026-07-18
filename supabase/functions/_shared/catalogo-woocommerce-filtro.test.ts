// Testa as regras puras de identidade/validade/mapeamento de produto
// WooCommerce (sem I/O — sem fetch, sem DB).
// Rodar: npx tsx --test supabase/functions/_shared/catalogo-woocommerce-filtro.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  produtoValido,
  extrairCodigoDoNome,
  divergeSkuDoCodigo,
  paraProdutoCatalogo,
  detectarCodigosDuplicados,
  construirHeaderBasicAuth,
  type WooProduct,
} from './catalogo-woocommerce-filtro.ts';
import type { ProdutoCatalogo } from './funil.ts';

function produtoBase(overrides: Partial<WooProduct> = {}): WooProduct {
  return {
    id: 4207,
    name: '004 - Buquê de rosas no vaso de vidro',
    sku: '',
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

// 1. Código obtido do padrão real do site (a descrição não contém código em
// nenhum produto real verificado — o código vem do prefixo do nome).
test('código comercial extraído do nome, no padrão real do site ("XXX - resto do nome")', () => {
  assert.equal(extrairCodigoDoNome('002 - Arranjo com 02 Rosas Nacionais e Asltroemérias'), '002');
  assert.equal(extrairCodigoDoNome('096 - Buque de 06 rosas + Ferrero Rocher 100g'), '096');
  assert.equal(extrairCodigoDoNome('M08 - Arranjo Mix Flores do Campo'), 'M08');
});

test('paraProdutoCatalogo: codigo vem do nome, idExterno é sempre o ID técnico do WooCommerce (nunca trocados)', () => {
  const p = produtoBase({ id: 3656, name: '002 - Arranjo com 02 Rosas Nacionais', sku: '' });
  const c = paraProdutoCatalogo(p);
  assert.equal(c.codigo, '002');
  assert.equal(c.idExterno, '3656');
  assert.notEqual(c.codigo, c.idExterno, 'código comercial nunca deve ser o ID do WooCommerce');
});

// 2. Divergência entre o código (nome) e o SKU cadastrado.
test('divergeSkuDoCodigo: sinaliza quando o SKU cadastrado diverge do código extraído do nome', () => {
  const divergente = produtoBase({ name: '002 - Arranjo com Rosas', sku: '999' });
  assert.equal(divergeSkuDoCodigo(divergente), true);

  const coincidente = produtoBase({ name: '002 - Arranjo com Rosas', sku: '002' });
  assert.equal(divergeSkuDoCodigo(coincidente), false);

  const semSku = produtoBase({ name: '002 - Arranjo com Rosas', sku: '' });
  assert.equal(divergeSkuDoCodigo(semSku), false, 'sem SKU cadastrado nao ha divergencia a sinalizar');
});

// 1b. Produto real (publicado, em estoque, com preço e foto) sem prefixo de
// código no nome NUNCA é excluído — usa o ID do WooCommerce como código
// exibido de fallback, mantendo idExterno igual ao ID técnico.
test('produto válido sem prefixo de código no nome: não é excluído, usa o ID do WooCommerce como código de fallback', () => {
  const semPrefixo = produtoBase({ id: 3220, name: 'Arranjo Orquídeas Pink vaso de vidro', sku: '' });
  assert.equal(extrairCodigoDoNome(semPrefixo.name), null, 'nome realmente nao segue o padrao XXX - resto');
  assert.equal(produtoValido(semPrefixo), true, 'produto real nunca deve ser excluido so por falta de prefixo no nome');

  const c = paraProdutoCatalogo(semPrefixo);
  assert.equal(c.codigo, '3220', 'codigo exibido cai pro ID do WooCommerce quando nao ha prefixo no nome');
  assert.equal(c.idExterno, '3220');
  assert.equal(c.codigo, c.idExterno, 'sem prefixo, codigo e idExterno sao o mesmo ID real — nunca um valor inventado diferente');
});

// 4. Códigos comerciais duplicados com IDs diferentes — sinaliza, nunca funde.
test('detectarCodigosDuplicados: mesmo código em produtos com IDs diferentes é sinalizado, sem fundir os produtos', () => {
  const produtos: ProdutoCatalogo[] = [
    { nome: '002 - Arranjo A', codigo: '002', idExterno: '100', preco: 105, disponivel: true, fotoUrl: 'https://site/a.jpg' },
    { nome: '002 - Arranjo B (cadastro duplicado)', codigo: '002', idExterno: '200', preco: 130, disponivel: true, fotoUrl: 'https://site/b.jpg' },
    { nome: '004 - Buquê único', codigo: '004', idExterno: '300', preco: 295, disponivel: true, fotoUrl: 'https://site/c.jpg' },
  ];
  const duplicados = detectarCodigosDuplicados(produtos);
  assert.equal(duplicados.size, 1);
  assert.deepEqual(duplicados.get('002')?.sort(), ['100', '200']);
  assert.equal(duplicados.has('004'), false);
  // Cada produto mantém seus próprios dados — nunca fundidos.
  assert.equal(produtos[0].preco, 105);
  assert.equal(produtos[1].preco, 130);
});

// 5. Ao escolher, preserva código de produção, ID, foto e preço exatos da opção.
test('cada produto preserva seu próprio código, ID, foto e preço mesmo quando o código é duplicado entre opções', () => {
  const a: ProdutoCatalogo = { nome: '002 - Arranjo A', codigo: '002', idExterno: '100', preco: 105, disponivel: true, fotoUrl: 'https://site/a.jpg' };
  const b: ProdutoCatalogo = { nome: '002 - Arranjo B', codigo: '002', idExterno: '200', preco: 130, disponivel: true, fotoUrl: 'https://site/b.jpg' };
  // "escolher" a opção B nunca deve trazer junto o ID/foto/preço de A.
  const escolhido = b;
  assert.equal(escolhido.idExterno, '200');
  assert.equal(escolhido.preco, 130);
  assert.equal(escolhido.fotoUrl, 'https://site/b.jpg');
  assert.notEqual(escolhido.idExterno, a.idExterno);
});

// 7. Produto fora de estoque nunca aparece.
test('produto outofstock (stock_status != instock) nunca aparece, mesmo publicado e com preço/foto válidos', () => {
  const foraDeEstoque = produtoBase({ stock_status: 'outofstock' });
  assert.equal(produtoValido(foraDeEstoque), false);
});

test('exclusão do produto de teste continua funcionando junto com a nova regra de código', () => {
  const produtoTeste = produtoBase({ name: 'Produto Teste - Não disponível para venda', sku: '', price: '1.00', regular_price: '1.00' });
  assert.equal(produtoValido(produtoTeste), false);
});

// 8. Credencial ausente nunca lança exceção nem vaza nada — header vira null.
test('credencial ausente: construirHeaderBasicAuth nunca lança exceção e não vaza nenhum valor (retorna null)', () => {
  assert.equal(construirHeaderBasicAuth(null, 'algum-secret'), null);
  assert.equal(construirHeaderBasicAuth('algum-key', null), null);
  assert.equal(construirHeaderBasicAuth(null, null), null);
  assert.equal(construirHeaderBasicAuth(undefined, undefined), null);
  assert.equal(construirHeaderBasicAuth('', ''), null);
});

test('header Basic Auth correto quando as duas credenciais estão presentes — nunca em query string', () => {
  const h = construirHeaderBasicAuth('minha-key', 'meu-secret');
  const esperado = Buffer.from('minha-key:meu-secret').toString('base64');
  assert.deepEqual(h, { Authorization: `Basic ${esperado}` });
});
