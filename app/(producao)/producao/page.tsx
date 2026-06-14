'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { EnumeopLogo } from '@/components/enemeop-logo'
import { Truck } from 'lucide-react'

type StatusPedido = 'novo' | 'confirmado' | 'preparando' | 'pronto' | 'saiu'

interface Pedido {
  num: number          // número grande do pedido
  produto: string
  cliente: string
  telefone: string
  horario: string
  bairro: string
  canal: string
  status: StatusPedido
  prioridade?: boolean
  transportadora: string
  foto: string         // emoji ou URL
  valor: number
}

// Fotos reais do catálogo Enemeop Flores via Unsplash
const MOCK: Pedido[] = [
  {
    num: 20240613001, produto: 'Kit Maternidade Girassóis',
    cliente: 'Família Melo', telefone: '(11) 98765-4321',
    horario: '10:30', bairro: 'Cambuci', canal: 'WhatsApp',
    status: 'novo', prioridade: true,
    transportadora: 'Motoboy Rápido SP',
    foto: 'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=120&h=120&fit=crop&auto=format',
    valor: 290,
  },
  {
    num: 20240613002, produto: 'Buquê Premium 24 Rosas Vermelhas',
    cliente: 'Carla Torres', telefone: '(11) 91234-5678',
    horario: '11:00', bairro: 'Mooca', canal: 'Instagram',
    status: 'novo', prioridade: false,
    transportadora: 'Retirada na loja',
    foto: 'https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=120&h=120&fit=crop&auto=format',
    valor: 320,
  },
  {
    num: 20240613003, produto: 'Arranjo Corporativo Médio — Lírios',
    cliente: 'Empresa ABC Ltda.', telefone: '(11) 3344-5566',
    horario: '14:00', bairro: 'V. Mariana', canal: 'Site',
    status: 'confirmado', prioridade: false,
    transportadora: 'Transportadora Flores & Cia',
    foto: 'https://images.unsplash.com/photo-1490750967868-88df5691cc08?w=120&h=120&fit=crop&auto=format',
    valor: 480,
  },
  {
    num: 20240613004, produto: 'Orquídea Phalaenopsis + Cartão',
    cliente: 'Pedro Souza', telefone: '(11) 97777-8888',
    horario: '14:30', bairro: 'Saúde', canal: 'WhatsApp',
    status: 'preparando', prioridade: false,
    transportadora: 'Motoboy Rápido SP',
    foto: 'https://images.unsplash.com/photo-1610397648930-477b8c7f0943?w=120&h=120&fit=crop&auto=format',
    valor: 140,
  },
  {
    num: 20240613005, produto: 'Arranjo Corporativo Pequeno',
    cliente: 'Empresa XYZ S.A.', telefone: '(11) 2233-4455',
    horario: '15:00', bairro: 'V. Mariana', canal: 'Site',
    status: 'preparando', prioridade: false,
    transportadora: 'Transportadora Flores & Cia',
    foto: 'https://images.unsplash.com/photo-1487530811015-780fb8a8e88e?w=120&h=120&fit=crop&auto=format',
    valor: 220,
  },
  {
    num: 20240613006, produto: 'Flores do Campo Misto — Vaso G',
    cliente: 'Ana Lima', telefone: '(11) 95555-1234',
    horario: '15:30', bairro: 'Ipiranga', canal: 'WhatsApp',
    status: 'pronto', prioridade: true,
    transportadora: 'Motoboy Rápido SP',
    foto: 'https://images.unsplash.com/photo-1490397967560-7f4f2da4e2f7?w=120&h=120&fit=crop&auto=format',
    valor: 175,
  },
  {
    num: 20240613007, produto: 'Buquê de Rosas Vermelhas 12un',
    cliente: 'João Neto', telefone: '(11) 98888-7777',
    horario: '16:00', bairro: 'Aclimação', canal: 'WhatsApp',
    status: 'saiu', prioridade: false,
    transportadora: 'Motoboy Rápido SP',
    foto: 'https://images.unsplash.com/photo-1518709766631-a6a7f45921c3?w=120&h=120&fit=crop&auto=format',
    valor: 180,
  },
]

const COLUNAS: { key: StatusPedido; label: string; cor: string; fundo: string; ring: string }[] = [
  { key: 'novo',       label: 'Novo',         cor: 'text-blue-400',   fundo: 'border-blue-500/30 bg-blue-500/5',   ring: 'ring-blue-500/20'   },
  { key: 'confirmado', label: 'Confirmado',   cor: 'text-amber-400',  fundo: 'border-amber-500/30 bg-amber-500/5', ring: 'ring-amber-500/20'  },
  { key: 'preparando', label: 'Preparando',   cor: 'text-orange-400', fundo: 'border-orange-500/30 bg-orange-500/5',ring:'ring-orange-500/20' },
  { key: 'pronto',     label: 'Pronto ✓',     cor: 'text-green-400',  fundo: 'border-green-500/30 bg-green-500/5', ring: 'ring-green-500/20'  },
  { key: 'saiu',       label: 'Saiu p/ Rota', cor: 'text-gray-500',   fundo: 'border-gray-600/30 bg-gray-700/20',  ring: 'ring-gray-600/20'   },
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
    const r = setInterval(() => {
      setUltimo(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }, 30000)
    setUltimo(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    return () => { clearInterval(t); clearInterval(r) }
  }, [])

  const porStatus = (s: StatusPedido) => MOCK.filter(p => p.status === s)
  const ativos = MOCK.filter(p => p.status !== 'saiu').length

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0f0f0f]">

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-[#161616] shrink-0">
        <div className="flex items-center gap-4">
          <EnumeopLogo size="sm" showText={true} />
          <div className="w-px h-8 bg-white/10" />
          <div>
            <p className="text-sm font-bold text-white tracking-widest uppercase">Painel de Produção</p>
            <p className="text-[10px] text-white/40">Enemeop Flores — uso interno</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-2xl font-bold text-amber-400 tabular-nums">{hora}</p>
            <p className="text-[10px] text-white/30">atualizado {ultimo}</p>
          </div>
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-4 py-2">
            <span className="text-2xl font-bold text-white tabular-nums">{ativos}</span>
            <span className="text-xs text-white/40 leading-tight">em<br/>aberto</span>
          </div>
          <Link href="/producao/status" target="_blank" rel="noopener noreferrer"
            className="text-xs border border-white/20 text-white/60 hover:text-white hover:border-white/40 px-3 py-2 rounded-lg transition-colors">
            Tela de Status ↗
          </Link>
        </div>
      </header>

      {/* Kanban */}
      <div className="flex flex-1 gap-3 p-4 overflow-hidden">
        {COLUNAS.map((col) => {
          const pedidos = porStatus(col.key)
          return (
            <div key={col.key} className="flex flex-col flex-1 min-w-0">

              {/* Cabeçalho da coluna */}
              <div className={`flex items-center justify-between mb-3 px-3 py-2 rounded-xl border ${col.fundo}`}>
                <span className={`text-xs font-bold uppercase tracking-widest ${col.cor}`}>{col.label}</span>
                <span className={`text-lg font-bold tabular-nums ${col.cor}`}>{pedidos.length}</span>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-2.5 overflow-y-auto flex-1">
                {pedidos.length === 0 && (
                  <div className="flex items-center justify-center h-20 rounded-xl border border-dashed border-white/10 text-white/20 text-xs">
                    Nenhum pedido
                  </div>
                )}
                {pedidos.map((p) => (
                  <div
                    key={p.num}
                    className={`rounded-xl border p-0 overflow-hidden ${
                      p.prioridade
                        ? 'border-amber-500/40 ring-1 ring-amber-500/20'
                        : 'border-white/10'
                    }`}
                  >
                    {/* Foto + número do pedido */}
                    <div className={`flex items-center gap-3 px-3 pt-3 pb-2 ${p.prioridade ? 'bg-amber-500/10' : 'bg-white/5'}`}>
                      {/* Foto do produto */}
                      <div className="w-14 h-14 shrink-0 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center text-3xl">
                        {p.foto}
                      </div>
                      {/* Número e produto */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="font-mono text-[11px] font-bold text-amber-400 tracking-tight">
                            #{p.num}
                          </span>
                          {p.prioridade && (
                            <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-1.5 py-0 text-[9px] font-black text-amber-400 uppercase tracking-widest">
                              URGENTE
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-white leading-tight truncate">{p.produto}</p>
                        <p className="text-[11px] text-amber-400 font-bold">R$ {p.valor.toFixed(2)}</p>
                      </div>
                    </div>

                    {/* Dados do cliente */}
                    <div className="px-3 py-2 space-y-1.5 bg-[#1a1a1a]">
                      <div>
                        <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mb-0.5">Cliente</p>
                        <p className="text-sm font-bold text-white">{p.cliente}</p>
                        <p className="text-[10px] text-white/40">{p.telefone}</p>
                      </div>

                      {/* Transportadora */}
                      <div className="flex items-center gap-1.5 bg-white/5 rounded-lg px-2 py-1.5">
                        <Truck className="w-3 h-3 text-white/40 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest leading-none">Transportadora</p>
                          <p className="text-[10px] font-semibold text-white/70 truncate">{p.transportadora}</p>
                        </div>
                      </div>
                    </div>

                    {/* Rodapé */}
                    <div className="flex items-center justify-between px-3 py-2 bg-[#161616] border-t border-white/5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-semibold text-white/30 uppercase tracking-widest">via</span>
                        <span className="text-[10px] text-white/50">{p.canal}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-white/40">{p.bairro}</span>
                        <span className="text-sm font-bold text-white tabular-nums">{p.horario}</span>
                      </div>
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
