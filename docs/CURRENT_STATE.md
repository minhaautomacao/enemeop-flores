# CURRENT STATE — fonte única de retomada

> Ler ESTE arquivo primeiro em toda retomada.

---

## Handoff humano (webhook-meta ↔ atendimentos_humanos ↔ Inbox Flora) — 2026-07-17

Branch `reorganizacao/absorver-aplicacao-2026-07-10` foi mesclada em
`master` (era a branch que o Vercel publica; a reorg nunca tinha sido
mergeada nela). Trabalho, migration e deploy feitos a partir de `master`.

**Estado em produção:**
- Commit `fdbde66` publicado em `master` (push feito) e deployado no
  Vercel (target production, alias `app.enemeopflores.com.br` atualizado).
- Migration `202607170001_atendimento_humano.sql` aplicada no projeto
  Supabase Enemeop (`gftnjvdvzgjkhwxnxnwl`): cria `atendimentos_humanos`
  e `atendimento_mensagens_enviadas` (não existiam aqui — a
  `atendimentos_humanos` do projeto Fábrica é de outra cópia de
  `conversas`, não a real), habilita RLS em `conversas` e
  `atendimentos_humanos` (estava desabilitado — achado crítico do
  Advisor, confirmado corrigido via `get_advisors` depois da migration).
- `webhook-meta` redeployado (v31) a partir deste repositório, com a
  ação `send-human-message` nova e criação/reuso de ticket no handoff.
  Logs confirmam tráfego real `POST 200` contínuo na nova versão.
- Número oficial do WhatsApp corrigido: os textos de handoff diziam
  "final 8282" — o número real (`5511982829083`) termina em **9083**.
  Corrigido em `_shared/funil.ts` e `orchestrator/src/lib/funil.ts`
  (paridade mantida, teste `funil.parity.test.ts` passando).
- Handoff não força mais saída para o WhatsApp — cliente recebe o
  código do ticket e continua no mesmo canal (Instagram/Facebook).
- Dashboard só libera acesso (incl. Inbox Flora) pra quem tem linha em
  `profiles` — antes qualquer conta com signup entrava.

**Pendências que bloqueiam considerar a tarefa 100% concluída:**
1. **`FACTORY_SECRET` não configurado nas Edge Function secrets do
   projeto Supabase Enemeop** (só foi possível configurar no Vercel — o
   valor já existe em `.credentials/infraestrutura/.env`, é o mesmo
   usado lá). O token de acesso salvo em `SUPABASE_ACCESS_TOKEN` nesse
   mesmo arquivo está expirado/revogado (`supabase secrets list` retorna
   401), e não há ferramenta MCP para setar secret de Edge Function —
   só o Supabase CLI autenticado ou o Dashboard resolvem isso. Sem essa
   secret, `send-human-message` responde 401 mesmo com tudo o mais
   correto (a criação do ticket no handoff funciona normalmente, pois
   não depende dela).
2. **Teste real ponta a ponta pelo Instagram/Facebook ainda não
   executado** — depende de alguém mandar a mensagem de fato (não há
   como originar isso via ferramenta/API disponível). Depois do item 1
   resolvido, rodar: pedir atendente → conferir 1 único código →
   assumir no Inbox → responder pelo mesmo canal → concluir/devolver →
   confirmar Flora retomando.

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
