# Drift de Schema — tabela `pedidos`

> Migration de sincronização proposta (não aplicada):
> `supabase/migrations/202607100002_sync_pedidos_schema.sql`.

## Schema original (`supabase/migrations/001_initial.sql`, linhas 39-61)

```
id, cliente_nome, cliente_telefone, produto, valor, status
  (check: novo, confirmado, preparando, saiu, entregue, cancelado),
horario_entrega, bairro, canal, obs, criado_em, atualizado_em
```
RLS habilitado, 2 políticas (`Autenticados leem pedidos` / `Autenticados
gerenciam pedidos`, ambas `auth.role() = 'authenticated'`). 2 índices
(`idx_pedidos_status`, `idx_pedidos_criado_em`).

## Schema real (levantado via Supabase MCP, projeto `gftnjvdvzgjkhwxnxnwl`, 2026-07-10)

21 colunas — as 12 abaixo existem em produção e **não estão em nenhuma
migration versionada em nenhum dos dois repositórios**:

`canal_id`, `link_pagamento`, `link_pagamento_id`, `tipo` (default
`'imediato'`), `data_agendada`, `lead_id` (com FK
`pedidos_lead_id_fkey` → `leads.id`), `workspace_id` (default
`'enemeop-flores'`), `produtos` (jsonb, default `'[]'`),
`nome_destinatario`, `endereco_entrega`, `canal_origem`, `observacoes`.

O `CHECK` de `status` também divergiu: produção aceita 9 valores
(`novo`, `pendente`, `confirmado`, `preparando`, `em_preparo`, `saiu`,
`saiu_para_entrega`, `entregue`, `cancelado`) contra os 6 originais —
3 valores novos (`pendente`, `em_preparo`, `saiu_para_entrega`) foram
introduzidos sem migration.

3 índices adicionais em produção: `idx_pedidos_tipo`,
`idx_pedidos_data_agendada` (parcial, `where tipo = 'agendado'`),
`idx_pedidos_workspace`.

## Divergências — resumo

| | Original | Produção |
|---|---|---|
| Colunas | 12 | 21 |
| Valores de `status` | 6 | 9 |
| Índices | 2 | 5 |
| FK | nenhuma | `lead_id` → `leads.id` |

## Provável origem manual

As 12 colunas ausentes formam um conjunto coerente (workspace, lead,
pagamento, agendamento, destinatário/entrega, canal de origem) que sugere
evolução orgânica do produto — cada funcionalidade nova (agendamento de
pedido, vínculo com lead, link de pagamento Cielo, catálogo de produtos
múltiplos por pedido) provavelmente foi adicionada com um `ALTER TABLE`
direto no Supabase Studio ou via MCP, sem gerar o arquivo de migration
correspondente. Isso é consistente com o padrão observado em outras
tabelas do mesmo projeto (`leads` também tem colunas em produção — email,
endereço, bairro, cidade, cep, notas, utm_source, histórico_canal,
metadata — não presentes em `001_initial.sql`; fora do escopo desta
migration, mas registrado aqui para uma futura sincronização de `leads`
seguir o mesmo processo).

## Migration de sincronização

`supabase/migrations/202607100002_sync_pedidos_schema.sql` — aditiva,
usa `IF NOT EXISTS` em colunas e índices, usa blocos `DO` defensivos para
a FK e o CHECK (que não têm sintaxe nativa `IF NOT EXISTS` no Postgres).
Não remove, renomeia ou transforma nenhuma coluna existente. Não aplicada.

## Riscos

- Nenhum para colunas/índices novos (aditivos puros).
- O `CHECK` de status precisa ser removido e recriado (não há
  `ALTER CONSTRAINT` no Postgres) — feito na mesma transação, sem janela
  de risco real.
- A FK `lead_id → leads.id` só será criada com sucesso se todo `lead_id`
  já existente em `pedidos` apontar para um `leads.id` válido ou for
  `NULL`. Se falhar, é sinal de dado órfão — investigar antes de forçar.

## Testes necessários antes de aplicar em produção

1. Rodar a migration em um ambiente de teste/branch do Supabase, se
   disponível (`create_branch` via MCP), antes de aplicar na produção.
2. Confirmar que a FK aplica sem erro (nenhum `lead_id` órfão).
3. Confirmar que o novo CHECK aceita todos os valores de `status`
   atualmente presentes nas 2 linhas de produção (nenhum valor fora da
   lista dos 9 confirmados).
4. Rodar `select column_name from information_schema.columns where
   table_name = 'pedidos'` antes e depois, comparar com a lista de 21
   colunas documentada aqui.

## Limitação atual de multi-tenant

A coluna `workspace_id` existe (default fixo `'enemeop-flores'`), mas
nenhuma das 2 políticas de RLS de `pedidos` filtra por ela — qualquer
usuário autenticado no painel vê e edita todos os pedidos, independente
de workspace. Isso é aceitável hoje porque só existe um workspace real
(Enemeop) neste projeto Supabase. Não é um incidente de segurança (todos
os usuários autenticados são da própria equipe Enemeop), mas é uma
limitação a corrigir **se** esta tabela algum dia for reaproveitada como
template multi-tenant pela Fábrica.

## Política atual de `pedidos`

RLS habilitado, 2 políticas amplas por `auth.role() = 'authenticated'`
(sem escopo por workspace ou por usuário). Diferente das 4 tabelas do
incidente de RLS (`RLS_SECURITY_PLAN.md`), `pedidos` **não** está exposta
à `anon` — o risco aqui é de escopo, não de exposição pública.

## Recomendação futura de escopo por workspace

Quando o modelo de usuário-por-workspace existir (mesma dependência
registrada em `docs/RLS_SECURITY_PLAN.md` para `conversas`), trocar as
políticas de `pedidos` de `auth.role() = 'authenticated'` para uma
condição que verifique o vínculo do usuário com `pedidos.workspace_id`.
Não implementado nesta etapa — depende do mesmo projeto de modelagem de
usuário-por-workspace citado no plano de RLS.
