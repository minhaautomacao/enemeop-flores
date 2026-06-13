'use client';

import { useEffect, useState, useCallback } from 'react';
import { MessageCircle, Users, TrendingUp, Activity, Wifi, WifiOff } from 'lucide-react';

const IconInstagram = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
  </svg>
);

const IconFacebook = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
);

const FABRICA_URL = 'https://ebeapnydeiwuewxatuuw.supabase.co';

interface Lead {
  id: string;
  canal: string;
  nome: string | null;
  nome_exibido: string | null;
  intencao: string | null;
  status: string | null;
  criado_em: string;
  canal_id?: string;
}

interface Conversa {
  id: string;
  canal: string;
  nome: string | null;
  nome_exibido: string | null;
  intencao: string | null;
  ultima_mensagem?: string;
  atualizado_em?: string;
  criado_em: string;
  fase?: string;
  mensagens?: { role: string; content: string; ts?: string }[];
}

const CANAL_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode; bg: string }> = {
  instagram: { label: 'Instagram', color: '#E1306C', icon: <IconInstagram />, bg: 'bg-pink-50 border-pink-200' },
  facebook:  { label: 'Facebook',  color: '#1877F2', icon: <IconFacebook />, bg: 'bg-blue-50 border-blue-200' },
  whatsapp:  { label: 'WhatsApp',  color: '#25D366', icon: <MessageCircle className="w-5 h-5" />, bg: 'bg-green-50 border-green-200' },
};

const INTENCAO_BADGE: Record<string, string> = {
  urgente:    'bg-red-100 text-red-700 border-red-200',
  alta:       'bg-orange-100 text-orange-700 border-orange-200',
  media:      'bg-yellow-100 text-yellow-700 border-yellow-200',
  baixa:      'bg-gray-100 text-gray-600 border-gray-200',
  indefinida: 'bg-gray-100 text-gray-500 border-gray-200',
};

function tempoAtras(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}m atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

export default function MonitorSocialPage() {
  const [leads, setLeads]         = useState<Lead[]>([]);
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [online, setOnline]       = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [pulso, setPulso]         = useState(false);

  const fetchDados = useCallback(async () => {
    let algumSucesso = false;
    try {
      const rLeads = await fetch(`${FABRICA_URL}/functions/v1/leads-enemeop?limit=300`);
      if (rLeads.ok) {
        const j = await rLeads.json();
        setLeads(j.leads ?? []);
        algumSucesso = true;
      }
    } catch { /* leads offline */ }

    try {
      const rConv = await fetch(`${FABRICA_URL}/functions/v1/conversas-enemeop?limit=30`);
      if (rConv.ok) {
        const j = await rConv.json();
        setConversas((j.conversas ?? j.leads ?? []).slice(0, 30));
        algumSucesso = true;
      }
    } catch { /* conversas offline */ }

    setOnline(algumSucesso);
    if (algumSucesso) {
      setLastUpdate(new Date());
      setPulso(p => !p);
    }
  }, []);

  useEffect(() => {
    fetchDados();
    const id = setInterval(fetchDados, 8000);
    return () => clearInterval(id);
  }, [fetchDados]);

  // Stats por canal
  const porCanal = ['instagram', 'facebook', 'whatsapp'].map(c => ({
    canal: c,
    total: leads.filter(l => l.canal === c).length,
    hoje:  leads.filter(l => {
      if (l.canal !== c) return false;
      const d = new Date(l.criado_em);
      const now = new Date();
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    }).length,
    urgentes: leads.filter(l => l.canal === c && l.intencao === 'urgente').length,
  }));

  const totalLeads = leads.length;
  const totalHoje  = porCanal.reduce((s, c) => s + c.hoje, 0);
  const totalUrgentes = leads.filter(l => l.intencao === 'urgente').length;

  return (
    <div className="min-h-screen bg-[#FDFCF9] font-sans">
      {/* Header */}
      <div className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-[#DDD6C8] bg-[#FDFCF9]/95 backdrop-blur px-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-pink-500"><IconInstagram /></span>
            <span className="text-blue-600"><IconFacebook /></span>
            <MessageCircle className="w-4 h-4 text-green-500" />
          </div>
          <span className="text-sm font-bold text-[#1C1208]">Monitor Social — Enemeop Flores</span>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <span className="text-xs text-[#A8967E]">
              Atualizado {lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${online ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
            {online
              ? <><Wifi className="w-3 h-3" /> Ao Vivo</>
              : <><WifiOff className="w-3 h-3" /> Offline</>
            }
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-3.5rem)]">

        {/* ─── ESQUERDA: Dashboard de Leads ─────────────────────────── */}
        <div className="w-1/2 border-r border-[#DDD6C8] overflow-y-auto p-5 space-y-5">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-[#9E7A1E]" />
            <h2 className="text-sm font-semibold text-[#1C1208]">Dashboard de Leads</h2>
          </div>

          {/* Totais rápidos */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Total de Leads', value: totalLeads, sub: 'todos os canais', color: 'text-[#9E7A1E]' },
              { label: 'Hoje',           value: totalHoje,  sub: 'capturados hoje',  color: 'text-blue-600' },
              { label: 'Urgentes',       value: totalUrgentes, sub: 'alta intenção', color: 'text-red-600' },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-[#DDD6C8] bg-[#F7F4EE] p-4">
                <p className="text-[10px] font-semibold text-[#A8967E] uppercase tracking-wide mb-1">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-[#A8967E] mt-0.5">{s.sub}</p>
              </div>
            ))}
          </div>

          {/* Por canal */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-[#6B5B45] uppercase tracking-wide">Leads por Canal</p>
            {porCanal.map(({ canal, total, hoje, urgentes }) => {
              const cfg = CANAL_CONFIG[canal];
              const pct = totalLeads > 0 ? Math.round((total / totalLeads) * 100) : 0;
              return (
                <div key={canal} className={`rounded-xl border p-4 ${cfg.bg}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2" style={{ color: cfg.color }}>
                      {cfg.icon}
                      <span className="text-sm font-semibold">{cfg.label}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xl font-bold text-[#1C1208]">{total}</span>
                      <span className="text-xs text-[#A8967E] ml-1">leads</span>
                    </div>
                  </div>
                  {/* Barra de progresso */}
                  <div className="h-1.5 bg-white/60 rounded-full overflow-hidden mb-2">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: cfg.color }} />
                  </div>
                  <div className="flex gap-4 text-xs text-[#6B5B45]">
                    <span><strong className="text-[#1C1208]">{hoje}</strong> hoje</span>
                    {urgentes > 0 && <span className="text-red-600 font-semibold">{urgentes} urgente{urgentes > 1 ? 's' : ''}</span>}
                    <span className="ml-auto">{pct}% do total</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Intenções breakdown */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#6B5B45] uppercase tracking-wide">Por Intenção</p>
            <div className="rounded-xl border border-[#DDD6C8] bg-[#F7F4EE] divide-y divide-[#DDD6C8]">
              {['urgente', 'alta', 'media', 'baixa', 'indefinida'].map(intencao => {
                const qt = leads.filter(l => (l.intencao ?? 'indefinida') === intencao).length;
                if (qt === 0) return null;
                return (
                  <div key={intencao} className="flex items-center justify-between px-4 py-2.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border capitalize ${INTENCAO_BADGE[intencao] ?? INTENCAO_BADGE.indefinida}`}>{intencao}</span>
                    <span className="text-sm font-bold text-[#1C1208]">{qt}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ─── DIREITA: Feed em Tempo Real ──────────────────────────── */}
        <div className="w-1/2 overflow-y-auto p-5 space-y-4">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Activity className={`w-4 h-4 text-[#9E7A1E] transition-opacity ${pulso ? 'opacity-100' : 'opacity-30'}`} />
              <h2 className="text-sm font-semibold text-[#1C1208]">Interações em Tempo Real</h2>
            </div>
            <span className="text-xs text-[#A8967E]">Atualiza a cada 8s</span>
          </div>

          {conversas.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center gap-3">
              <Users className="w-10 h-10 text-[#DDD6C8]" />
              <p className="text-sm text-[#A8967E]">Aguardando interações…</p>
              <p className="text-xs text-[#A8967E]">As mensagens aparecem aqui conforme chegam</p>
            </div>
          ) : (
            <div className="space-y-3">
              {conversas.map(conv => {
                const cfg = CANAL_CONFIG[conv.canal] ?? CANAL_CONFIG.instagram;
                const nome = conv.nome_exibido ?? conv.nome ?? 'Desconhecido';
                const msgs = conv.mensagens ?? [];
                const ultimaMsg = msgs[msgs.length - 1];
                return (
                  <div key={conv.id} className={`rounded-xl border p-4 ${cfg.bg} space-y-2`}>
                    {/* Cabeçalho */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2" style={{ color: cfg.color }}>
                        {cfg.icon}
                        <span className="text-sm font-semibold text-[#1C1208]">{nome}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {conv.intencao && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border capitalize ${INTENCAO_BADGE[conv.intencao] ?? INTENCAO_BADGE.indefinida}`}>
                            {conv.intencao}
                          </span>
                        )}
                        <span className="text-[10px] text-[#A8967E]">
                          {tempoAtras(conv.atualizado_em ?? conv.criado_em)}
                        </span>
                      </div>
                    </div>

                    {/* Últimas mensagens */}
                    {msgs.length > 0 ? (
                      <div className="space-y-1.5 max-h-32 overflow-y-auto">
                        {msgs.slice(-3).map((m, i) => (
                          <div key={i} className={`flex ${m.role === 'assistant' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-xs leading-relaxed ${
                              m.role === 'assistant'
                                ? 'bg-[#9E7A1E]/15 text-[#6B5B45] border border-[#9E7A1E]/20'
                                : 'bg-white text-[#1C1208] border border-[#DDD6C8]'
                            }`}>
                              {m.role === 'assistant' && <span className="text-[9px] font-bold text-[#9E7A1E] block mb-0.5">Agente Flora</span>}
                              {m.content}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : conv.ultima_mensagem ? (
                      <p className="text-xs text-[#6B5B45] bg-white/60 rounded-lg px-3 py-2 border border-[#DDD6C8]/50 line-clamp-2">
                        {conv.ultima_mensagem}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
