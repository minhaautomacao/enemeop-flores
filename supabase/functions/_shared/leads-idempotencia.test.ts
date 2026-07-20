// Testa as regras puras de idempotência de leads (prioridade de intenção e
// merge de campos no UPDATE) — correção 2026-07-20 do bug de duplicação.
// Rodar: npx tsx --test supabase/functions/_shared/leads-idempotencia.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maiorIntencao, montarAtualizacaoLead, encontrarLeadCandidato, type LeadCandidato } from './leads-idempotencia.ts';

test('encontrarLeadCandidato: primeira mensagem sem lead existente -> nenhum candidato (index.ts faz o INSERT)', () => {
  const id = encontrarLeadCandidato([], { workspaceId: 'enemeop-flores', canal: 'instagram', canalId: '9530087693699545' });
  assert.equal(id, null);
});

test('encontrarLeadCandidato: mensagens seguintes da mesma identidade encontram o lead existente (index.ts faz UPDATE, nunca outro INSERT)', () => {
  const leads: LeadCandidato[] = [
    { id: 'lead-1', canal: 'instagram', canal_id: '9530087693699545', workspace_id: 'enemeop-flores', criado_em: '2026-07-20T10:00:00Z' },
  ];
  const id = encontrarLeadCandidato(leads, { workspaceId: 'enemeop-flores', canal: 'instagram', canalId: '9530087693699545' });
  assert.equal(id, 'lead-1');
});

test('encontrarLeadCandidato: dois workspaces diferentes nunca se misturam, mesmo com o mesmo canal_id', () => {
  const leads: LeadCandidato[] = [
    { id: 'lead-workspace-a', canal: 'instagram', canal_id: '999', workspace_id: 'workspace-a', criado_em: '2026-07-20T10:00:00Z' },
  ];
  const id = encontrarLeadCandidato(leads, { workspaceId: 'workspace-b', canal: 'instagram', canalId: '999' });
  assert.equal(id, null, 'nunca deve reutilizar um lead de outro workspace');
});

test('encontrarLeadCandidato: Instagram e Facebook do mesmo canal_id nunca se misturam', () => {
  const leads: LeadCandidato[] = [
    { id: 'lead-instagram', canal: 'instagram', canal_id: '999', workspace_id: 'enemeop-flores', criado_em: '2026-07-20T10:00:00Z' },
  ];
  const id = encontrarLeadCandidato(leads, { workspaceId: 'enemeop-flores', canal: 'facebook', canalId: '999' });
  assert.equal(id, null, 'nunca deve reutilizar um lead de outro canal, mesmo com o mesmo canal_id')
});

test('encontrarLeadCandidato: com multiplos leads antigos da mesma identidade (duplicatas pre-existentes), usa o mais recente', () => {
  const leads: LeadCandidato[] = [
    { id: 'lead-antigo', canal: 'instagram', canal_id: '999', workspace_id: 'enemeop-flores', criado_em: '2026-07-18T10:00:00Z' },
    { id: 'lead-recente', canal: 'instagram', canal_id: '999', workspace_id: 'enemeop-flores', criado_em: '2026-07-20T10:00:00Z' },
  ];
  const id = encontrarLeadCandidato(leads, { workspaceId: 'enemeop-flores', canal: 'instagram', canalId: '999' });
  assert.equal(id, 'lead-recente');
});

test('maiorIntencao: intencao urgente nunca regride para uma menor', () => {
  assert.equal(maiorIntencao('urgente', 'baixa'), 'urgente');
  assert.equal(maiorIntencao('urgente', 'media'), 'urgente');
  assert.equal(maiorIntencao('urgente', 'alta'), 'urgente');
});

test('maiorIntencao: intencao maior sempre sobrescreve a menor', () => {
  assert.equal(maiorIntencao('baixa', 'alta'), 'alta');
  assert.equal(maiorIntencao('media', 'urgente'), 'urgente');
});

test('maiorIntencao: sem intencao anterior, usa a nova', () => {
  assert.equal(maiorIntencao(null, 'baixa'), 'baixa');
  assert.equal(maiorIntencao(undefined, 'media'), 'media');
});

test('maiorIntencao: mesma intencao permanece igual', () => {
  assert.equal(maiorIntencao('alta', 'alta'), 'alta');
});

test('montarAtualizacaoLead: campos novos vazios/nulos nunca sobrescrevem valores antigos (simplesmente nao entram no payload)', () => {
  const payload = montarAtualizacaoLead({ nome: null, telefone: undefined, cidade: '', notas: undefined }, 'media');
  assert.equal('nome' in payload, false);
  assert.equal('telefone' in payload, false);
  assert.equal('cidade' in payload, false);
  assert.equal('notas' in payload, false);
  assert.equal(payload.intencao, 'media');
});

test('montarAtualizacaoLead: campos novos presentes entram no payload de UPDATE', () => {
  const payload = montarAtualizacaoLead({ nome: 'Camila', cidade: 'São Paulo', cep: '01040010' }, 'alta');
  assert.equal(payload.nome, 'Camila');
  assert.equal(payload.cidade, 'São Paulo');
  assert.equal(payload.cep, '01040010');
  assert.equal(payload.intencao, 'alta');
});

test('montarAtualizacaoLead: status só entra no payload quando a extracao deu um status confiavel (nunca regride pra "novo" por falha de IA)', () => {
  const semStatus = montarAtualizacaoLead({ status: null }, 'media');
  assert.equal('status' in semStatus, false);
  const comStatus = montarAtualizacaoLead({ status: 'em_atendimento' }, 'media');
  assert.equal(comStatus.status, 'em_atendimento');
});

test('montarAtualizacaoLead: nunca inclui mensagem_inicial nem criado_em (write-once, nunca sobrescritos numa reutilizacao)', () => {
  const payload = montarAtualizacaoLead({ nome: 'Camila' }, 'media');
  assert.equal('mensagem_inicial' in payload, false);
  assert.equal('criado_em' in payload, false);
});
