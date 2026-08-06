// Rodar: npx tsx --test supabase/functions/_shared/estorno-decisao.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirEstorno } from './estorno-decisao.ts';

test('pagamento approved, sem evento ativo, valor exato -> pode estornar', () => {
  const d = decidirEstorno({ status: 'approved', valor: 100 }, null, 100);
  assert.deepEqual(d, { pode: true });
});

test('pagamento nao aprovado (pending/rejected/etc) -> nunca estorna', () => {
  for (const status of ['pending', 'rejected', 'in_process', 'cancelled', 'refunded']) {
    const d = decidirEstorno({ status, valor: 100 }, null, 100);
    assert.deepEqual(d, { pode: false, motivo: 'pagamento_nao_aprovado' });
  }
});

test('evento de estorno ja ativo pro mesmo pedido -> nunca duplica', () => {
  for (const status of ['pendente_autorizacao', 'autorizado', 'processando', 'concluido']) {
    const d = decidirEstorno({ status: 'approved', valor: 100 }, { status }, 100);
    assert.deepEqual(d, { pode: false, motivo: 'evento_ja_ativo' });
  }
});

test('evento anterior recusado ou com erro nao bloqueia uma nova tentativa', () => {
  for (const status of ['recusado', 'erro']) {
    const d = decidirEstorno({ status: 'approved', valor: 100 }, { status }, 100);
    assert.deepEqual(d, { pode: true });
  }
});

test('estorno parcial e sempre recusado na v1, mesmo com valor e pagamento validos', () => {
  const d = decidirEstorno({ status: 'approved', valor: 100 }, null, 50, 'parcial');
  assert.deepEqual(d, { pode: false, motivo: 'estorno_parcial_nao_suportado' });
});

test('valor solicitado divergente do valor pago -> invalido', () => {
  const d = decidirEstorno({ status: 'approved', valor: 100 }, null, 80);
  assert.deepEqual(d, { pode: false, motivo: 'valor_invalido' });
});

test('valor solicitado zero ou negativo -> sempre invalido', () => {
  assert.deepEqual(decidirEstorno({ status: 'approved', valor: 100 }, null, 0), { pode: false, motivo: 'valor_invalido' });
  assert.deepEqual(decidirEstorno({ status: 'approved', valor: 100 }, null, -10), { pode: false, motivo: 'valor_invalido' });
});

test('diferenca de centavos de arredondamento (dentro da tolerancia) ainda e aceita', () => {
  const d = decidirEstorno({ status: 'approved', valor: 100.005 }, null, 100);
  assert.deepEqual(d, { pode: true });
});

test('diferenca maior que a tolerancia (0.02) e recusada', () => {
  const d = decidirEstorno({ status: 'approved', valor: 100.02 }, null, 100);
  assert.deepEqual(d, { pode: false, motivo: 'valor_invalido' });
});
