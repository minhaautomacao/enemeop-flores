'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { EnumeopLogo } from '@/components/enemeop-logo'

type StatusPedido = 'novo' | 'confirmado' | 'preparando' | 'pronto' | 'saiu'

interface Pedido {
  id: string
  produto: string
  cliente: string
  horario: string
  bairro: string
  canal: string
  status: StatusPedido
  prioridade?: boolean
}

const MOCK: Pedido[] = [
  { id: '#1048', produto: 'Kit maternidade girassóis',  cliente: 'Família Melo',  horario: '10:30', bairro: 'Cambuci',    canal: 'WhatsApp', status: 'novo',        prioridade: true },
  { id: '#1047', produto: 'Buquê premium rosas',        cliente: 'Carla Torres',  horario: '11:00', bairro: 'Mooca',      canal: 'Instagram',status: 'novo'       },
  { id: '#1046', produto: 'Arranjo corporativo M',      cliente: 'Empresa ABC',   horario: '14:00', bairro: 'V. Mariana', canal: 'Site',     status: 'confirmado' },
  { id: '#1045', produto: 'Orquídea vaso + card',       cliente: 'Pedro Souza',   horario: '14:30', bairro: 'Saúde',      canal: 'WhatsApp', status: 'preparando' },
  { id: '#1044', produto: 'Arranjo corporativo P',      cliente: 'Empresa XYZ',   horario: '15:00', bairro: 'V. Mariana', canal: 'Site',     status: 'preparando' },
  { id: '#1043', produto: 'Flores do campo misto',      cliente: 'Ana Lima',      horario: '15:30', bairro: 'Ipiranga',   canal: 'WhatsApp', status: 'pronto',      prioridade: true },
  { id: '#1042', produto: 'Buquê de rosas vermelhas',   cliente: 'João Neto',     horario: '16:00', bairro: 'Aclimação',  canal: 'WhatsApp', status: 'saiu'       },
]

const COLUNAS: { key: StatusPedido; label: string; cor: string; fundo: string }[] = [
  { key: 'novo',        label: 'Novo',        cor: 'text-status-info',    fundo: 'border-status-info/30    bg-status-info/5'    },
  { key: 'confirmado',  label: 'Confirmado',  cor: 'text-gold',           fundo: 'border-gold/30           bg-gold/5'           },
  { key: 'preparando',  label: 'Preparando',  cor: 'text-status-warning', fundo: 'border-status-warning/30 bg-status-warning/5' },
  { key: 'pronto',      label: 'Pronto',      cor: 'text-status-success', fundo: 'border-status-success/30 bg-status-success/5' },
  { key: 'saiu',        label: 'Saiu p/ Rota',cor: 'text-text-muted',     fundo: 'border-border            bg-bg-raised/30'     },
]

export default function ProducaoPage() {
  const [hora, setHora] = useState('')
  const [ultimo, setUltimo] = useState('')

  useEffect(() => {
    const tick = () => {
      const agora = new Date()
      setHora(agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))
    }
    tick()
    const t = setInterval(tick, 1000)

    // auto-refresh da página a cada 30s
    const r = setInterval(() => {
      setUltimo(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }, 30000)

    setUltimo(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))

    return () => { clearInterval(t); clearInterval(r) }
  }, [])

  const porStatus = (s: StatusPedido) => MOCK.filter(p => p.status === s)
  const ativos = MOCK.filter(p => p.status !== 'saiu').length

  return (
    <div className="flex flex-col h-screen overflow-hidden">

      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-border bg-bg-surface shrink-0">
        <div className="flex items-center gap-4">
          <EnumeopLogo size="sm" showText={true} />
          <div className="w-px h-8 bg-border" />
          <div>
            <p className="text-base font-bold text-text-primary tracking-wide">PAINEL DE PRODUÇÃO</p>
            <p className="text-xs text-text-faint">Área interna — pedidos do dia</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-2xl font-bold text-gold tabular-nums">{hora}</p>
            <p className="text-[10px] text-text-faint">atualizado {ultimo}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-text-primary tabular-nums">{ativos}</p>
            <p className="text-[10px] text-text-faint">em aberto</p>
          </div>
          <Link href="/producao/status" className="btn-outline text-xs py-1.5 px-3">
            Tela de Status
          </Link>
        </div>
      </header>

      {/* Kanban */}
      <div className="flex flex-1 gap-4 p-6 overflow-hidden">
        {COLUNAS.map((col) => {
          const pedidos = porStatus(col.key)
          return (
            <div key={col.key} className="flex flex-col flex-1 min-w-0">

              {/* Cabeçalho da coluna */}
              <div className={`flex items-center justify-between mb-3 px-4 py-2.5 rounded-xl border ${col.fundo}`}>
                <span className={`text-sm font-bold uppercase tracking-widest ${col.cor}`}>{col.label}</span>
                <span className={`text-xl font-bold tabular-nums ${col.cor}`}>{pedidos.length}</span>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-3 overflow-y-auto flex-1 pr-0.5">
                {pedidos.length === 0 && (
                  <div className="flex items-center justify-center h-24 rounded-xl border border-dashed border-border text-text-faint text-sm">
                    Nenhum pedido
                  </div>
                )}
                {pedidos.map((p) => (
                  <div
                    key={p.id}
                    className={`rounded-xl border p-4 space-y-2 ${p.prioridade ? 'border-gold/50 bg-gold/5' : 'border-border bg-bg-surface'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-xs text-text-faint">{p.id}</span>
                      <div className="flex gap-1">
                        {p.prioridade && (
                          <span className="rounded-full bg-gold/20 border border-gold/30 px-2 py-0.5 text-[10px] font-bold text-gold uppercase tracking-wide">
                            URGENTE
                          </span>
                        )}
                        <span className="rounded-full bg-bg-raised border border-border px-2 py-0.5 text-[10px] text-text-faint">
                          {p.canal}
                        </span>
                      </div>
                    </div>
                    <p className="text-base font-semibold text-text-primary leading-tight">{p.produto}</p>
                    <p className="text-sm text-text-muted">{p.cliente}</p>
                    <div className="flex items-center justify-between pt-1 border-t border-border">
                      <span className="text-xs text-text-faint">{p.bairro}</span>
                      <span className="text-sm font-bold text-text-primary tabular-nums">{p.horario}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
