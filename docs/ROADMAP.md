# Roadmap

## FASE 1 — OPERAÇÃO (bloqueia tudo abaixo)

- [ ] Tornar os dois repositórios privados no GitHub
- [ ] Rotacionar credenciais (`docs/CREDENTIAL_ROTATION_PLAN.md`)
- [ ] Aplicar proposta de RLS (`docs/RLS_SECURITY_PLAN.md`)
- [ ] Confirmar URLs de webhook nos painéis Meta, Z-API, Cielo
      (`docs/SUPABASE_SOURCE_OF_TRUTH.md`)
- [ ] Redeploy das Edge Functions migradas a partir deste repositório
      (`docs/DEPLOYMENT.md`)
- [ ] Configurar as novas env vars (`STORE_*`, `AGENT_NAME`,
      `WORKSPACE_NAME`, credenciais) no ambiente de deploy antes do
      redeploy — ver `docs/KNOWN_ISSUES.md` itens 4-6
- [ ] Aplicar migration de sincronização de `pedidos`
- [ ] Resolver `enemeop-whatsapp-bridge`
- [ ] Renovação do token Instagram (confirmar prazo real — ver
      `docs/KNOWN_ISSUES.md` item 12)
- [ ] CNAME Cloudflare para `app.enemeopflores.com.br`

## FASE 2 — CONSOLIDAÇÃO

- [ ] Reconciliar as duas cópias divergentes de `leads`/`conversas`/
      `catalogo_produtos`/`funcao_configs` entre os projetos Supabase
- [ ] Confirmar status real de `webhook-mercadopago` (em uso ou órfão)
- [ ] Corrigir dashboard para não depender de nenhuma função no projeto
      Supabase da Fábrica (hoje `leads-enemeop`/`conversas-enemeop`
      precisam ser redeployadas aqui — ver Fase 1)
- [ ] Modelo de usuário-por-workspace (dependência da política final de
      RLS em `conversas`, ver `docs/RLS_SECURITY_PLAN.md`)

## FASE 3 — AUTOMAÇÃO

- [ ] Migração do WhatsApp de Z-API para Cloud API oficial da Meta
      (já no roadmap do `CLAUDE.md` da Fábrica, ainda não iniciada)
- [ ] Facebook Messenger 100% validado (código já existe em
      `webhook-meta`, sem teste real registrado)
- [ ] Bug REQUER_ESCALADA em `orquestrador.ts` (ver `docs/KNOWN_ISSUES.md`)
