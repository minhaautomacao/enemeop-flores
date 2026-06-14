'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { EnumeopLogo } from '@/components/enemeop-logo'
import { Truck } from 'lucide-react'

const SUPABASE_URL = 'https://gftnjvdvzgjkhwxnxnwl.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmdG5qdmR2emdqa2h3eG54bndsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMjExNTMsImV4cCI6MjA5NTU5NzE1M30.zgX7BLR5u8f3MNA5kwUVk3P6bjSWEjf9AZP0ksLjvY4'

type StatusPedido = 'novo' | 'confirmado' | 'preparando' | 'pronto' | 'saiu'

interface CatalogoProduto {
  codigo: string
  nome: string
  categoria: string
  preco: number
  foto_url: string
}

interface Pedido {
  num: number
  produto: string
  foto_url: string
  preco: number
  cliente: string
  telefone: string
  horario: string
  bairro: string
  canal: string
  status: StatusPedido
  prioridade?: boolean
  transportadora: string
}

// Pedidos simulados — produto_codigo referencia o catálogo real do Supabase
const PEDIDOS_MOCK = [
  { num: 20240613001, produto_codigo: '011', cliente: 'Família Melo',     telefone: '(11) 98765-4321', horario: '10:30', bairro: 'Cambuci',    canal: 'WhatsApp', status: 'novo'       as StatusPedido, prioridade: true,  transportadora: 'Motoboy Rápido SP' },
  { num: 20240613002, produto_codigo: '034', cliente: 'Carla Torres',     telefone: '(11) 91234-5678', horario: '11:00', bairro: 'Mooca',      canal: 'Instagram', status: 'novo'      as StatusPedido, prioridade: false, transportadora: 'Retirada na loja' },
  { num: 20240613003, produto_codigo: '093', cliente: 'Empresa ABC Ltda.',telefone: '(11) 3344-5566',  horario: '14:00', bairro: 'V. Mariana', canal: 'Site',      status: 'confirmado' as StatusPedido, prioridade: false, transportadora: 'Transportadora Flores & Cia' },
  { num: 20240613004, produto_codigo: '083', cliente: 'Pedro Souza',      telefone: '(11) 97777-8888', horario: '14:30', bairro: 'Saúde',      canal: 'WhatsApp', status: 'preparando' as StatusPedido, prioridade: false, transportadora: 'Motoboy Rápido SP' },
  { num: 20240613005, produto_codigo: '012', cliente: 'Empresa XYZ S.A.',telefone: '(11) 2233-4455',  horario: '15:00', bairro: 'V. Mariana', canal: 'Site',      status: 'preparando' as StatusPedido, prioridade: false, transportadora: 'Transportadora Flores & Cia' },
  { num: 20240613006, produto_codigo: 'M08', cliente: 'Ana Lima',         telefone: '(11) 95555-1234', horario: '15:30', bairro: 'Ipiranga',   canal: 'WhatsApp', status: 'pronto'     as StatusPedido, prioridade: true,  transportadora: 'Motoboy Rápido SP' },
  { num: 20240613007, produto_codigo: '033', cliente: 'João Neto',        telefone: '(11) 98888-7777', horario: '16:00', bairro: 'Aclimação', canal: 'WhatsApp', status: 'saiu'       as StatusPedido, prioridade: false, transportadora: 'Motoboy Rápido SP' },
]

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

  const carregarCatalogo = useCallback(async () => {
    try {
      const codigos = PEDIDOS_MOCK.map(p => p.produto_codigo)
      const params = new URLSearchParams()
      params.set('select', 'codigo,nome,categoria,preco,foto_url')
      params.set('codigo', `in.(${codigos.join(',')})`)

      const res = await fetch(`${SUPABASE_URL}/rest/v1/catalogo_produtos?${params}`, {
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
        },
      })

      if (!res.ok) throw new Error('erro ao carregar catálogo')
      const catalogo: CatalogoProduto[] = await res.json()
      const mapa = Object.fromEntries(catalogo.map(p => [p.codigo, p]))

      const montados: Pedido[] = PEDIDOS_MOCK.map(pm => {
        const prod = mapa[pm.produto_codigo]
        return {
          num: pm.num,
          produto: prod?.nome ?? pm.produto_codigo,
          foto_url: prod?.foto_url ?? '',
          preco: prod?.preco ?? 0,
          cliente: pm.cliente,
          telefone: pm.telefone,
          horario: pm.horario,
          bairro: pm.bairro,
          canal: pm.canal,
          status: pm.status,
          prioridade: pm.prioridade,
          transportadora: pm.transportadora,
        }
      })

      setPedidos(montados)
    } catch {
      // fallback: monta sem foto
      setPedidos(PEDIDOS_MOCK.map(pm => ({
        num: pm.num, produto: pm.produto_codigo, foto_url: '', preco: 0,
        cliente: pm.cliente, telefone: pm.telefone, horario: pm.horario,
        bairro: pm.bairro, canal: pm.canal, status: pm.status,
        prioridade: pm.prioridade, transportadora: pm.transportadora,
      })))
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    carregarCatalogo()
    const tick = () => setHora(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))
    tick()
    const t = setInterval(tick, 1000)
    setUltimo(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    const r = setInterval(() => setUltimo(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })), 30000)
    return () => { clearInterval(t); clearInterval(r) }
  }, [carregarCatalogo])

  const porStatus = (s: StatusPedido) => pedidos.filter(p => p.status === s)
  const ativos = pedidos.filter(p => p.status !== 'saiu').length

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
                      key={p.num}
                      className={`rounded-xl border overflow-hidden ${
                        p.prioridade ? 'border-amber-500/40 ring-1 ring-amber-500/20' : 'border-white/10'
                      }`}
                    >
                      {/* Foto + número */}
                      <div className={`flex items-center gap-3 px-3 pt-3 pb-2 ${p.prioridade ? 'bg-amber-500/10' : 'bg-white/5'}`}>
                        {/* Foto real do catálogo */}
                        <div className="w-14 h-14 shrink-0 rounded-lg overflow-hidden border border-white/10 bg-white/10">
                          {p.foto_url ? (
                            <img
                              src={p.foto_url}
                              alt={p.produto}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-white/20 text-xs">
                              🌸
                            </div>
                          )}
                        </div>
                        {/* Número e produto */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="font-mono text-[11px] font-bold text-amber-400 tracking-tight">
                              #{p.num}
                            </span>
                            {p.prioridade && (
                              <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-1.5 text-[9px] font-black text-amber-400 uppercase tracking-widest">
                                URGENTE
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-semibold text-white leading-tight line-clamp-2">{p.produto}</p>
                          <p className="text-[11px] text-amber-400 font-bold mt-0.5">R$ {p.preco.toFixed(2)}</p>
                        </div>
                      </div>

                      {/* Cliente */}
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
      )}
    </div>
  )
}
