-- Telemetria da camada de interpretação contextual de intenção (funil.ts,
-- Parte "correção estrutural") — tabela nova, não reaproveita
-- public.orchestrator_logs (schema incompatível, tabela de outro propósito:
-- rastreamento de tarefas de agentes, não decisões de intenção por
-- mensagem/conversa).
--
-- Nunca bloqueia o atendimento: todo insert é fire-and-forget (try/catch
-- silencioso do lado do chamador, ver _shared/interpretador-telemetria.ts e
-- orchestrator/src/lib/interpretador-telemetria.ts — mesmo padrão de
-- _shared/logger.ts). RLS desabilitada de propósito (mesma decisão já
-- documentada para outras tabelas de log/telemetria internas do sistema,
-- nunca lida/gravada pelo cliente final).
create table if not exists public.funil_interpretacao_eventos (
  id bigint generated always as identity primary key,
  conversa_id uuid,
  fase text not null,
  ultima_pergunta_chave text,
  ultima_pergunta_texto text,
  mensagem_recebida text not null,
  intencao_primaria text,
  intencoes_secundarias jsonb not null default '[]'::jsonb,
  confianca text,
  acao_tomada text not null,
  estado_antes jsonb,
  estado_depois jsonb,
  campos_alterados text[] not null default '{}',
  avancou boolean not null,
  motivo text,
  tentativa_numero integer not null default 0,
  fallback_acionado boolean not null default false,
  duracao_ms integer,
  criado_em timestamptz not null default now()
);

comment on table public.funil_interpretacao_eventos is 'Telemetria de cada decisão da camada de interpretação contextual de intenção (fatia 1: gate resolverRetomadaAposIntervalo) — auditoria de intenção identificada, confiança, ação tomada e progresso da conversa. Nunca contém segredos/credenciais.';
comment on column public.funil_interpretacao_eventos.ultima_pergunta_chave is 'Identificador estável do gate (ex.: retomada_apos_intervalo) — mesmo valor de DadosPedido.ultimaPergunta.chave em funil.ts.';
comment on column public.funil_interpretacao_eventos.avancou is 'true quando esta mensagem fez a conversa sair da fase/pergunta pendente atual; false quando a Flora precisou pedir esclarecimento de novo (ver contador de tentativas).';
comment on column public.funil_interpretacao_eventos.fallback_acionado is 'true quando o modelo estava indisponível/expirou/devolveu resposta inválida e o gate caiu no comportamento determinístico de fallback.';

create index if not exists idx_funil_interpretacao_eventos_conversa on public.funil_interpretacao_eventos (conversa_id, criado_em desc);
create index if not exists idx_funil_interpretacao_eventos_intencao on public.funil_interpretacao_eventos (intencao_primaria, confianca);
