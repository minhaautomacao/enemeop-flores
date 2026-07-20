'use client'

import { useCallback, useEffect, useRef } from 'react'

const CHAVE_VISTOS = 'enemeop_producao_pedidos_vistos'

function carregarVistos(): Set<number> {
  try {
    const bruto = localStorage.getItem(CHAVE_VISTOS)
    return new Set(bruto ? (JSON.parse(bruto) as number[]) : [])
  } catch {
    return new Set()
  }
}

/** Diferença pura entre os pedidos atuais e os já vistos — separada só pra ser testável sem DOM/localStorage. Nunca marca um pedido como novo duas vezes: quem chama já inclui `atuais` nos vistos antes da próxima chamada. */
export function calcularNovos(atuais: number[], vistosAnteriores: Set<number>): number[] {
  return atuais.filter((n) => !vistosAnteriores.has(n))
}

function salvarVistos(vistos: Set<number>): void {
  try {
    // Mantém só os últimos 500 — a lista só existe pra nunca repetir o som
    // pro mesmo pedido entre reloads, não precisa crescer sem limite.
    const lista = [...vistos].slice(-500)
    localStorage.setItem(CHAVE_VISTOS, JSON.stringify(lista))
  } catch { /* localStorage indisponível (modo privado etc.) — degrada sem som persistente */ }
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
 */
export function useAlertaNovoPedido() {
  const tocarBipe = useBipeDesbloqueadoPorGesto()
  const vistosRef = useRef<Set<number> | null>(null)
  const primeiraCargaRef = useRef(true)

  const registrar = useCallback((numerosAtuais: number[]) => {
    if (vistosRef.current === null) vistosRef.current = carregarVistos()
    const vistos = vistosRef.current

    const novos = calcularNovos(numerosAtuais, vistos)
    for (const n of numerosAtuais) vistos.add(n)
    salvarVistos(vistos)

    if (primeiraCargaRef.current) {
      primeiraCargaRef.current = false
      return { novos: [] as number[] }
    }
    if (novos.length > 0) tocarBipe()
    return { novos }
  }, [tocarBipe])

  return { registrar }
}
