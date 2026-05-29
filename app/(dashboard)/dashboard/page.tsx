import { createClient } from '@/lib/supabase/server';
import { formatarMoeda, formatarDataHora } from '@/lib/utils';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Visão Geral' };

// Tipos locais para dados da floricultura
type StatusPedido = 'novo' | 'confirmado' | 'preparando' | 'saiu' | 'entregue' | 'cancelado';

const STATUS_LABEL: Record<StatusPedido, string> = {
  novo:        'Novo',
  confirmado:  'Confirmado',
  preparando:  'Em Preparo',
  saiu:        'Saiu p/ Entrega',
  entregue:    'Entregue',
  cancelado:   'Cancelado',
};

const STATUS_BADGE: Record<StatusPedido, string> = {
  novo:       'badge-info',
  confirmado: 'badge-gold',
  preparando: 'badge-warning',
  saiu:       'badge-info',
  entregue:   'badge-success',
  cancelado:  'badge-error',
};

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

  // Hora de saudação
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';

  // Dados mockados — substituir por queries reais
  const stats = [
    { label: 'Pedidos hoje',      valor: '14',         sub: '3 pendentes de confirmação', cor: 'text-gold' },
    { label: 'Receita do dia',    valor: 'R$ 2.180',   sub: '+12% vs. ontem',             cor: 'text-status-success' },
    { label: 'Entregas',          valor: '9 / 14',     sub: '5 ainda em rota',            cor: 'text-status-info' },
    { label: 'Novos clientes',    valor: '6',          sub: 'via WhatsApp hoje',           cor: 'text-gold-light' },
  ];

  const pedidosUrgentes = [
    { id: '#1042', produto: 'Buquê de rosas vermelhas',  cliente: 'Ana Lima',    horario: '14:00', bairro: 'Ipiranga',   status: 'confirmado' as StatusPedido },
    { id: '#1043', produto: 'Arranjo corporativo P',     cliente: 'Empresa XYZ', horario: '15:30', bairro: 'Vila Mariana',status: 'preparando' as StatusPedido },
    { id: '#1044', produto: 'Orquídea vaso + card',      cliente: 'Pedro Souza', horario: '16:00', bairro: 'Saúde',      status: 'novo'       as StatusPedido },
    { id: '#1045', produto: 'Kit maternidade girassóis', cliente: 'Família Melo',horario: '17:00', bairro: 'Cambuci',    status: 'saiu'       as StatusPedido },
  ];

  const atividadeRecente = [
    { msg: 'Cliente Ana Lima confirmou pedido #1042 via WhatsApp', quando: '10 min atrás',   tipo: 'success' },
    { msg: 'Novo lead: Fernanda Costa perguntou sobre flores para casamento', quando: '23 min atrás', tipo: 'info' },
    { msg: 'Entrega #1038 concluída — João confirmou recebimento', quando: '1h atrás',   tipo: 'success' },
    { msg: 'Pagamento R$320 aprovado — Pedido #1040', quando: '2h atrás',   tipo: 'gold' },
    { msg: 'Estoque baixo: Rosa Vermelha — apenas 8 unidades', quando: '3h atrás',   tipo: 'warning' },
  ];

  const atividadeCor: Record<string, string> = {
    success: 'bg-status-success',
    info:    'bg-status-info',
    warning: 'bg-status-warning',
    gold:    'bg-gold',
  };

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            {saudacao}, {primeiroNome}
          </h1>
          <p className="mt-1 text-text-muted">
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-status-success/30 bg-status-success/10 px-3 py-1 text-xs font-medium text-status-success">
            <span className="h-1.5 w-1.5 rounded-full bg-status-success animate-pulse" />
            Agente ativo
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="stat-card">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide">{stat.label}</p>
            <p className={`mt-2 text-3xl font-bold ${stat.cor}`}>{stat.valor}</p>
            <p className="mt-1 text-xs text-text-faint">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Pedidos urgentes + Atividade recente */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Pedidos do dia */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-text-primary">Pedidos para hoje</h2>
            <a href="/dashboard/pedidos" className="text-xs text-gold hover:text-gold-light transition-colors">
              Ver todos →
            </a>
          </div>
          <div className="space-y-3">
            {pedidosUrgentes.map((pedido) => (
              <div key={pedido.id} className="flex items-start gap-3 rounded-lg border border-border p-3 hover:border-border-strong transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-mono text-text-faint">{pedido.id}</span>
                    <span className={`badge ${STATUS_BADGE[pedido.status]}`}>{STATUS_LABEL[pedido.status]}</span>
                  </div>
                  <p className="text-sm font-medium text-text-primary truncate">{pedido.produto}</p>
                  <p className="text-xs text-text-muted">{pedido.cliente} · {pedido.bairro}</p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className="text-sm font-semibold text-gold">{pedido.horario}</p>
                  <button className="mt-1 text-xs text-text-muted hover:text-gold transition-colors">WhatsApp</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Atividade recente */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-text-primary">Atividade recente</h2>
            <a href="/dashboard/leads" className="text-xs text-gold hover:text-gold-light transition-colors">
              Ver CRM →
            </a>
          </div>
          <div className="space-y-3">
            {atividadeRecente.map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${atividadeCor[item.tipo]}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text-primary leading-snug">{item.msg}</p>
                  <p className="mt-0.5 text-xs text-text-faint">{item.quando}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Gráfico de vendas — placeholder visual */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-base font-semibold text-text-primary">Vendas — últimos 7 dias</h2>
          <div className="flex items-center gap-4 text-xs text-text-muted">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-gold" />Receita</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-status-info/50" />Pedidos</span>
          </div>
        </div>
        <div className="flex items-end gap-2 h-24">
          {[65, 45, 80, 55, 90, 70, 100].map((h, i) => {
            const dias = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-gold/80 hover:bg-gold transition-colors cursor-pointer"
                  style={{ height: `${h}%` }}
                />
                <span className="text-xs text-text-faint">{dias[i]}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
