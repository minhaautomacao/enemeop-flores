import { redirect } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, ClipboardList, Users, Truck, BarChart3, Settings, LogOut, MessagesSquare, MonitorPlay, BarChart2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { iniciais } from '@/lib/utils';
import { BrandPattern } from '@/components/brand-pattern';
import { EnumeopLogo } from '@/components/enemeop-logo';

const NAV_ITEMS = [
  { href: '/dashboard',               label: 'Visão Geral',       icon: LayoutDashboard },
  { href: '/dashboard/pedidos',       label: 'Pedidos',           icon: ClipboardList   },
  { href: '/dashboard/leads',         label: 'Clientes / CRM',    icon: Users           },
  { href: '/dashboard/conversas',     label: 'Conversas ao Vivo', icon: MessagesSquare  },
  { href: '/dashboard/entregas',      label: 'Entregas',          icon: Truck           },
  { href: '/dashboard/financeiro',    label: 'Financeiro',        icon: BarChart3       },
  { href: '/dashboard/configuracoes', label: 'Configurações',     icon: Settings        },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profileData } = await supabase
    .from('profiles')
    .select('nome, cargo')
    .eq('id', user.id)
    .single();

  const profile = profileData as { nome: string | null; cargo: string | null } | null;
  const nomeUsuario = profile?.nome ?? user.email ?? '';

  return (
    <div className="flex min-h-screen bg-bg-base">

      <aside className="fixed inset-y-0 left-0 z-10 flex w-60 flex-col border-r border-border bg-bg-surface overflow-hidden">
        <BrandPattern className="absolute inset-0 h-full w-full" />

        {/* Logo */}
        <div className="relative flex h-16 items-center border-b border-border px-4">
          <EnumeopLogo size="sm" showText={true} />
        </div>

        {/* Navegação */}
        <nav className="relative flex-1 overflow-y-auto px-2 py-3">
          <p className="px-3 mb-1.5 text-[10px] font-semibold text-text-faint uppercase tracking-widest">Gestão</p>
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link href={item.href} className="nav-link">
                    <Icon className="w-4 h-4 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Botões de ação rápida */}
        <div className="relative px-2 pb-3 space-y-2">
          <p className="px-3 mb-1.5 text-[10px] font-semibold text-text-faint uppercase tracking-widest">Telas Auxiliares</p>

          {/* Tela de Pedidos — abre em nova aba para monitor de produção */}
          <a
            href="/producao/producao"
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center justify-center gap-1.5 w-full rounded-lg border border-gold/40 bg-gold/10 hover:bg-gold/20 transition-all py-4 text-gold"
          >
            <MonitorPlay className="w-6 h-6" />
            <span className="text-xs font-semibold text-center leading-tight">Tela de<br/>Pedidos ↗</span>
          </a>

          {/* Monitor Social — abre em nova aba */}
          <a
            href="/monitor-social"
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center justify-center gap-1.5 w-full rounded-lg border border-border bg-bg-raised hover:border-gold/40 hover:bg-gold/10 hover:text-gold transition-all py-4 text-text-muted"
          >
            <BarChart2 className="w-6 h-6" />
            <span className="text-xs font-semibold text-center leading-tight">Monitor<br/>Social ↗</span>
          </a>
        </div>

        {/* Usuário */}
        <div className="relative border-t border-border p-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gold/15 border border-gold/30 text-xs font-bold text-gold">
              {iniciais(nomeUsuario)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-text-primary">{nomeUsuario}</p>
              <p className="text-[10px] text-text-faint">{profile?.cargo ?? 'Gerente'}</p>
            </div>
            <form action="/api/auth/signout" method="post">
              <button type="submit" className="p-1.5 text-text-faint hover:text-status-error transition-colors rounded">
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <main className="ml-60 flex-1 min-w-0 relative">
        <BrandPattern className="fixed left-60 top-0 right-0 bottom-0" />
        <div className="relative z-10">
          {children}
        </div>
      </main>
    </div>
  );
}
