'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface PedidoResumo {
  id: string;
  produto: string | null;
  status: string;
  cliente_nome: string | null;
  valor: number;
  criado_em: string;
}

interface Stats {
  pedidosHoje: number;
  novosClientes: number;
  entregasHoje: number;
  aguardandoHumano: number;
  receitaHoje: number;
  pedidosRecentes: PedidoResumo[];
}

async function carregarStats(): Promise<Stats> {
  const supabase = createClient();
  const hoje = new Date().toISOString().split('T')[0];

  const [{ count: pedidosHoje }, { count: novosClientes }, { data: pedidosRecentes }, { count: entregasHoje }, { count: aguardandoHumano }, { data: pedidosPagosRaw }] = await Promise.all([
    supabase.from('pedidos').select('*', { count: 'exact', head: true }).gte('criado_em', hoje),
    supabase.from('leads').select('*', { count: 'exact', head: true }).gte('criado_em', hoje),
    supabase.from('pedidos').select('id, produto, status, cliente_nome, valor, criado_em').order('criado_em', { ascending: false }).limit(5),
    supabase.from('pedidos').select('*', { count: 'exact', head: true }).gte('criado_em', hoje).in('status', ['saiu', 'entregue']),
    (supabase as any).from('conversas').select('*', { count: 'exact', head: true }).in('canal', ['instagram', 'facebook']).eq('status_atendimento', 'aguardando_humano'),
    supabase.from('pedidos').select('valor').gte('criado_em', hoje).in('status', ['confirmado', 'saiu', 'entregue']),
  ]);

  const receitaHoje = ((pedidosPagosRaw ?? []) as { valor: number }[]).reduce((s, p) => s + Number(p.valor ?? 0), 0);

  return {
    pedidosHoje: pedidosHoje ?? 0,
    novosClientes: novosClientes ?? 0,
    entregasHoje: entregasHoje ?? 0,
    aguardandoHumano: aguardandoHumano ?? 0,
    receitaHoje,
    pedidosRecentes: (pedidosRecentes ?? []) as PedidoResumo[],
  };
}

// Igual ao padrão já usado em /dashboard/pedidos e no Atendimento Flora:
// realtime (postgres_changes) + polling de 15s como reforço — os cards e a
// lista de "Pedidos recentes" atualizam sozinhos durante o teste, sem
// precisar recarregar a página.
export function OverviewDashboard({ initial }: { initial: Stats }) {
  const [stats, setStats] = useState<Stats>(initial);

  const carregar = useCallback(async () => {
    try {
      setStats(await carregarStats());
    } catch { /* mantém os últimos dados bons conhecidos */ }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const canal = supabase.channel('dashboard-overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, carregar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, carregar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversas' }, carregar)
      .subscribe();
    const timer = window.setInterval(carregar, 15000);
    return () => { window.clearInterval(timer); supabase.removeChannel(canal); };
  }, [carregar]);

  const receitaFmt = stats.receitaHoje.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

  const cards = [
    { label: 'Pedidos hoje',      valor: String(stats.pedidosHoje),       sub: 'registrados hoje',    cor: 'text-gold' },
    { label: 'Receita do dia',    valor: `R$ ${receitaFmt}`,              sub: 'pedidos confirmados', cor: 'text-status-success' },
    { label: 'Entregas',          valor: String(stats.entregasHoje),      sub: 'saíram ou entregues', cor: 'text-status-info' },
    { label: 'Novos clientes',    valor: String(stats.novosClientes),     sub: 'capturados hoje',     cor: 'text-gold-light' },
    { label: 'Aguardando humano', valor: String(stats.aguardandoHumano),  sub: 'Inbox Flora',         cor: 'text-status-warning' },
  ];

  return (
    <div className="p-6 space-y-6">

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((stat) => (
          <div key={stat.label} className="stat-card">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide">{stat.label}</p>
            <p className={`mt-2 text-3xl font-bold ${stat.cor}`}>{stat.valor}</p>
            <p className="mt-1 text-xs text-text-faint">{stat.sub}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-text-primary">Pedidos recentes</h2>
        </div>
        {stats.pedidosRecentes.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-text-muted text-sm">Nenhum pedido registrado ainda.</p>
            <p className="text-text-faint text-xs mt-1">Os pedidos fechados pelo agente aparecerão aqui.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {stats.pedidosRecentes.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-text-primary">{p.produto ?? '—'}</p>
                  <p className="text-xs text-text-muted">{p.cliente_nome ?? '—'}</p>
                </div>
                <p className="text-sm font-semibold text-gold">R$ {Number(p.valor ?? 0).toFixed(2)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-base font-semibold text-text-primary">Vendas — últimos 7 dias</h2>
        </div>
        <div className="flex items-end gap-2 h-24">
          {['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map((dia) => (
            <div key={dia} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full rounded-t bg-gold/20" style={{ height: '4px' }} />
              <span className="text-xs text-text-faint">{dia}</span>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-text-faint mt-2">Os dados de vendas aparecerão aqui conforme pedidos forem fechados.</p>
      </div>

    </div>
  );
}
