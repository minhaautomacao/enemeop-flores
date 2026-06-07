import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Clientes / CRM' };

type Intencao = 'urgente' | 'alta' | 'media' | 'baixa' | 'desconhecida';

const INTENCAO_LABEL: Record<Intencao, string> = {
  urgente:      'Urgente',
  alta:         'Alta',
  media:        'Média',
  baixa:        'Baixa',
  desconhecida: 'Desconhecida',
};

const INTENCAO_BADGE: Record<Intencao, string> = {
  urgente:      'badge-error',
  alta:         'badge-gold',
  media:        'badge-info',
  baixa:        'badge-info',
  desconhecida: 'badge-info',
};

const CANAL_ICON: Record<string, string> = {
  instagram: '📸',
  facebook:  '📘',
  whatsapp:  '📱',
};

const FASE_LABEL: Record<string, string> = {
  descoberta:           'Descoberta',
  interesse:            'Interesse',
  proposta:             'Proposta',
  aguardando_pagamento: 'Ag. Pagamento',
  concluido:            'Concluído',
  perdido:              'Perdido',
};

interface Lead {
  id: string;
  nome: string | null;
  nome_exibido: string | null;
  canal: string;
  canal_id: string | null;
  telefone: string | null;
  email: string | null;
  intencao: Intencao;
  status: string;
  notas: string | null;
  mensagem_inicial: string | null;
  fase_conversa: string | null;
  criado_em: string;
  atualizado_em: string | null;
}

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

function nomeDisplay(l: Lead): string {
  return l.nome_exibido ?? l.nome ?? '';
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Cliente</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Canal</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Intenção IA</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide hidden lg:table-cell">Última mensagem</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Captado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((l) => {
                  const nome = nomeDisplay(l);
                  return (
                    <tr key={l.id} className="table-row-hover">

                      {/* Coluna Cliente — nome + contato + fase */}
                      <td className="px-4 py-3">
                        {nome ? (
                          <p className="font-semibold text-text-primary">{nome}</p>
                        ) : (
                          <p className="text-text-muted italic text-xs">Sem nome</p>
                        )}
                        {l.telefone && (
                          <p className="text-xs text-text-muted mt-0.5">📞 {l.telefone}</p>
                        )}
                        {l.email && (
                          <p className="text-xs text-text-muted">✉️ {l.email}</p>
                        )}
                        {!l.telefone && !l.email && l.canal_id && (
                          <p className="text-xs text-text-faint font-mono">ID: {l.canal_id.slice(0, 14)}…</p>
                        )}
                        {l.fase_conversa && (
                          <p className="text-[10px] text-gold mt-0.5">{FASE_LABEL[l.fase_conversa] ?? l.fase_conversa}</p>
                        )}
                      </td>

                      {/* Canal */}
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1 text-xs text-text-muted capitalize">
                          {CANAL_ICON[l.canal] ?? '💬'} {l.canal}
                        </span>
                      </td>

                      {/* Intenção */}
                      <td className="px-4 py-3">
                        <span className={`badge ${INTENCAO_BADGE[l.intencao] ?? 'badge-info'}`}>
                          {INTENCAO_LABEL[l.intencao] ?? l.intencao}
                        </span>
                      </td>

                      {/* Última mensagem */}
                      <td className="px-4 py-3 text-text-muted text-xs max-w-xs hidden lg:table-cell">
                        <span className="line-clamp-2">{l.mensagem_inicial ?? l.notas ?? '—'}</span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3 text-text-muted text-xs capitalize">{l.status}</td>

                      {/* Tempo */}
                      <td className="px-4 py-3 text-text-muted text-xs">{formatTempo(l.criado_em)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
