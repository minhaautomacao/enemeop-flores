import type { Metadata } from 'next';
import { BrandPattern } from '@/components/brand-pattern';
import LoginForm from './login-form';

export const metadata: Metadata = { title: 'Entrar | Enemeop Flores' };

function LogoMark() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="56" height="56" rx="14" fill="rgba(158,122,30,0.08)" stroke="rgba(158,122,30,0.25)" strokeWidth="1"/>
      <g fill="#9E7A1E">
        <path d="M27,27 Q27,15 16,15 Q15,15 15,16 Q15,27 27,27 Z" opacity="0.95"/>
        <path d="M29,27 Q29,15 40,15 Q41,15 41,16 Q41,27 29,27 Z" opacity="0.8"/>
        <path d="M27,29 Q27,41 16,41 Q15,41 15,40 Q15,29 27,29 Z" opacity="0.8"/>
        <path d="M29,29 Q29,41 40,41 Q41,41 41,40 Q41,29 29,29 Z" opacity="0.95"/>
      </g>
    </svg>
  );
}

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-bg-base px-4 overflow-hidden">
      {/* Padrão de marca como fundo */}
      <BrandPattern className="absolute inset-0 h-full w-full" />

      <div className="absolute inset-0 bg-gradient-to-b from-bg-base/40 via-bg-base/70 to-bg-base pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm">
        <div className="rounded-2xl border border-border bg-white shadow-gold-md p-8 space-y-7">

          {/* Logo */}
          <div className="flex flex-col items-center gap-3">
            <LogoMark />
            <div className="text-center">
              <h1 className="text-lg font-bold text-gold tracking-[0.18em]">ENEMEOP FLORES</h1>
              <p className="mt-0.5 text-xs text-text-faint tracking-wide">Painel de Gestão</p>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Formulário */}
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-text-primary">Bem-vindo de volta</h2>
            <p className="text-xs text-text-muted">Entre com suas credenciais para acessar</p>
          </div>

          <LoginForm />

        </div>

        <p className="mt-4 text-center text-[11px] text-text-faint">
          Sistema exclusivo · Enemeop Flores desde 1997
        </p>
      </div>
    </div>
  );
}
