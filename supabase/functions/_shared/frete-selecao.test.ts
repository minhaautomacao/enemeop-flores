// Testa a seleção pura da melhor opção de frete entre transportadoras
// (Lalamove/Melhor Envio) — sem I/O, sem rede real, nunca cria corrida.
// Rodar: npx tsx --test supabase/functions/_shared/frete-selecao.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selecionarMelhor, MARKUP_FRETE_REAIS, type OpcaoFrete } from './frete-selecao.ts';

test('nenhuma opção disponível: nunca inventa um valor, retorna null', () => {
  assert.equal(selecionarMelhor([]), null);
});

test('prioriza entrega no mesmo dia mesmo quando não é a mais barata entre todas', () => {
  const opcoes: OpcaoFrete[] = [
    { transportadora: 'Melhor Envio', preco: 20, prazo_dias: 2 },
    { transportadora: 'Lalamove', preco: 30, prazo_dias: 0 },
  ];
  const melhor = selecionarMelhor(opcoes);
  assert.equal(melhor?.transportadora, 'Lalamove', 'mesmo dia tem prioridade sobre preço mais baixo com prazo maior');
});

test('entre opções do mesmo prazo, escolhe sempre a mais barata', () => {
  const opcoes: OpcaoFrete[] = [
    { transportadora: 'Lalamove', servico: 'Carro', preco: 45, prazo_dias: 0 },
    { transportadora: 'Lalamove', servico: 'Moto', preco: 25, prazo_dias: 0 },
  ];
  const melhor = selecionarMelhor(opcoes);
  assert.equal(melhor?.servico, 'Moto');
  assert.equal(melhor?.preco, 25);
});

test('preco_cliente sempre soma exatamente o markup fixo, nunca um valor estimado à parte', () => {
  const opcoes: OpcaoFrete[] = [{ transportadora: 'Lalamove', preco: 25, prazo_dias: 0 }];
  const melhor = selecionarMelhor(opcoes);
  assert.equal(melhor?.preco_cliente, 25 + MARKUP_FRETE_REAIS);
});
