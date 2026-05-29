import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Configurações' };

const INTEGRACOES = [
  {
    nome:    'WhatsApp (Evolution API)',
    icon:    '💬',
    desc:    'Envio e recebimento de mensagens automatizado',
    status:  'pendente',
    link:    '/dashboard/configuracoes/whatsapp',
  },
  {
    nome:    'Mercado Pago',
    icon:    '💳',
    desc:    'Pagamentos via Pix, cartão e boleto',
    status:  'pendente',
    link:    '/dashboard/configuracoes/pagamentos',
  },
  {
    nome:    'Melhor Envio',
    icon:    '📦',
    desc:    'Cálculo de frete e geração de etiquetas',
    status:  'pendente',
    link:    '/dashboard/configuracoes/frete',
  },
  {
    nome:    'Resend (E-mail)',
    icon:    '📧',
    desc:    'E-mails transacionais e notificações',
    status:  'pendente',
    link:    '/dashboard/configuracoes/email',
  },
];

const HORARIOS = [
  { dia: 'Segunda a Sexta', abertura: '08:00', fechamento: '18:00' },
  { dia: 'Sábado',         abertura: '08:00', fechamento: '14:00' },
  { dia: 'Domingo',        abertura: '—',     fechamento: '—'     },
];

export default function ConfiguracoesPage() {
  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Configurações</h1>
        <p className="mt-1 text-text-muted">Integrações, horários e comportamento do agente IA</p>
      </div>

      {/* Integrações */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-text-primary">Integrações</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {INTEGRACOES.map((intg) => (
            <a key={intg.nome} href={intg.link} className="card-hover flex items-start gap-4 cursor-pointer">
              <span className="text-2xl">{intg.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-text-primary">{intg.nome}</p>
                  <span className={`badge ${intg.status === 'ativo' ? 'badge-success' : 'badge-warning'}`}>
                    {intg.status === 'ativo' ? 'Ativo' : 'Configurar'}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-text-muted">{intg.desc}</p>
              </div>
              <span className="text-text-faint text-sm">→</span>
            </a>
          ))}
        </div>
      </section>

      {/* Horários de funcionamento */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-text-primary">Horários de funcionamento</h2>
          <button className="btn-outline text-xs py-1.5">Editar</button>
        </div>
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Período</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Abertura</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Fechamento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {HORARIOS.map((h) => (
                <tr key={h.dia}>
                  <td className="px-4 py-3 text-text-primary">{h.dia}</td>
                  <td className="px-4 py-3 font-medium text-gold">{h.abertura}</td>
                  <td className="px-4 py-3 font-medium text-gold">{h.fechamento}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Agente IA */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-text-primary">Agente IA</h2>
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text-primary">Resposta automática WhatsApp</p>
              <p className="text-xs text-text-muted">O agente responde clientes fora do horário comercial</p>
            </div>
            <div className="h-6 w-11 rounded-full bg-gold cursor-pointer relative">
              <span className="absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-bg-base shadow" />
            </div>
          </div>
          <div className="border-t border-border pt-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text-primary">Classificação automática de leads</p>
              <p className="text-xs text-text-muted">IA classifica intenção de compra em tempo real</p>
            </div>
            <div className="h-6 w-11 rounded-full bg-gold cursor-pointer relative">
              <span className="absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-bg-base shadow" />
            </div>
          </div>
          <div className="border-t border-border pt-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text-primary">Sem desconto automático</p>
              <p className="text-xs text-text-muted">Agente nunca concede desconto sem aprovação humana</p>
            </div>
            <div className="h-6 w-11 rounded-full bg-gold cursor-pointer relative">
              <span className="absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-bg-base shadow" />
            </div>
          </div>
        </div>
      </section>

      {/* Mensagens padrão */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-text-primary">Mensagens padrão do agente</h2>
          <button className="btn-outline text-xs py-1.5">Editar</button>
        </div>
        <div className="card space-y-3">
          {[
            { label: 'Saudação inicial', msg: 'Olá! Bem-vindo(a) à Enemeop Flores 🌸 Como posso ajudar?' },
            { label: 'Fora do horário',  msg: 'Obrigado pelo contato! Nosso horário é de seg-sex 8h às 18h. Responderemos em breve.' },
            { label: 'Confirmação pedido', msg: 'Pedido confirmado! Sua entrega está prevista para {{horario}} em {{bairro}}. 💐' },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-text-muted mb-1">{m.label}</p>
              <p className="text-sm text-text-primary">{m.msg}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
