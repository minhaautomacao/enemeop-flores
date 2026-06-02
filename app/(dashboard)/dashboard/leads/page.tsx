import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Clientes / CRM' };

type Intencao = 'urgente' | 'alta' | 'media' | 'baixa' | 'desconhecida';

const INTENCAO_LABEL: Record<Intencao, string> = {
  urgente:     'Urgente',
  alta:        'Alta',
  media:       'Média',
  baixa:       'Baixa',
  desconhecida:'Desconhecida',
};

const INTENCAO_BADGE: Record<Intencao, string> = {
  urgente:     'badge-error',
  alta:        'badge-gold',
  media:       'badge-info',
  baixa:       'badge-info',
  desconhecida:'badge-info',
};

interface Lead {
  id: string;
  nome: string | null;
  canal: string;
  canal_id: string | null;
  intencao: Intencao;
  status: string;
  notas: string | null;
  mensagem_inicial: string | null;
  criado_em: string;
  atualizado_em: string | null;
}

async function getLeads(): Promise<Lead[]> {
  const url = 'https://ebeapnydeiwuewxatuuw.supabase.co/functions/v1/leads-enemeop?limit=100';
  try {
    const res = await fetch(url, { next: { revalidate: 30 } });
    if (!res.ok) return [];
    const json = await res.json();
    return json.leads ?? [];
  } catch {
    return [];
  }
}

function formatTempo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)} dias`;
}

export default async function LeadsPage() {
  const leads = await getLeads();

  const urgentes    = leads.filter(l => l.intencao === 'urgente').length;
  const altas       = leads.filter(l => l.intencao === 'alta').length;
  const instagram   = leads.filter(l => l.canal === 'instagram').length;

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Clientes / CRM</h1>
          <p className="text-xs text-text-faint">Leads capturados pelo agente de Instagram</p>
        </div>
      </header>

      <div className="p-6 space-y-5">

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Total leads',  valor: leads.length, cor: 'text-text-primary' },
            { label: 'Urgentes',     valor: urgentes,     cor: 'text-status-error' },
            { label: 'Alta intenção',valor: altas,        cor: 'text-gold' },
            { label: 'Instagram',    valor: instagram,    cor: 'text-status-success' },
          ].map((s) => (
            <div key={s.label} className="stat-card">
              <p className="text-xs text-text-muted uppercase tracking-wide">{s.label}</p>
              <p className={`mt-2 text-2xl font-bold ${s.cor}`}>{s.valor}</p>
            </div>
          ))}
        </div>

        <div className="card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <p className="text-sm font-medium text-text-primary">{leads.length} contatos</p>
            <span className="text-xs text-text-faint">Atualiza a cada 30s</span>
          </div>

          {leads.length === 0 ? (
            <div className="px-4 py-12 text-center text-text-muted text-sm">
              Nenhum lead captado ainda. Aguardando mensagens no Instagram.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Lead</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Canal</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Intenção IA</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Mensagem</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Captado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((l) => (
                  <tr key={l.id} className="table-row-hover">
                    <td className="px-4 py-3">
                      <p className="font-medium text-text-primary">{l.nome ?? 'Usuário Instagram'}</p>
                      <p className="text-xs text-text-faint font-mono">{l.canal_id}</p>
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs capitalize">{l.canal}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${INTENCAO_BADGE[l.intencao] ?? 'badge-info'}`}>
                        {INTENCAO_LABEL[l.intencao] ?? l.intencao}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs max-w-xs truncate">
                      {l.mensagem_inicial ?? l.notas ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs capitalize">{l.status}</td>
                    <td className="px-4 py-3 text-text-muted text-xs">{formatTempo(l.criado_em)}</td>
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
