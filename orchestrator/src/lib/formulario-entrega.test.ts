// Testa a seção "Formulário único de entrega" de funil.ts (Parte 2) — não é
// mais um módulo separado (ver nota "ZERO IMPORTS" no topo de funil.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extrairFormularioEntrega, camposFaltandoFormulario as camposFaltando, formularioCompleto,
  montarMensagemCamposFaltando, cepValido, normalizarTelefoneDestinatarioBR,
  montarResumoFormulario, CAMPOS_OBRIGATORIOS_FORMULARIO as CAMPOS_OBRIGATORIOS,
} from './funil.js'

const RESPOSTA_COMPLETA = `Nome de quem está fazendo o pedido: Camila Souza
Nome de quem vai receber: Maria Oliveira
Telefone de quem vai receber, com DDD: (11) 95857-9179
CEP: 01040-010
Rua ou avenida: Rua Direita
Número: 105
Complemento, se houver: apto 12
Bairro: República
Cidade: São Paulo
UF: SP
Data desejada para entrega: hoje
Período ou horário preferido: à tarde
Mensagem para o cartão, se desejar: Com carinho!`

test('extrai todos os campos de uma resposta completa, uma única mensagem', () => {
  const dados = extrairFormularioEntrega(RESPOSTA_COMPLETA)
  assert.equal(dados.nomeComprador, 'Camila Souza')
  assert.equal(dados.nomeDestinatario, 'Maria Oliveira')
  assert.equal(dados.telefoneDestinatario, '(11) 95857-9179')
  assert.equal(dados.cep, '01040-010')
  assert.equal(dados.rua, 'Rua Direita')
  assert.equal(dados.numero, '105')
  assert.equal(dados.complemento, 'apto 12')
  assert.equal(dados.bairro, 'República')
  assert.equal(dados.cidade, 'São Paulo')
  assert.equal(dados.uf, 'SP')
  assert.equal(dados.dataEntrega, 'hoje')
  assert.equal(dados.periodo, 'à tarde')
  assert.equal(dados.mensagemCartao, 'Com carinho!')
})

test('nome do comprador e nome do destinatario nunca se confundem (ambos contem "nome")', () => {
  const dados = extrairFormularioEntrega('Nome de quem está fazendo o pedido: Ana\nNome de quem vai receber: Bruno')
  assert.equal(dados.nomeComprador, 'Ana')
  assert.equal(dados.nomeDestinatario, 'Bruno')
})

test('tolera pequenas variacoes de rotulo', () => {
  const dados = extrairFormularioEntrega('Destinatário: João\nTelefone: 11999998888\nBairro: Centro')
  assert.equal(dados.nomeDestinatario, 'João')
  assert.equal(dados.telefoneDestinatario, '11999998888')
  assert.equal(dados.bairro, 'Centro')
})

test('linha sem dois-pontos ou sem valor apos os dois-pontos e ignorada, nunca inventa dado', () => {
  const dados = extrairFormularioEntrega('Isso aqui não é um campo\nCEP:\nBairro: Centro')
  assert.equal(dados.cep, undefined)
  assert.equal(dados.bairro, 'Centro')
})

test('camposFaltando aponta exatamente os 10 obrigatorios quando nada foi preenchido', () => {
  assert.deepEqual(camposFaltando({}), CAMPOS_OBRIGATORIOS)
})

test('camposFaltando nunca inclui campo opcional', () => {
  const faltando = camposFaltando({})
  assert.equal(faltando.includes('complemento'), false)
  assert.equal(faltando.includes('periodo'), false)
  assert.equal(faltando.includes('mensagemCartao'), false)
})

test('formularioCompleto true so quando todos os obrigatorios estao presentes, mesmo sem os opcionais', () => {
  const dados = extrairFormularioEntrega(RESPOSTA_COMPLETA)
  delete (dados as Record<string, unknown>).complemento
  delete (dados as Record<string, unknown>).periodo
  delete (dados as Record<string, unknown>).mensagemCartao
  assert.equal(formularioCompleto(dados), true)
})

test('formularioCompleto false quando falta um obrigatorio', () => {
  const dados = extrairFormularioEntrega('Nome de quem está fazendo o pedido: Camila')
  assert.equal(formularioCompleto(dados), false)
})

test('montarMensagemCamposFaltando pede so os campos que faltam, nunca os ja preenchidos', () => {
  const msg = montarMensagemCamposFaltando(['numero', 'bairro'])
  assert.match(msg, /número/i)
  assert.match(msg, /bairro/i)
  assert.doesNotMatch(msg, /cidade/i)
  assert.doesNotMatch(msg, /cep/i)
})

test('cepValido aceita com e sem hifen, rejeita formato errado', () => {
  assert.equal(cepValido('01040-010'), true)
  assert.equal(cepValido('01040010'), true)
  assert.equal(cepValido('123'), false)
  assert.equal(cepValido('abcde-123'), false)
})

test('normalizarTelefoneDestinatarioBR converte formatos comuns para E.164', () => {
  assert.equal(normalizarTelefoneDestinatarioBR('11958579179'), '+5511958579179')
  assert.equal(normalizarTelefoneDestinatarioBR('(11) 95857-9179'), '+5511958579179')
  assert.equal(normalizarTelefoneDestinatarioBR('+55 11 95857-9179'), '+5511958579179')
  assert.equal(normalizarTelefoneDestinatarioBR('5511958579179'), '+5511958579179')
})

test('normalizarTelefoneDestinatarioBR nunca inventa numero para formato nao reconhecido', () => {
  assert.equal(normalizarTelefoneDestinatarioBR('123'), null)
  assert.equal(normalizarTelefoneDestinatarioBR(''), null)
  assert.equal(normalizarTelefoneDestinatarioBR('abc'), null)
})

test('montarResumoFormulario nunca mostra CEP isolado sem endereco, nem inventa campo ausente', () => {
  const resumo = montarResumoFormulario({ nomeDestinatario: 'Maria', cep: '01040-010' })
  assert.match(resumo, /Maria/)
  assert.match(resumo, /01040-010/)
  assert.doesNotMatch(resumo, /undefined/)
})
