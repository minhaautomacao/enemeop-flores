import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Financeiro' };

const META_MENSAL = 18000;

export default async function FinanceiroPage() {
  const supabase = await createClient();

  const hoje = new Date().toISOString().split('T')[0];
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  type PedidoRow = { id: string; produto: string; cliente_nome: string; valor: number; canal: string; status: string; criado_em: string };
  type PedidoMesRow = { valor: number; canal: string; status: string };

  const { data: pedidosHojeRaw } = await supabase
    .from('pedidos')
    .select('id, produto, cliente_nome, valor, canal, status, criado_em')
    .gte('criado_em', hoje)
    .order('criado_em', { ascending: false });
  const pedidosHoje = (pedidosHojeRaw ?? []) as PedidoRow[];

  const { data: pedidosMesRaw } = await supabase
    .from('pedidos')
    .select('valor, canal, status')
    .gte('criado_em', inicioMes);
  const pedidosMes = (pedidosMesRaw ?? []) as PedidoMesRow[];

  const pagosHoje = pedidosHoje.filter(p =>
    p.status === 'entregue' || p.status === 'saiu' || p.status === 'confirmado'
  );
  const receitaHoje = pagosHoje.reduce((s, p) => s + Number(p.valor ?? 0), 0);

  const pagos = pedidosMes.filter(p =>
    p.status === 'entregue' || p.status === 'saiu' || p.status === 'confirmado'
  );
  const receitaMes = pagos.reduce((s, p) => s + Number(p.valor ?? 0), 0);
  const pctMeta = META_MENSAL > 0 ? Math.min(Math.round((receitaMes / META_MENSAL) * 100), 100) : 0;

  const canalMap: Record<string, number> = {};
  for (const p of pagos) {
    const c = p.canal ?? 'Outro';
    canalMap[c] = (canalMap[c] ?? 0) + Number(p.valor ?? 0);
  }
  const canais = Object.entries(canalMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([canal, valor]) => ({ canal, valor, pct: receitaMes > 0 ? Math.round((valor / receitaMes) * 100) : 0 }));

  const CANAL_COR: Record<string, string> = {
    WhatsApp: 'bg-status-success',
    Site: 'bg-status-info',
    Instagram: 'bg-gold',
    Presencial: 'bg-gold',
  };

  const diasRestantes = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate();

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Financeiro</h1>
          <p className="text-xs text-text-faint">Receitas e fluxo de caixa — dados reais</p>
        </div>
      </header>

      <div className="p-6 space-y-5">

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="stat-card border-gold/30">
            <p className="text-xs text-text-muted uppercase tracking-wide">Receita hoje</p>
            <p className="mt-2 text-3xl font-bold text-gold">
              R$ {receitaHoje.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
            <p className="mt-1 text-xs text-text-faint">{pagosHoje.length} pedido(s) confirmado/entregue</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-text-muted uppercase tracking-wide">Pedidos hoje</p>
            <p className="mt-2 text-3xl font-bold text-text-primary">{(pedidosHoje ?? []).length}</p>
            <p className="mt-1 text-xs text-text-faint">todos os status</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-text-muted uppercase tracking-wide">Receita do mês</p>
            <p className="mt-2 text-3xl font-bold text-status-success">
              R$ {receitaMes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
            <p className="mt-1 text-xs text-text-faint">{pagos.length} pedido(s) pagos</p>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold text-text-primary">Meta mensal</h2>
              <p className="text-xs text-text-muted">
                R$ {receitaMes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} de R$ {META_MENSAL.toLocaleString('pt-BR')}
              </p>
            </div>
            <span className="text-2xl font-bold text-gold">{pctMeta}%</span>
          </div>
          <div className="h-3 w-full rounded-full bg-bg-raised overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-gold to-gold-light transition-all"
              style={{ width: `${pctMeta}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-text-faint">
            Faltam R$ {Math.max(META_MENSAL - receitaMes, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} para atingir a meta — {diasRestantes} dias restantes
          </p>
        </div>

        {canais.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {canais.map((c) => (
              <div key={c.canal} className="card">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-text-primary">{c.canal}</span>
                  <span className="text-xs text-text-muted">{c.pct}%</span>
                </div>
                <p className="text-xl font-bold text-text-primary">
                  R$ {c.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
                <div className="mt-2 h-1.5 w-full rounded-full bg-bg-raised overflow-hidden">
                  <div
                    className={`h-full rounded-full ${CANAL_COR[c.canal] ?? 'bg-gold'}`}
                    style={{ width: `${c.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-text-primary">Pedidos de hoje</h2>
          </div>
          {(pedidosHoje ?? []).length === 0 ? (
            <div className="px-4 py-10 text-center text-text-muted text-sm">
              Nenhum pedido registrado hoje ainda.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Produto</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Cliente</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Canal</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wide">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(pedidosHoje ?? []).map((p) => (
                  <tr key={p.id} className="table-row-hover">
                    <td className="px-4 py-3 text-text-primary">{p.produto}</td>
                    <td className="px-4 py-3 text-text-muted text-xs">{p.cliente_nome}</td>
                    <td className="px-4 py-3 text-text-muted text-xs">{p.canal}</td>
                    <td className="px-4 py-3 text-xs capitalize">{p.status}</td>
                    <td className="px-4 py-3 text-right font-semibold text-status-success">
                      R$ {Number(p.valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}
