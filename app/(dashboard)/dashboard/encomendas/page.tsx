import type { Metadata } from 'next';
import { CalendarPlus } from 'lucide-react';

export const metadata: Metadata = { title: 'Encomendas' };

export default function EncomendasPage() {
  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Encomendas</h1>
          <p className="text-xs text-text-faint">Agende pedidos manuais e receba lembretes automáticos</p>
        </div>
        <button className="btn-gold flex items-center gap-2">
          <CalendarPlus className="w-4 h-4" />
          Nova Encomenda
        </button>
      </header>

      <div className="p-6">
        <div className="flex items-center justify-center h-64 rounded-lg border border-dashed border-border text-text-faint text-sm">
          Calendário de encomendas — em construção
        </div>
      </div>
    </div>
  );
}
