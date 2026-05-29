'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setErro('');

    const form = new FormData(e.currentTarget);
    const { error } = await supabase.auth.signInWithPassword({
      email: form.get('email') as string,
      password: form.get('password') as string,
    });

    if (error) {
      setErro('E-mail ou senha incorretos');
      setLoading(false);
    } else {
      router.push('/dashboard');
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5">E-mail</label>
        <input type="email" name="email" required className="input" placeholder="seu@email.com" />
      </div>
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5">Senha</label>
        <input type="password" name="password" required className="input" placeholder="••••••••" />
      </div>
      {erro && (
        <p className="rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-xs text-status-error">
          {erro}
        </p>
      )}
      <button type="submit" disabled={loading} className="btn-gold w-full mt-2">
        {loading ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  );
}
