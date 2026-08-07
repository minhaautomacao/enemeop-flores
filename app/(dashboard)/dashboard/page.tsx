import { createClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';
import { OverviewDashboard } from './OverviewDashboard';

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

  // Pedidos de teste (mp_ambiente='teste') nunca entram nas contagens/receita
  // do overview — mesma exclusão já aplicada em financeiro/entregas.
  const [{ count: pedidosHoje }, { count: novosClientes }, { data: pedidosRecentes }, { count: entregasHoje }, { count: aguardandoHumano }, { data: pedidosPagosRaw }] = await Promise.all([
    supabase.from('pedidos').select('*', { count: 'exact', head: true }).neq('mp_ambiente', 'teste').gte('criado_em', hoje),
    supabase.from('leads').select('*', { count: 'exact', head: true }).gte('criado_em', hoje),
    supabase.from('pedidos').select('id, produto, status, cliente_nome, valor, criado_em').neq('mp_ambiente', 'teste').order('criado_em', { ascending: false }).limit(5),
    supabase.from('pedidos').select('*', { count: 'exact', head: true }).neq('mp_ambiente', 'teste').gte('criado_em', hoje).in('status', ['saiu', 'entregue']),
    (supabase as any).from('conversas').select('*', { count: 'exact', head: true }).in('canal', ['instagram', 'facebook']).eq('status_atendimento', 'aguardando_humano'),
    supabase.from('pedidos').select('valor').neq('mp_ambiente', 'teste').gte('criado_em', hoje).in('status', ['confirmado', 'saiu', 'entregue']),
  ]);

  const receitaHoje = ((pedidosPagosRaw ?? []) as { valor: number }[]).reduce((s, p) => s + Number(p.valor ?? 0), 0);

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">{saudacao}, {primeiroNome}</h1>
          <p className="text-xs text-text-faint capitalize">
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-status-success/25 bg-status-success/8 px-3 py-1 text-xs font-medium text-status-success">
          <span className="h-1.5 w-1.5 rounded-full bg-status-success animate-pulse" />
          Agente ativo
        </span>
      </header>

      <OverviewDashboard
        initial={{
          pedidosHoje: pedidosHoje ?? 0,
          novosClientes: novosClientes ?? 0,
          entregasHoje: entregasHoje ?? 0,
          aguardandoHumano: aguardandoHumano ?? 0,
          receitaHoje,
          pedidosRecentes: (pedidosRecentes ?? []) as any,
        }}
      />
    </div>
  );
}
