# CURRENT STATE — fonte única de retomada

> Ler ESTE arquivo primeiro em toda retomada.

---

## Reorganização Fábrica/Enemeop — CONCLUÍDA (2026-07-10)

O código operacional da Enemeop Flores (orquestrador, Edge Functions,
persona da Flora, catálogo, integrações) foi migrado do repositório da
Fábrica de SaaS para este repositório. O frontend não depende mais do
projeto Supabase da Fábrica por padrão. Detalhes completos:

- O que foi migrado: `docs/DEPLOYMENT.md` (seção "Migração desta etapa")
- Segredos sanitizados: `docs/SECURITY_INCIDENTS.md`,
  `docs/CREDENTIAL_ROTATION_PLAN.md`
- Funções sem código-fonte original, recuperadas do deploy:
  `docs/MISSING_SOURCE_FUNCTIONS.md`, `docs/MISSING_WHATSAPP_BRIDGE.md`
- Estado real de infraestrutura (duplicidade entre projetos Supabase):
  `docs/INFRASTRUCTURE_MAP.md`, `docs/SUPABASE_SOURCE_OF_TRUTH.md`
- Fluxos de produção mapeados com evidência: `docs/PRODUCTION_DATA_FLOW.md`
- Arquitetura completa: `docs/ARCHITECTURE.md`
- Drift de schema de `pedidos`: `docs/DATABASE_SCHEMA_DRIFT.md`
- Proposta de RLS (não aplicada): `docs/RLS_SECURITY_PLAN.md`

## Missão M002 — CONCLUÍDA (2026-07-03, preservada nesta migração)

Flora responde DM real no Instagram via `graph.instagram.com` (não
`graph.facebook.com`). Fix confirmado intacto em
`supabase/functions/webhook-meta/index.ts` linhas ~454-455 após a
migração — verificado linha a linha antes de mover o arquivo.

## Ponto exato de retomada

Branch `reorganizacao/absorver-aplicacao-2026-07-10` (repositório
Enemeop) e `reorganizacao/separacao-enemeop-2026-07-10` (repositório
Fábrica). Nenhuma das duas foi publicada (sem push). Commits locais
listados no changelog da sessão. Nenhum deploy foi feito — todo o código
migrado ainda roda, em produção, a partir do estado anterior à
reorganização (Supabase Edge Functions, Render, Vercel inalterados).

**Antes de qualquer deploy do código migrado**, ver
`docs/KNOWN_ISSUES.md` — em especial a rotação de credenciais (deve vir
antes de qualquer redeploy que remova os fallbacks hardcoded) e a
confirmação de qual projeto Supabase é a fonte de verdade de cada
função (`docs/SUPABASE_SOURCE_OF_TRUTH.md`).

## Pendências externas (ação humana, fora do escopo desta reorganização)

- Tornar os repositórios `AI-SaaS-Factory-Fabrica-de-Saas` e
  `enemeop-flores` privados no GitHub
- Aplicar RLS proposta (`supabase/migrations/202607100001_security_rls_proposal.sql`)
- Rotacionar credenciais (`docs/CREDENTIAL_ROTATION_PLAN.md`)
- Confirmar URLs de webhook nos painéis Meta, Z-API e Cielo
- Implantar (deploy) as Edge Functions migradas no projeto Supabase
  correto — hoje o código está no repositório certo, mas o deploy ainda
  não foi refeito a partir daqui
- Aplicar a migration de sincronização de `pedidos`
  (`supabase/migrations/202607100002_sync_pedidos_schema.sql`)
- Resolver `enemeop-whatsapp-bridge` (`docs/MISSING_WHATSAPP_BRIDGE.md`)
