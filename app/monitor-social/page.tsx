import Link from 'next/link';
import AtendimentoFloraClient from '../(dashboard)/dashboard/atendimento/atendimento-flora-client';

// Monitor Social virou a mesma inbox operacional do Atendimento Flora
// (lista de conversas à esquerda + histórico/ações à direita, sem trocar de
// página) — reaproveita 100% do componente, API e regras de handoff já
// existentes em vez de duplicar a lógica numa segunda implementação.
// Esta rota fica fora do grupo (dashboard) (não recebe o layout com o
// EnumeopLogo/nav lateral), então mantém um link de volta próprio e mínimo
// — sem duplicar nem reescrever o cabeçalho do dashboard.
export default function MonitorSocialPage() {
  return (
    <div className="min-h-screen bg-[#FDFCF9] font-sans">
      <div className="sticky top-0 z-20 flex h-14 items-center border-b border-[#DDD6C8] bg-[#FDFCF9]/95 backdrop-blur px-6">
        <Link href="/dashboard" aria-label="Ir para o Dashboard" className="flex items-center gap-3 cursor-pointer">
          <span className="text-lg">📸</span>
          <span className="text-lg">📘</span>
          <span className="text-sm font-bold text-[#1C1208]">Monitor Social — Enemeop Flores</span>
        </Link>
      </div>
      <AtendimentoFloraClient />
    </div>
  );
}
