'use client';

import { useEffect, useState, useCallback, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { NovoPedidoModal } from './NovoPedidoModal';
import { EstornoModal } from './EstornoModal';
import { atualizarStatusPedido, avancarStatusProducao } from '@/app/actions/pedidos';
import type { Pedido, StatusPedido } from '@/types';

type StatusProducao = Pedido['status_producao'];

// Pedidos reais criados pela Flora usam `status` para o ciclo de PAGAMENTO
// (ver types/index.ts) — os demais valores são do fluxo manual antigo
// ("+ Novo pedido"), onde `status` é o próprio ciclo de vida do pedido.
const STATUS_PAGAMENTO_REAL: StatusPedido[] = ['aguardando_pagamento', 'pago', 'pagamento_recusado', 'reembolsado'];
function ehPedidoReal(status: StatusPedido): boolean {
  return STATUS_PAGAMENTO_REAL.includes(status);
}

// Botão de estorno só aparece pra pedido pago sem estorno ativo em
// andamento — 'recusado'/'erro' liberam uma nova tentativa (mesma regra de
// estorno-decisao.ts do lado do servidor, que é a fonte real de verdade).
function podeSolicitarEstorno(p: Pedido): boolean {
  return p.status === 'pago' && (!p.estorno_status || p.estorno_status === 'recusado' || p.estorno_status === 'erro');
}

function fotoDoPedido(p: Pedido): string | null {
  const produtos = p.produtos as Array<{ fotoUrl?: string | null }> | null;
  return produtos?.[0]?.fotoUrl ?? null;
}

const STATUS_LABEL: Record<StatusPedido, string> = {
  novo:       'Novo',
  pendente:   'Pendente',
  confirmado: 'Confirmado',
  preparando: 'Em Preparo',
  em_preparo: 'Em Preparo',
  saiu:       'Saiu p/ Entrega',
  saiu_para_entrega: 'Saiu p/ Entrega',
  entregue:   'Entregue',
  cancelado:  'Cancelado',
  aguardando_pagamento: 'Aguardando Pagamento',
  pago:                 'Pago',
  pagamento_recusado:   'Pagamento Recusado',
  reembolsado:          'Reembolsado',
};

const STATUS_BADGE: Record<StatusPedido, string> = {
  novo:       'badge-info',
  pendente:   'badge-info',
  confirmado: 'badge-gold',
  preparando: 'badge-warning',
  em_preparo: 'badge-warning',
  saiu:       'badge-info',
  saiu_para_entrega: 'badge-info',
  entregue:   'badge-success',
  cancelado:  'badge-error',
  aguardando_pagamento: 'badge-warning',
  pago:                 'badge-success',
  pagamento_recusado:   'badge-error',
  reembolsado:          'badge-error',
};

const PROXIMO_STATUS_LABEL: Partial<Record<StatusPedido, string>> = {
  novo:       'Confirmar',
  confirmado: 'Preparar',
  preparando: 'Saiu',
  saiu:       'Entregue',
};

const STATUS_PRODUCAO_LABEL: Record<StatusProducao, string> = {
  novo:       'Novo',
  confirmado: 'Confirmado',
  preparando: 'Em Preparo',
  pronto:     'Pronto',
  saiu:       'Saiu p/ Entrega',
  entregue:   'Entregue',
};

const STATUS_PRODUCAO_BADGE: Record<StatusProducao, string> = {
  novo:       'badge-info',
  confirmado: 'badge-gold',
  preparando: 'badge-warning',
  pronto:     'badge-success',
  saiu:       'badge-info',
  entregue:   'badge-success',
};

const PROXIMO_STATUS_PRODUCAO_LABEL: Partial<Record<StatusProducao, string>> = {
  novo:       'Confirmar',
  confirmado: 'Preparar',
  preparando: 'Marcar pronto',
  pronto:     'Saiu p/ entrega',
  saiu:       'Entregue',
};

const STATUS_LOGISTICA_LABEL: Record<string, string> = {
  pendente:          'Criando entrega…',
  criada:            'Entrega criada',
  erro_logistica:    'Erro na logística',
  revisao_logistica: 'Revisão necessária',
  agendada:          'Entrega agendada',
};

const STATUS_FILTROS: { label: string; value: string }[] = [
  { label: 'Todos',       value: 'todos'      },
  { label: 'Novos',       value: 'novo'       },
  { label: 'Confirmados', value: 'confirmado' },
  { label: 'Em Preparo',  value: 'preparando' },
  { label: 'Em Rota',     value: 'saiu'       },
  { label: 'Entregues',   value: 'entregue'   },
];

export default function PedidosPage() {
  const [pedidos, setPedidos]         = useState<Pedido[]>([]);
  const [carregando, setCarregando]   = useState(true);
  const [filtro, setFiltro]           = useState('todos');
  const [busca, setBusca]             = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [pedidoParaEstornar, setPedidoParaEstornar] = useState<string | null>(null);
  const [isPending, startTransition]  = useTransition();
  const [atualizando, setAtualizando] = useState<string | null>(null);

  const carregarPedidos = useCallback(async () => {
    const supabase = createClient();
    // 'internal_test' é o canal usado só pra validar a Flora em ambiente
    // controlado (ver supabase/functions/flora-internal-test) — nunca deve
    // aparecer misturado com pedidos reais de cliente nesta tela.
    const { data } = await supabase
      .from('pedidos')
      .select('*')
      .neq('canal', 'internal_test')
      .order('criado_em', { ascending: false });
    setPedidos(data ?? []);
    setCarregando(false);
  }, []);

  useEffect(() => {
    carregarPedidos();
    const supabase = createClient();
    const canal = supabase.channel('dashboard-pedidos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => carregarPedidos())
      .subscribe();
    const timer = window.setInterval(() => carregarPedidos(), 15000);
    return () => { window.clearInterval(timer); supabase.removeChannel(canal); };
  }, [carregarPedidos]);

  const pedidosFiltrados = pedidos
    .filter(p => filtro === 'todos' || p.status === filtro)
    .filter(p => {
      if (!busca) return true;
      const q = busca.toLowerCase();
      return p.produto.toLowerCase().includes(q) || p.cliente_nome.toLowerCase().includes(q);
    });

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Pedidos</h1>
          <p className="text-xs text-text-faint">Gerencie os pedidos de hoje e anteriores</p>
        </div>
        <button className="btn-gold" onClick={() => setModalAberto(true)}>+ Novo pedido</button>
      </header>

      <div className="p-6 space-y-5">

        {/* Filtros rápidos */}
        <div className="flex gap-2 flex-wrap">
          {STATUS_FILTROS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFiltro(f.value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                f.value === filtro
                  ? 'border-gold bg-gold/10 text-gold'
                  : 'border-border text-text-muted hover:border-border-strong hover:text-text-primary'
              }`}
            >
              {f.label}
            </button>
          ))}
          <div className="ml-auto">
            <input
              type="text"
              placeholder="Buscar pedido, cliente..."
              className="input w-64 text-xs"
              value={busca}
              onChange={e => setBusca(e.target.value)}
            />
          </div>
        </div>

        {/* Tabela */}
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Pedido</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Produto</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Cliente</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Valor</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Entrega</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Canal</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Pagamento</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Produção</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {carregando ? (
                <tr><td colSpan={9} className="px-4 py-16 text-center text-text-muted text-sm">Carregando pedidos…</td></tr>
              ) : pedidosFiltrados.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-16 text-center text-text-muted text-sm">
                  {pedidos.length === 0
                    ? 'Nenhum pedido ainda. Clique em "+ Novo pedido" para começar.'
                    : 'Nenhum pedido para o filtro selecionado.'}
                </td></tr>
              ) : pedidosFiltrados.map((p) => {
                const real = ehPedidoReal(p.status);
                const foto = fotoDoPedido(p);
                return (
                <tr key={p.id} className="table-row-hover">
                  <td className="px-4 py-3 font-mono text-xs text-text-faint">
                    {p.numero_pedido ? `#${p.numero_pedido}` : `#${p.id.slice(0, 6).toUpperCase()}`}
                  </td>
                  <td className="px-4 py-3 text-text-primary font-medium">
                    <div className="flex items-center gap-2">
                      {foto && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={foto} alt={p.produto} className="w-8 h-8 rounded object-cover border border-border shrink-0" />
                      )}
                      <span>{p.produto}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-muted">{p.cliente_nome}</td>
                  <td className="px-4 py-3 font-semibold text-gold">
                    {p.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    <span className="font-medium text-text-primary">{p.horario_entrega ?? '—'}</span>
                    {p.bairro && <span className="ml-1 text-xs">{p.bairro}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-text-muted">{p.canal}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${STATUS_BADGE[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                    {p.mp_ambiente === 'teste' && (
                      <span className="badge badge-teste ml-1" title="Pagamento gerado no ambiente de teste do Mercado Pago — nunca dinheiro real">TESTE</span>
                    )}
                    {real && p.status_logistica && (
                      <div className="text-[10px] text-text-faint mt-1">{STATUS_LOGISTICA_LABEL[p.status_logistica] ?? p.status_logistica}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {real ? (
                      <span className={`badge ${STATUS_PRODUCAO_BADGE[p.status_producao]}`}>{STATUS_PRODUCAO_LABEL[p.status_producao]}</span>
                    ) : (
                      <span className="text-xs text-text-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {real ? (
                        p.status === 'pago' && PROXIMO_STATUS_PRODUCAO_LABEL[p.status_producao] && (
                          <button
                            disabled={isPending && atualizando === p.id}
                            onClick={() => {
                              setAtualizando(p.id);
                              startTransition(async () => {
                                await avancarStatusProducao(p.id, p.status, p.status_producao);
                                await carregarPedidos();
                                setAtualizando(null);
                              });
                            }}
                            className="btn-gold py-1 px-2 text-xs disabled:opacity-50"
                          >
                            {isPending && atualizando === p.id ? '…' : PROXIMO_STATUS_PRODUCAO_LABEL[p.status_producao]}
                          </button>
                        )
                      ) : (
                        PROXIMO_STATUS_LABEL[p.status] && (
                          <button
                            disabled={isPending && atualizando === p.id}
                            onClick={() => {
                              setAtualizando(p.id);
                              startTransition(async () => {
                                await atualizarStatusPedido(p.id, p.status);
                                await carregarPedidos();
                                setAtualizando(null);
                              });
                            }}
                            className="btn-gold py-1 px-2 text-xs disabled:opacity-50"
                          >
                            {isPending && atualizando === p.id ? '…' : PROXIMO_STATUS_LABEL[p.status]}
                          </button>
                        )
                      )}
                      {real && podeSolicitarEstorno(p) && (
                        <button
                          onClick={() => setPedidoParaEstornar(p.id)}
                          className="btn-ghost py-1 px-2 text-xs text-status-error hover:text-status-error"
                        >
                          Estornar
                        </button>
                      )}
                      <a
                        href={`https://wa.me/55${p.cliente_telefone.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-ghost py-1 px-2 text-xs text-green-400 hover:text-green-300"
                      >
                        WhatsApp
                      </a>
                    </div>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      </div>

      {modalAberto && (
        <NovoPedidoModal
          onFechar={() => setModalAberto(false)}
          onSalvo={() => { setModalAberto(false); carregarPedidos(); }}
        />
      )}

      {pedidoParaEstornar && (
        <EstornoModal
          pedidoId={pedidoParaEstornar}
          onFechar={() => setPedidoParaEstornar(null)}
          onConcluido={() => { setPedidoParaEstornar(null); carregarPedidos(); }}
        />
      )}
    </div>
  );
}
