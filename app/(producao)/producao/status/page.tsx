'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { EnumeopLogo } from '@/components/enemeop-logo'

type StatusPedido = 'novo' | 'confirmado' | 'preparando' | 'pronto' | 'saiu' | 'entregue'

interface Pedido {
  id: string
  produto: string
  cliente: string
  horario: string
  status: StatusPedido
  prioridade?: boolean
}

const MOCK: Pedido[] = [
  { id: '#1048', produto: 'Kit maternidade girassóis', cliente: 'Família Melo', horario: '10:30', status: 'novo',       prioridade: true },
  { id: '#1047', produto: 'Buquê premium rosas',       cliente: 'Carla Torres', horario: '11:00', status: 'novo'       },
  { id: '#1046', produto: 'Arranjo corporativo M',     cliente: 'Empresa ABC',  horario: '14:00', status: 'confirmado' },
  { id: '#1045', produto: 'Orquídea vaso + card',      cliente: 'Pedro Souza',  horario: '14:30', status: 'preparando' },
  { id: '#1044', produto: 'Arranjo corporativo P',     cliente: 'Empresa XYZ',  horario: '15:00', status: 'preparando' },
  { id: '#1043', produto: 'Flores do campo misto',     cliente: 'Ana Lima',     horario: '15:30', status: 'pronto',     prioridade: true },
  { id: '#1042', produto: 'Buquê de rosas vermelhas',  cliente: 'João Neto',    horario: '16:00', status: 'saiu'       },
  { id: '#1041', produto: 'Arranjo de lírios',         cliente: 'Márcia Faria', horario: '09:00', status: 'entregue'   },
]

const STATUS_CONFIG: Record<StatusPedido, { label: string; classes: string; dot: string }> = {
  novo:       { label: 'AGUARDANDO',   classes: 'bg-status-info/10    border-status-info/30    text-status-info',    dot: 'bg-status-info'    },
  confirmado: { label: 'CONFIRMADO',   classes: 'bg-gold/10           border-gold/30           text-gold',           dot: 'bg-gold'           },
  preparando: { label: 'PREPARANDO',   classes: 'bg-status-warning/10 border-status-warning/30 text-status-warning', dot: 'bg-status-warning animate-pulse' },
  pronto:     { label: 'PRONTO',       classes: 'bg-status-success/10 border-status-success/30 text-status-success', dot: 'bg-status-success' },
  saiu:       { label: 'SAIU P/ ROTA', classes: 'bg-bg-raised         border-border            text-text-muted',     dot: 'bg-text-faint'     },
  entregue:   { label: 'ENTREGUE',     classes: 'bg-bg-raised         border-border            text-text-faint',     dot: 'bg-text-faint'     },
}

export default function StatusPage() {
  const [hora, setHora] = useState('')
  const [data, setData] = useState('')

  useEffect(() => {
    const tick = () => {
      const agora = new Date()
      setHora(agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      setData(agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }))
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  const ativos   = MOCK
    .filter(p => !['entregue'].includes(p.status))
    .sort((a, b) => {
      if (a.prioridade && !b.prioridade) return -1
      if (!a.prioridade && b.prioridade) return 1
      return a.horario.localeCompare(b.horario)
    })
  const prontos  = MOCK.filter(p => p.status === 'pronto').length
  const prep     = MOCK.filter(p => p.status === 'preparando').length

  return (
    <div className="flex flex-col min-h-screen bg-bg-base">

      {/* Header */}
      <header className="flex items-center justify-between px-10 py-5 border-b border-border bg-bg-surface shrink-0">
        <div className="flex items-center gap-5">
          <EnumeopLogo size="md" showText={true} />
          <div className="w-px h-10 bg-border" />
          <p className="text-xl font-bold text-text-primary tracking-widest uppercase">Status dos Pedidos</p>
        </div>
        <div className="flex items-center gap-8">
          <div className="text-center">
            <p className="text-3xl font-bold text-gold tabular-nums">{hora}</p>
            <p className="text-xs text-text-faint capitalize">{data}</p>
          </div>
          <Link href="/producao" className="btn-outline text-xs py-2 px-4">
            Painel Kanban
          </Link>
        </div>
      </header>

      {/* Contadores rápidos */}
      <div className="grid grid-cols-3 gap-4 px-10 py-6 shrink-0">
        {[
          { label: 'Em aberto',   valor: ativos.length,  cor: 'text-text-primary' },
          { label: 'Preparando',  valor: prep,           cor: 'text-status-warning' },
          { label: 'Prontos',     valor: prontos,        cor: 'text-status-success' },
        ].map((c) => (
          <div key={c.label} className="card flex items-center justify-between py-5 px-6">
            <p className="text-base text-text-muted font-medium">{c.label}</p>
            <p className={`text-5xl font-bold tabular-nums ${c.cor}`}>{c.valor}</p>
          </div>
        ))}
      </div>

      {/* Lista de pedidos */}
      <div className="flex-1 px-10 pb-8 overflow-y-auto">
        <div className="grid grid-cols-2 gap-4">
          {ativos.map((p) => {
            const cfg = STATUS_CONFIG[p.status]
            return (
              <div
                key={p.id}
                className={`flex items-center justify-between gap-4 rounded-2xl border px-6 py-5 ${cfg.classes} ${p.prioridade ? 'ring-1 ring-gold/40' : ''}`}
              >
                {/* Esquerda */}
                <div className="flex items-center gap-4 min-w-0">
                  <div className={`w-3.5 h-3.5 rounded-full shrink-0 ${cfg.dot}`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-base font-bold">{p.id}</span>
                      {p.prioridade && (
                        <span className="rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 text-[10px] font-bold text-gold uppercase tracking-widest">
                          URGENTE
                        </span>
                      )}
                    </div>
                    <p className="text-lg font-semibold leading-tight truncate">{p.produto}</p>
                    <p className="text-sm opacity-70">{p.cliente}</p>
                  </div>
                </div>

                {/* Direita */}
                <div className="text-right shrink-0">
                  <p className="text-2xl font-bold tabular-nums">{p.horario}</p>
                  <p className="text-xs font-bold uppercase tracking-widest opacity-80">{cfg.label}</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Entregues */}
        {MOCK.filter(p => p.status === 'entregue').length > 0 && (
          <div className="mt-6">
            <p className="text-xs font-semibold text-text-faint uppercase tracking-widest mb-3">Entregues hoje</p>
            <div className="grid grid-cols-2 gap-3">
              {MOCK.filter(p => p.status === 'entregue').map(p => (
                <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-bg-surface/50 px-5 py-3">
                  <div className="w-2 h-2 rounded-full bg-status-success" />
                  <span className="font-mono text-sm text-text-faint">{p.id}</span>
                  <span className="text-sm text-text-faint truncate flex-1">{p.produto}</span>
                  <span className="text-sm font-medium text-text-faint tabular-nums">{p.horario}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
