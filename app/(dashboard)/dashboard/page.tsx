import { createClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Visão Geral' };

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profileData } = await supabase
    .from('profiles')
    .select('nome')
    .eq('id', user!.id)
    .single();

  const profile = profileData as { nome: string | null } | null;
  const primeiroNome = profile?.nome?.split(' ')[0] ?? 'Carlos';

  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';

  const hoje = new Date().toISOString().split('T')[0];

  const [{ count: pedidosHoje }, { count: novosClientes }, { data: pedidosRecentes }] = await Promise.all([
    supabase.from('pedidos').select('*', { count: 'exact', head: true }).gte('criado_em', hoje),
    supabase.from('leads').select('*', { count: 'exact', head: true }).gte('criado_em', hoje),
    supabase.from('pedidos').select('id, produto, status, cliente_nome, valor, criado_em').order('criado_em', { ascending: false }).limit(5),
  ]);

  const stats = [
    { label: 'Pedidos hoje',   valor: String(pedidosHoje ?? 0),    sub: 'registrados hoje',        cor: 'text-gold' },
    { label: 'Receita do dia', valor: 'R$ 0',                       sub: 'nenhum pedido pago ainda', cor: 'text-status-success' },
    { label: 'Entregas',       valor: '0',                          sub: 'nenhuma entrega hoje',    cor: 'text-status-info' },
    { label: 'Novos clientes', valor: String(novosClientes ?? 0),   sub: 'capturados hoje',         cor: 'text-gold-light' },
  ];

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">{saudacao}, {primeiroNome}</h1>
          <p className="text-xs text-text-faint capitalize">
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-status-success/30 bg-status-success/10 px-3 py-1 text-xs font-medium text-status-success">
          <span className="h-1.5 w-1.5 rounded-full bg-status-success animate-pulse" />
          Agente ativo
        </span>
      </header>

      <div className="p-6 space-y-6">

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="stat-card">
              <p className="text-xs font-medium text-text-muted uppercase tracking-wide">{stat.label}</p>
              <p className={`mt-2 text-3xl font-bold ${stat.cor}`}>{stat.valor}</p>
              <p className="mt-1 text-xs text-text-faint">{stat.sub}</p>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-text-primary">Pedidos recentes</h2>
          </div>
          {!pedidosRecentes || pedidosRecentes.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-text-muted text-sm">Nenhum pedido registrado ainda.</p>
              <p className="text-text-faint text-xs mt-1">Os pedidos fechados pelo agente aparecerão aqui.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pedidosRecentes.map((p: Record<string, unknown>) => (
                <div key={String(p.id)} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium text-text-primary">{String(p.produto ?? '—')}</p>
                    <p className="text-xs text-text-muted">{String(p.cliente_nome ?? '—')}</p>
                  </div>
                  <p className="text-sm font-semibold text-gold">R$ {Number(p.valor ?? 0).toFixed(2)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-base font-semibold text-text-primary">Vendas — últimos 7 dias</h2>
          </div>
          <div className="flex items-end gap-2 h-24">
            {['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map((dia) => (
              <div key={dia} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full rounded-t bg-gold/20" style={{ height: '4px' }} />
                <span className="text-xs text-text-faint">{dia}</span>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-text-faint mt-2">Os dados de vendas aparecerão aqui conforme pedidos forem fechados.</p>
        </div>

      </div>
    </div>
  );
}
