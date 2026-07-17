# Decisões Técnicas

## 2026-07-10 — Separação de repositórios Fábrica/Enemeop

**Decisão:** todo o código operacional da Enemeop (orquestrador, Edge
Functions específicas, persona Flora, catálogo, integrações Meta/Z-API/
Cielo) migra para este repositório. O núcleo genérico (fila, tipos,
adaptadores de provedor sem dado de cliente, roteamento de eventos) fica
duplicado temporariamente na Fábrica — decisão explícita de não usar
pacote npm/submodule/monorepo nesta etapa, para não adicionar
complexidade de infraestrutura antes de estabilizar a separação.

**Por quê:** o código e a documentação operacional da Enemoep estavam
majoritariamente no repositório da Fábrica (que deveria ser genérico),
violando o princípio de isolamento de cliente. Auditoria de 2026-07-10
encontrou também segredos reais versionados publicamente como
consequência dessa mistura.

## 2026-07-10 — Estrutura de pastas mantida (sem `apps/`+`packages/`)

**Decisão:** o frontend Next.js continua na raiz do repositório;
`orchestrator/` e `supabase/functions/` viram diretórios de topo, sem
reestruturação em monorepo.

**Por quê:** não existe `vercel.json` hoje — a Vercel detecta Next.js
automaticamente na raiz. Mover para `apps/web/` exigiria reconfigurar
manualmente o Root Directory no painel Vercel, um passo fora do controle
do Git que poderia quebrar o deploy em produção. Risco desproporcional
ao ganho nesta etapa.

## 2026-07-10 — Sanitização de defaults sem fallback real

**Decisão:** todo valor hardcoded removido (coordenadas, CEP, ZAPI
tokens, IG Page ID, connection strings, persona/contato da Flora) passou
a ter fallback **vazio**, não um valor "correto" reintroduzido como
default.

**Por quê:** consistente com a política de isolamento de cliente da
Fábrica (nenhum valor real deveria depender de estar "esquecido" no
código como rede de segurança) e evita que uma nova rotação de
credencial precise editar código-fonte — só a env var muda.

## 2026-07-10 — Funções sem código-fonte recuperadas do deploy

**Decisão:** `captura-qr`, `webhook-mercadopago`, `conversas-enemeop`,
`renovar-token-instagram`, `atualizar-nomes-leads`, `varredura-leads`,
`marketing-scraping` foram recuperadas via Supabase MCP
(`get_edge_function`) e versionadas pela primeira vez, com origem
registrada em comentário no topo de cada arquivo.

**Por quê:** essas funções estavam ativas em produção sem nenhum
histórico de código — risco de perda total se o deploy fosse
acidentalmente removido, e impossibilidade de revisar/testar mudanças
antes de aplicá-las.

## 2026-07-10 — `enemeop-whatsapp-bridge` não recuperado

**Decisão:** não foi feita nenhuma tentativa de recriar o código deste
serviço Render a partir de suposição.

**Por quê:** diferente das Edge Functions, não há ferramenta disponível
para ler o código-fonte de um serviço Render diretamente. Inventar código
seria mais arriscado do que documentar o bloqueio. Ver
`docs/MISSING_WHATSAPP_BRIDGE.md`.
