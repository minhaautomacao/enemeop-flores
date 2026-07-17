/**
 * Testes manuais da integração WhatsApp Z-API.
 * Uso: npx tsx scripts/test-whatsapp.ts [comando]
 *
 * Comandos disponíveis:
 *   enviar   — envia mensagem de texto para número de teste
 *   webhook  — simula payload inbound Z-API via HTTP local
 *   creds    — valida presença das variáveis de ambiente
 *   payload  — testa parser sem fazer chamadas de rede
 */

import 'dotenv/config'
import { enviarMensagem, extrairMensagemZApi, normalizarTelefone } from '../src/lib/whatsapp.js'

const PORT = process.env.PORT ?? 3000
const NUMERO_TESTE = process.env.CARLOS_WHATSAPP ?? ''

const cmd = process.argv[2] ?? 'creds'

// ── Validar credenciais ───────────────────────────────────────────────────────
async function testeCreds(): Promise<void> {
  const vars = {
    ZAPI_INSTANCE_ID:  process.env.ZAPI_INSTANCE_ID,
    ZAPI_TOKEN:        process.env.ZAPI_TOKEN,
    ZAPI_CLIENT_TOKEN: process.env.ZAPI_CLIENT_TOKEN,
    CARLOS_WHATSAPP:   process.env.CARLOS_WHATSAPP,
    WHATSAPP_PROVIDER: process.env.WHATSAPP_PROVIDER,
  }
  let ok = true
  for (const [key, val] of Object.entries(vars)) {
    const presente = Boolean(val)
    console.log(`${presente ? '✓' : '✗'} ${key}: ${presente ? val : 'AUSENTE'}`)
    if (!presente) ok = false
  }
  if (!ok) {
    console.error('\n[FALHA] Variáveis obrigatórias ausentes. Configure o .env e tente novamente.')
    process.exit(1)
  }
  console.log('\n[OK] Todas as credenciais presentes.')
}

// ── Enviar mensagem de teste ──────────────────────────────────────────────────
async function testeEnviar(): Promise<void> {
  if (!NUMERO_TESTE) {
    console.error('[FALHA] CARLOS_WHATSAPP não definido no .env')
    process.exit(1)
  }
  console.log(`Enviando mensagem de teste para ${NUMERO_TESTE}...`)
  const ok = await enviarMensagem({
    numero: NUMERO_TESTE,
    mensagem: 'Teste de integração Z-API — Orquestrador Enemeop Flores ✓',
  })
  if (ok) {
    console.log('[OK] Mensagem enviada com sucesso.')
  } else {
    console.error('[FALHA] Não foi possível enviar. Verifique as credenciais e o status da instância Z-API.')
    process.exit(1)
  }
}

// ── Simular webhook inbound ───────────────────────────────────────────────────
async function testeWebhook(): Promise<void> {
  const payloadZApi = {
    phone: NUMERO_TESTE || '5511999999999',
    participantPhone: null,
    messageId: 'test-msg-id-001',
    momment: Date.now(),
    status: 'RECEIVED',
    chatName: 'Teste',
    senderName: 'Carlos Teste',
    type: 'ReceivedCallback',
    text: { message: 'Quero comprar flores para o aniversário da minha esposa' },
    fromMe: false,
    isStatusReply: false,
    instanceId: process.env.ZAPI_INSTANCE_ID ?? 'test-instance',
  }

  console.log('Simulando webhook inbound Z-API...')
  console.log('Payload:', JSON.stringify(payloadZApi, null, 2))

  try {
    const res = await fetch(`http://localhost:${PORT}/webhook/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadZApi),
    })
    const body = await res.json()
    console.log(`\n[HTTP ${res.status}] Resposta:`, body)
    if (res.ok) {
      console.log('[OK] Webhook aceito pelo orquestrador.')
    } else {
      console.error('[FALHA] Orquestrador rejeitou o webhook.')
    }
  } catch {
    console.error('[FALHA] Orquestrador não está rodando em localhost:' + PORT)
    console.error('Inicie com: npm run dev')
    process.exit(1)
  }
}

// ── Testar parser de payload ──────────────────────────────────────────────────
function testePayload(): void {
  const casos = [
    {
      desc: 'mensagem normal',
      payload: { type: 'ReceivedCallback', phone: '5511982829083', text: { message: 'Olá' }, fromMe: false },
      esperado: 'extrair',
    },
    {
      desc: 'mensagem fromMe (bot)',
      payload: { type: 'ReceivedCallback', phone: '5511982829083', text: { message: 'Resposta da Flora' }, fromMe: true },
      esperado: 'ignorar',
    },
    {
      desc: 'evento de status (não mensagem)',
      payload: { type: 'MessageStatusCallback', phone: '5511982829083' },
      esperado: 'ignorar',
    },
    {
      desc: 'payload vazio',
      payload: {},
      esperado: 'ignorar',
    },
    {
      desc: 'normalização de telefone',
      payload: { type: 'ReceivedCallback', phone: '+55 (11) 98282-9083', text: { message: 'Oi' }, fromMe: false },
      esperado: 'extrair',
    },
  ]

  let falhas = 0
  for (const { desc, payload, esperado } of casos) {
    const resultado = extrairMensagemZApi(payload)
    const extraiu = resultado !== null
    const passou = esperado === 'extrair' ? extraiu : !extraiu
    console.log(`${passou ? '✓' : '✗'} ${desc}`)
    if (resultado) {
      console.log(`  → numero: ${resultado.numero} | texto: ${resultado.texto}`)
    }
    if (!passou) falhas++
  }

  // Teste de normalização
  const norm = normalizarTelefone('+55 (11) 98282-9083')
  const normOk = norm === '5511982829083'
  console.log(`${normOk ? '✓' : '✗'} normalizarTelefone("+55 (11) 98282-9083") → "${norm}"`)
  if (!normOk) falhas++

  if (falhas === 0) {
    console.log('\n[OK] Todos os testes de payload passaram.')
  } else {
    console.error(`\n[FALHA] ${falhas} teste(s) falharam.`)
    process.exit(1)
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────
switch (cmd) {
  case 'creds':   await testeCreds();   break
  case 'enviar':  await testeEnviar();  break
  case 'webhook': await testeWebhook(); break
  case 'payload': testePayload();       break
  default:
    console.error(`Comando desconhecido: ${cmd}`)
    console.error('Comandos: creds | enviar | webhook | payload')
    process.exit(1)
}
