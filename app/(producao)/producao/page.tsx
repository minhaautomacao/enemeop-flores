'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { EnumeopLogo } from '@/components/enemeop-logo'
import { Truck, AlertTriangle, RefreshCw, Clock } from 'lucide-react'
import { useAlertaNovoPedido, numerosAgendados, CHAVE_VISTOS_AGENDADO } from '../use-alerta-pedido'

type StatusPedido = 'novo' | 'confirmado' | 'preparando' | 'pronto' | 'saiu' | 'entregue'
// 'agendada' = pago fora do horário comercial — corrida nunca criada ainda,
// despacho fica pro próximo horário comercial (ver webhook-mercadopago).
type StatusLogistica = 'agendada' | 'pendente' | 'criada' | 'erro_logistica' | 'revisao_logistica' | null

const INTERVALO_ATUALIZACAO_MS = 15_000

const LOGISTICA_CONFIG: Record<Exclude<StatusLogistica, null>, { label: string; classes: string }> = {
  agendada:            { label: 'Agendado p/ próximo horário', classes: 'bg-amber-500/10 border-amber-500/30 text-amber-400' },
  pendente:            { label: 'Logística: processando…', classes: 'bg-blue-500/10 border-blue-500/30 text-blue-400' },
  criada:              { label: 'Entrega criada',          classes: 'bg-green-500/10 border-green-500/30 text-green-400' },
  erro_logistica:      { label: 'Erro na entrega',         classes: 'bg-red-500/10 border-red-500/30 text-red-400' },
  revisao_logistica:   { label: 'Revisão manual necessária', classes: 'bg-purple-500/10 border-purple-500/30 text-purple-300' },
}

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
  statusLogistica: StatusLogistica
  erroLogistica: string | null
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
  const [erro, setErro] = useState<string | null>(null)
  const [reprocessando, setReprocessando] = useState<string | null>(null)
  const { registrar } = useAlertaNovoPedido()
  // Mesmo mecanismo de alerta (bipe + dedup), chave de storage separada —
  // nunca mistura "pedido novo" com "pedido agendado fora do horário" no
  // mesmo controle de "já visto" (ver use-alerta-pedido.ts).
  const { registrar: registrarAgendado } = useAlertaNovoPedido(CHAVE_VISTOS_AGENDADO)

  const carregarPedidos = useCallback(async () => {
    try {
      const res = await fetch('/api/producao/pedidos', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'erro ao carregar pedidos')
      setErro(null)
      const bruto: Record<string, unknown>[] = json.pedidos ?? []
      const { novos } = registrar(bruto.map((p) => Number(p.numero_pedido)).filter((n) => Number.isFinite(n)))
      // A existência dos pedidos agendados vem sempre desta resposta do
      // banco (nunca de localStorage) — o hook só usa localStorage pra
      // nunca repetir o bipe pro mesmo pedido (regra oficial da tarefa).
      registrarAgendado(numerosAgendados(bruto))
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
          statusLogistica: (p.status_logistica as StatusLogistica) ?? null,
          erroLogistica: (p.logistica_resposta as { erro?: string } | null)?.erro ?? null,
          prioridade: false,
          transportadora: String(p.frete_transportadora ?? 'A definir'),
          novo: novos.includes(numero),
        }
      })
      setPedidos(montados)
    } catch (e) {
      // Erro de API nunca vira lista vazia silenciosa (pareceria "nenhum
      // pedido em aberto", quando na verdade o painel só não conseguiu
      // carregar) — mantém a última lista boa conhecida na tela e mostra um
      // aviso visível, com retry manual disponível (GO-LIVE Parte 7).
      setErro(e instanceof Error ? e.message : 'Falha ao carregar pedidos')
    } finally {
      setCarregando(false)
    }
  }, [registrar, registrarAgendado])

  const reprocessarLogistica = useCallback(async (pedidoId: string) => {
    setReprocessando(pedidoId)
    try {
      await fetch(`/api/producao/pedidos/${pedidoId}/retry-logistica`, { method: 'POST' })
    } finally {
      setReprocessando(null)
      carregarPedidos()
    }
  }, [carregarPedidos])

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
  // Sempre recalculado a partir da lista carregada agora (nunca de
  // localStorage) — o alerta permanece enquanto existir pelo menos um
  // pedido pago com logística agendada, some sozinho quando a corrida real
  // for criada (status_logistica deixa de ser 'agendada').
  const agendados = pedidos.filter(p => p.statusLogistica === 'agendada').length

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0f0f0f]">

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-[#161616] shrink-0">
        <div className="flex items-center gap-4">
          <EnumeopLogo size="sm" showText={true} />
          <div className="w-px h-8 bg-white/10" />
          <div>
            <p className="text-sm font-bold text-white tracking-widest uppercase">Painel de Produção</p>
            <p className="text-[10px] text-white/40">Enemeop Flores — uso interno · alerta sonoro é habilitado após o primeiro clique nesta página</p>
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

      {erro && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/30 text-red-400 text-xs shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="font-bold uppercase tracking-widest">Falha ao atualizar pedidos:</span>
          <span className="text-red-300">{erro}</span>
          <span className="text-red-400/60">— mostrando a última lista carregada com sucesso.</span>
        </div>
      )}

      {/* Permanece visível enquanto houver pelo menos um pedido pago fora
          do horário aguardando o próximo horário comercial — nunca some
          sozinho, some quando a corrida real for criada. */}
      {agendados > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-400 text-xs shrink-0">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span className="font-bold uppercase tracking-widest">
            Há {agendados} pedido{agendados > 1 ? 's' : ''} pago{agendados > 1 ? 's' : ''} agendado{agendados > 1 ? 's' : ''} para produção e entrega.
          </span>
        </div>
      )}

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

                        {/* Status da logística real (Lalamove) */}
                        {p.statusLogistica && (
                          <div className={`rounded-lg border px-2.5 py-1.5 ${LOGISTICA_CONFIG[p.statusLogistica].classes}`}>
                            <div className="flex items-center gap-1.5">
                              {(p.statusLogistica === 'erro_logistica' || p.statusLogistica === 'revisao_logistica') && (
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                              )}
                              <p className="text-[10px] font-bold uppercase tracking-widest leading-none">{LOGISTICA_CONFIG[p.statusLogistica].label}</p>
                            </div>
                            {p.erroLogistica && (
                              <p className="text-[10px] mt-1 opacity-80 line-clamp-2">{p.erroLogistica}</p>
                            )}
                            {/* Reprocessar só aparece pra erro recuperável — nunca em
                                estado ambíguo (revisao_logistica), que exige checagem
                                humana antes de qualquer nova tentativa. */}
                            {p.statusLogistica === 'erro_logistica' && (
                              <button
                                onClick={() => reprocessarLogistica(p.id)}
                                disabled={reprocessando === p.id}
                                className="mt-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest border border-current rounded px-2 py-1 hover:bg-white/10 disabled:opacity-40 transition-colors"
                              >
                                <RefreshCw className={`w-3 h-3 ${reprocessando === p.id ? 'animate-spin' : ''}`} />
                                {reprocessando === p.id ? 'Reprocessando…' : 'Reprocessar entrega'}
                              </button>
                            )}
                          </div>
                        )}
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
