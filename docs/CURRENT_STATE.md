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
1. ~~`FACTORY_SECRET` não configurado~~ — **FALSO ALARME, resolvido
   2026-07-17 (sessão de continuação).** Confirmado via Supabase
   Dashboard (Playwright) que o secret já existia desde 08 Jun 2026; o
   digest SHA256 exibido (`93a25165a7b49712aa03aa75edd8eb8ff418beab271bcd30ac794d5ca9d0d7dd`)
   bate exatamente com o valor local de
   `.credentials/infraestrutura/.env` (comparado por hash, sem revelar
   o valor). O 401 nunca foi causado por secret ausente — o CLI só
   falhava por token de acesso expirado.

   **Testes direcionados do `webhook-meta` v31 executados e OK**
   (2026-07-17, direto contra produção via curl, usando uma conversa
   sintética descartável em `conversas`/`atendimento_mensagens_enviadas`
   com `canal_id` inválido para não atingir cliente real — dados
   apagados ao final):
   - Sem header `Authorization` → 401 ✅
   - Segredo errado → 401 ✅
   - `autor_id` diferente do `atendente_id` da conversa → 409 ✅
   - Ação válida autenticada (auth + ownership + insert de
     idempotência OK) → 502 esperado no envio Meta (canal_id fake) ✅
   - Repetir a mesma `idempotency_key` → 200 `{ok:true,duplicado:true}`,
     sem tentar reenviar ✅
   - `historico` da conversa não foi alterado quando o envio falhou
     (confirma que só grava após sucesso real) ✅
   Ainda não testados neste ciclo: assumir/concluir/devolver
   (`atendimentos_humanos`) e o envio realmente bem-sucedido pelo canal
   Meta — dependem do teste real do item 2 abaixo.

2. ~~Deploy do frontend desatualizado~~ — **FALSO ALARME, causado por
   erro meu (sessão 2026-07-17): consultei o projeto Vercel errado via
   MCP.** O conector MCP do Vercel está autenticado numa conta
   (`essencial-auto-pecas-projects`) diferente da conta que o CLI local
   usa (`minhaautomacao`, batendo com `.vercel/project.json` do clone
   ativo). Existem dois projetos Vercel homônimos `enemeop-flores`; o
   real é **`minhaautomacaos-projects/enemeop-flores`**
   (`prj_rGXjRZzqsE8riGFyvY6koAchZC0Q`, org `team_gZMrVpE7q1aYd7VXOAUcCN0E`)
   — confirmado por `vercel whoami`, `vercel project inspect` e
   `.vercel/project.json`. Nesse projeto correto, a integração
   GitHub→Vercel está funcionando: o deployment de produção
   `dpl_5Wq87oskGCCwDFZSy9g62fzAchf8` foi criado 3 segundos depois do
   push do commit `5b01c9b` (descendente de `fdbde66`), e o alias
   `app.enemeopflores.com.br` aponta corretamente pra ele (confirmado em
   `vercel inspect <url> --format json` → campo `aliases`). **A
   produção já tinha o fix de handoff humano / Inbox Flora antes mesmo
   desta sessão.** O projeto antigo (`essencial-auto-pecas-projects`)
   não deve ser usado nem alterado — é resquício de outra conta/config,
   não está vinculado a este repo nem ao domínio.

   **Lição para sessões futuras:** ao usar as ferramentas MCP do
   Vercel, sempre confirmar `team_id`/projeto contra
   `.vercel/project.json` do repo local (ou `vercel whoami` +
   `vercel project inspect` via CLI) antes de confiar no que o MCP
   retorna — o MCP pode estar noutra conta.

3. **Teste real ponta a ponta pelo Instagram/Facebook — EM ANDAMENTO,
   achou um bug real 2026-07-17.** Itens 1 e 2 confirmados OK. Testando
   o item 3, dois envios reais pelo Instagram (conta de teste, canal_id
   `9530087693699545`, conversa `1866ecd9-5662-49cd-8b8f-2ef0bb064b77`)
   revelaram um bug de retomada de contexto, não relacionado ao handoff
   humano em si:

   **Evidência bruta preservada (logs expiram em 24h no Supabase):**
   - `18:59:01 UTC` — cliente: `"Olá"` (mensagem enviada por engano, em
     vez do texto de teste completo).
   - `18:59:01 UTC` — Flora: `"Já te enviei o link de pagamento — assim
     que identificarmos o pagamento, seu pedido é confirmado
     automaticamente!"`
   - `18:02:57 UTC` — cliente: `"Olá. Quais flores para hoje ?"` — Flora
     respondeu com a **mesma frase idêntica** acima, ignorando o
     conteúdo da mensagem.
   - Estado real da conversa no momento (`select fase, pedido_info from
     conversas where id = '1866ecd9...'`): `fase = 'aguardando_pagamento'`,
     `pedido_info.dados = {}` (**vazio** — nenhum `linkPagamento` real
     jamais foi registrado nesta conversa; a última menção a link de
     pagamento no histórico é de `2026-07-12`, de um fluxo antigo
     anterior à integração do funil determinístico).
   - Causa raiz: `case 'aguardando_pagamento'` em
     `orchestrator/src/lib/funil.ts` (+ cópia `_shared/funil.ts`)
     retornava uma frase fixa (`'Já te enviei o link de pagamento...'`)
     **sempre**, sem checar `dados.linkPagamento`, e sem tratar
     saudação/retorno como retomada de contexto — nunca deixava claro
     que estava reabrindo uma conversa antiga nem citava fatos reais.
   - Bug secundário relacionado, achado na mesma revisão: `processarDM`
     (`webhook-meta/index.ts`) não checava `modo_atendimento === 'humano'`
     antes de processar uma mensagem — Flora responderia
     automaticamente mesmo com um atendente humano já responsável pela
     conversa.

   **Correção aplicada, testada e commitada** (ver commit no `git log`
   deste arquivo): `avancarFunil` agora detecta saudação simples em fase
   de compra em andamento e retoma citando só fatos reais de `dados`
   (nunca inventa produto/link/pagamento); a fase `aguardando_pagamento`
   só reenvia o link se `dados.linkPagamento` existir de verdade, senão
   admite que não encontrou e oferece gerar de novo ou recomeçar;
   `processarDM` agora bloqueia qualquer resposta automática quando
   `modo_atendimento === 'humano'` (só registra a mensagem no histórico
   pro atendente ver). 6 testes direcionados novos (saudação com pedido
   em andamento, link enviado, link não enviado, contexto inconsistente
   — reproduzindo exatamente o estado real encontrado acima, conversa
   concluída reaberta, modo humano bloqueando a Flora) + suíte completa
   (63 testes em `orchestrator/`, 7 em `webhook-meta/`) passando.

   **Próximo passo:** deploy do `webhook-meta` com a correção, confirmar
   versão em produção, e repetir o teste real com uma mensagem simples
   ("Olá") na mesma conversa `1866ecd9...` para confirmar que a resposta
   agora deixa claro que está retomando (sem "já enviei") antes de
   prosseguir para o teste original do handoff humano em si.

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
