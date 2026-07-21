// Rodar: npx tsx --test supabase/functions/_shared/handoff-whatsapp-sdr.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarRegistroHandoff } from './handoff-whatsapp-sdr.ts';

test('registro de handoff nunca contem um numero/telefone de operador — so dados do cliente e o motivo', () => {
  const registro = montarRegistroHandoff({
    canal: 'whatsapp',
    telefone: '5511977776666',
    nome: 'Camila',
    leadId: 'lead-1',
    intencao: 'alta',
    ultimaMensagem: 'quero falar com alguem',
    motivo: 'Cliente pediu atendente',
    horarioComercial: true,
  });
  const chaves = Object.keys(registro);
  // Nunca um campo de "numero do operador" / "telefone da loja" — o
  // registro é só o ticket do CRM, nunca um alvo de envio de mensagem.
  assert.equal(chaves.some((k) => /operador|store_phone|numero_loja/i.test(k)), false);
  assert.equal(registro.telefone, '5511977776666');
  assert.equal(registro.origem_handoff, 'whatsapp_sdr');
});

test('canal_cliente_id usa o identificador do CLIENTE (canalId ou telefone), nunca um valor fixo da loja', () => {
  const registro = montarRegistroHandoff({
    canal: 'whatsapp',
    canalId: 'wa-cliente-123',
    telefone: '5511977776666',
    motivo: 'teste',
    horarioComercial: true,
  });
  assert.equal(registro.canal_cliente_id, 'wa-cliente-123');
});

test('sem canalId, cai pro telefone do cliente — nunca fica vazio silenciosamente', () => {
  const registro = montarRegistroHandoff({ telefone: '5511977776666', motivo: 'teste', horarioComercial: true });
  assert.equal(registro.canal_cliente_id, '5511977776666');
});

test('sem canalId nem telefone, marca "desconhecido" explicitamente — nunca undefined/null silencioso', () => {
  const registro = montarRegistroHandoff({ motivo: 'teste', horarioComercial: true });
  assert.equal(registro.canal_cliente_id, 'desconhecido');
});

test('fora_do_horario reflete corretamente o horario comercial informado', () => {
  const dentro = montarRegistroHandoff({ motivo: 'x', horarioComercial: true });
  const fora = montarRegistroHandoff({ motivo: 'x', horarioComercial: false });
  assert.equal(dentro.dados_pedido.fora_do_horario, false);
  assert.equal(fora.dados_pedido.fora_do_horario, true);
});

test('canal default e whatsapp quando nao informado', () => {
  const registro = montarRegistroHandoff({ motivo: 'x', horarioComercial: true });
  assert.equal(registro.canal, 'whatsapp');
});

test('lead_id e intencao ausentes viram null/string vazia, nunca quebram o registro', () => {
  const registro = montarRegistroHandoff({ motivo: 'x', horarioComercial: true });
  assert.equal(registro.dados_pedido.lead_id, null);
  assert.equal(registro.dados_pedido.intencao, '');
});
