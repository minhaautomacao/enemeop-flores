/**
 * handoff-whatsapp-sdr.ts — monta o registro de handoff humano do fluxo
 * whatsapp-sdr, sem I/O (puro, testável com node:test/tsx).
 *
 * Handoff aqui NUNCA envia uma mensagem WhatsApp pra um "número de
 * operador" — isso exigiria reusar o mesmo canal automatizado da loja
 * (Z-API), o que seria a Enemeop Flores mandando uma mensagem pra si
 * mesma, sem nenhum humano do outro lado (loop/no-op). Em vez disso, só
 * registra um ticket em atendimentos_humanos — o mesmo painel/CRM usado
 * pelo fluxo Instagram/Facebook (/dashboard/atendimento).
 */

export interface DadosHandoffWhatsappSdr {
  canal?: string;
  canalId?: string;
  telefone?: string;
  nome?: string;
  leadId?: string;
  intencao?: string;
  ultimaMensagem?: string;
  motivo: string;
  horarioComercial: boolean;
}

export interface RegistroAtendimentoHumano {
  canal: string;
  canal_cliente_id: string;
  telefone: string | null;
  nome_cliente: string;
  motivo_transferencia: string;
  origem_handoff: 'whatsapp_sdr';
  dados_pedido: {
    lead_id: string | null;
    intencao: string;
    ultima_mensagem: string | null;
    fora_do_horario: boolean;
  };
}

export function montarRegistroHandoff(d: DadosHandoffWhatsappSdr): RegistroAtendimentoHumano {
  return {
    canal: d.canal ?? 'whatsapp',
    canal_cliente_id: d.canalId ?? d.telefone ?? 'desconhecido',
    telefone: d.telefone ?? null,
    nome_cliente: d.nome ?? d.telefone ?? d.canalId ?? 'Cliente',
    motivo_transferencia: d.motivo,
    origem_handoff: 'whatsapp_sdr',
    dados_pedido: {
      lead_id: d.leadId ?? null,
      intencao: d.intencao ?? '',
      ultima_mensagem: d.ultimaMensagem ?? null,
      fora_do_horario: !d.horarioComercial,
    },
  };
}
