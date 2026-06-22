'use client';

import { X, Phone } from 'lucide-react';
import type { Pedido, StatusPedido } from '@/types';

const STATUS_LABEL: Record<StatusPedido, string> = {
  novo:       'Novo',
  confirmado: 'Confirmado',
  preparando: 'Em Preparo',
  saiu:       'Saiu p/ Entrega',
  entregue:   'Entregue',
  cancelado:  'Cancelado',
};

const STATUS_BADGE: Record<StatusPedido, string> = {
  novo:       'badge-info',
  confirmado: 'badge-gold',
  preparando: 'badge-warning',
  saiu:       'badge-info',
  entregue:   'badge-success',
  cancelado:  'badge-error',
};

interface Props {
  pedido:   Pedido;
  onFechar: () => void;
}

function Linha({ label, valor }: { label: string; valor?: string | null }) {
  return (
    <div className="flex gap-2 py-2 border-b border-border last:border-0">
      <span className="w-40 shrink-0 text-xs text-text-muted">{label}</span>
      <span className="text-sm text-text-primary break-words">{valor ?? '—'}</span>
    </div>
  );
}

export function DetalhePedidoModal({ pedido, onFechar }: Props) {
  const fmtData = (iso: string) =>
    new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  const fmtValor = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onFechar}
    >
      <div
        className="w-full max-w-xl bg-bg-surface border border-border rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-text-primary">
              Pedido <span className="font-mono text-gold">#{pedido.id.slice(0, 6).toUpperCase()}</span>
            </h2>
            <span className={`badge ${STATUS_BADGE[pedido.status]} mt-1`}>
              {STATUS_LABEL[pedido.status]}
            </span>
          </div>
          <button onClick={onFechar} className="btn-ghost p-1.5 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Corpo */}
        <div className="px-6 py-5 space-y-6">

          {/* Produto e valor */}
          <section>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Pedido</p>
            <Linha label="Produto"    valor={pedido.produto} />
            <Linha label="Valor"      valor={fmtValor(pedido.valor)} />
            <Linha label="Canal"      valor={pedido.canal} />
            <Linha label="Status"     valor={STATUS_LABEL[pedido.status]} />
          </section>

          {/* Cliente */}
          <section>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Cliente</p>
            <Linha label="Nome"     valor={pedido.cliente_nome} />
            <Linha label="Telefone" valor={pedido.cliente_telefone} />
          </section>

          {/* Entrega */}
          <section>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Entrega</p>
            <Linha label="Horário de entrega" valor={pedido.horario_entrega} />
            <Linha label="Bairro"             valor={pedido.bairro} />
          </section>

          {/* Obs */}
          {pedido.obs && (
            <section>
              <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Observações</p>
              <p className="text-sm text-text-primary whitespace-pre-wrap bg-bg-subtle rounded-lg p-3">
                {pedido.obs}
              </p>
            </section>
          )}

          {/* Datas */}
          <section>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Histórico</p>
            <Linha label="Criado em"       valor={fmtData(pedido.criado_em)} />
            <Linha label="Atualizado em"   valor={fmtData(pedido.atualizado_em)} />
          </section>
        </div>

        {/* Rodapé */}
        <div className="px-6 py-4 border-t border-border flex justify-between items-center">
          <a
            href={`https://wa.me/55${pedido.cliente_telefone.replace(/\D/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-xs text-green-400 hover:text-green-300 flex items-center gap-1.5"
          >
            <Phone className="w-3.5 h-3.5" />
            Abrir WhatsApp
          </a>
          <button onClick={onFechar} className="btn-ghost">Fechar</button>
        </div>
      </div>
    </div>
  );
}
