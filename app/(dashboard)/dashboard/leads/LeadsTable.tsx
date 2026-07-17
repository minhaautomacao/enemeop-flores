'use client';

import { useState } from 'react';
import { formatTempo } from '@/lib/utils';

const INTENCAO_LABEL: Record<string, string> = {
  urgente:      'Urgente',
  alta:         'Alta',
  pesquisando:  'Pesquisando',
  recorrente:   'Recorrente',
  corporativo:  'Corporativo',
  media:        'Média',
  baixa:        'Baixa',
  desconhecida: 'Desconhecida',
};

const INTENCAO_BADGE: Record<string, string> = {
  urgente:      'badge-error',
  alta:         'badge-gold',
  pesquisando:  'badge-info',
  recorrente:   'badge-info',
  corporativo:  'badge-info',
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

interface Mensagem {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
}

export interface Lead {
  id: string;
  nome: string | null;
  nome_exibido: string | null;
  canal: string;
  canal_id: string | null;
  telefone: string | null;
  email: string | null;
  intencao: string;
  status: string;
  notas: string | null;
  mensagem_inicial: string | null;
  fase_conversa: string | null;
  historico_conversa?: Mensagem[];
  criado_em: string;
  atualizado_em: string | null;
}

function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// conversas-enemeop foi migrada para enemeop-flores/supabase/functions/ —
// pendente de deploy no projeto Enemeop (ver docs/DEPLOYMENT.md).
const FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

function ExpandirConversa({ canalId }: { canalId: string | null }) {
  const [aberto, setAberto] = useState(false);
  const [historico, setHistorico] = useState<Mensagem[]>([]);
  const [carregando, setCarregando] = useState(false);

  async function toggle() {
    if (aberto) { setAberto(false); return; }
    if (historico.length > 0) { setAberto(true); return; }

    setCarregando(true);
    try {
      const res = await fetch(`${FUNCTIONS_URL}/functions/v1/conversas-enemeop?canal_id=${canalId}`);
      if (res.ok) {
        const data = await res.json();
        const conv = (data.conversas ?? []).find(
          (c: { canal_id: string; historico: Mensagem[] }) => c.canal_id === canalId,
        );
        setHistorico(conv?.historico ?? []);
      }
    } catch {
      // fetch falhou silenciosamente — sem conversa
    }
    setCarregando(false);
    setAberto(true);
  }

  return (
    <div>
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 text-xs text-gold hover:text-gold-light transition-colors mt-1"
      >
        {carregando ? (
          <span className="opacity-60">Carregando...</span>
        ) : (
          <>
            <span>{aberto ? '▲' : '▼'}</span>
            <span>{aberto ? 'Fechar' : 'Ver conversa'}</span>
          </>
        )}
      </button>

      {aberto && (
        <div className="mt-3 rounded-lg border border-border bg-bg-base overflow-hidden">
          {historico.length === 0 ? (
            <p className="px-3 py-4 text-xs text-text-faint text-center">
              Nenhuma conversa registrada para este lead.
            </p>
          ) : (
            <div className="divide-y divide-border max-h-80 overflow-y-auto">
              {historico.map((msg, i) => (
                <div
                  key={i}
                  className={`px-3 py-2.5 ${msg.role === 'assistant' ? 'bg-bg-surface' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide">
                      {msg.role === 'user' ? (
                        <span className="text-status-info">Cliente</span>
                      ) : (
                        <span className="text-gold">Flora (IA)</span>
                      )}
                    </span>
                    <span className="text-[10px] text-text-faint">{formatHora(msg.ts)}</span>
                  </div>
                  <p className="text-xs text-text-primary leading-relaxed">{msg.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function LeadsTable({ leads }: { leads: Lead[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border">
          <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Cliente</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Canal</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Intenção IA</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide hidden lg:table-cell">Primeira mensagem</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Status</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Captado</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {leads.map((l) => {
          const nome = l.nome_exibido ?? l.nome;
          return (
            <tr key={l.id} className="align-top">
              <td className="px-4 py-3">
                {nome ? (
                  <p className="font-semibold text-text-primary">{nome}</p>
                ) : (
                  <p className="text-text-muted italic text-xs">Sem nome</p>
                )}
                {l.telefone && <p className="text-xs text-text-muted mt-0.5">📞 {l.telefone}</p>}
                {l.email    && <p className="text-xs text-text-muted">✉️ {l.email}</p>}
                {!l.telefone && !l.email && l.canal_id && (
                  <p className="text-xs text-text-faint font-mono">ID: {l.canal_id.slice(0, 14)}…</p>
                )}
                {l.fase_conversa && (
                  <p className="text-[10px] text-gold mt-0.5">{FASE_LABEL[l.fase_conversa] ?? l.fase_conversa}</p>
                )}
                <ExpandirConversa canalId={l.canal_id} />
              </td>

              <td className="px-4 py-3">
                <span className="flex items-center gap-1 text-xs text-text-muted capitalize">
                  {CANAL_ICON[l.canal] ?? '💬'} {l.canal}
                </span>
              </td>

              <td className="px-4 py-3">
                <span className={`badge ${INTENCAO_BADGE[l.intencao] ?? 'badge-info'}`}>
                  {INTENCAO_LABEL[l.intencao] ?? l.intencao}
                </span>
              </td>

              <td className="px-4 py-3 text-text-muted text-xs max-w-xs hidden lg:table-cell">
                <span className="line-clamp-2">{l.mensagem_inicial ?? l.notas ?? '—'}</span>
              </td>

              <td className="px-4 py-3 text-text-muted text-xs capitalize">{l.status}</td>

              <td className="px-4 py-3 text-text-muted text-xs">{formatTempo(l.criado_em)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
