/**
 * email.ts — Envio de emails via Resend.
 *
 * Credenciais necessárias no workspace (tipo='email'):
 *   api_key  → Resend API key (re_...)
 *   from     → endereço remetente (ex: "Floricultura <contato@flor.com.br>")
 */

import { buscarTodasCredenciais } from './credentials.ts';

export interface ResultadoEmail {
  enviado: boolean;
  id?: string;
  erro?: string;
}

/**
 * Envia email via Resend usando as credenciais do workspace.
 * Nunca lança exceção — retorna { enviado: false, erro } se não conseguir.
 */
export async function enviarEmail(
  workspaceId: string | undefined,
  para: string | undefined | null,
  assunto: string,
  corpo: string,
): Promise<ResultadoEmail> {
  if (!workspaceId) return { enviado: false, erro: 'workspace_id não informado' };
  if (!para)        return { enviado: false, erro: 'Endereço de email não informado no payload' };

  const creds = await buscarTodasCredenciais(workspaceId, 'email');

  if (!creds['api_key']) {
    return { enviado: false, erro: 'Credencial email.api_key não configurada para este workspace' };
  }

  const from = creds['from'] ?? 'noreply@fabrica-saas.com.br';
  const corpoHtml = corpo.replace(/\n/g, '<br>');

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${creds['api_key']}`,
      },
      body: JSON.stringify({
        from,
        to: [para],
        subject: assunto,
        html: `<div style="font-family:sans-serif;max-width:600px">${corpoHtml}</div>`,
        text: corpo,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => resp.status.toString());
      return { enviado: false, erro: `Resend HTTP ${resp.status}: ${err}` };
    }

    const data = await resp.json() as { id?: string };
    return { enviado: true, id: data.id };
  } catch (e) {
    return { enviado: false, erro: String(e) };
  }
}
