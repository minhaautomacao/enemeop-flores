'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, Clock, RefreshCw, Send, UserCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Mensagem = { role: 'user' | 'assistant'; content: string; ts?: string; autor_tipo?: string; autor_id?: string; status?: string };
type Conversa = {
  id: string; canal: string; canal_id: string; nome_cliente: string | null; fase: string;
  historico: Mensagem[]; pedido_info: Record<string, unknown> | null; atualizado_em?: string;
  modo_atendimento?: 'flora' | 'humano'; status_atendimento?: string; motivo_handoff?: string | null;
  handoff_em?: string | null; resumo?: string | null; proximo_passo?: string | null; atendente_id?: string | null; assumido_em?: string | null;
};

const STATUS: Record<string, string> = {
  flora_atendendo: 'Flora atendendo', aguardando_humano: 'Aguardando humano', humano_atendendo: 'Humano atendendo',
  aguardando_cliente: 'Aguardando cliente', concluida: 'Concluída', erro_envio: 'Erro no envio',
};
const CANAL: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook' };

function hora(v?: string | null) { return v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; }
function espera(v?: string | null) { if (!v) return '—'; const m = Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}min`; }
function ultima(c: Conversa) { return c.historico?.[c.historico.length - 1]?.content ?? '—'; }

export default function AtendimentoFloraClient() {
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const res = await fetch('/api/atendimento/conversas');
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Erro ao carregar conversas');
    setConversas(json.conversas ?? []);
    setSelecionada((atual) => atual ?? json.conversas?.[0]?.id ?? null);
  }, []);

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    carregar().catch(e => setErro(e.message));
    const supabase = createClient();
    const canal = supabase.channel('flora-inbox-conversas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversas' }, () => carregar().catch(() => {}))
      .subscribe();
    const timer = window.setInterval(() => carregar().catch(() => {}), 15000);
    return () => { window.clearInterval(timer); supabase.removeChannel(canal); };
  }, [carregar]);

  const conversa = useMemo(() => conversas.find(c => c.id === selecionada) ?? null, [conversas, selecionada]);
  const podeEnviar = !!conversa && conversa.modo_atendimento === 'humano' && conversa.atendente_id === userId && conversa.status_atendimento !== 'concluida';

  async function acao(tipo: 'assumir' | 'devolver' | 'concluir') {
    if (!conversa) return;
    setLoading(true); setErro(null);
    try {
      const res = await fetch(`/api/atendimento/conversas/${conversa.id}/${tipo}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha na ação');
      await carregar();
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha na ação'); }
    finally { setLoading(false); }
  }

  async function enviar() {
    if (!conversa || !texto.trim()) return;
    const mensagem = texto.trim();
    setLoading(true); setErro(null);
    try {
      const res = await fetch(`/api/atendimento/conversas/${conversa.id}/mensagens`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagem, idempotency_key: `${conversa.id}:${userId}:${Date.now()}:${mensagem.length}` }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao enviar');
      setTexto(''); await carregar();
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha ao enviar'); }
    finally { setLoading(false); }
  }

  return <div>
    <header className="page-header"><div><h1 className="page-title">Atendimento Flora</h1><p className="text-xs text-text-faint">Inbox humano integrado ao Instagram e Facebook</p></div><button onClick={() => carregar()} className="btn-outline text-xs"><RefreshCw className="w-4 h-4"/>Atualizar</button></header>
    <div className="p-6 space-y-4">
      {erro && <div className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{erro}</div>}
      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-4 min-h-[680px]">
        <aside className="card p-0 overflow-hidden"><div className="px-4 py-3 border-b border-border flex justify-between"><b className="text-sm">Fila</b><span className="text-xs text-text-faint">{conversas.length}</span></div><div className="divide-y divide-border max-h-[640px] overflow-y-auto">
          {conversas.map(c => { const status = c.status_atendimento ?? 'flora_atendendo'; const alerta = ['aguardando_humano','erro_envio'].includes(status); return <button key={c.id} onClick={() => setSelecionada(c.id)} className={`w-full text-left p-4 hover:bg-surface-hover ${c.id === selecionada ? 'bg-gold/10' : ''}`}><div className="flex items-center justify-between gap-2"><b className="text-sm text-text-primary truncate">{c.nome_cliente ?? c.canal_id}</b>{alerta && <AlertTriangle className="w-4 h-4 text-status-warning"/>}</div><p className="text-xs text-text-faint mt-1">{CANAL[c.canal] ?? c.canal} • {hora(c.atualizado_em)}</p><p className="text-xs text-text-muted truncate mt-2">{ultima(c)}</p><div className="flex justify-between mt-3"><span className={`text-[10px] px-2 py-0.5 rounded-full ${alerta ? 'badge-warning' : 'badge-info'}`}>{STATUS[status] ?? status}</span><span className="text-[10px] text-text-faint">{espera(c.handoff_em ?? c.atualizado_em)}</span></div></button>; })}
        </div></aside>
        <section className="card p-0 overflow-hidden flex flex-col">{!conversa ? <div className="flex-1 grid place-items-center text-text-muted">Selecione uma conversa.</div> : <>
          <div className="px-4 py-3 border-b border-border flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold text-text-primary">{conversa.nome_cliente ?? conversa.canal_id}</h2><p className="text-xs text-text-faint">{CANAL[conversa.canal] ?? conversa.canal} • fase {conversa.fase}</p>{conversa.motivo_handoff && <p className="text-xs text-status-warning mt-1">Motivo: {conversa.motivo_handoff}</p>}</div><div className="flex gap-2"><button disabled={loading} onClick={() => acao('assumir')} className="btn-primary text-xs"><UserCheck className="w-4 h-4"/>Assumir</button><button disabled={loading} onClick={() => acao('devolver')} className="btn-outline text-xs"><Bot className="w-4 h-4"/>Devolver</button><button disabled={loading} onClick={() => acao('concluir')} className="btn-outline text-xs"><CheckCircle2 className="w-4 h-4"/>Concluir</button></div></div>
          <div className="grid grid-cols-1 2xl:grid-cols-[1fr_320px] flex-1 min-h-0"><div className="flex flex-col min-h-0"><div className="flex-1 overflow-y-auto p-4 space-y-3 bg-bg-base/60">{(conversa.historico ?? []).map((m,i) => <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}><div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm ${m.role === 'user' ? 'bg-bg-surface border border-border' : m.autor_tipo === 'humano' ? 'bg-gold text-bg-base' : 'bg-status-success text-bg-base'}`}><p className="whitespace-pre-wrap">{m.content}</p><p className="text-[10px] opacity-70 mt-1">{m.autor_tipo ?? (m.role === 'user' ? 'cliente' : 'flora')} • {hora(m.ts)}</p></div></div>)}</div><div className="p-4 border-t border-border"><p className="text-xs text-text-faint mb-2 flex gap-1"><Clock className="w-3 h-3"/>O atendente só envia após assumir. Em modo humano, a Flora fica bloqueada.</p><div className="flex gap-2"><textarea value={texto} onChange={e => setTexto(e.target.value)} disabled={!podeEnviar || loading} className="input min-h-20 flex-1" placeholder="Responder no mesmo canal Meta..."/><button disabled={!podeEnviar || !texto.trim() || loading} onClick={enviar} className="btn-primary px-4"><Send className="w-5 h-5"/></button></div></div></div><aside className="border-l border-border p-4 space-y-4"><div><b className="text-sm text-text-primary">Resumo</b><p className="text-xs text-text-muted mt-1 whitespace-pre-wrap">{conversa.resumo ?? 'Sem resumo.'}</p></div><div><b className="text-sm text-text-primary">Próximo passo</b><p className="text-xs text-text-muted mt-1">{conversa.proximo_passo ?? '—'}</p></div><div><b className="text-sm text-text-primary">Pedido info</b><pre className="text-[11px] bg-bg-base border border-border rounded-lg p-2 mt-1 overflow-auto max-h-52">{JSON.stringify(conversa.pedido_info ?? {}, null, 2)}</pre></div></aside></div>
        </>}</section>
      </div>
    </div>
  </div>;
}
