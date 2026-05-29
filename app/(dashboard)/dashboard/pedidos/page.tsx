import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Pedidos' };

type StatusPedido = 'novo' | 'confirmado' | 'preparando' | 'saiu' | 'entregue' | 'cancelado';

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

const PEDIDOS = [
  { id: '#1045', produto: 'Buquê de rosas vermelhas',    cliente: 'Ana Lima',     valor: 180, horario: '14:00', bairro: 'Ipiranga',    status: 'saiu'       as StatusPedido, canal: 'WhatsApp' },
  { id: '#1044', produto: 'Arranjo corporativo P',        cliente: 'Empresa XYZ', valor: 320, horario: '15:30', bairro: 'V. Mariana',  status: 'preparando' as StatusPedido, canal: 'Site'     },
  { id: '#1043', produto: 'Orquídea vaso + card',         cliente: 'Pedro Souza', valor: 140, horario: '16:00', bairro: 'Saúde',       status: 'confirmado' as StatusPedido, canal: 'WhatsApp' },
  { id: '#1042', produto: 'Kit maternidade girassóis',    cliente: 'Família Melo',valor: 290, horario: '17:00', bairro: 'Cambuci',     status: 'novo'       as StatusPedido, canal: 'WhatsApp' },
  { id: '#1041', produto: 'Flores do campo misto',        cliente: 'Carla Torres',valor:  95, horario: '10:00', bairro: 'Mooca',       status: 'entregue'   as StatusPedido, canal: 'Instagram'},
  { id: '#1040', produto: 'Arranjo de lírios brancos',    cliente: 'João Neto',   valor: 210, horario: '11:30', bairro: 'Aclimação',   status: 'entregue'   as StatusPedido, canal: 'WhatsApp' },
];

const STATUS_FILTROS: { label: string; value: string }[] = [
  { label: 'Todos',        value: 'todos'      },
  { label: 'Novos',        value: 'novo'       },
  { label: 'Confirmados',  value: 'confirmado' },
  { label: 'Em Preparo',   value: 'preparando' },
  { label: 'Em Rota',      value: 'saiu'       },
  { label: 'Entregues',    value: 'entregue'   },
];

export default function PedidosPage() {
  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Pedidos</h1>
          <p className="text-xs text-text-faint">Gerencie os pedidos de hoje e anteriores</p>
        </div>
        <button className="btn-gold">+ Novo pedido</button>
      </header>

    <div className="p-6 space-y-5">

      {/* Filtros rápidos */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTROS.map((f) => (
          <button
            key={f.value}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
              f.value === 'todos'
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
            {PEDIDOS.map((p) => (
              <tr key={p.id} className="table-row-hover">
                <td className="px-4 py-3 font-mono text-xs text-text-faint">{p.id}</td>
                <td className="px-4 py-3 text-text-primary font-medium">{p.produto}</td>
                <td className="px-4 py-3 text-text-muted">{p.cliente}</td>
                <td className="px-4 py-3 font-semibold text-gold">
                  {p.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </td>
                <td className="px-4 py-3 text-text-muted">
                  <span className="font-medium text-text-primary">{p.horario}</span>
                  <span className="ml-1 text-xs">{p.bairro}</span>
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
                    <button className="btn-ghost py-1 px-2 text-xs text-green-400 hover:text-green-300">WhatsApp</button>
                  </div>
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
