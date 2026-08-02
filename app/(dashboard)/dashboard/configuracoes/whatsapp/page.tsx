'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, QrCode, CheckCircle2, XCircle } from 'lucide-react';

type Status = { conectado: boolean; bruto: unknown } | { erro: string } | null;

export default function ConectarWhatsAppPage() {
  const [status, setStatus] = useState<Status>(null);
  const [carregandoStatus, setCarregandoStatus] = useState(false);
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [carregandoQr, setCarregandoQr] = useState(false);
  const [erroQr, setErroQr] = useState<string | null>(null);
  const [confirmandoQr, setConfirmandoQr] = useState(false);

  const consultarStatus = useCallback(async () => {
    setCarregandoStatus(true);
    try {
      const resp = await fetch('/api/whatsapp/zapi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
      });
      const json = await resp.json();
      setStatus(resp.ok ? json : { erro: json.error ?? 'Falha ao consultar status' });
    } catch (e) {
      setStatus({ erro: e instanceof Error ? e.message : String(e) });
    } finally {
      setCarregandoStatus(false);
    }
  }, []);

  useEffect(() => { consultarStatus(); }, [consultarStatus]);

  const conectado = status && 'conectado' in status && status.conectado;

  async function gerarNovoQrCode() {
    setConfirmandoQr(false);
    setCarregandoQr(true);
    setErroQr(null);
    setQrCodeBase64(null);
    try {
      const resp = await fetch('/api/whatsapp/zapi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'qrcode' }),
      });
      const json = await resp.json();
      if (!resp.ok || json.erro) {
        setErroQr(json.error ?? json.erro ?? 'Falha ao gerar QR Code');
      } else {
        setQrCodeBase64(json.qrCodeBase64);
      }
    } catch (e) {
      setErroQr(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregandoQr(false);
    }
  }

  return (
    <div>
      <header className="page-header">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/configuracoes" className="text-text-faint hover:text-text-primary">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="page-title">WhatsApp (Z-API)</h1>
            <p className="text-xs text-text-faint">Status da conexão e vínculo de um número via QR Code</p>
          </div>
        </div>
      </header>

      <div className="p-6 space-y-6 max-w-xl">
        <section className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">Status da instância</h2>
            <button
              className="btn-outline text-xs py-1.5 flex items-center gap-1.5"
              onClick={consultarStatus}
              disabled={carregandoStatus}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${carregandoStatus ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
          </div>

          {status && 'erro' in status && (
            <p className="text-xs text-red-500">Erro ao consultar status: {status.erro}</p>
          )}

          {status && 'conectado' in status && (
            <div className={`flex items-center gap-2 text-sm ${conectado ? 'text-emerald-600' : 'text-amber-600'}`}>
              {conectado ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {conectado ? 'Número conectado' : 'Número desconectado'}
            </div>
          )}
        </section>

        <section className="card space-y-4">
          <h2 className="text-sm font-semibold text-text-primary">Vincular número via QR Code</h2>
          <p className="text-xs text-text-muted">
            {conectado
              ? 'A instância já está conectada. Gerar um novo QR Code pode DESCONECTAR o número atual — só faça isso se realmente quiser trocar/revincular.'
              : 'Gere o QR Code e escaneie com o WhatsApp do número que vai atender (Configurações → Aparelhos conectados → Conectar um aparelho).'}
          </p>

          {!confirmandoQr && (
            <button
              className={conectado ? 'btn-outline text-xs py-1.5 border-red-300 text-red-600' : 'btn-primary text-xs py-1.5 flex items-center gap-1.5'}
              onClick={() => setConfirmandoQr(true)}
              disabled={carregandoQr}
            >
              <QrCode className="w-3.5 h-3.5" />
              {conectado ? 'Gerar novo QR Code (desconecta o atual)' : 'Gerar QR Code'}
            </button>
          )}

          {confirmandoQr && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 space-y-2">
              <p className="text-xs text-red-700 font-medium">
                {conectado
                  ? 'Confirma? O número conectado agora vai perder a sessão.'
                  : 'Confirma que quer gerar um novo QR Code?'}
              </p>
              <div className="flex gap-2">
                <button className="btn-outline text-xs py-1 border-red-400 text-red-700" onClick={gerarNovoQrCode}>
                  Sim, gerar
                </button>
                <button className="btn-outline text-xs py-1" onClick={() => setConfirmandoQr(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {carregandoQr && <p className="text-xs text-text-muted">Buscando QR Code na Z-API…</p>}
          {erroQr && <p className="text-xs text-red-500">Erro: {erroQr}</p>}

          {qrCodeBase64 && (
            <div className="flex flex-col items-center gap-2 pt-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrCodeBase64} alt="QR Code de conexão WhatsApp" className="w-56 h-56 rounded-lg border border-border" />
              <p className="text-xs text-text-faint">Escaneie em até ~30s antes que expire — clique em Atualizar para conferir se conectou.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
