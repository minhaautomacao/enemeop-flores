import AtendimentoFloraClient from '../(dashboard)/dashboard/atendimento/atendimento-flora-client';

// Monitor Social virou a mesma inbox operacional do Atendimento Flora
// (lista de conversas à esquerda + histórico/ações à direita, sem trocar de
// página) — reaproveita 100% do componente, API e regras de handoff já
// existentes em vez de duplicar a lógica numa segunda implementação.
export default function MonitorSocialPage() {
  return <AtendimentoFloraClient />;
}
