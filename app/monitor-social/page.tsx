'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, MessageCircle, Users, Wifi, WifiOff } from 'lucide-react';

const IconInstagram = () => <span className="text-lg">📸</span>;
const IconFacebook = () => <span className="text-lg">📘</span>;

type Lead = { id: string; canal: string; canal_id: string; nome: string | null; nome_disponivel: boolean; status: string | null; criado_em: string };
type Interacao = {
  id: string; canal: string; canal_id: string; nome: string | null; nome_disponivel: boolean; mensagem: string; tipo_interacao: string;
  data_hora: string; status_atendimento: string; respondido_por: 'cliente' | 'flora' | 'humano'; fase?: string;
  mensagens?: { role?: string; content?: string; ts?: string; autor_tipo?: string }[];
};

const CANAL_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode; bg: string }> = {
  instagram: { label: 'Instagram', color: '#E1306C', icon: <IconInstagram />, bg: 'bg-pink-50 border-pink-200' },
  facebook: { label: 'Facebook', color: '#1877F2', icon: <IconFacebook />, bg: 'bg-blue-50 border-blue-200' },
  whatsapp: { label: 'WhatsApp', color: '#25D366', icon: <MessageCircle className="w-5 h-5" />, bg: 'bg-green-50 border-green-200' },
};

function tempoAtras(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}m atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

export default function MonitorSocialPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [interacoes, setInteracoes] = useState<Interacao[]>([]);
  const [online, setOnline] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [pulso, setPulso] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const fetchDados = useCallback(async () => {
    try {
      const res = await fetch('/api/monitor-social', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao consultar Supabase');
      setLeads(json.leads ?? []);
      setInteracoes((json.interacoes ?? []).slice(0, 30));
      setOnline(true);
      setErro(null);
      setLastUpdate(new Date());
      setPulso(p => !p);
    } catch (e) {
      setOnline(false);
      setErro(e instanceof Error ? e.message : 'Fonte indisponível');
      setLeads([]);
      setInteracoes([]);
    }
  }, []);

  useEffect(() => {
    fetchDados();
    const id = setInterval(fetchDados, 8000);
    return () => clearInterval(id);
  }, [fetchDados]);

  const porCanal = ['instagram', 'facebook'].map(c => {
    const lista = leads.filter(l => l.canal === c);
    const hoje = lista.filter(l => {
      const d = new Date(l.criado_em), n = new Date();
      return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    }).length;
    return { canal: c, total: lista.length, hoje };
  });
  const totalLeads = leads.length;
  const statusList = Array.from(new Set(leads.map(l => l.status ?? 'indefinido')));

  return (
    <div className="min-h-screen bg-[#FDFCF9] font-sans">
      <div className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-[#DDD6C8] bg-[#FDFCF9]/95 backdrop-blur px-6">
        <div className="flex items-center gap-3"><IconInstagram /><IconFacebook /><span className="text-sm font-bold text-[#1C1208]">Monitor Social — Enemeop Flores</span></div>
        <div className="flex items-center gap-3">
          {lastUpdate && <span className="text-xs text-[#A8967E]">Atualizado {lastUpdate.toLocaleTimeString('pt-BR')}</span>}
          <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${online ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
            {online ? <><Wifi className="w-3 h-3" /> Ao vivo</> : <><WifiOff className="w-3 h-3" /> Indisponível</>}
          </div>
        </div>
      </div>

      {erro && <div className="mx-5 mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      <div className="flex h-[calc(100vh-3.5rem)]">
        <div className="w-1/2 border-r border-[#DDD6C8] overflow-y-auto p-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[#DDD6C8] bg-[#F7F4EE] p-4"><p className="text-[10px] font-semibold text-[#A8967E] uppercase">Total de Leads únicos</p><p className="text-2xl font-bold text-[#9E7A1E]">{totalLeads}</p><p className="text-[10px] text-[#A8967E]">um por canal + identificador</p></div>
            <div className="rounded-xl border border-[#DDD6C8] bg-[#F7F4EE] p-4"><p className="text-[10px] font-semibold text-[#A8967E] uppercase">Interações reais</p><p className="text-2xl font-bold text-blue-600">{interacoes.length}</p><p className="text-[10px] text-[#A8967E]">últimas conversas Meta</p></div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-[#6B5B45] uppercase tracking-wide">Leads por Canal</p>
            {porCanal.map(({ canal, total, hoje }) => {
              const cfg = CANAL_CONFIG[canal];
              const pct = totalLeads > 0 ? Math.round((total / totalLeads) * 100) : 0;
              return <div key={canal} className={`rounded-xl border p-4 ${cfg.bg}`}><div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2" style={{ color: cfg.color }}>{cfg.icon}<span className="text-sm font-semibold">{cfg.label}</span></div><div><span className="text-xl font-bold text-[#1C1208]">{total}</span><span className="text-xs text-[#A8967E] ml-1">leads</span></div></div><div className="h-1.5 bg-white/60 rounded-full overflow-hidden mb-2"><div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: cfg.color }} /></div><div className="flex gap-4 text-xs text-[#6B5B45]"><span><strong className="text-[#1C1208]">{hoje}</strong> hoje</span><span className="ml-auto">{pct}% do total</span></div></div>;
            })}
          </div>

          <div className="space-y-2"><p className="text-xs font-semibold text-[#6B5B45] uppercase tracking-wide">Por Status</p><div className="rounded-xl border border-[#DDD6C8] bg-[#F7F4EE] divide-y divide-[#DDD6C8]">{statusList.length === 0 ? <p className="p-4 text-xs text-[#A8967E]">Nenhum lead real.</p> : statusList.map(status => <div key={status} className="flex items-center justify-between px-4 py-2.5"><span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-gray-100 text-gray-700">{status}</span><span className="text-sm font-bold text-[#1C1208]">{leads.filter(l => (l.status ?? 'indefinido') === status).length}</span></div>)}</div></div>
        </div>

        <div className="w-1/2 overflow-y-auto p-5 space-y-4">
          <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Activity className={`w-4 h-4 text-[#9E7A1E] ${pulso ? 'opacity-100' : 'opacity-30'}`} /><h2 className="text-sm font-semibold text-[#1C1208]">Interações em Tempo Real</h2></div><span className="text-xs text-[#A8967E]">Atualiza a cada 8s</span></div>
          {interacoes.length === 0 ? <div className="flex flex-col items-center justify-center h-64 text-center gap-3"><Users className="w-10 h-10 text-[#DDD6C8]" /><p className="text-sm text-[#A8967E]">Aguardando interações reais.</p></div> : <div className="space-y-3">{interacoes.map(conv => { const cfg = CANAL_CONFIG[conv.canal] ?? CANAL_CONFIG.instagram; const nome = conv.nome ?? conv.canal_id; const msgs = conv.mensagens ?? []; return <div key={conv.id} className={`rounded-xl border p-4 ${cfg.bg} space-y-2`}><div className="flex items-center justify-between"><div className="flex items-center gap-2" style={{ color: cfg.color }}>{cfg.icon}<span className="text-sm font-semibold text-[#1C1208]">{nome}</span><span className="text-[10px] text-[#A8967E]">{conv.nome_disponivel ? 'nome Meta' : 'nome indisponível'}</span></div><div className="flex items-center gap-2"><span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-white/70 text-[#6B5B45]">{conv.status_atendimento}</span><span className="text-[10px] text-[#A8967E]">{tempoAtras(conv.data_hora)}</span></div></div><p className="text-[10px] text-[#6B5B45]">{cfg.label} • {conv.tipo_interacao} • ID {conv.canal_id} • resposta: {conv.respondido_por}</p>{msgs.length > 0 ? <div className="space-y-1.5 max-h-32 overflow-y-auto">{msgs.slice(-3).map((m, i) => <div key={i} className={`flex ${m.role === 'assistant' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-xs ${m.role === 'assistant' ? 'bg-[#9E7A1E]/15 text-[#6B5B45] border border-[#9E7A1E]/20' : 'bg-white text-[#1C1208] border border-[#DDD6C8]'}`}>{m.role === 'assistant' && <span className="text-[9px] font-bold text-[#9E7A1E] block mb-0.5">{m.autor_tipo === 'humano' ? 'Humano' : 'Agente Flora'}</span>}{m.content}</div></div>)}</div> : conv.mensagem ? <p className="text-xs text-[#6B5B45] bg-white/60 rounded-lg px-3 py-2 border border-[#DDD6C8]/50">{conv.mensagem}</p> : null}</div>; })}</div>}
        </div>
      </div>
    </div>
  );
}
