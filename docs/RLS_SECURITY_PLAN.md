# Plano de Segurança — RLS (Row Level Security)

> Proposta preparada em
> `supabase/migrations/202607100001_security_rls_proposal.sql`.
> **Não aplicada.** Este documento explica o raciocínio; a migration tem
> os comandos. Nenhuma alteração foi feita no banco de produção.

## Estado atual

Projeto Supabase `gftnjvdvzgjkhwxnxnwl` (Enemeop), 4 tabelas com RLS
**desabilitado**, confirmado via Supabase Advisors (2026-07-10):

| Tabela | Linhas | Quem lê/grava (confirmado no código) |
|---|---|---|
| `workspace_credentials` | 5 | **Atualizado na Etapa C:** código-fonte de `webhook-mercadopago` (recuperado do deploy, não estava em nenhum repositório Git) confirma leitura via `service_role`, filtrando por `workspace_id`+`tipo='financeiro'`+`chave`. Nenhuma escrita nem uso de anon key encontrado em nenhum consumidor identificado |
| `conversas` | 27 (Enemeop) / 121 (Fábrica, cópia separada) | `webhook-meta/index.ts`, `webhook-whatsapp/index.ts`, `webhook-mercadopago` (recuperado na Etapa C), `orchestrator/src/lib/instagram.ts` — todos usam `service_role`. **Confirmado na Etapa C:** o dashboard (`conversas/page.tsx`, `LeadsTable.tsx`, `monitor-social/page.tsx`) **não toca esta tabela do projeto Enemeop diretamente** — ele lê a cópia do projeto **Fábrica** via a Edge Function `conversas-enemeop` (que já roda com `service_role`, RLS já habilitado naquela cópia). Isso reforça que aplicar a proposta na cópia do Enemeop é segura para o frontend |
| `qr_temp` | 4390 | **Confirmado na Etapa C:** código-fonte de `captura-qr` recuperado do deploy — insere via `service_role` (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`), sem nenhum uso de anon key. A recomendação `service_role`-only está confirmada, não é mais suposição |
| `funcao_configs` | 2 (Enemeop) / 9 (Fábrica, cópia separada) | `_shared/instagram.ts`, `_shared/anthropic.ts`, `webhook-whatsapp/index.ts`, `webhook-meta/index.ts` — todos leitura via `service_role`, nenhuma escrita encontrada no código (valores parecem ser inseridos manualmente via Studio) |

## Risco

Com RLS desabilitado, a **anon key** (pública por design — está em
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, embarcada no frontend, e adicionalmente
exposta em dois arquivos versionados, ver `SECURITY_INCIDENTS.md`) permite
a **qualquer pessoa**, sem autenticação, ler e escrever nas 4 tabelas via
API REST do PostgREST. Para `workspace_credentials`, isso expõe blobs de
credencial criptografados e IVs de todos os workspaces cadastrados. Para
`conversas`, expõe histórico real de atendimento a clientes.

## Políticas propostas

### `workspace_credentials`
Objetivo: bloquear `anon` e usuário comum; só `service_role` (backend)
acessa. Como nenhum código do frontend/cliente final acessa esta tabela
diretamente (confirmado pela ausência de referências fora de
`_shared/credentials.ts`, que já usa `service_role`), a política é
simples: **RLS habilitado, sem nenhuma política para `anon`/
`authenticated`** — nega tudo por padrão a esses roles, `service_role`
continua funcionando (Supabase concede bypass de RLS a `service_role` por
design).

### `conversas`
Objetivo: bloquear `anon`; permitir `service_role`; permitir usuário
autenticado **apenas** quando houver vínculo válido com o workspace da
conversa. **Esse vínculo (usuário ↔ workspace) não existe no schema hoje**
— não há tabela `user_workspaces`/`workspace_members`, nem claim de
workspace no JWT do Supabase Auth (confirmado por busca no código: zero
ocorrências). Por isso a política final para `authenticated` fica
**comentada** na migration, com a dependência registrada explicitamente.
Até esse modelo existir, `conversas` fica com a mesma política de
`workspace_credentials` (só `service_role`) — mais restritivo do que o
pedido original ("usuário autenticado com vínculo"), mas é o que pode ser
implementado com segurança hoje sem inventar uma claim que não existe.
Isso pode quebrar o acesso direto do dashboard a `conversas` **se** algum
componente do frontend consultar a tabela diretamente — não encontrei
nenhum (o dashboard usa a Edge Function `conversas-enemeop`, que roda com
`service_role`), mas isso deve ser testado antes de aplicar (ver seção de
testes).

### `qr_temp`
**Atualizado na Etapa C:** código-fonte de `captura-qr` recuperado
diretamente do deploy via Supabase MCP (nunca esteve em nenhum
repositório Git — ver `docs/MISSING_SOURCE_FUNCTIONS.md`). Confirma uso
exclusivo de `service_role`, sem nenhuma referência a anon key. A
proposta `service_role`-only está validada por evidência direta, não é
mais uma suposição de baixa confiança.

### `funcao_configs`
Confirmado pelo código: só leitura, só via `service_role`, nenhuma
escrita encontrada (inserção parece manual via Studio). Proposta:
`service_role` only para leitura e escrita.

## Dependências

- Modelo de usuário-por-workspace (necessário para a política completa de
  `conversas` com `authenticated`) — não implementado, é um projeto à parte.
- Código-fonte de `captura-qr` e `webhook-mercadopago` — não encontrado em
  nenhum repositório, recomendo recuperar via `supabase functions
  download` ou re-versionar a partir do painel antes de mexer em `qr_temp`.

## Testes necessários antes de aplicar em produção

1. **Com anon key:** `select * from conversas limit 1` e equivalentes nas
   outras 3 tabelas devem retornar vazio/erro de permissão após a
   migration.
2. **Com usuário autenticado comum (sem service_role):** mesmo teste —
   deve continuar falhando (nenhuma política para `authenticated` nas 4
   tabelas, pelo motivo explicado acima).
3. **Com `service_role`:** todas as Edge Functions que hoje leem/escrevem
   essas tabelas (`webhook-meta`, `webhook-whatsapp`, `_shared/instagram.ts`,
   `_shared/anthropic.ts`) devem continuar funcionando sem alteração —
   testar enviando uma mensagem de teste real (mesmo padrão do teste de
   encerramento da missão M002) depois de aplicar.
4. **Frontend:** abrir `/dashboard/conversas` e confirmar que a página
   continua carregando (ela usa a Edge Function `conversas-enemeop`, que
   roda no projeto Fábrica com `service_role` — não deveria ser afetada
   pela mudança de RLS no projeto Enemeop, mas está registrado aqui para
   não ser esquecido).

## Rollback

Cada `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` tem o inverso
(`DISABLE ROW LEVEL SECURITY`) documentado na própria migration. Reverter
uma política específica: `DROP POLICY` pelo nome, também documentado.

## Impacto possível nas Edge Functions

Nenhum impacto esperado nas funções que já usam `service_role`
(confirmado que é o padrão em todo o código lido). O risco real está nas
duas funções sem código-fonte recuperado (`captura-qr`,
`webhook-mercadopago`) — se alguma delas usar a anon key internamente, a
política as quebraria. Recomendo recuperar o código-fonte dessas duas
funções como pré-requisito antes de aplicar a proposta em produção.
