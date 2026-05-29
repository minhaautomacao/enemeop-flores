import type { Metadata } from 'next';
import { BrandPattern } from '@/components/brand-pattern';
import LoginForm from './login-form';

export const metadata: Metadata = { title: 'Entrar | Enemeop Flores' };

function LogoMark() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="56" height="56" rx="14" fill="rgba(201,168,76,0.08)" stroke="rgba(201,168,76,0.3)" strokeWidth="1"/>
      <g fill="#C9A84C">
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

      {/* Gradiente central para destacar o card */}
      <div className="absolute inset-0 bg-radial-[ellipse_at_center] from-transparent via-bg-base/60 to-bg-base/95 pointer-events-none" />

      {/* Card de login */}
      <div className="relative z-10 w-full max-w-sm">
        <div className="rounded-2xl border border-border bg-bg-surface/90 backdrop-blur-sm shadow-gold-md p-8 space-y-7">

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
