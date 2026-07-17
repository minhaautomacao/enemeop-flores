-- Handoff humano (Instagram/Facebook): tabela de atendimentos, idempotência
-- de mensagens humanas e RLS em `conversas`/`atendimentos_humanos`.
--
-- Contexto: `atendimentos_humanos` já existe no projeto Supabase da
-- Fábrica (ebeapnydeiwuewxatuuw), ligada a uma cópia separada de
-- `conversas` de lá — não é a mesma conversa que o webhook-meta e o Inbox
-- Flora usam neste projeto (Enemeop). Por isso ela é CRIADA aqui, não
-- alterada. RLS em `conversas` estava desabilitado neste projeto (achado
-- crítico do Supabase Advisor) — habilitado aqui porque é a tabela que
-- este fix mexe.
--
-- Incremental e não destrutivo: não modifica nenhuma migration já
-- existente/pendente deste repositório.

create table if not exists public.atendimentos_humanos (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text not null unique default substr(md5(gen_random_uuid()::text), 1, 8),
  conversa_id         uuid references public.conversas(id),
  canal               text not null check (canal in ('whatsapp', 'instagram', 'facebook')),
  canal_cliente_id    text not null,
  telefone            text,
  nome_cliente        text,
  resumo              text,
  historico_referencia text,
  dados_pedido        jsonb default '{}'::jsonb,
  pendencias          jsonb default '[]'::jsonb,
  motivo_transferencia text,
  origem_handoff      text not null check (origem_handoff in ('cliente_solicitou', 'flora_sem_confianca', 'limite_tecnico', 'pagamento', 'logistica', 'administrativo', 'manual')),
  status              text not null default 'aguardando_humano' check (status in ('aguardando_humano', 'em_atendimento', 'concluido', 'cancelado', 'devolvido_flora')),
  atendente_id        text,
  assumido_em         timestamptz,
  concluido_em        timestamptz,
  devolvido_em        timestamptz,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

-- Só um atendimento "aberto" por conversa — resolve a corrida de handoffs
-- duplicados: a criação usa
--   INSERT ... ON CONFLICT (conversa_id) WHERE status IN ('aguardando_humano','em_atendimento') DO NOTHING RETURNING *
-- e, se vier vazio (conflito), busca e reusa o registro já aberto em vez
-- de criar outro código.
create unique index if not exists atendimentos_humanos_conversa_aberto_idx
  on public.atendimentos_humanos (conversa_id)
  where status in ('aguardando_humano', 'em_atendimento');

create index if not exists atendimentos_humanos_status_idx on public.atendimentos_humanos (status);

-- Idempotência de `send-human-message`: PK garante que a mesma
-- idempotency_key nunca dispara um segundo envio real ao Instagram/Facebook.
create table if not exists public.atendimento_mensagens_enviadas (
  idempotency_key text primary key,
  conversa_id     uuid not null references public.conversas(id),
  criado_em       timestamptz not null default now()
);

-- ── RLS ─────────────────────────────────────────────────────────────────
-- service_role (webhook-meta, orquestrador) ignora RLS por padrão do
-- Supabase — nenhuma mudança de comportamento para o backend.
-- authenticated = usuários do Inbox Flora (sessão via cookie, chave anon).
-- "Autorizado" = ter linha em public.profiles (mesma checagem usada para
-- restringir o dashboard, ver app/(dashboard)/layout.tsx).

alter table public.conversas enable row level security;
alter table public.atendimentos_humanos enable row level security;
alter table public.atendimento_mensagens_enviadas enable row level security;

drop policy if exists conversas_staff_select on public.conversas;
create policy conversas_staff_select on public.conversas
  for select to authenticated
  using (
    canal in ('instagram', 'facebook')
    and exists (select 1 from public.profiles where id = auth.uid())
  );

drop policy if exists conversas_staff_update on public.conversas;
create policy conversas_staff_update on public.conversas
  for update to authenticated
  using (
    canal in ('instagram', 'facebook')
    and exists (select 1 from public.profiles where id = auth.uid())
  )
  with check (
    canal in ('instagram', 'facebook')
    and exists (select 1 from public.profiles where id = auth.uid())
  );

drop policy if exists atendimentos_humanos_staff_select on public.atendimentos_humanos;
create policy atendimentos_humanos_staff_select on public.atendimentos_humanos
  for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid()));

drop policy if exists atendimentos_humanos_staff_update on public.atendimentos_humanos;
create policy atendimentos_humanos_staff_update on public.atendimentos_humanos
  for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid()))
  with check (exists (select 1 from public.profiles where id = auth.uid()));

-- Sem política nenhuma para `anon` nas 3 tabelas: nega tudo por padrão.
-- Sem política de INSERT/DELETE para `authenticated`: quem cria os
-- registros é sempre o webhook-meta (service_role).

-- ── Grants — restringe ao papel necessário ────────────────────────────
revoke all on public.conversas from anon;
revoke all on public.atendimentos_humanos from anon;
revoke all on public.atendimento_mensagens_enviadas from anon, authenticated;

grant select, update on public.conversas to authenticated;
grant select, update on public.atendimentos_humanos to authenticated;
