// Rodar: npx tsx --test supabase/functions/_shared/whatsapp-guard.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canSendWhatsAppMessage,
  mensagemDeOptOut,
  mensagemConfirmacaoOptOut,
  dentroDaJanelaDeAtendimento,
  type ConfigEnvioWhatsApp,
} from './whatsapp-guard.ts';

const CONFIG_OK: ConfigEnvioWhatsApp = {
  numeroAtivo: '5511966439190',
  numeroOficial: '5511982829083',
  numeroOficialBloqueado: true,
  marketingHabilitado: false,
  safeStart: true,
};

const CONTEXTO_OK = {
  tipo: 'transacional' as const,
  atendimentoHumanoAtivo: false,
  optOut: false,
  mensagemDuplicada: false,
};

test('caso feliz: numero ativo != numero oficial, sem bloqueios -> permitido', () => {
  const r = canSendWhatsAppMessage(CONFIG_OK, CONTEXTO_OK);
  assert.equal(r.permitido, true);
});

test('numero oficial bloqueado: se numeroAtivo == numeroOficial, NUNCA permite enviar, mesmo com todo o resto ok', () => {
  const config: ConfigEnvioWhatsApp = { ...CONFIG_OK, numeroAtivo: '5511982829083' };
  const r = canSendWhatsAppMessage(config, CONTEXTO_OK);
  assert.equal(r.permitido, false);
  assert.match(r.motivo!, /numero_oficial_bloqueado/);
});

test('numero oficial bloqueado=false: numeroAtivo pode ser igual ao oficial (trava desativada explicitamente)', () => {
  const config: ConfigEnvioWhatsApp = { ...CONFIG_OK, numeroAtivo: '5511982829083', numeroOficialBloqueado: false };
  const r = canSendWhatsAppMessage(config, CONTEXTO_OK);
  assert.equal(r.permitido, true);
});

test('sem numero ativo configurado -> nunca envia', () => {
  const config: ConfigEnvioWhatsApp = { ...CONFIG_OK, numeroAtivo: '' };
  const r = canSendWhatsAppMessage(config, CONTEXTO_OK);
  assert.equal(r.permitido, false);
  assert.match(r.motivo!, /numero_ativo_nao_configurado/);
});

test('mensagem duplicada nunca e reenviada', () => {
  const r = canSendWhatsAppMessage(CONFIG_OK, { ...CONTEXTO_OK, mensagemDuplicada: true });
  assert.equal(r.permitido, false);
  assert.match(r.motivo!, /mensagem_duplicada/);
});

test('cliente em opt-out nunca recebe mensagem automatica', () => {
  const r = canSendWhatsAppMessage(CONFIG_OK, { ...CONTEXTO_OK, optOut: true });
  assert.equal(r.permitido, false);
  assert.match(r.motivo!, /opt/);
});

test('atendimento humano ativo: Flora nunca envia enquanto humano responsavel', () => {
  const r = canSendWhatsAppMessage(CONFIG_OK, { ...CONTEXTO_OK, atendimentoHumanoAtivo: true });
  assert.equal(r.permitido, false);
  assert.match(r.motivo!, /humano/);
});

// Achado de auditoria 2026-07-30: mensagem "iniciada_pela_empresa" (ex.:
// abordagem_inicial do SDR) nunca deve sair com WHATSAPP_MARKETING_ENABLED
// desligado (padrão) — é exatamente o tipo de mensagem duplicada/não
// solicitada que provavelmente contribuiu pro banimento anterior.
test('mensagem iniciada pela empresa (campanha/abordagem fria) e bloqueada quando marketing esta desabilitado (padrao)', () => {
  const config: ConfigEnvioWhatsApp = { ...CONFIG_OK, safeStart: false };
  const r = canSendWhatsAppMessage(config, { ...CONTEXTO_OK, tipo: 'iniciada_pela_empresa' });
  assert.equal(r.permitido, false);
  assert.match(r.motivo!, /marketing_desabilitado/);
});

test('mensagem iniciada pela empresa e permitida quando marketing esta habilitado e SAFE_START esta desligado', () => {
  const config: ConfigEnvioWhatsApp = { ...CONFIG_OK, marketingHabilitado: true, safeStart: false };
  const r = canSendWhatsAppMessage(config, { ...CONTEXTO_OK, tipo: 'iniciada_pela_empresa' });
  assert.equal(r.permitido, true);
});

// ── SAFE_START ─────────────────────────────────────────────────────────────
// Modo de partida segura do número novo: nunca iniciar conversa, nunca
// campanha/lembrete/cobrança automática/recuperação de carrinho/marketing —
// tudo isso é 'iniciada_pela_empresa'. Só responde mensagem recebida
// ('transacional'). É um override independente de marketingHabilitado.

test('SAFE_START=true bloqueia mensagem iniciada pela empresa MESMO com marketing habilitado por engano', () => {
  const config: ConfigEnvioWhatsApp = { ...CONFIG_OK, marketingHabilitado: true, safeStart: true };
  const r = canSendWhatsAppMessage(config, { ...CONTEXTO_OK, tipo: 'iniciada_pela_empresa' });
  assert.equal(r.permitido, false);
  assert.match(r.motivo!, /safe_start_ativo/);
});

test('SAFE_START=true nunca bloqueia resposta a mensagem recebida (transacional)', () => {
  const config: ConfigEnvioWhatsApp = { ...CONFIG_OK, safeStart: true };
  const r = canSendWhatsAppMessage(config, { ...CONTEXTO_OK, tipo: 'transacional' });
  assert.equal(r.permitido, true);
});

test('SAFE_START=false permite mensagem iniciada pela empresa se marketing tambem estiver habilitado', () => {
  const config: ConfigEnvioWhatsApp = { ...CONFIG_OK, marketingHabilitado: true, safeStart: false };
  const r = canSendWhatsAppMessage(config, { ...CONTEXTO_OK, tipo: 'iniciada_pela_empresa' });
  assert.equal(r.permitido, true);
});

test('mensagem transacional (resposta de atendimento) nunca e barrada pelo marketing desabilitado', () => {
  const r = canSendWhatsAppMessage(CONFIG_OK, { ...CONTEXTO_OK, tipo: 'transacional' });
  assert.equal(r.permitido, true);
});

test('numero oficial bloqueado tem prioridade sobre qualquer outra checagem', () => {
  const config: ConfigEnvioWhatsApp = { ...CONFIG_OK, numeroAtivo: '5511982829083', marketingHabilitado: true };
  const r = canSendWhatsAppMessage(config, { tipo: 'iniciada_pela_empresa', atendimentoHumanoAtivo: false, optOut: false, mensagemDuplicada: false });
  assert.equal(r.permitido, false);
  assert.match(r.motivo!, /numero_oficial_bloqueado/);
});

// ── Opt-out ────────────────────────────────────────────────────────────────

test('mensagemDeOptOut reconhece as frases pedidas', () => {
  assert.equal(mensagemDeOptOut('pare'), true);
  assert.equal(mensagemDeOptOut('Pare'), true);
  assert.equal(mensagemDeOptOut('parar'), true);
  assert.equal(mensagemDeOptOut('não quero receber mais nada'), true);
  assert.equal(mensagemDeOptOut('não me envie mensagens'), true);
  assert.equal(mensagemDeOptOut('remova meu número por favor'), true);
  assert.equal(mensagemDeOptOut('cancelar mensagens'), true);
});

test('mensagemDeOptOut nunca reconhece uma mensagem comum de compra', () => {
  assert.equal(mensagemDeOptOut('quero um buquê de rosas'), false);
  assert.equal(mensagemDeOptOut('qual o valor do frete?'), false);
});

test('mensagemConfirmacaoOptOut e sempre o mesmo texto fixo, nunca gerado dinamicamente', () => {
  assert.equal(mensagemConfirmacaoOptOut(), 'Certo. As mensagens automáticas foram interrompidas.');
});

// ── Janela de atendimento ────────────────────────────────────────────────

test('dentroDaJanelaDeAtendimento: sem ultima mensagem registrada, nunca esta dentro da janela', () => {
  assert.equal(dentroDaJanelaDeAtendimento(null, new Date()), false);
  assert.equal(dentroDaJanelaDeAtendimento(undefined, new Date()), false);
});

test('dentroDaJanelaDeAtendimento: 23h59 atras ainda esta dentro; 24h01 atras ja nao esta', () => {
  const agora = new Date('2026-07-30T12:00:00.000Z');
  const dentro = new Date('2026-07-29T12:01:00.000Z').toISOString();
  const fora = new Date('2026-07-29T11:59:00.000Z').toISOString();
  assert.equal(dentroDaJanelaDeAtendimento(dentro, agora), true);
  assert.equal(dentroDaJanelaDeAtendimento(fora, agora), false);
});
