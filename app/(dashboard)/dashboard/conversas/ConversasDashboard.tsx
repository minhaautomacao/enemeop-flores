'use client';

import { useCallback, useEffect, useState } from 'react';

const FASE_LABEL: Record<string, string> = {
  descoberta:           'Descoberta',
  interesse:            'Interesse',
  proposta:             'Proposta',
  aguardando_pagamento: 'Ag. Pagamento',
  concluido:            'Concluído',
  perdido:              'Perdido',
};

const FASE_BADGE: Record<string, string> = {
  descoberta:           'badge-info',
  interesse:            'badge-gold',
  proposta:             'badge-warning',
  aguardando_pagamento: 'badge-error',
  concluido:            'badge-success',
  perdido:              'bg-zinc-700 text-zinc-300',
};

const CANAL_ICON: Record<string, string> = {
  instagram: '📸',
  facebook:  '📘',
  whatsapp:  '📱',
};

interface Mensagem {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
}

export interface Conversa {
  id: string;
  canal: string;
  canal_id: string;
  nome_cliente: string | null;
  fase: string;
  historico: Mensagem[];
  pedido_info: Record<string, unknown> | null;
  criado_em: string;
  atualizado_em: string;
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

function ultimaMensagem(historico: Mensagem[]): string {
  if (!historico || historico.length === 0) return '—';
  const ultima = historico[historico.length - 1];
  const prefixo = ultima.role === 'user' ? '👤' : '🤖';
  return `${prefixo} ${ultima.content.slice(0, 80)}${ultima.content.length > 80 ? '…' : ''}`;
}

// Dono do polling — a página server-rendered só faz a primeira busca (first
// paint rápido); daqui pra frente atualiza de verdade via
// /api/dashboard/conversas a cada 10s, batendo com o que a tela sempre
// afirmou fazer ("Ao vivo") mas antes não fazia de fato (revalidate do
// Next só afeta cache entre requests, não empurra atualização pro navegador
// já aberto).
export function ConversasDashboard({ initialConversas, initialErro }: { initialConversas: Conversa[]; initialErro: string | null }) {
  const [conversas, setConversas] = useState<Conversa[]>(initialConversas);
  const [erro, setErro] = useState<string | null>(initialErro);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/conversas?limit=100', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao carregar conversas');
      setConversas(json.conversas ?? []);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar conversas');
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(carregar, 10000);
    return () => window.clearInterval(timer);
  }, [carregar]);

  const ativas     = conversas.filter(c => !['concluido', 'perdido'].includes(c.fase)).length;
  const propostas  = conversas.filter(c => c.fase === 'proposta').length;
  const concluidas = conversas.filter(c => c.fase === 'concluido').length;

  return (
    <div className="p-6 space-y-5">

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total', valor: conversas.length, cor: 'text-text-primary' },
          { label: 'Em andamento', valor: ativas, cor: 'text-status-success' },
          { label: 'Em proposta', valor: propostas, cor: 'text-gold' },
          { label: 'Concluídas', valor: concluidas, cor: 'text-status-success' },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <p className="text-xs text-text-muted uppercase tracking-wide">{s.label}</p>
            <p className={`mt-2 text-2xl font-bold ${s.cor}`}>{s.valor}</p>
          </div>
        ))}
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-sm font-medium text-text-primary">{conversas.length} conversas</p>
          <span className="flex items-center gap-1.5 text-xs text-status-success">
            <span className="w-2 h-2 rounded-full bg-status-success animate-pulse" />
            Ao vivo
          </span>
        </div>

        {erro ? (
          <div className="px-4 py-16 text-center">
            <p className="text-status-error text-sm font-medium">Não foi possível carregar as conversas.</p>
            <p className="text-text-faint text-xs mt-1">{erro}</p>
          </div>
        ) : conversas.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <p className="text-text-muted text-sm">Nenhuma conversa ainda.</p>
            <p className="text-text-faint text-xs mt-1">Mande uma DM no Instagram para testar.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {conversas.map((c) => (
              <div key={c.id} className="px-4 py-4 hover:bg-surface-hover transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm">{CANAL_ICON[c.canal] ?? '💬'}</span>
                      <span className="text-sm font-semibold text-text-primary">
                        {c.nome_cliente ?? c.canal_id.slice(0, 12) + '…'}
                      </span>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${FASE_BADGE[c.fase] ?? 'badge-info'}`}>
                        {FASE_LABEL[c.fase] ?? c.fase}
                      </span>
                      {c.historico?.length > 0 && (
                        <span className="text-xs text-text-faint">{c.historico.length} msgs</span>
                      )}
                    </div>
                    <p className="text-xs text-text-muted truncate">{ultimaMensagem(c.historico)}</p>
                    {c.pedido_info && (
                      <p className="text-xs text-gold mt-1">
                        🛒 {String(c.pedido_info['produto'] ?? '')} — R$ {String(c.pedido_info['valor'] ?? '')}
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-text-faint">{formatTempo(c.atualizado_em)}</p>
                    <p className="text-[10px] text-text-faint capitalize mt-0.5">{c.canal}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
