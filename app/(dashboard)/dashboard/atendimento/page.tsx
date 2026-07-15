import type { Metadata } from 'next';
import AtendimentoFloraClient from './atendimento-flora-client';

export const metadata: Metadata = { title: 'Atendimento Flora' };

export default function AtendimentoFloraPage() {
  return <AtendimentoFloraClient />;
}
