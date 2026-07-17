-- ============================================================================
-- MIGRATION ADITIVA — sincroniza supabase/migrations/001_initial.sql com o
-- schema real de producao da tabela pedidos (projeto gftnjvdvzgjkhwxnxnwl).
-- ============================================================================
-- NAO APLICADA. Levantamento feito via Supabase MCP (list_tables verbose)
-- em 2026-07-10. Ver docs/DATABASE_SCHEMA_DRIFT.md para o raciocinio
-- completo por coluna.
--
-- Esta migration:
--   - NAO remove, renomeia ou transforma nenhuma coluna existente;
--   - NAO contem DROP TABLE, DELETE ou TRUNCATE;
--   - so adiciona colunas/indices/constraint que ja existem em producao
--     mas nunca foram capturados em uma migration versionada;
--   - usa IF NOT EXISTS onde o Postgres suporta (colunas, indices);
--   - usa DO blocks defensivos para a constraint de CHECK e a foreign key,
--     que nao tem sintaxe nativa "IF NOT EXISTS" no Postgres.
--
-- Aplicar com: supabase db push  (ou colar no SQL Editor do painel)
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Colunas ausentes em 001_initial.sql, presentes em producao
-- ----------------------------------------------------------------------------

alter table public.pedidos add column if not exists canal_id           text;
alter table public.pedidos add column if not exists link_pagamento     text;
alter table public.pedidos add column if not exists link_pagamento_id  text;
alter table public.pedidos add column if not exists tipo               text not null default 'imediato';
alter table public.pedidos add column if not exists data_agendada      timestamptz;
alter table public.pedidos add column if not exists lead_id            uuid;
alter table public.pedidos add column if not exists workspace_id       text not null default 'enemeop-flores';
alter table public.pedidos add column if not exists produtos           jsonb default '[]'::jsonb;
alter table public.pedidos add column if not exists nome_destinatario  text;
alter table public.pedidos add column if not exists endereco_entrega   text;
alter table public.pedidos add column if not exists canal_origem       text;
alter table public.pedidos add column if not exists observacoes        text;

-- ----------------------------------------------------------------------------
-- 2. Foreign key pedidos.lead_id -> leads.id (confirmada em producao como
--    "pedidos_lead_id_fkey"). Postgres nao suporta ADD CONSTRAINT IF NOT
--    EXISTS, entao verificamos antes de adicionar.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pedidos_lead_id_fkey'
      and conrelid = 'public.pedidos'::regclass
  ) then
    alter table public.pedidos
      add constraint pedidos_lead_id_fkey
      foreign key (lead_id) references public.leads(id);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. CHECK de status — producao aceita 3 valores a mais que o schema
--    original ('pendente', 'em_preparo', 'saiu_para_entrega'). O Postgres
--    nao permite "ALTER CONSTRAINT", entao removemos o check antigo (por
--    nome, com busca defensiva em pg_constraint em vez de assumir o nome
--    padrao) e recriamos com a lista completa confirmada em producao.
-- ----------------------------------------------------------------------------

do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.pedidos'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%'
  limit 1;

  if v_conname is not null then
    execute format('alter table public.pedidos drop constraint %I', v_conname);
  end if;

  alter table public.pedidos add constraint pedidos_status_check
    check (status = any (array[
      'novo', 'pendente', 'confirmado', 'preparando', 'em_preparo',
      'saiu', 'saiu_para_entrega', 'entregue', 'cancelado'
    ]));
end $$;

-- ----------------------------------------------------------------------------
-- 4. Indices confirmados em producao, ausentes em 001_initial.sql
--    (idx_pedidos_status e idx_pedidos_criado_em ja existem, nao repetidos)
-- ----------------------------------------------------------------------------

create index if not exists idx_pedidos_tipo
  on public.pedidos(tipo);

create index if not exists idx_pedidos_data_agendada
  on public.pedidos(data_agendada)
  where tipo = 'agendado';

create index if not exists idx_pedidos_workspace
  on public.pedidos(workspace_id);

commit;

-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- begin;
-- drop index if exists idx_pedidos_tipo;
-- drop index if exists idx_pedidos_data_agendada;
-- drop index if exists idx_pedidos_workspace;
-- alter table public.pedidos drop constraint if exists pedidos_status_check;
-- alter table public.pedidos add constraint pedidos_status_check
--   check (status in ('novo','confirmado','preparando','saiu','entregue','cancelado'));
-- alter table public.pedidos drop constraint if exists pedidos_lead_id_fkey;
-- alter table public.pedidos
--   drop column if exists canal_id,
--   drop column if exists link_pagamento,
--   drop column if exists link_pagamento_id,
--   drop column if exists tipo,
--   drop column if exists data_agendada,
--   drop column if exists lead_id,
--   drop column if exists workspace_id,
--   drop column if exists produtos,
--   drop column if exists nome_destinatario,
--   drop column if exists endereco_entrega,
--   drop column if exists canal_origem,
--   drop column if exists observacoes;
-- commit;
-- NOTA: o rollback acima é destrutivo (apaga dado das colunas removidas)
-- e não deve ser executado em produção sem backup — documentado aqui só
-- para completude, não como ação recomendada.

-- ============================================================================
-- RISCOS
-- ============================================================================
-- 1. Nenhuma coluna existente é removida/alterada — risco de perda de dado
--    é zero para o caminho "aplicar".
-- 2. O CHECK de status é substituído (drop + create) — durante a janela
--    entre os dois comandos (mesma transação, portanto atômico) não há
--    risco real de linha inválida passar despercebida.
-- 3. A FK lead_id -> leads.id só é criada se todo lead_id já existente em
--    pedidos apontar para um leads.id válido (ou for NULL). Não verificado
--    aqui — se a FK falhar ao aplicar, é sinal de dado órfão que precisa
--    de investigação antes, não de forçar a constraint.
