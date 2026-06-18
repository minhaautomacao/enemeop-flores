import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Entregas' };

const STATUS_LABEL: Record<string, string> = {
  novo:       'Novo',
  confirmado: 'Confirmado',
  preparando: 'Em Preparo',
  saiu:       'Em Rota',
  entregue:   'Entregue',
  cancelado:  'Cancelado',
};

const STATUS_BADGE: Record<string, string> = {
  novo:       'badge-info',
  confirmado: 'badge-gold',
  preparando: 'badge-warning',
  saiu:       'badge-info',
  entregue:   'badge-success',
  cancelado:  'badge-error',
};

export default async function EntregasPage() {
  const supabase = await createClient();
  const hoje = new Date().toISOString().split('T')[0];

  type EntregaRow = { id: string; produto: string; cliente_nome: string; cliente_telefone: string; bairro: string | null; horario_entrega: string | null; canal: string; status: string; criado_em: string };

  const { data: pedidosRaw } = await supabase
    .from('pedidos')
    .select('id, produto, cliente_nome, cliente_telefone, bairro, horario_entrega, canal, status, criado_em')
    .gte('criado_em', hoje)
    .in('status', ['confirmado', 'preparando', 'saiu', 'entregue'])
    .order('horario_entrega', { ascending: true });

  const lista = (pedidosRaw ?? []) as EntregaRow[];
  const emRota     = lista.filter(p => p.status === 'saiu').length;
  const aguardando = lista.filter(p => p.status === 'confirmado' || p.status === 'preparando').length;
  const entregues  = lista.filter(p => p.status === 'entregue').length;

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Entregas</h1>
          <p className="text-xs text-text-faint">Pedidos com entrega agendada para hoje</p>
        </div>
      </header>

      <div className="p-6 space-y-5">

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Total hoje',  valor: lista.length, cor: 'text-text-primary'    },
            { label: 'Em rota',     valor: emRota,       cor: 'text-status-info'     },
            { label: 'Aguardando',  valor: aguardando,   cor: 'text-status-warning'  },
            { label: 'Entregues',   valor: entregues,    cor: 'text-status-success'  },
          ].map((s) => (
            <div key={s.label} className="stat-card">
              <p className="text-xs text-text-muted uppercase tracking-wide">{s.label}</p>
              <p className={`mt-2 text-2xl font-bold ${s.cor}`}>{s.valor}</p>
            </div>
          ))}
        </div>

        <div className="card p-0 overflow-hidden">
          {lista.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-text-muted text-sm">Nenhuma entrega agendada para hoje.</p>
              <p className="text-text-faint text-xs mt-1">Pedidos confirmados com horário aparecerão aqui.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Horário</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Produto</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Cliente</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Bairro</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Canal</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Contato</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lista.map((p) => (
                  <tr key={p.id} className="table-row-hover">
                    <td className="px-4 py-3 font-semibold text-gold">{p.horario_entrega ?? '—'}</td>
                    <td className="px-4 py-3 text-text-primary font-medium">{p.produto}</td>
                    <td className="px-4 py-3 text-text-primary">{p.cliente_nome}</td>
                    <td className="px-4 py-3 text-text-muted text-xs">{p.bairro ?? '—'}</td>
                    <td className="px-4 py-3 text-text-muted text-xs">{p.canal}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${STATUS_BADGE[p.status] ?? 'badge-info'}`}>
                        {STATUS_LABEL[p.status] ?? p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {p.cliente_telefone ? (
                        <a
                          href={`https://wa.me/55${p.cliente_telefone.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-status-success hover:underline"
                        >
                          WhatsApp
                        </a>
                      ) : (
                        <span className="text-xs text-text-faint">—</span>
                      )}
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
