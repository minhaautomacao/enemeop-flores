import type { Metadata } from 'next';
import { BrandPattern } from '@/components/brand-pattern';
import { EnumeopLogo } from '@/components/enemeop-logo';
import LoginForm from './login-form';

export const metadata: Metadata = { title: 'Entrar | Enemeop Flores' };

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-bg-base px-4 overflow-hidden">
      <BrandPattern className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0 bg-gradient-to-b from-bg-base/20 via-bg-base/60 to-bg-base/95 pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm">
        <div className="rounded-2xl border border-border bg-bg-surface/95 backdrop-blur-sm shadow-gold-md p-8 space-y-7">

          {/* Logo centralizada — tamanho lg, em coluna */}
          <div className="flex flex-col items-center gap-4">
            <EnumeopLogo size="lg" showText={false} />
            <div className="text-center">
              <h1 className="text-lg font-bold text-gold tracking-[0.18em]">ENEMEOP FLORES</h1>
              <p className="mt-0.5 text-xs text-text-faint tracking-wide">Painel de Gestão</p>
            </div>
          </div>

          <div className="border-t border-border" />

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
