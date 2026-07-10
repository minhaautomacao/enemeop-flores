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
| `workspace_credentials` | 5 | Não encontrei leitura/escrita direta desta tabela específica no código atual (a tabela existe pela migration `20260527000004_workspace_credentials.sql` da Fábrica, pensada para ser acessada só por `service_role`) |
| `conversas` | 27 | `webhook-meta/index.ts`, `webhook-whatsapp/index.ts`, `orchestrator/src/lib/instagram.ts` — todos usam client Supabase autenticado com `SUPABASE_SERVICE_ROLE_KEY` (service_role, ignora RLS) |
| `qr_temp` | 4390 | Nenhuma referência encontrada em nenhum dos dois repositórios Git — provavelmente lida/gravada pela Edge Function `captura-qr`, cujo código-fonte não está versionado em nenhum dos dois repositórios (ver `INFRASTRUCTURE_MAP.md`) |
| `funcao_configs` | 2 | `_shared/instagram.ts`, `_shared/anthropic.ts`, `webhook-whatsapp/index.ts`, `webhook-meta/index.ts` — todos leitura via `service_role`, nenhuma escrita encontrada no código (valores parecem ser inseridos manualmente via Studio) |

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
Sem confirmação de código de quem lê/grava (função `captura-qr` não
versionada). Proposta: `service_role` only, por ser uma tabela de dado de
sessão técnica (QR code) sem caso de uso legítimo para acesso direto de
usuário final ou frontend. **Risco registrado explicitamente na
migration**: se `captura-qr` ou outro consumidor usar a anon key em vez
de service_role, a política quebra esse fluxo — recuperar o código-fonte
da função antes de aplicar em produção é fortemente recomendado.

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
