import type { Metadata } from 'next';

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

        {/* Form */}
        <form className="space-y-4" action="/api/auth/login" method="POST">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">E-mail</label>
            <input type="email" name="email" required className="input" placeholder="seu@email.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Senha</label>
            <input type="password" name="password" required className="input" placeholder="••••••••" />
          </div>
          <button type="submit" className="btn-gold w-full mt-2">
            Entrar
          </button>
        </form>

        <p className="text-center text-xs text-text-faint">
          Sistema exclusivo Enemeop Flores · Desde 1997
        </p>
      </div>
    </div>
  );
}
