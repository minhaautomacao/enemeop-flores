# Funções e Serviços Implantados sem Código-Fonte Versionado

> Nenhum valor de credencial é reproduzido neste documento, mesmo os
> encontrados durante a recuperação do código-fonte abaixo.

## 1. `captura-qr` (Supabase Edge Function, projeto Enemeop)

- **Classificação:** produção ativa provável, mas sem confirmação de uso recente (nenhuma chamada nas últimas 24h de log consultadas)
- **Código-fonte recuperado via `get_edge_function` (não estava em nenhum repositório Git):**
  - Recebe evento (`event`/`type`) com um campo `base64` (QR code de sessão WhatsApp/Evolution)
  - Insere em `qr_temp` via `service_role` (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`) — **confirma que a proposta de RLS `service_role`-only para `qr_temp` é segura**, não quebra este consumidor
  - Não usa a anon key em nenhum ponto
- **Dependências:** provavelmente chamada pelo serviço Evolution API (`enemeop-evolution` no Render) como webhook de evento de QR code
- **Em qual repositório deveria estar:** `enemeop-flores/supabase/functions/captura-qr/` (é 100% específico da Enemeop — nome de evento e fluxo de pareamento WhatsApp)
- **Plano de recuperação:** copiar o conteúdo já obtido via MCP para `supabase/functions/captura-qr/index.ts` no repositório Enemeop, sem nenhum valor de credencial embutido (o código em si não contém nenhum — usa só env vars). **Arquivo não foi criado nesta etapa**, conforme instrução de não mover código ainda.

## 2. `webhook-mercadopago` (Supabase Edge Function, projeto Enemeop)

- **Classificação:** desconhecida / candidata à desativação futura — nenhuma evidência de uso ativo (sem chamada nas últimas 24h; toda a documentação conhecida do projeto usa **Cielo**, não Mercado Pago, como meio de pagamento)
- **Código-fonte recuperado via `get_edge_function` (não estava em nenhum repositório Git):**
  - Recebe notificação de pagamento do Mercado Pago, consulta a API do MP, atualiza `conversas.pedido_info` e `conversas.fase` (via `service_role`), envia confirmação por Z-API
  - **Achado de segurança novo, não catalogado antes desta etapa:** o arquivo contém `ZAPI_INSTANCE_ID`, `ZAPI_TOKEN` e `ZAPI_CLIENT_TOKEN` reais como fallback hardcoded (`Deno.env.get(...) ?? '<valor real>'`) — **mesmo padrão do incidente já registrado para `webhook-whatsapp`** (`docs/SECURITY_INCIDENTS.md`, Incidente 2), mas este caso **nunca esteve em nenhum repositório Git** — o valor está exposto apenas no código-fonte deployado no Supabase (visível a quem tiver acesso ao dashboard/API do projeto — exposição menor que um repositório público, mas ainda um valor real fora de um cofre de segredos)
  - Também lê `workspace_credentials` (chave `mp_access_token`, tipo `financeiro`) via `service_role` — **confirma que a proposta de RLS `service_role`-only para `workspace_credentials` é segura** para este consumidor
- **Dependências:** API do Mercado Pago, Z-API, tabela `conversas`, tabela `workspace_credentials`
- **Em qual repositório deveria estar:** `enemeop-flores/supabase/functions/webhook-mercadopago/`, **se** confirmado que ainda está em uso — caso contrário, candidata a desativação (não fiz isso nesta etapa)
- **Plano de recuperação:** **antes de versionar este arquivo em qualquer repositório**, sanitizar os 3 fallbacks Z-API (trocar por string vazia, mesmo tratamento recomendado para `webhook-whatsapp` em `docs/CREDENTIAL_ROTATION_PLAN.md`) — não copiar o código bruto para o Git como está. Recomendo tratar isso como parte da rotação Z-API (item 3 do plano de rotação), já que os valores parecem ser os mesmos tokens do incidente já conhecido (não confirmado se são idênticos sem comparar hash, o que eu não fiz para não expor nada).
- **Pergunta em aberto para decisão humana:** este código é uma tentativa de integração com Mercado Pago que nunca foi concluída/adotada, ou está ativa em paralelo à Cielo? A ausência total de menção ao Mercado Pago em qualquer outro documento do projeto (`ARCHITECTURE.md`, `CLAUDE.md`, `.credentials/`) sugere que é código órfão, mas isso não é uma confirmação.

## 3. Serviço Render `enemeop-whatsapp-bridge`

- **Classificação:** desconhecida — achado novo desta etapa, categoria diferente das duas acima (não é uma Edge Function, é um serviço Render inteiro)
- **Evidência:** definido em `render.yaml` (raiz do repositório **Fábrica**, não `orchestrator/render.yaml`), com `rootDir: whatsapp-bridge`, `runtime: node`, região Frankfurt
- **Achado de segurança adicional:** este arquivo também contém, em texto puro, um token real do Upstash Redis (`UPSTASH_REDIS_TOKEN`) — **não catalogado em `docs/SECURITY_INCIDENTS.md` até esta etapa** (esse documento não foi alterado aqui pois está fora do escopo de arquivos autorizados para esta etapa; recomendo adicioná-lo na próxima revisão de segurança)
- **O diretório `whatsapp-bridge/` referenciado por `rootDir` não existe em nenhum lugar do repositório Git** — mesma situação de `captura-qr`/`webhook-mercadopago`, mas para um serviço inteiro, não uma função
- **Dependências aparentes (pelos nomes das env vars):** Upstash Redis, uma instância Evolution chamada `floricultura` (`EVOLUTION_INSTANCE: floricultura` — nome diferente de `enemeop-evolution`, o serviço Evolution já catalogado em `orchestrator/render.yaml`, sugerindo que pode ser uma instância/tentativa anterior), e aponta `ORCHESTRATOR_WEBHOOK` para a mesma URL de `webhook-meta` do projeto Enemeop
- **Em qual repositório deveria estar:** se recuperado, `enemeop-flores/` (é 100% específico da integração WhatsApp da Enemeop)
- **Plano de recuperação:** não há código para recuperar via Supabase MCP (isso é um serviço Render, não uma Edge Function) — a única forma de recuperar o código-fonte, se existir, é acessando o painel Render diretamente (pendência humana) ou verificando se existe uma cópia local fora do Git em alguma máquina.
- **Classificação de status:** **candidata à desativação futura** é prematuro sem antes confirmar no painel Render se este serviço está de fato deployado e recebendo tráfego — pode já estar morto (nunca chegou a rodar) ou pode ser um componente esquecido mas ativo. **Depende de confirmação humana.**

## Resumo de classificação

| Item | Status |
|---|---|
| `captura-qr` | produção ativa provável, candidata à recuperação |
| `webhook-mercadopago` | desconhecida, candidata à desativação futura (após confirmação humana) |
| `enemeop-whatsapp-bridge` (serviço Render) | desconhecida, depende de confirmação humana no painel Render antes de qualquer classificação |

Nenhum destes três componentes foi desativado, alterado ou teve seu
código versionado nesta etapa.
