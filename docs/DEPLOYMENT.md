# Deploy — guia e registro da migração

> Nenhum deploy foi executado como parte da reorganização de 2026-07-10.
> Este documento registra o que foi migrado (para rastreabilidade) e
> como implantar com segurança quando chegar a hora.

## Migração desta etapa (código movido, nada deployado)

### De `AI-SaaS-Factory-Fabrica-de-Saas` para este repositório

**Orquestrador** (`orchestrator/`): `src/index.ts`, `src/types.ts`,
`src/lib/{queue,redis,supabase,melhor-envio,lalamove,whatsapp,instagram,sdr}.ts`,
`src/catalog/{liveSiteCatalog,test-live}.ts`,
`src/workers/{orquestrador,logistica}.ts`, `scripts/test-whatsapp.ts`,
`package.json`, `tsconfig.json`, `render.yaml` (sanitizado),
`.env.example` (sanitizado e expandido).

**Edge Functions** (`supabase/functions/`): `webhook-meta`,
`webhook-whatsapp` (sanitizado), `webhook-whatsapp-proxy`, `whatsapp-sdr`,
`captacao-leads` (sanitizado), `logistica` (sanitizado),
`agente-financeiro`, `agente-logistica` (sanitizado), `leads-enemeop`,
`orquestrador`, `webhook-cielo` — estas duas últimas não estavam na lista
original da missão, adicionadas porque `webhook-meta` chama
`orquestrador` internamente e `webhook-cielo` é a única via de
confirmação de pagamento de `pedidos`, ambos necessários para o
repositório funcionar de forma independente.

**`_shared/`**: `anthropic.ts`, `cielo.ts`, `credentials.ts`, `email.ts`,
`instagram.ts` (sanitizado), `lalamove.ts` (sanitizado), `logger.ts`,
`melhor-envio.ts`, `supabase.ts`, `transportadoras.ts`, `types.ts`,
`whatsapp.ts`.

**Migration**: `20260625000009_catalogo_produtos.sql`.

### Recuperadas do deploy (nunca estiveram em nenhum Git antes)

`captura-qr`, `webhook-mercadopago` (sanitizado), `conversas-enemeop`,
`renovar-token-instagram`, `atualizar-nomes-leads`, `varredura-leads`,
`marketing-scraping` — todas com comentário de origem no topo do
arquivo. Ver `docs/MISSING_SOURCE_FUNCTIONS.md`.

### Frontend corrigido

`app/monitor-social/page.tsx`, `app/(dashboard)/dashboard/leads/page.tsx`,
`app/(dashboard)/dashboard/leads/LeadsTable.tsx`,
`app/(dashboard)/dashboard/conversas/page.tsx`,
`app/(producao)/producao/page.tsx` — removidas referências hardcoded ao
projeto Supabase da Fábrica e à anon key; passam a usar
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Ordem segura de deploy (quando autorizado)

1. Configurar todas as env vars novas no ambiente de deploy (Supabase
   Edge Functions secrets, Render, Vercel) — lista completa em
   `orchestrator/.env.example`. Sem isso, o redeploy quebra
   funcionalidade (ver `docs/KNOWN_ISSUES.md` itens 4-6).
2. Aplicar a rotação de credenciais (`docs/CREDENTIAL_ROTATION_PLAN.md`)
   **antes** do redeploy, não depois — evita que o código novo suba com
   credencial já comprometida.
3. Aplicar a proposta de RLS (`docs/RLS_SECURITY_PLAN.md`) — pode ser
   feito antes ou depois do redeploy de código, mas antes de considerar
   o ambiente seguro.
4. Redeploy das Edge Functions **a partir deste repositório**, no
   projeto Supabase Enemoep (`gftnjvdvzgjkhwxnxnwl`) — inclusive
   `leads-enemeop` e `conversas-enemeop`, que o frontend já espera
   encontrar lá.
5. Testar cada fluxo crítico após o deploy: DM Instagram (mesmo teste da
   missão M002), mensagem WhatsApp, `/dashboard/leads`,
   `/dashboard/conversas`, criação de pedido.
6. Só depois disso, decidir sobre desativar as cópias duplicadas no
   projeto Supabase da Fábrica.

## Variáveis de ambiente necessárias

Ver `orchestrator/.env.example` (lista completa e comentada) e
`.credentials/*/README.md` de cada categoria.
