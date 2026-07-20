/**
 * leads-idempotencia.ts — regras puras de identidade/merge idempotente de
 * leads (sem Deno.env, sem I/O). Separado só pra ser testável com
 * node:test/tsx, mesmo padrão de catalogo-woocommerce-filtro.ts e
 * mercadopago-assinatura.ts.
 *
 * Correção 2026-07-20: captacao-leads criava um lead novo a cada mensagem
 * (nenhum chamador passa lead_id) — 13 leads chegaram a ser criados numa
 * única conversa de teste. A busca por lead existente (workspace+canal+
 * canal_id) fica em index.ts (precisa do client Supabase real); aqui só a
 * lógica pura de prioridade de intenção e merge de campos no UPDATE.
 */

export const PRIORIDADE_INTENCAO: Record<string, number> = {
  urgente: 4,
  alta: 3,
  media: 2,
  baixa: 1,
  desconhecida: 0,
};

/** Nunca reduz a intenção já registrada — urgente > alta > media > baixa > desconhecida. */
export function maiorIntencao(atual: string | null | undefined, nova: string): string {
  const pAtual = atual ? (PRIORIDADE_INTENCAO[atual] ?? -1) : -1;
  const pNova = PRIORIDADE_INTENCAO[nova] ?? -1;
  return pNova >= pAtual ? nova : (atual as string);
}

export interface LeadCandidato {
  id: string;
  canal: string;
  canal_id: string | null;
  workspace_id: string | null;
  criado_em: string;
}

/**
 * Réplica pura do filtro usado por encontrarLeadExistente (index.ts —
 * consulta real via Supabase: .eq('canal', ...).eq('canal_id', ...).eq
 * ('metadata->>workspace_id', ...)) — nunca mistura workspaces diferentes
 * nem canais diferentes (ex.: Instagram e Facebook do mesmo cliente nunca
 * viram o mesmo lead). Extraída aqui só pra ser testável sem um banco real.
 */
export function encontrarLeadCandidato(
  leads: LeadCandidato[],
  params: { workspaceId: string; canal: string; canalId: string },
): string | null {
  const candidatos = leads
    .filter(l => l.canal === params.canal && l.canal_id === params.canalId && (l.workspace_id ?? '') === params.workspaceId)
    .sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1));
  return candidatos[0]?.id ?? null;
}

export interface DadosExtraidosLead {
  notas?: string | null;
  nome?: string | null;
  telefone?: string | null;
  email?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  cep?: string | null;
  status?: string | null;
}

/**
 * Monta o payload de UPDATE do lead: só inclui campos com valor novo
 * realmente presente (nunca sobrescreve um valor já salvo com null/vazio).
 * mensagem_inicial e criado_em nunca fazem parte daqui — são write-once,
 * definidos só na criação do lead.
 */
export function montarAtualizacaoLead(dados: DadosExtraidosLead, intencaoFinal: string): Record<string, unknown> {
  return {
    intencao: intencaoFinal,
    ...(dados.status ? { status: dados.status } : {}),
    ...(dados.notas ? { notas: dados.notas } : {}),
    ...(dados.nome ? { nome: dados.nome } : {}),
    ...(dados.telefone ? { telefone: dados.telefone } : {}),
    ...(dados.email ? { email: dados.email } : {}),
    ...(dados.endereco ? { endereco: dados.endereco } : {}),
    ...(dados.bairro ? { bairro: dados.bairro } : {}),
    ...(dados.cidade ? { cidade: dados.cidade } : {}),
    ...(dados.cep ? { cep: dados.cep } : {}),
  };
}
