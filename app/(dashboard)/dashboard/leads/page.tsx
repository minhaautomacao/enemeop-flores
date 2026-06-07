import type { Metadata } from 'next';
import { LeadsTable, type Lead } from './LeadsTable';

export const metadata: Metadata = { title: 'Clientes / CRM' };

async function getLeads(): Promise<Lead[]> {
  const url = 'https://ebeapnydeiwuewxatuuw.supabase.co/functions/v1/leads-enemeop?limit=100';
  try {
    const res = await fetch(url, { next: { revalidate: 15 } });
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
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)} dias`;
}

export default async function LeadsPage() {
  const leads = await getLeads();

  const urgentes  = leads.filter(l => l.intencao === 'urgente').length;
  const altas     = leads.filter(l => l.intencao === 'alta').length;
  const comNome   = leads.filter(l => !!(l.nome_exibido ?? l.nome)).length;

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Clientes / CRM</h1>
          <p className="text-xs text-text-faint">Leads capturados — Instagram, Facebook e WhatsApp</p>
        </div>
        <span className="text-xs text-text-faint">Atualiza a cada 15s</span>
      </header>

      <div className="p-6 space-y-5">

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Total leads',   valor: leads.length, cor: 'text-text-primary' },
            { label: 'Urgentes',      valor: urgentes,     cor: 'text-status-error' },
            { label: 'Alta intenção', valor: altas,        cor: 'text-gold' },
            { label: 'Com nome',      valor: comNome,      cor: 'text-status-success' },
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
          </div>

          {leads.length === 0 ? (
            <div className="px-4 py-12 text-center text-text-muted text-sm">
              Nenhum lead captado ainda. Aguardando mensagens no Instagram.
            </div>
          ) : (
            <LeadsTable leads={leads} />
          )}
        </div>
      </div>
    </div>
  );
}
