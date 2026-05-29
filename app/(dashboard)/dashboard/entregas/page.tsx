import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Entregas' };

type StatusEntrega = 'aguardando' | 'em_rota' | 'entregue' | 'reagendado';

const STATUS_LABEL: Record<StatusEntrega, string> = {
  aguardando: 'Aguardando',
  em_rota:    'Em Rota',
  entregue:   'Entregue',
  reagendado: 'Reagendado',
};

const STATUS_BADGE: Record<StatusEntrega, string> = {
  aguardando: 'badge-warning',
  em_rota:    'badge-info',
  entregue:   'badge-success',
  reagendado: 'badge-error',
};

const ENTREGAS = [
  { id: '#1045', produto: 'Buquê de rosas vermelhas',  cliente: 'Ana Lima',      bairro: 'Ipiranga',    horario: '14:00', entregador: 'Ricardo', status: 'em_rota'   as StatusEntrega, notificado: true  },
  { id: '#1044', produto: 'Arranjo corporativo P',      cliente: 'Empresa XYZ',  bairro: 'V. Mariana',  horario: '15:30', entregador: 'Ricardo', status: 'aguardando'as StatusEntrega, notificado: false },
  { id: '#1043', produto: 'Orquídea vaso + card',       cliente: 'Pedro Souza',  bairro: 'Saúde',       horario: '16:00', entregador: 'Marcus',  status: 'aguardando'as StatusEntrega, notificado: false },
  { id: '#1042', produto: 'Kit maternidade girassóis',  cliente: 'Família Melo', bairro: 'Cambuci',     horario: '17:00', entregador: 'Marcus',  status: 'aguardando'as StatusEntrega, notificado: false },
  { id: '#1041', produto: 'Flores do campo misto',      cliente: 'Carla Torres', bairro: 'Mooca',       horario: '10:00', entregador: 'Ricardo', status: 'entregue'  as StatusEntrega, notificado: true  },
  { id: '#1040', produto: 'Arranjo de lírios brancos',  cliente: 'João Neto',    bairro: 'Aclimação',   horario: '11:30', entregador: 'Marcus',  status: 'entregue'  as StatusEntrega, notificado: true  },
];

export default function EntregasPage() {
  const emRota     = ENTREGAS.filter(e => e.status === 'em_rota').length;
  const aguardando = ENTREGAS.filter(e => e.status === 'aguardando').length;
  const entregues  = ENTREGAS.filter(e => e.status === 'entregue').length;
  const total      = ENTREGAS.length;

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Entregas</h1>
          <p className="text-xs text-text-faint">Acompanhe as entregas do dia em tempo real</p>
        </div>
        <button className="btn-gold">Notificar todos</button>
      </header>

    <div className="p-6 space-y-5">

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total hoje',  valor: total,      cor: 'text-text-primary' },
          { label: 'Em rota',     valor: emRota,     cor: 'text-status-info' },
          { label: 'Aguardando',  valor: aguardando, cor: 'text-status-warning' },
          { label: 'Entregues',   valor: entregues,  cor: 'text-status-success' },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <p className="text-xs text-text-muted uppercase tracking-wide">{s.label}</p>
            <p className={`mt-2 text-2xl font-bold ${s.cor}`}>{s.valor}</p>
          </div>
        ))}
      </div>

      {/* Por entregador */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {['Ricardo', 'Marcus'].map((entregador) => {
          const lista = ENTREGAS.filter(e => e.entregador === entregador);
          const concluidas = lista.filter(e => e.status === 'entregue').length;
          return (
            <div key={entregador} className="card">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center text-sm font-bold text-gold">
                    {entregador[0]}
                  </div>
                  <span className="font-semibold text-text-primary">{entregador}</span>
                </div>
                <span className="text-xs text-text-muted">{concluidas}/{lista.length} entregas</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-bg-raised overflow-hidden">
                <div
                  className="h-full rounded-full bg-gold transition-all"
                  style={{ width: `${(concluidas / lista.length) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Lista de entregas */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Pedido</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Produto</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Cliente / Bairro</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Horário</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Entregador</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Notificado</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ENTREGAS.map((e) => (
              <tr key={e.id} className="table-row-hover">
                <td className="px-4 py-3 font-mono text-xs text-text-faint">{e.id}</td>
                <td className="px-4 py-3 text-text-primary font-medium">{e.produto}</td>
                <td className="px-4 py-3">
                  <p className="text-text-primary text-sm">{e.cliente}</p>
                  <p className="text-text-muted text-xs">{e.bairro}</p>
                </td>
                <td className="px-4 py-3 font-semibold text-gold">{e.horario}</td>
                <td className="px-4 py-3 text-text-muted">{e.entregador}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${STATUS_BADGE[e.status]}`}>{STATUS_LABEL[e.status]}</span>
                </td>
                <td className="px-4 py-3">
                  {e.notificado
                    ? <span className="badge badge-success">Sim</span>
                    : <span className="badge badge-warning">Não</span>
                  }
                </td>
                <td className="px-4 py-3">
                  <button className="btn-ghost py-1 px-2 text-xs text-green-400 hover:text-green-300">
                    Notificar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  );
}
