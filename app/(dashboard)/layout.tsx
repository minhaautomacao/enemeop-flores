import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { iniciais } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/dashboard',              label: 'Visão Geral',   icon: '◈' },
  { href: '/dashboard/pedidos',      label: 'Pedidos',       icon: '📋' },
  { href: '/dashboard/leads',        label: 'Clientes / CRM',icon: '👥' },
  { href: '/dashboard/entregas',     label: 'Entregas',      icon: '🚚' },
  { href: '/dashboard/financeiro',   label: 'Financeiro',    icon: '💰' },
  { href: '/dashboard/configuracoes',label: 'Configurações', icon: '⚙️' },
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
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-10 flex w-64 flex-col border-r border-border bg-bg-surface">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-border px-5">
          {/* Ícone símbolo da marca */}
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold/10 border border-gold/30">
            <span className="text-gold font-bold text-sm">EF</span>
          </div>
          <div>
            <p className="text-sm font-bold text-gold tracking-wide">ENEMEOP</p>
            <p className="text-xs text-text-faint tracking-widest">FLORES</p>
          </div>
        </div>

        {/* Navegação */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="nav-link">
                  <span className="text-base leading-none">{item.icon}</span>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-6 border-t border-border pt-4">
            <p className="px-3 mb-2 text-xs font-medium text-text-faint uppercase tracking-wider">
              Sistema
            </p>
            <ul className="space-y-0.5">
              <li>
                <Link href="/dashboard/configuracoes/agente" className="nav-link">
                  <span className="text-base">🤖</span>
                  Agente IA
                </Link>
              </li>
              <li>
                <Link href="/dashboard/configuracoes/whatsapp" className="nav-link">
                  <span className="text-base">💬</span>
                  WhatsApp
                </Link>
              </li>
            </ul>
          </div>
        </nav>

        {/* Usuário */}
        <div className="border-t border-border p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gold/20 border border-gold/30 text-sm font-bold text-gold">
              {iniciais(nomeUsuario)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text-primary">{nomeUsuario}</p>
              <p className="text-xs text-text-muted">{profile?.cargo ?? 'Gerente'}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Conteúdo principal */}
      <main className="ml-64 flex-1 min-w-0">
        {children}
      </main>
    </div>
  );
}
