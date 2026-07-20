import type { Metadata } from 'next';
import { LeadsTable, type Lead } from './LeadsTable';
import { formatTempo } from '@/lib/utils';

export const metadata: Metadata = { title: 'Clientes / CRM' };

// leads-enemeop foi migrada para enemeop-flores/supabase/functions/ —
// pendente de deploy no projeto Enemeop (ver docs/DEPLOYMENT.md).
const FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

async function getLeads(): Promise<Lead[]> {
  const factorySecret = process.env.FACTORY_SECRET;
  if (!factorySecret) {
    console.error('[dashboard/leads] FACTORY_SECRET não configurado no servidor — lista vazia');
    return [];
  }

  const url = `${FUNCTIONS_URL}/functions/v1/leads-enemeop?limit=100`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${factorySecret}` },
      next: { revalidate: 15 },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.leads ?? [];
  } catch {
    return [];
  }
}

export default async function LeadsPage() {
  const leads = await getLeads();

  const urgentes = leads.filter(l => l.intencao === 'urgente').length;
  const comNome  = leads.filter(l => !!(l.nome_exibido ?? l.nome)).length;

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
            { label: 'Com nome',      valor: comNome,      cor: 'text-status-success' },
            { label: 'Último',        valor: leads[0] ? formatTempo(leads[0].criado_em) : '—', cor: 'text-gold' },
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
