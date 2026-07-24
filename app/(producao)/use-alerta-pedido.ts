'use client'

import { useCallback, useEffect, useRef } from 'react'

const CHAVE_VISTOS_NOVO_PEDIDO = 'enemeop_producao_pedidos_vistos'
const CHAVE_VISTOS_AGENDADO = 'enemeop_producao_pedidos_agendados_vistos'

function carregarVistos(chave: string): Set<number> {
  try {
    const bruto = localStorage.getItem(chave)
    return new Set(bruto ? (JSON.parse(bruto) as number[]) : [])
  } catch {
    return new Set()
  }
}

/** Diferença pura entre os pedidos atuais e os já vistos — separada só pra ser testável sem DOM/localStorage. Nunca marca um pedido como novo duas vezes: quem chama já inclui `atuais` nos vistos antes da próxima chamada. */
export function calcularNovos(atuais: number[], vistosAnteriores: Set<number>): number[] {
  return atuais.filter((n) => !vistosAnteriores.has(n))
}

function salvarVistos(chave: string, vistos: Set<number>): void {
  try {
    // Mantém só os últimos 500 — a lista só existe pra nunca repetir o som
    // pro mesmo pedido entre reloads, não precisa crescer sem limite.
    const lista = [...vistos].slice(-500)
    localStorage.setItem(chave, JSON.stringify(lista))
  } catch { /* localStorage indisponível (modo privado etc.) — degrada sem som persistente */ }
}

/**
 * Números dos pedidos pagos com logística agendada (fora do horário) —
 * calculado sempre a partir da lista vinda do banco (nunca de
 * localStorage): localStorage só decide se o alerta sonoro já tocou pra um
 * pedido específico, nunca decide quais pedidos agendados existem agora.
 */
export function numerosAgendados(pedidos: Record<string, unknown>[]): number[] {
  return pedidos
    .filter((p) => p.status_logistica === 'agendada' && p.numero_pedido != null)
    .map((p) => Number(p.numero_pedido))
    .filter((n) => Number.isFinite(n))
}

/**
 * Toca um bipe curto via Web Audio API (sem depender de nenhum arquivo de
 * áudio) só depois de o usuário interagir com a página pelo menos uma vez —
 * navegadores bloqueiam áudio automático sem gesto do usuário.
 */
function useBipeDesbloqueadoPorGesto() {
  const ctxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    const desbloquear = () => {
      if (!ctxRef.current) {
        const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (AudioCtor) ctxRef.current = new AudioCtor()
      }
      ctxRef.current?.resume().catch(() => {})
    }
    window.addEventListener('click', desbloquear)
    window.addEventListener('keydown', desbloquear)
    return () => {
      window.removeEventListener('click', desbloquear)
      window.removeEventListener('keydown', desbloquear)
    }
  }, [])

  return useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx || ctx.state !== 'running') return // ainda sem gesto do usuário — nunca força, só deixa de tocar
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.55)
  }, [])
}

/**
 * Detecta pedidos novos entre uma lista de números de pedido e a anterior —
 * toca o alerta sonoro só pros realmente novos, nunca repete pro mesmo
 * pedido (persistido em localStorage, sobrevive a refresh — Parte I.6/I.7).
 * Na primeira carga da página, só registra os pedidos existentes como
 * "vistos" sem tocar som (evita disparar um alerta por cada pedido antigo).
 *
 * `chaveStorage` permite reaproveitar o mesmo mecanismo (bipe + dedup) pra
 * outra categoria de pedido sem misturar os dois conjuntos de "vistos" —
 * ver uso duplo em producao/page.tsx (pedido novo vs. pedido agendado fora
 * do horário). A EXISTÊNCIA dos pedidos em si nunca vem daqui: sempre do
 * banco (quem chama passa a lista já vinda da API); localStorage só evita
 * repetir o som.
 */
export function useAlertaNovoPedido(chaveStorage: string = CHAVE_VISTOS_NOVO_PEDIDO) {
  const tocarBipe = useBipeDesbloqueadoPorGesto()
  const vistosRef = useRef<Set<number> | null>(null)
  const primeiraCargaRef = useRef(true)

  const registrar = useCallback((numerosAtuais: number[]) => {
    if (vistosRef.current === null) vistosRef.current = carregarVistos(chaveStorage)
    const vistos = vistosRef.current

    const novos = calcularNovos(numerosAtuais, vistos)
    for (const n of numerosAtuais) vistos.add(n)
    salvarVistos(chaveStorage, vistos)

    if (primeiraCargaRef.current) {
      primeiraCargaRef.current = false
      return { novos: [] as number[] }
    }
    if (novos.length > 0) tocarBipe()
    return { novos }
  }, [tocarBipe, chaveStorage])

  return { registrar }
}

export { CHAVE_VISTOS_AGENDADO }
