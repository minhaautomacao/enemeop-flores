-- Telemetria da camada de interpretação contextual de intenção (funil.ts,
-- "correção estrutural" — Fatias 1 e 2) — tabela nova, não reaproveita
-- public.orchestrator_logs (schema incompatível, tabela de outro propósito:
-- rastreamento de tarefas de agentes, não decisões de intenção por
-- mensagem/conversa).
--
-- Nunca bloqueia o atendimento: todo insert é fire-and-forget (try/catch
-- silencioso do lado do chamador, ver _shared/interpretador-telemetria.ts e
-- orchestrator/src/lib/interpretador-telemetria.ts — mesmo padrão de
-- _shared/logger.ts).
--
-- Minimização deliberada (revisão de privacidade, ver
-- orchestrator/src/lib/INTERPRETADOR_PRIVACIDADE.md): esta tabela NUNCA
-- armazena o texto literal da mensagem do cliente nem o estado bruto
-- (nome/telefone/endereço/mensagem de cartão) antes/depois da decisão —
-- só metadados de diagnóstico (quais campos mudaram, por nome, nunca por
-- valor; qual foi a intenção reconhecida; se precisou de esclarecimento).
-- O texto real da conversa já existe em `conversas.historico`; esta tabela
-- nunca duplica esse dado.
--
-- Idempotente: seguro executar mais de uma vez (create table/index usam
-- IF NOT EXISTS; comment on substitui em vez de falhar; enable row level
-- security, revoke e grant são no-op se já aplicados; nenhuma política é
-- criada, então não há "create policy" para colidir numa segunda execução;
-- as 3 constraints de integridade abaixo são criadas dentro de blocos
-- `do $$ ... $$` que checam pg_constraint pelo nome antes de tentar criar,
-- nunca um `add constraint` direto). Nenhum DROP/TRUNCATE/DELETE de tabela
-- ou dado existente em nenhum ponto deste arquivo. Nenhuma tabela fora de
-- funil_interpretacao_eventos é criada, alterada ou lida.
create table if not exists public.funil_interpretacao_eventos (
  id bigint generated always as identity primary key,
  -- Vínculo solto de propósito: nunca uma foreign key pra conversas(id) —
  -- evita acoplar esta tabela de telemetria ao schema de conversas de cada
  -- canal (sdr.ts, por exemplo, não tem conversa_id em uuid e insere NULL
  -- aqui). Uma FK aqui poderia rejeitar inserts válidos de canais sem esse
  -- identificador, ou exigir manutenção em lockstep com outra tabela.
  conversa_id uuid,
  -- Identificador estável do gate que gerou o evento (ex.:
  -- 'retomada_apos_intervalo', 'aprovacao_frete') — nunca o texto da
  -- pergunta mostrada ao cliente.
  gate text,
  fase_anterior text not null,
  fase_posterior text not null,
  intencao_primaria text,
  intencoes_secundarias text[] not null default '{}',
  confianca text,
  precisa_esclarecimento boolean not null default false,
  -- Nomes dos campos que mudaram (ex.: {'nomeDestinatario','dataEntrega'})
  -- — NUNCA o valor antes/depois. Esta é a única informação "de diff"
  -- armazenada; não existe estado_antes/estado_depois nesta tabela.
  campos_alterados text[] not null default '{}',
  avancou boolean not null,
  -- Rótulo curto e não-livre (ex.: 'confirmou', 'cancelamento_pendente',
  -- 'modelo_indisponivel_anti_loop') — nunca texto do cliente nem frase
  -- gerada por IA armazenada aqui.
  motivo text,
  tentativa_numero integer not null default 0,
  fallback_acionado boolean not null default false,
  duracao_ms integer,
  criado_em timestamptz not null default now()
);

comment on table public.funil_interpretacao_eventos is 'Telemetria de diagnóstico da camada de interpretação contextual de intenção (funil.ts) — auditoria de qual intenção foi identificada, com que confiança, e o que mudou de fase/campo. Nunca contém o texto da mensagem do cliente, estado bruto do pedido, nem qualquer segredo/credencial — ver orchestrator/src/lib/INTERPRETADOR_PRIVACIDADE.md.';
comment on column public.funil_interpretacao_eventos.gate is 'Identificador estável do gate (ex.: aprovacao_frete) — mesmo valor de DadosPedido.ultimaPergunta.chave em funil.ts.';
comment on column public.funil_interpretacao_eventos.campos_alterados is 'Nomes dos campos do formulário/produto alterados nesta mensagem — nunca os valores antes/depois.';
comment on column public.funil_interpretacao_eventos.avancou is 'true quando esta mensagem fez a conversa sair da fase/pergunta pendente atual; false quando a Flora precisou pedir esclarecimento de novo.';
comment on column public.funil_interpretacao_eventos.fallback_acionado is 'true quando o modelo estava indisponível/expirou/devolveu resposta inválida NESTA mensagem específica e o gate caiu no comportamento determinístico de fallback.';

create index if not exists idx_funil_interpretacao_eventos_conversa on public.funil_interpretacao_eventos (conversa_id, criado_em desc);
create index if not exists idx_funil_interpretacao_eventos_gate on public.funil_interpretacao_eventos (gate, criado_em desc);

-- Índice dedicado só em criado_em (sem outra coluna composta) — nenhuma
-- rotina de retenção existe ainda (ver INTERPRETADOR_PRIVACIDADE.md, item
-- pendente), mas uma futura limpeza por idade ("delete where criado_em <
-- now() - interval '90 days'") usa exatamente este índice, não os
-- compostos acima (que exigiriam também filtrar por conversa_id/gate pra
-- serem aproveitados pelo planner).
create index if not exists idx_funil_interpretacao_eventos_criado_em on public.funil_interpretacao_eventos (criado_em);

-- ── Constraints de integridade — idempotentes via pg_constraint ──────────
-- Nunca `alter table ... add constraint` direto (falharia numa 2ª
-- execução) — cada bloco só cria a constraint se ela ainda não existir
-- neste catálogo, checado pelo nome explícito. `conrelid` só resolve
-- porque a tabela já foi criada acima, na mesma execução deste arquivo.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'funil_interpretacao_eventos_tentativa_numero_check'
      and conrelid = 'public.funil_interpretacao_eventos'::regclass
  ) then
    alter table public.funil_interpretacao_eventos
      add constraint funil_interpretacao_eventos_tentativa_numero_check
      check (tentativa_numero >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'funil_interpretacao_eventos_duracao_ms_check'
      and conrelid = 'public.funil_interpretacao_eventos'::regclass
  ) then
    alter table public.funil_interpretacao_eventos
      add constraint funil_interpretacao_eventos_duracao_ms_check
      check (duracao_ms is null or duracao_ms >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'funil_interpretacao_eventos_confianca_check'
      and conrelid = 'public.funil_interpretacao_eventos'::regclass
  ) then
    alter table public.funil_interpretacao_eventos
      add constraint funil_interpretacao_eventos_confianca_check
      check (confianca is null or confianca in ('alta', 'media', 'baixa'));
  end if;
end $$;

-- ── RLS: habilitada, zero políticas de propósito ──────────────────────────
-- Esta tabela é telemetria interna de backend, nunca lida nem gravada pelo
-- cliente final ou pelo dashboard — diferente de public.conversas (ver
-- 202607170001_atendimento_humano.sql), que TEM políticas pra staff
-- autenticado. Aqui, com RLS habilitada e nenhuma política criada, nenhuma
-- role sujeita a RLS (anon, authenticated) consegue selecionar, inserir,
-- atualizar ou excluir NENHUMA linha — só a service role usada pelos
-- Edge Functions/orchestrator (que faz bypass de RLS por padrão no
-- Supabase) tem acesso, e mesmo essa só através do código já revisado em
-- interpretador-telemetria.ts (nunca por SQL livre exposto ao cliente).
alter table public.funil_interpretacao_eventos enable row level security;

-- Revoke explícito além do RLS (defesa em profundidade — nunca depende só
-- da ausência de políticas): garante que mesmo um GRANT futuro acidental
-- em public.* pra estas roles não destrave acesso a esta tabela específica.
revoke all on public.funil_interpretacao_eventos from anon, authenticated;

-- ── Grants explícitos pra service_role ─────────────────────────────────────
-- service_role faz bypass de RLS por padrão no Supabase, mas privilégio de
-- tabela (GRANT) é um mecanismo separado de RLS — sem este grant explícito,
-- o acesso da service_role dependeria só de ela ser dona da tabela (nem
-- sempre verdade, dependendo de como a migration é aplicada). Nunca GRANT
-- ALL/UPDATE/DELETE: esta tabela é só insert-and-read (fire-and-forget do
-- lado do código, nunca atualizada nem apagada linha a linha).
grant insert, select
  on public.funil_interpretacao_eventos
  to service_role;

-- Necessário pra INSERT funcionar quando `id` (generated always as
-- identity) não é informado explicitamente — nextval()/currval() na
-- sequência implícita exigem USAGE; SELECT permite consultar o valor
-- atual/último, útil pra diagnóstico.
grant usage, select
  on sequence public.funil_interpretacao_eventos_id_seq
  to service_role;

-- Achado da validação pós-aplicação desta migration: uma sequência nova
-- (`generated always as identity`) recebe USAGE/SELECT de anon/authenticated
-- por padrão da plataforma Supabase/Postgres, mesmo sem nenhum GRANT
-- explícito pra essas roles — nunca introduzido por este arquivo, mas
-- revogado aqui explicitamente pra fechar o gap: com isto, anon e
-- authenticated não têm NENHUM privilégio nem na tabela (já garantido pelo
-- revoke all + RLS acima) nem na sequência.
revoke usage, select
  on sequence public.funil_interpretacao_eventos_id_seq
  from anon, authenticated;
