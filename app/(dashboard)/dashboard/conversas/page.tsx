import type { Metadata } from 'next';
import { ConversasDashboard, type Conversa } from './ConversasDashboard';

export const metadata: Metadata = { title: 'Conversas ao Vivo' };

// Retorna `erro` separado da lista — uma falha de auth/rede nunca deve
// parecer "nenhuma conversa ainda" (silenciosa); a página distingue os dois
// estados e mostra um aviso visível quando erro != null.
async function getConversas(): Promise<{ conversas: Conversa[]; erro: string | null }> {
  const factorySecret = process.env.FACTORY_SECRET;
  if (!factorySecret) {
    console.error('[dashboard/conversas] FACTORY_SECRET não configurado no servidor — lista vazia');
    return { conversas: [], erro: 'FACTORY_SECRET não configurado no servidor' };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const url = `${supabaseUrl}/functions/v1/conversas-enemeop?limit=100`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${factorySecret}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      // Nunca logamos corpo/headers da resposta (poderiam ecoar o segredo
      // enviado) — só o status HTTP, suficiente pra diagnosticar 401 (segredo
      // divergente) vs 5xx (Supabase fora do ar).
      console.error(`[dashboard/conversas] conversas-enemeop respondeu HTTP ${res.status} — lista vazia`);
      return { conversas: [], erro: `Falha ao carregar conversas (HTTP ${res.status})` };
    }
    const json = await res.json();
    return { conversas: json.conversas ?? [], erro: null };
  } catch (e) {
    console.error('[dashboard/conversas] falha de rede ao chamar conversas-enemeop:', e instanceof Error ? e.message : 'erro desconhecido');
    return { conversas: [], erro: 'Falha de rede ao carregar conversas' };
  }
}

export default async function ConversasPage() {
  const { conversas, erro } = await getConversas();

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Conversas ao Vivo</h1>
          <p className="text-xs text-text-faint">Atendimento da Flor — Instagram, Facebook e WhatsApp</p>
        </div>
        <span className="text-xs text-text-faint">Atualiza a cada 10s</span>
      </header>

      <ConversasDashboard initialConversas={conversas} initialErro={erro} />
    </div>
  );
}
