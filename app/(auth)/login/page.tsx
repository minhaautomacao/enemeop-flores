import type { Metadata } from 'next';
import LoginForm from './login-form';

export const metadata: Metadata = { title: 'Entrar' };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-base px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gold/10 border border-gold/30">
            <span className="text-xl font-bold text-gold">EF</span>
          </div>
          <h1 className="mt-4 text-2xl font-bold text-text-primary tracking-wide">ENEMEOP FLORES</h1>
          <p className="mt-1 text-sm text-text-muted">Acesse o painel de gestão</p>
        </div>

        <LoginForm />

        <p className="text-center text-xs text-text-faint">
          Sistema exclusivo Enemeop Flores · Desde 1997
        </p>
      </div>
    </div>
  );
}
