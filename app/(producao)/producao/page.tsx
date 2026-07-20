'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { EnumeopLogo } from '@/components/enemeop-logo'
import { Truck } from 'lucide-react'
import { useAlertaNovoPedido } from '../use-alerta-pedido'

type StatusPedido = 'novo' | 'confirmado' | 'preparando' | 'pronto' | 'saiu' | 'entregue'

const INTERVALO_ATUALIZACAO_MS = 15_000

interface Pedido {
  id: string
  seq: number
  produto: string
  codigo: string
  foto_url: string
  preco: number
  cliente: string
  telefone: string
  horario: string
  bairro: string
  canal: string
  status: StatusPedido
  statusLogistica: string | null
  prioridade?: boolean
  transportadora: string
  novo?: boolean
}

const COLUNAS: { key: StatusPedido; label: string; cor: string; fundo: string }[] = [
  { key: 'novo',       label: 'Novo',         cor: 'text-blue-400',   fundo: 'border-blue-500/30 bg-blue-500/5'    },
  { key: 'confirmado', label: 'Confirmado',   cor: 'text-amber-400',  fundo: 'border-amber-500/30 bg-amber-500/5'  },
  { key: 'preparando', label: 'Preparando',   cor: 'text-orange-400', fundo: 'border-orange-500/30 bg-orange-500/5'},
  { key: 'pronto',     label: 'Pronto ✓',     cor: 'text-green-400',  fundo: 'border-green-500/30 bg-green-500/5'  },
  { key: 'saiu',       label: 'Saiu p/ Rota', cor: 'text-gray-500',   fundo: 'border-gray-600/30 bg-gray-700/20'   },
]

export default function ProducaoPage() {
  const [hora, setHora] = useState('')
  const [ultimo, setUltimo] = useState('')
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [carregando, setCarregando] = useState(true)
  const { registrar } = useAlertaNovoPedido()

  const carregarPedidos = useCallback(async () => {
    try {
      const res = await fetch('/api/producao/pedidos', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'erro ao carregar pedidos')
      const bruto: Record<string, unknown>[] = json.pedidos ?? []
      const { novos } = registrar(bruto.map((p) => Number(p.numero_pedido)).filter((n) => Number.isFinite(n)))
      const montados: Pedido[] = bruto.map((p) => {
        const produtos = (p.produtos as Array<{ codigo?: string }> | null) ?? []
        const numero = Number(p.numero_pedido)
        return {
          id: String(p.id),
          seq: numero,
          produto: String(p.produto ?? 'Pedido sem produto'),
          codigo: produtos[0]?.codigo ?? '',
          foto_url: '',
          preco: Number(p.valor ?? 0),
          cliente: String(p.cliente_nome ?? 'Cliente sem nome'),
          telefone: String(p.cliente_telefone ?? ''),
          horario: p.data_agendada ? new Date(String(p.data_agendada)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : new Date(String(p.criado_em)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          bairro: String(p.bairro ?? ''),
          canal: String(p.canal ?? ''),
          status: String(p.status_producao ?? 'novo') as StatusPedido,
          statusLogistica: (p.status_logistica as string | null) ?? null,
          prioridade: false,
          transportadora: String(p.frete_transportadora ?? 'A definir'),
          novo: novos.includes(numero),
        }
      })
      setPedidos(montados)
    } catch {
      setPedidos([])
    } finally {
      setCarregando(false)
    }
  }, [registrar])

  useEffect(() => {
    carregarPedidos()
    const tick = () => setHora(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))
    tick()
    const t = setInterval(tick, 1000)
    setUltimo(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    const atualizar = () => {
      carregarPedidos()
      setUltimo(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }
    const r = setInterval(atualizar, INTERVALO_ATUALIZACAO_MS)
    return () => { clearInterval(t); clearInterval(r) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const porStatus = (s: StatusPedido) => pedidos.filter(p => p.status === s)
  const ativos = pedidos.filter(p => !['saiu','entregue'].includes(p.status)).length

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

      {carregando ? (
        <div className="flex flex-1 items-center justify-center text-white/30 text-sm">
          Carregando catálogo...
        </div>
      ) : (
        /* Kanban */
        <div className="flex flex-1 gap-3 p-4 overflow-hidden">
          {COLUNAS.map((col) => {
            const lista = porStatus(col.key)
            return (
              <div key={col.key} className="flex flex-col flex-1 min-w-0">

                {/* Cabeçalho da coluna */}
                <div className={`flex items-center justify-between mb-3 px-3 py-2 rounded-xl border ${col.fundo}`}>
                  <span className={`text-xs font-bold uppercase tracking-widest ${col.cor}`}>{col.label}</span>
                  <span className={`text-lg font-bold tabular-nums ${col.cor}`}>{lista.length}</span>
                </div>

                {/* Cards */}
                <div className="flex flex-col gap-2.5 overflow-y-auto flex-1">
                  {lista.length === 0 && (
                    <div className="flex items-center justify-center h-20 rounded-xl border border-dashed border-white/10 text-white/20 text-xs">
                      Nenhum pedido
                    </div>
                  )}
                  {lista.map((p) => (
                    <div
                      key={p.seq}
                      className={`rounded-xl border overflow-hidden ${
                        p.novo ? 'border-green-500/60 ring-2 ring-green-500/30' : p.prioridade ? 'border-amber-500/50 ring-1 ring-amber-500/20' : 'border-white/10'
                      }`}
                    >
                      {p.novo && (
                        <div className="px-3 py-1 bg-green-500/20 border-b border-green-500/30 text-[10px] font-black text-green-400 uppercase tracking-widest">
                          Novo pedido
                        </div>
                      )}
                      {/* Topo: foto + número grande + nome do produto */}
                      <div className={`flex gap-3 p-3 ${p.prioridade ? 'bg-amber-500/10' : 'bg-white/5'}`}>

                        {/* Foto real do catálogo */}
                        <div className="w-20 h-20 shrink-0 rounded-xl overflow-hidden border border-white/10 bg-white/10">
                          {p.foto_url ? (
                            <img
                              src={p.foto_url}
                              alt={p.produto}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-2xl">🌸</div>
                          )}
                        </div>

                        {/* Número grande + produto */}
                        <div className="flex-1 min-w-0 flex flex-col justify-between">
                          <div>
                            {/* Número do pedido — destaque máximo */}
                            <div className="flex items-baseline gap-2 leading-none mb-1">
                              <span className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">Pedido</span>
                              {p.prioridade && (
                                <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-1.5 text-[8px] font-black text-amber-400 uppercase tracking-widest">
                                  URGENTE
                                </span>
                              )}
                            </div>
                            <p className="font-mono font-black text-amber-400 leading-none" style={{ fontSize: '2rem' }}>
                              #{String(p.seq).padStart(4, '0')}
                            </p>
                          </div>
                          {/* Nome do produto */}
                          <div>
                            <p className="text-xs font-semibold text-white leading-snug line-clamp-2">{p.produto}</p>
                            <p className="text-[11px] text-amber-400/80 font-bold mt-0.5">R$ {p.preco.toFixed(2)}</p>
                          </div>
                        </div>
                      </div>

                      {/* Meio: cliente + transportadora */}
                      <div className="px-3 py-2.5 bg-[#1a1a1a] space-y-2">
                        {/* Nome do cliente em destaque */}
                        <div>
                          <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest">Cliente</p>
                          <p className="text-sm font-bold text-white">{p.cliente}</p>
                          <p className="text-[10px] text-white/40">{p.telefone}</p>
                        </div>
                        {/* Transportadora */}
                        <div className="flex items-center gap-2 bg-white/5 rounded-lg px-2.5 py-1.5">
                          <Truck className="w-3.5 h-3.5 text-white/40 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[9px] font-semibold text-white/25 uppercase tracking-widest leading-none">Transportadora</p>
                            <p className="text-[11px] font-semibold text-white/70 truncate">{p.transportadora}</p>
                          </div>
                        </div>
                      </div>

                      {/* Rodapé: canal, bairro, horário */}
                      <div className="flex items-center justify-between px-3 py-2 bg-[#161616] border-t border-white/5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] text-white/25 uppercase tracking-widest">via</span>
                          <span className="text-[10px] text-white/50">{p.canal}</span>
                          <span className="text-white/15">·</span>
                          <span className="text-[10px] text-white/40">{p.bairro}</span>
                        </div>
                        <span className="text-sm font-bold text-white tabular-nums">{p.horario}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
