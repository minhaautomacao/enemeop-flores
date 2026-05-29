import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { iniciais } from '@/lib/utils';
import { BrandPattern } from '@/components/brand-pattern';

const NAV_ITEMS = [
  { href: '/dashboard',               label: 'Visão Geral',    icon: '◈' },
  { href: '/dashboard/pedidos',       label: 'Pedidos',        icon: '📋' },
  { href: '/dashboard/leads',         label: 'Clientes / CRM', icon: '👥' },
  { href: '/dashboard/entregas',      label: 'Entregas',       icon: '🚚' },
  { href: '/dashboard/financeiro',    label: 'Financeiro',     icon: '💰' },
  { href: '/dashboard/configuracoes', label: 'Configurações',  icon: '⚙️' },
];

function EnumeopLogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="36" height="36" rx="9" fill="rgba(201,168,76,0.12)" stroke="rgba(201,168,76,0.35)" strokeWidth="0.75"/>
      {/* 4-petal logo mark */}
      <g fill="#C9A84C">
        {/* top-left petal */}
        <path d="M17,17 Q17,9 10,9 Q9,9 9,10 Q9,17 17,17 Z" opacity="0.95"/>
        {/* top-right petal */}
        <path d="M19,17 Q19,9 26,9 Q27,9 27,10 Q27,17 19,17 Z" opacity="0.85"/>
        {/* bottom-left petal */}
        <path d="M17,19 Q17,27 10,27 Q9,27 9,26 Q9,19 17,19 Z" opacity="0.85"/>
        {/* bottom-right petal */}
        <path d="M19,19 Q19,27 26,27 Q27,27 27,26 Q27,19 19,19 Z" opacity="0.95"/>
      </g>
    </svg>
  );
}

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
      <aside className="fixed inset-y-0 left-0 z-10 flex w-64 flex-col border-r border-border bg-bg-surface overflow-hidden">
        {/* Padrão de marca no sidebar (muito sutil) */}
        <BrandPattern className="absolute inset-0 h-full w-full" />

        {/* Logo */}
        <div className="relative flex h-[72px] items-center gap-3 border-b border-border px-4">
          <EnumeopLogoMark size={40} />
          <div className="leading-tight">
            <p className="text-sm font-bold text-gold tracking-[0.12em]">ENEMEOP</p>
            <p className="text-[10px] text-gold/50 tracking-[0.28em] font-medium">FLORES</p>
          </div>
        </div>

        {/* Navegação */}
        <nav className="relative flex-1 overflow-y-auto px-3 py-4">
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
                <Link href="/dashboard/configuracoes" className="nav-link">
                  <span className="text-base">🤖</span>
                  Agente IA
                </Link>
              </li>
              <li>
                <Link href="/dashboard/configuracoes" className="nav-link">
                  <span className="text-base">💬</span>
                  WhatsApp
                </Link>
              </li>
            </ul>
          </div>
        </nav>

        {/* Usuário */}
        <div className="relative border-t border-border p-4">
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

      {/* Conteúdo principal com padrão de fundo */}
      <main className="ml-64 flex-1 min-w-0 relative">
        <BrandPattern className="fixed left-64 top-0 right-0 bottom-0" />
        <div className="relative z-10">
          {children}
        </div>
      </main>
    </div>
  );
}
