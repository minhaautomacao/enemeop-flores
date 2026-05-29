import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Financeiro' };

const TRANSACOES = [
  { desc: 'Buquê rosas — Ana Lima',       valor: 180,  tipo: 'entrada', canal: 'Pix',         quando: '13:42' },
  { desc: 'Arranjo corporativo XYZ',       valor: 320,  tipo: 'entrada', canal: 'Cartão',      quando: '12:10' },
  { desc: 'Flores do campo — Carla',       valor: 95,   tipo: 'entrada', canal: 'Pix',         quando: '10:03' },
  { desc: 'Compra insumos — Ceasa',        valor: 480,  tipo: 'saida',   canal: 'Débito',      quando: '08:30' },
  { desc: 'Arranjo lírios — João Neto',    valor: 210,  tipo: 'entrada', canal: 'Pix',         quando: 'Ontem' },
  { desc: 'Frete Melhor Envio',            valor: 28,   tipo: 'saida',   canal: 'Automático',  quando: 'Ontem' },
  { desc: 'Kit maternidade — Família Melo',valor: 290,  tipo: 'entrada', canal: 'WhatsApp Pay',quando: 'Ontem' },
];

const receita  = TRANSACOES.filter(t => t.tipo === 'entrada').reduce((s, t) => s + t.valor, 0);
const despesas = TRANSACOES.filter(t => t.tipo === 'saida').reduce((s, t) => s + t.valor, 0);
const saldo    = receita - despesas;

const metaMensal = 18000;
const receitaMes = 12400;
const pctMeta    = Math.round((receitaMes / metaMensal) * 100);

export default function FinanceiroPage() {
  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Financeiro</h1>
        <p className="mt-1 text-text-muted">Receitas, despesas e fluxo de caixa</p>
      </div>

      {/* Stats principais */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="stat-card border-gold/30">
          <p className="text-xs text-text-muted uppercase tracking-wide">Receita hoje</p>
          <p className="mt-2 text-3xl font-bold text-gold">R$ {receita.toLocaleString('pt-BR')}</p>
          <p className="mt-1 text-xs text-status-success">+8% vs. ontem</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-text-muted uppercase tracking-wide">Despesas hoje</p>
          <p className="mt-2 text-3xl font-bold text-status-error">R$ {despesas.toLocaleString('pt-BR')}</p>
          <p className="mt-1 text-xs text-text-faint">Insumos + fretes</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-text-muted uppercase tracking-wide">Saldo líquido</p>
          <p className={`mt-2 text-3xl font-bold ${saldo >= 0 ? 'text-status-success' : 'text-status-error'}`}>
            R$ {saldo.toLocaleString('pt-BR')}
          </p>
          <p className="mt-1 text-xs text-text-faint">Margem {Math.round((saldo / receita) * 100)}%</p>
        </div>
      </div>

      {/* Meta mensal */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Meta mensal</h2>
            <p className="text-xs text-text-muted">
              R$ {receitaMes.toLocaleString('pt-BR')} de R$ {metaMensal.toLocaleString('pt-BR')}
            </p>
          </div>
          <span className="text-2xl font-bold text-gold">{pctMeta}%</span>
        </div>
        <div className="h-3 w-full rounded-full bg-bg-raised overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-gold to-gold-light transition-all"
            style={{ width: `${pctMeta}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-text-faint">
          Faltam R$ {(metaMensal - receitaMes).toLocaleString('pt-BR')} para atingir a meta — {30 - new Date().getDate()} dias restantes
        </p>
      </div>

      {/* Receita por canal */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { canal: 'WhatsApp',  valor: 6200, pct: 50, cor: 'bg-status-success' },
          { canal: 'Site',      valor: 3800, pct: 31, cor: 'bg-status-info'    },
          { canal: 'Presencial',valor: 2400, pct: 19, cor: 'bg-gold'           },
        ].map((c) => (
          <div key={c.canal} className="card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-text-primary">{c.canal}</span>
              <span className="text-xs text-text-muted">{c.pct}%</span>
            </div>
            <p className="text-xl font-bold text-text-primary">R$ {c.valor.toLocaleString('pt-BR')}</p>
            <div className="mt-2 h-1.5 w-full rounded-full bg-bg-raised overflow-hidden">
              <div className={`h-full rounded-full ${c.cor}`} style={{ width: `${c.pct}%` }} />
            </div>
          </div>
        ))}
      </div>

      {/* Transações recentes */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">Transações recentes</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Descrição</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Canal</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Horário</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wide">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {TRANSACOES.map((t, i) => (
              <tr key={i} className="table-row-hover">
                <td className="px-4 py-3 text-text-primary">{t.desc}</td>
                <td className="px-4 py-3 text-text-muted text-xs">{t.canal}</td>
                <td className="px-4 py-3 text-text-muted text-xs">{t.quando}</td>
                <td className={`px-4 py-3 text-right font-semibold ${t.tipo === 'entrada' ? 'text-status-success' : 'text-status-error'}`}>
                  {t.tipo === 'entrada' ? '+' : '-'}R$ {t.valor.toLocaleString('pt-BR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
