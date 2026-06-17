'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { NovoPedidoModal } from './NovoPedidoModal';
import type { Pedido, StatusPedido } from '@/types';

const STATUS_LABEL: Record<StatusPedido, string> = {
  novo:       'Novo',
  confirmado: 'Confirmado',
  preparando: 'Em Preparo',
  saiu:       'Saiu p/ Entrega',
  entregue:   'Entregue',
  cancelado:  'Cancelado',
};

const STATUS_BADGE: Record<StatusPedido, string> = {
  novo:       'badge-info',
  confirmado: 'badge-gold',
  preparando: 'badge-warning',
  saiu:       'badge-info',
  entregue:   'badge-success',
  cancelado:  'badge-error',
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

  const carregarPedidos = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('pedidos')
      .select('*')
      .order('criado_em', { ascending: false });
    setPedidos(data ?? []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregarPedidos(); }, [carregarPedidos]);

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
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {carregando ? (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-text-muted text-sm">Carregando pedidos…</td></tr>
              ) : pedidosFiltrados.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-text-muted text-sm">
                  {pedidos.length === 0
                    ? 'Nenhum pedido ainda. Clique em "+ Novo pedido" para começar.'
                    : 'Nenhum pedido para o filtro selecionado.'}
                </td></tr>
              ) : pedidosFiltrados.map((p) => (
                <tr key={p.id} className="table-row-hover">
                  <td className="px-4 py-3 font-mono text-xs text-text-faint">#{p.id.slice(0, 6).toUpperCase()}</td>
                  <td className="px-4 py-3 text-text-primary font-medium">{p.produto}</td>
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
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button className="btn-ghost py-1 px-2 text-xs">Ver</button>
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
              ))}
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
    </div>
  );
}
