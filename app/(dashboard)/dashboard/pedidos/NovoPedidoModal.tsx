'use client';

import { useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { criarPedido } from '@/app/actions/pedidos';

const CANAIS = ['WhatsApp', 'Instagram', 'Facebook', 'Site', 'Presencial'];

const FORM_INICIAL = {
  produto: '', cliente_nome: '', cliente_telefone: '',
  valor: '', horario_entrega: '', bairro: '', canal: 'WhatsApp', obs: '',
};

interface Props {
  onFechar: () => void;
  onSalvo:  () => void;
}

export function NovoPedidoModal({ onFechar, onSalvo }: Props) {
  const [form, setForm]            = useState(FORM_INICIAL);
  const [erro, setErro]            = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function campo(key: keyof typeof FORM_INICIAL) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }));
  }

  function salvar() {
    setErro(null);
    if (!form.produto || !form.cliente_nome || !form.cliente_telefone || !form.valor) {
      setErro('Preencha os campos obrigatórios: produto, cliente, telefone e valor.');
      return;
    }
    startTransition(async () => {
      try {
        await criarPedido({
          produto:          form.produto,
          cliente_nome:     form.cliente_nome,
          cliente_telefone: form.cliente_telefone,
          valor:            parseFloat(form.valor.replace(',', '.')),
          status:           'novo',
          horario_entrega:  form.horario_entrega || null,
          bairro:           form.bairro          || null,
          canal:            form.canal,
          obs:              form.obs              || null,
        });
        onSalvo();
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Erro ao salvar pedido.');
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg bg-bg-surface border border-border rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-text-primary">Novo Pedido</h2>
          <button onClick={onFechar} className="btn-ghost p-1.5 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">

          <div>
            <label className="label">
              Produto <span className="text-status-error">*</span>
            </label>
            <input
              type="text" className="input"
              placeholder="Ex: Buquê de rosas vermelhas"
              value={form.produto} onChange={campo('produto')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">
                Nome do cliente <span className="text-status-error">*</span>
              </label>
              <input
                type="text" className="input" placeholder="Ex: Ana Lima"
                value={form.cliente_nome} onChange={campo('cliente_nome')}
              />
            </div>
            <div>
              <label className="label">
                Telefone <span className="text-status-error">*</span>
              </label>
              <input
                type="tel" className="input" placeholder="(11) 99999-9999"
                value={form.cliente_telefone} onChange={campo('cliente_telefone')}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">
                Valor (R$) <span className="text-status-error">*</span>
              </label>
              <input
                type="number" min="0" step="0.01" className="input"
                placeholder="0.00"
                value={form.valor} onChange={campo('valor')}
              />
            </div>
            <div>
              <label className="label">Canal</label>
              <select className="input" value={form.canal} onChange={campo('canal')}>
                {CANAIS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Horário de entrega</label>
              <input
                type="time" className="input"
                value={form.horario_entrega} onChange={campo('horario_entrega')}
              />
            </div>
            <div>
              <label className="label">Bairro</label>
              <input
                type="text" className="input" placeholder="Ex: Ipiranga"
                value={form.bairro} onChange={campo('bairro')}
              />
            </div>
          </div>

          <div>
            <label className="label">Observações</label>
            <textarea
              className="input min-h-[72px] resize-none"
              placeholder="Informações extras para a entrega…"
              value={form.obs} onChange={campo('obs')}
            />
          </div>

          {erro && (
            <p className="text-xs text-status-error rounded-lg border border-status-error/20 bg-status-error/8 px-3 py-2">
              {erro}
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
          <button onClick={onFechar} className="btn-ghost" disabled={pending}>
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={pending}
            className="btn-gold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? 'Salvando…' : 'Salvar Pedido'}
          </button>
        </div>
      </div>
    </div>
  );
}
