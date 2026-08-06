'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface Preview {
  pode_estornar: boolean;
  motivo_bloqueio?: string;
  pedido_id: string;
  payment_id: string;
  valor: number;
  status_pagamento: string;
}

interface Props {
  pedidoId: string;
  onFechar: () => void;
  onConcluido: () => void;
}

const MOTIVO_BLOQUEIO_LABEL: Record<string, string> = {
  pagamento_nao_aprovado: 'O pagamento deste pedido não está aprovado no Mercado Pago — não há o que estornar.',
  evento_ja_ativo: 'Já existe um estorno pendente ou concluído para este pedido.',
  valor_invalido: 'O valor do pedido não confere com o valor realmente pago — revise antes de tentar de novo.',
  estorno_parcial_nao_suportado: 'Estorno parcial ainda não é suportado.',
};

// Preview (consulta real, nunca grava nada) -> confirmação explícita, com
// pagamento/pedido/valor exatos visíveis antes de qualquer ação real —
// mesma regra usada em toda a integração de estorno (nunca automático).
export function EstornoModal({ pedidoId, onFechar, onConcluido }: Props) {
  const [preview, setPreview]   = useState<Preview | null>(null);
  const [motivo, setMotivo]     = useState('');
  const [carregando, setCarregando] = useState(true);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [concluido, setConcluido] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch(`/api/producao/pedidos/${pedidoId}/estorno-preview`, { method: 'POST' });
        const json = await res.json();
        if (cancelado) return;
        if (!res.ok) { setErro(json.error ?? 'Falha ao consultar o pagamento.'); return; }
        setPreview(json as Preview);
      } catch {
        if (!cancelado) setErro('Falha ao consultar o pagamento.');
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [pedidoId]);

  async function confirmar() {
    setConfirmando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/producao/pedidos/${pedidoId}/estorno-confirmar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo }),
      });
      const json = await res.json();
      if (!res.ok) { setErro(json.error ?? 'Falha ao confirmar o estorno.'); return; }
      setConcluido(json.status === 'concluido' ? 'Estorno concluído.' : 'Estorno enviado — aguardando confirmação do Mercado Pago.');
    } catch {
      setErro('Falha ao confirmar o estorno.');
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md bg-bg-surface border border-border rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-text-primary">Estornar pagamento</h2>
          <button onClick={onFechar} className="btn-ghost p-1.5 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {carregando && <p className="text-sm text-text-muted">Consultando pagamento real no Mercado Pago…</p>}

          {!carregando && preview && !concluido && (
            <>
              <div className="rounded-lg border border-border bg-bg-base px-4 py-3 space-y-1 text-sm">
                <p><span className="text-text-muted">Pedido:</span> <span className="font-mono text-xs">{preview.pedido_id}</span></p>
                <p><span className="text-text-muted">Pagamento (Mercado Pago):</span> <span className="font-mono text-xs">{preview.payment_id}</span></p>
                <p><span className="text-text-muted">Status do pagamento:</span> {preview.status_pagamento}</p>
                <p><span className="text-text-muted">Valor a estornar:</span> <span className="font-semibold text-gold">{preview.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></p>
              </div>

              {!preview.pode_estornar && (
                <p className="text-xs text-status-error rounded-lg border border-status-error/20 bg-status-error/8 px-3 py-2">
                  {MOTIVO_BLOQUEIO_LABEL[preview.motivo_bloqueio ?? ''] ?? preview.motivo_bloqueio}
                </p>
              )}

              {preview.pode_estornar && (
                <div>
                  <label className="label">Motivo (opcional)</label>
                  <textarea
                    className="input min-h-[64px] resize-none"
                    placeholder="Ex: cliente desistiu do pedido após o pagamento"
                    value={motivo}
                    onChange={e => setMotivo(e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          {concluido && (
            <p className="text-sm text-status-success rounded-lg border border-status-success/20 bg-status-success/8 px-3 py-2">
              {concluido}
            </p>
          )}

          {erro && (
            <p className="text-xs text-status-error rounded-lg border border-status-error/20 bg-status-error/8 px-3 py-2">
              {erro}
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
          <button onClick={concluido ? onConcluido : onFechar} className="btn-ghost" disabled={confirmando}>
            {concluido ? 'Fechar' : 'Cancelar'}
          </button>
          {!concluido && preview?.pode_estornar && (
            <button
              onClick={confirmar}
              disabled={confirmando || carregando}
              className="btn-gold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {confirmando ? 'Confirmando…' : 'Confirmar estorno'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
