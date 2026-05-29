import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Clientes / CRM' };

type Intencao = 'urgente' | 'pesquisando' | 'recorrente' | 'corporativo';

const INTENCAO_LABEL: Record<Intencao, string> = {
  urgente:    'Urgente',
  pesquisando:'Pesquisando',
  recorrente: 'Recorrente',
  corporativo:'Corporativo',
};

const INTENCAO_BADGE: Record<Intencao, string> = {
  urgente:    'badge-error',
  pesquisando:'badge-info',
  recorrente: 'badge-success',
  corporativo:'badge-gold',
};

const LEADS = [
  { nome: 'Ana Lima',      telefone: '(11) 99999-0001', canal: 'WhatsApp', intencao: 'urgente'    as Intencao, ultima: '10 min',  pedidos: 3,  ltv: 540  },
  { nome: 'Fernanda Costa',telefone: '(11) 99999-0002', canal: 'Instagram',intencao: 'pesquisando'as Intencao, ultima: '23 min',  pedidos: 0,  ltv: 0    },
  { nome: 'Empresa XYZ',   telefone: '(11) 3333-0003',  canal: 'Site',     intencao: 'corporativo'as Intencao, ultima: '1h',      pedidos: 12, ltv: 4200 },
  { nome: 'Pedro Souza',   telefone: '(11) 99999-0004', canal: 'WhatsApp', intencao: 'recorrente' as Intencao, ultima: '2h',      pedidos: 7,  ltv: 1230 },
  { nome: 'Carla Torres',  telefone: '(11) 99999-0005', canal: 'WhatsApp', intencao: 'pesquisando'as Intencao, ultima: '5h',      pedidos: 1,  ltv: 95   },
  { nome: 'João Neto',     telefone: '(11) 99999-0006', canal: 'WhatsApp', intencao: 'recorrente' as Intencao, ultima: 'Ontem',   pedidos: 9,  ltv: 1890 },
  { nome: 'Mariana Alves', telefone: '(11) 99999-0007', canal: 'Site',     intencao: 'corporativo'as Intencao, ultima: '2 dias',  pedidos: 5,  ltv: 2100 },
];

export default function LeadsPage() {
  const totalLeads    = LEADS.length;
  const urgentes      = LEADS.filter(l => l.intencao === 'urgente').length;
  const recorrentes   = LEADS.filter(l => l.intencao === 'recorrente').length;
  const ltvTotal      = LEADS.reduce((s, l) => s + l.ltv, 0);

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Clientes / CRM</h1>
          <p className="mt-1 text-text-muted">Contatos gerenciados pelo agente de WhatsApp</p>
        </div>
        <button className="btn-gold">+ Adicionar contato</button>
      </div>

      {/* Stats rápidos */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total clientes', valor: totalLeads,    cor: 'text-text-primary' },
          { label: 'Urgentes',       valor: urgentes,      cor: 'text-status-error' },
          { label: 'Recorrentes',    valor: recorrentes,   cor: 'text-status-success' },
          { label: 'LTV total',      valor: `R$ ${ltvTotal.toLocaleString('pt-BR')}`, cor: 'text-gold' },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <p className="text-xs text-text-muted uppercase tracking-wide">{s.label}</p>
            <p className={`mt-2 text-2xl font-bold ${s.cor}`}>{s.valor}</p>
          </div>
        ))}
      </div>

      {/* Tabela */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-sm font-medium text-text-primary">{totalLeads} contatos</p>
          <input type="text" placeholder="Buscar cliente..." className="input w-56 text-xs py-1.5" />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Nome</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Telefone</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Canal</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Intenção IA</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Último contato</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Pedidos</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">LTV</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {LEADS.map((l) => (
              <tr key={l.nome} className="table-row-hover">
                <td className="px-4 py-3 font-medium text-text-primary">{l.nome}</td>
                <td className="px-4 py-3 text-text-muted font-mono text-xs">{l.telefone}</td>
                <td className="px-4 py-3 text-text-muted text-xs">{l.canal}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${INTENCAO_BADGE[l.intencao]}`}>{INTENCAO_LABEL[l.intencao]}</span>
                </td>
                <td className="px-4 py-3 text-text-muted text-xs">{l.ultima}</td>
                <td className="px-4 py-3 text-text-primary font-medium">{l.pedidos}</td>
                <td className="px-4 py-3 font-semibold text-gold">
                  {l.ltv > 0 ? `R$ ${l.ltv.toLocaleString('pt-BR')}` : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
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
  );
}
