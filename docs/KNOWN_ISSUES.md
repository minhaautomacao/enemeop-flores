# Problemas Conhecidos

## Críticos — bloqueiam qualquer deploy do código migrado

1. **Segredos hardcoded ainda no histórico Git.** O código migrado já
   está sanitizado (fallbacks reais removidos), mas os valores antigos
   continuam recuperáveis no histórico dos dois repositórios até
   rotação + limpeza de histórico. Ver `docs/SECURITY_INCIDENTS.md`.
2. **RLS desabilitado em `workspace_credentials`, `conversas`, `qr_temp`,
   `funcao_configs`** no projeto Supabase Enemeop. Proposta pronta, não
   aplicada. Ver `docs/RLS_SECURITY_PLAN.md`.
3. **Duas cópias divergentes** de `leads`, `conversas`, `funcao_configs`,
   `catalogo_produtos`, `workspace_credentials` — uma no projeto Supabase
   Enemeop, outra no da Fábrica. Ver `docs/SUPABASE_SOURCE_OF_TRUTH.md`.

## Funcionais

4. **`agente-logistica/index.ts` e `_shared/lalamove.ts`** dependiam de
   coordenadas/CEP hardcoded, agora vazios por padrão
   (`STORE_LATITUDE`/`STORE_LONGITUDE`/`STORE_ADDRESS`/`STORE_CEP`) —
   **não vão funcionar até essas env vars serem configuradas** no
   ambiente de deploy.
5. **`orchestrator/src/lib/sdr.ts`** (persona Flora) depende de
   `AGENT_NAME`, `STORE_WHATSAPP_LINK`, `STORE_PIX_KEY` — sem fallback
   real. Configurar antes do próximo deploy do orquestrador.
6. **`captacao-leads/index.ts` e `logistica/index.ts`** — bug de
   copy-paste geográfico ("Aracaju" como cidade padrão) corrigido para
   usar `STORE_CITY` — configurar a env var antes do deploy, senão o
   prompt de IA fica sem cidade padrão.
7. **Dashboard: `leads` (contagem) e `dashboard/leads` (lista) vêm de
   projetos Supabase diferentes**, com contagens diferentes (113 vs
   633). Mesma situação com `conversas` (27 vs 121). Ver
   `docs/PRODUCTION_DATA_FLOW.md`. Isso é pré-existente à reorganização,
   não foi introduzido por ela.
8. **`leads-enemeop` e `conversas-enemeop`, chamadas pelo frontend, ainda
   não foram deployadas no projeto Supabase Enemeop** — o código foi
   migrado para este repositório mas o deploy real ainda está no projeto
   da Fábrica. O frontend já aponta para `NEXT_PUBLIC_SUPABASE_URL`
   (projeto Enemeop) — as chamadas vão falhar (404) até o deploy ser
   refeito a partir daqui. Ver `docs/DEPLOYMENT.md`.
9. **Bug REQUER_ESCALADA** em `orchestrator/src/workers/orquestrador.ts`
   linhas ~38-43 — nenhum produtor real dos 3 tipos de evento
   interceptados foi encontrado no código. Pré-existente, não corrigido.
10. **`webhook-mercadopago`** — status de uso real não confirmado (ver
    `docs/MISSING_SOURCE_FUNCTIONS.md`). Código recuperado e sanitizado,
    mas pode ser código órfão.
11. **`enemeop-whatsapp-bridge`** — serviço Render referenciado, código
    não encontrado em nenhum repositório Git. Ver
    `docs/MISSING_WHATSAPP_BRIDGE.md`.

## Renovação de token

12. Token Instagram — prazo mencionado no `CLAUDE.md` da Fábrica é
    2026-08-01; entrada de 2026-07-01 em decisões anteriores registra
    expiração em 2026-08-30 — **conferir qual data é a correta antes de
    agir**. `renovar-token-instagram` (migrada, ver
    `docs/DEPLOYMENT.md`) automatiza a renovação uma vez deployada.
