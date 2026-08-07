'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { EnumeopLogo } from '@/components/enemeop-logo'
import { useAlertaNovoPedido } from '../../use-alerta-pedido'
import { FILTROS_STATUS_PEDIDOS, pedidoNoFiltroStatus, classificarParaProducao, lerFiltroStatusDaUrl, PARAM_FILTRO_STATUS, type FiltroStatusPedidos, type StatusProducao } from '@/lib/status-pedido'

type StatusLogistica = 'pendente' | 'criada' | 'erro_logistica' | 'revisao_logistica' | null

interface Pedido {
  id: string
  numero: number
  produto: string
  cliente: string
  horario: string
  status: StatusProducao
  statusLogistica: StatusLogistica
  prioridade?: boolean
  novo?: boolean
  mpAmbiente?: string
}

const STATUS_CONFIG: Record<StatusProducao, { label: string; classes: string; dot: string }> = {
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
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [filtro, setFiltro] = useState<FiltroStatusPedidos>('em_aberto')
  const { registrar } = useAlertaNovoPedido()

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

  // Filtro selecionado só é lido da URL no cliente (após montar) — evita
  // divergência entre o HTML renderizado no servidor (sempre o padrão) e o
  // primeiro paint no navegador.
  useEffect(() => {
    setFiltro(lerFiltroStatusDaUrl(window.location.search))
  }, [])

  function selecionarFiltro(novo: FiltroStatusPedidos) {
    setFiltro(novo)
    const url = new URL(window.location.href)
    url.searchParams.set(PARAM_FILTRO_STATUS, novo)
    window.history.replaceState(null, '', url)
  }

  useEffect(() => {
    async function carregarPedidos() {
      try {
        const res = await fetch('/api/producao/pedidos', { cache: 'no-store' })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'erro')
        const bruto: Record<string, unknown>[] = json.pedidos ?? []
        const { novos } = registrar(bruto.map((p) => Number(p.numero_pedido)).filter((n) => Number.isFinite(n)))
        setPedidos(bruto
          .map((p): Pedido | null => {
            // Esta tela é só produção/entrega — pedido ainda não pago
            // (em_atendimento) ou pagamento recusado/cancelado/reembolsado
            // (null) nunca aparece aqui, nunca é tratado como "em aberto".
            const filtroPedido = classificarParaProducao({
              status: String(p.status ?? ''),
              status_producao: (p.status_producao as string | null) ?? null,
            })
            if (filtroPedido == null || filtroPedido === 'em_atendimento') return null
            const numero = Number(p.numero_pedido)
            return {
              id: `#${String(numero).padStart(4, '0')}`,
              numero,
              produto: String(p.produto ?? 'Pedido sem produto'),
              cliente: String(p.cliente_nome ?? 'Cliente sem nome'),
              horario: p.data_agendada ? new Date(String(p.data_agendada)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : new Date(String(p.criado_em)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
              status: filtroPedido as StatusProducao,
              statusLogistica: (p.status_logistica as StatusLogistica) ?? null,
              prioridade: false,
              novo: novos.includes(numero),
              mpAmbiente: (p.mp_ambiente as string | null) ?? undefined,
            }
          })
          .filter((p): p is Pedido => p !== null))
      } catch { setPedidos([]) }
    }
    carregarPedidos()
    const r = setInterval(carregarPedidos, 30000)
    return () => clearInterval(r)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtrados = pedidos
    .filter(p => pedidoNoFiltroStatus(p.status, filtro))
    .sort((a, b) => {
      if (a.prioridade && !b.prioridade) return -1
      if (!a.prioridade && b.prioridade) return 1
      return a.horario.localeCompare(b.horario)
    })

  return (
    <div className="flex flex-col min-h-screen bg-bg-base">

      {/* Header */}
      <header className="flex items-center justify-between px-10 py-5 border-b border-border bg-bg-surface shrink-0">
        <div className="flex items-center gap-5">
          <EnumeopLogo size="md" showText={true} href="/dashboard" />
          <div className="w-px h-10 bg-border" />
          <div>
            <p className="text-xl font-bold text-text-primary tracking-widest uppercase">Status dos Pedidos</p>
            <p className="text-[10px] text-text-faint">alerta sonoro é habilitado após o primeiro clique nesta página</p>
          </div>
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

      {/* Filtros — cada botão mostra só os pedidos do status correspondente */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-10 py-6 shrink-0">
        {FILTROS_STATUS_PEDIDOS.map((f) => {
          const contagem = pedidos.filter(p => pedidoNoFiltroStatus(p.status, f.valor)).length
          const ativo = filtro === f.valor
          return (
            <button
              key={f.valor}
              onClick={() => selecionarFiltro(f.valor)}
              aria-pressed={ativo}
              className={`card flex items-center justify-between py-5 px-6 text-left transition-colors ${
                ativo ? 'border-gold/60 bg-gold/10' : 'hover:border-gold/30'
              }`}
            >
              <p className={`text-base font-medium ${ativo ? 'text-gold' : 'text-text-muted'}`}>{f.label}</p>
              <p className={`text-5xl font-bold tabular-nums ${ativo ? 'text-gold' : 'text-text-primary'}`}>{contagem}</p>
            </button>
          )
        })}
      </div>

      {/* Lista de pedidos do filtro selecionado */}
      <div className="flex-1 px-10 pb-8 overflow-y-auto">
        {filtrados.length === 0 ? (
          <div className="flex items-center justify-center h-32 rounded-2xl border border-dashed border-border text-text-faint text-sm">
            Nenhum pedido em &quot;{FILTROS_STATUS_PEDIDOS.find(f => f.valor === filtro)?.label}&quot;
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {filtrados.map((p) => {
              const cfg = STATUS_CONFIG[p.status]
              return (
                <div
                  key={p.id}
                  className={`flex items-center justify-between gap-4 rounded-2xl border px-6 py-5 ${cfg.classes} ${p.prioridade ? 'ring-1 ring-gold/40' : ''} ${p.novo ? 'ring-2 ring-status-success/60' : ''}`}
                >
                  {/* Esquerda */}
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-3.5 h-3.5 rounded-full shrink-0 ${cfg.dot}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-base font-bold">{p.id}</span>
                        {p.novo && (
                          <span className="rounded-full border border-status-success/50 bg-status-success/10 px-2 py-0.5 text-[10px] font-bold text-status-success uppercase tracking-widest">
                            NOVO
                          </span>
                        )}
                        {p.prioridade && (
                          <span className="rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 text-[10px] font-bold text-gold uppercase tracking-widest">
                            URGENTE
                          </span>
                        )}
                        {p.mpAmbiente === 'teste' && (
                          <span className="rounded-full border border-purple-500/50 bg-purple-500/10 px-2 py-0.5 text-[10px] font-bold text-purple-300 uppercase tracking-widest" title="Pagamento gerado no ambiente de teste do Mercado Pago — nunca dinheiro real">
                            TESTE
                          </span>
                        )}
                        {p.statusLogistica === 'erro_logistica' && (
                          <span className="rounded-full border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-400 uppercase tracking-widest">
                            ⚠ Erro na entrega
                          </span>
                        )}
                        {p.statusLogistica === 'revisao_logistica' && (
                          <span className="rounded-full border border-purple-500/50 bg-purple-500/10 px-2 py-0.5 text-[10px] font-bold text-purple-300 uppercase tracking-widest">
                            ⚠ Revisão manual
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
        )}
      </div>
    </div>
  )
}
