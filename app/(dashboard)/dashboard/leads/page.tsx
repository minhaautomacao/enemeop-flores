import type { Metadata } from 'next';
import { LeadsDashboard, type Lead } from './LeadsTable';

export const metadata: Metadata = { title: 'Clientes / CRM' };

// leads-enemeop foi migrada para enemeop-flores/supabase/functions/ —
// pendente de deploy no projeto Enemeop (ver docs/DEPLOYMENT.md).
const FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

// Retorna `erro` separado da lista — uma falha de auth/rede nunca deve
// parecer "nenhum lead ainda" (silenciosa); a página distingue os dois
// estados e mostra um aviso visível quando erro != null.
async function getLeads(): Promise<{ leads: Lead[]; erro: string | null }> {
  const factorySecret = process.env.FACTORY_SECRET;
  if (!factorySecret) {
    console.error('[dashboard/leads] FACTORY_SECRET não configurado no servidor — lista vazia');
    return { leads: [], erro: 'FACTORY_SECRET não configurado no servidor' };
  }

  const url = `${FUNCTIONS_URL}/functions/v1/leads-enemeop?limit=100`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${factorySecret}` },
      next: { revalidate: 15 },
    });
    if (!res.ok) {
      // Nunca logamos corpo/headers da resposta (poderiam ecoar o segredo
      // enviado) — só o status HTTP, suficiente pra diagnosticar 401 (segredo
      // divergente) vs 5xx (Supabase fora do ar).
      console.error(`[dashboard/leads] leads-enemeop respondeu HTTP ${res.status} — lista vazia`);
      return { leads: [], erro: `Falha ao carregar leads (HTTP ${res.status})` };
    }
    const json = await res.json();
    return { leads: json.leads ?? [], erro: null };
  } catch (e) {
    console.error('[dashboard/leads] falha de rede ao chamar leads-enemeop:', e instanceof Error ? e.message : 'erro desconhecido');
    return { leads: [], erro: 'Falha de rede ao carregar leads' };
  }
}

export default async function LeadsPage() {
  const { leads, erro } = await getLeads();

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Clientes / CRM</h1>
          <p className="text-xs text-text-faint">Leads capturados — Instagram, Facebook e WhatsApp</p>
        </div>
        <span className="text-xs text-text-faint">Atualiza a cada 15s</span>
      </header>

      <LeadsDashboard initialLeads={leads} initialErro={erro} />
    </div>
  );
}
