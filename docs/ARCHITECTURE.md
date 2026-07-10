# Arquitetura — Enemeop Flores

> Este documento descreve a aplicação real da floricultura Enemeop Flores.
> Ao contrário do `docs/ARCHITECTURE.md` da Fábrica de SaaS (genérico),
> este documento pode e deve conter nomes, provedores e fluxos reais deste
> negócio — mas nunca valores de credencial (ver
> `docs/SECURITY_INCIDENTS.md` e `docs/CREDENTIAL_ROTATION_PLAN.md`).
>
> Estado de infraestrutura detalhado (duplicidades, divergências,
> pendências de confirmação): `docs/INFRASTRUCTURE_MAP.md`.

## 1. Frontend

Next.js 14 (App Router), na raiz do repositório (sem monorepo `apps/`
por decisão registrada — ver seção de estrutura-alvo do relatório da
Etapa 1). Hospedado na Vercel, deploy automático via `git push`.

Rotas principais: `(auth)/login`, `(dashboard)/dashboard/{configuracoes,
conversas, encomendas, entregas, financeiro, leads, pedidos}`,
`(producao)/producao`, `monitor-social`.

## 2. Supabase

Dois projetos estão envolvidos na operação real hoje (ver
`INFRASTRUCTURE_MAP.md` para o detalhamento — esta é uma situação a
corrigir, não o desenho pretendido):
- **Projeto Enemeop** (`gftnjvdvzgjkhwxnxnwl`) — usado pelo frontend via
  `NEXT_PUBLIC_SUPABASE_URL`, hospeda a versão mais recente da maioria das
  Edge Functions.
- **Projeto Fábrica** (`ebeapnydeiwuewxatuuw`) — hospeda uma segunda cópia
  de várias Edge Functions e tabelas com o mesmo nome (`leads`, `conversas`,
  `funcao_configs`, `catalogo_produtos`, `workspace_credentials`), com
  contagens de linha diferentes das do projeto Enemeop. Pelo menos uma
  função do frontend (`conversas-enemeop`, ver seção 5) consulta este
  projeto, não o projeto "oficial" da Enemeop.

## 3. Edge Functions

Ver inventário completo e estado de deploy em `INFRASTRUCTURE_MAP.md`.
Resumo funcional: `webhook-meta` (Instagram Direct + Facebook Messenger),
`webhook-whatsapp` (Z-API), `whatsapp-sdr`, `captacao-leads`,
`agente-financeiro`, `agente-logistica`, `logistica`, `webhook-cielo`,
`orquestrador` (roteamento tipo-evento → agente).

## 4. Orquestrador

Serviço Node standalone (`orchestrator/`), hospedado no Render, com fila
BullMQ sobre Redis (Upstash). Recebe eventos do `webhook-meta`/
`webhook-whatsapp`, roteia para o agente correto (SDR, logística,
financeiro), usa `orchestrator/src/lib/sdr.ts` (persona "Flora") para
gerar resposta.

## 5. Render

Hospeda o orquestrador e um serviço Evolution API (`enemeop-evolution`,
`orchestrator/render.yaml`) com banco Postgres próprio (connection string
hoje exposta em texto puro no arquivo — ver `SECURITY_INCIDENTS.md`,
rotação obrigatória antes de qualquer limpeza de código).

## 6. Vercel

Hospeda o frontend Next.js. Projeto `enemeop-flores`. **Atenção:** o MCP
Vercel usado nas últimas sessões está conectado à conta errada
("Essencial Auto Peças") — checagem de env vars de produção via MCP não é
confiável até reconectar a conta correta ("Minha Automação").

## 7. Meta (Instagram + Facebook)

App Meta "enemeopflores". Webhook `webhook-meta` recebe eventos de DM do
Instagram e mensagens do Messenger. Fix crítico de produção (missão M002,
2026-07-03): usar `graph.instagram.com` (não `graph.facebook.com`) para
enviar DM via Instagram Business Login — comportamento validado com 20+
envios reais. Qual projeto Supabase recebe efetivamente o webhook
registrado no painel Meta **não está confirmado** (ver
`INFRASTRUCTURE_MAP.md`).

## 8. WhatsApp (Z-API)

Instância Z-API paga (~R$79/mês). `webhook-whatsapp` recebe mensagem,
responde com IA + fotos de produto real (tabela `catalogo_produtos`).
Migração futura para Cloud API oficial da Meta está no roadmap (ver
`CLAUDE.md` do projeto), ainda não iniciada.

## 9. Cielo

Link de pagamento (SuperLink). Merchant ID cadastrado (ver
`.credentials/cielo.md` — sanitização pendente, ver
`CREDENTIAL_ROTATION_PLAN.md`). Pix habilitado desde 2026-06-18.

## 10. WordPress

Site institucional/loja (`www.enemeopflores.com.br`, WooCommerce) é a
fonte do catálogo ao vivo, consumido via scraping por
`orchestrator/src/catalog/liveSiteCatalog.ts`.

## 11. Agente Flora

Persona de IA definida em `orchestrator/src/lib/sdr.ts` e nos prompts de
`whatsapp-sdr`/`webhook-meta`/`captacao-leads`. Atende por WhatsApp,
Instagram Direct e (parcialmente validado) Facebook Messenger.

## 12. Catálogo

Duas fontes coexistem hoje: `catalogo_produtos` (tabela Supabase, usada
por `webhook-whatsapp` para enviar foto real do produto) e o scraping ao
vivo do WooCommerce (`liveSiteCatalog.ts`, usado pelo orquestrador para
sugestão por ocasião/categoria). Não há reconciliação automática entre as
duas fontes documentada.

## 13. Pedidos

Tabela `pedidos` — ver estrutura completa e histórico de divergência em
`docs/DATABASE_SCHEMA_DRIFT.md`. Alimentada por `webhook-cielo` (link de
pagamento), `agente-financeiro` e pelos componentes de frontend
`PedidosView`/`ProducaoScreen`.

## 14. Logística

`agente-logistica` e o worker `orchestrator/src/workers/logistica.ts`
cotam frete via Lalamove (moto, entrega no mesmo dia) e Melhor Envio,
partindo do endereço fixo da loja (Rua Costa Aguiar, 1184, Ipiranga, São
Paulo, SP). **Bug ativo:** dois prompts de IA (`captacao-leads/index.ts`,
`logistica/index.ts`) ainda usam "Aracaju" como cidade padrão — ver
`docs/DATABASE_SCHEMA_DRIFT.md` seção de riscos e o registro em
`AI-SaaS-Factory-Fabrica-de-Saas/docs/ENEMEOP_EXTRACTION_MAP.md`.

## 15. Pagamentos

Cielo (link de pagamento/SuperLink, cartão + Pix) via `webhook-cielo` e
`agente-financeiro`.

## 16. Observabilidade

`orchestrator_logs` (Supabase) registra execução de agentes. Não há
dashboard de monitoramento de erro dedicado além de UptimeRobot (ping de
disponibilidade, não de erro de aplicação).

## 17. Fluxo completo de atendimento e venda

```
Cliente escreve (WhatsApp/Instagram/Messenger)
  → Webhook (webhook-whatsapp / webhook-meta) recebe
  → HMAC valida
  → Evento vai para o orquestrador (fila BullMQ)
  → Orquestrador roteia por tipo de evento
  → Flora (SDR) responde: entende intenção, sugere produto do catálogo,
    envia foto real quando aplicável
  → Cliente confirma → cria/atualiza lead → gera pedido
  → agente-logistica cota frete → agente-financeiro gera link de
    pagamento Cielo
  → Cliente paga → webhook-cielo confirma → pedido avança de status
  → Equipe acompanha via dashboard (dashboard/pedidos, /producao)
  → Escalonamento para humano apenas em: pedido do cliente, falha de
    pagamento, erro operacional, reclamação grave, caso fora das regras
```
