# Fluxos de Produção — Evidências

> Levantado em 2026-07-10 (Etapa C) via leitura de código (Fábrica e
> Enemeop) e Supabase MCP (`list_edge_functions`, `get_logs` últimas 24h,
> `get_edge_function` para recuperar código-fonte deployado). Nenhuma
> consulta leu conteúdo de conversa, credencial, cliente ou pedido —
> apenas metadados, schema e logs de requisição (método/status/tempo).
>
> Nenhum valor de credencial é reproduzido neste documento.

## Instagram Direct

```
Meta (App "enemeopflores")
  → POST https://gftnjvdvzgjkhwxnxnwl.supabase.co/functions/v1/webhook-meta
    [EVIDÊNCIA: get_logs confirma dezenas de "POST | 200" em webhook-meta
     v25 no projeto gftnjvdvzgjkhwxnxnwl nas últimas 24h — tráfego real]
  → HMAC validado (validarAssinatura, META_APP_SECRET)
  → extrai eventos (DM ou comentário)
  → processarDM(): busca/cria conversa na tabela `conversas`
    [projeto gftnjvdvzgjkhwxnxnwl — mesma instância que recebeu o webhook]
  → chama IA (Groq, fallback Anthropic) com prompt "Flor, vendedora
    Enemeop Flores" + catálogo embutido no próprio código da função
  → envia resposta via graph.instagram.com (Instagram) — confirmado
    presente no código local do repositório Fábrica; a versão deployada
    em gftnjvdvzgjkhwxnxnwl não foi lida linha a linha nesta etapa, mas a
    ausência de erros nos logs (só "200") é consistente com o fix ativo
  → em paralelo, dispara enviarAoOrquestrador() → POST para
    `${SUPABASE_URL}/functions/v1/orquestrador` do MESMO projeto
    [EVIDÊNCIA: get_logs mostra orquestrador v15 em gftnjvdvzgjkhwxnxnwl
     recebendo POST logo após cada webhook-meta, majoritariamente 200,
     com alguns 401 intercalados — ver lacuna abaixo]
```

- **Projeto Supabase:** `gftnjvdvzgjkhwxnxnwl` (Enemeop) — confirmado por logs de tráfego real, não apenas por nome
- **Credencial utilizada:** `META_APP_SECRET`, `META_IG_ACCESS_TOKEN`/`META_PAGE_ACCESS_TOKEN` (nomes, não valores)
- **Lacuna:** a versão da função `orquestrador` (Edge Function) no mesmo projeto também recebe chamadas com **401 intercalados** — algumas chamadas de `enviarAoOrquestrador()` estão falhando por autenticação (`FACTORY_SECRET`/`SERVICE_KEY` incorretos ou ausentes no ambiente de quem chama). Isso é uma falha real observável nos logs, não hipotética — mas não é possível, sem mais investigação, dizer se isso causa perda de lead ou se há novo retry.
- **Risco:** nenhuma tabela do RLS proposal está no caminho crítico deste fluxo além de `conversas` (que já usa `service_role`, ver `RLS_SECURITY_PLAN.md`).

## WhatsApp

```
Cliente (Z-API, instância Enemeop)
  → POST .../functions/v1/webhook-whatsapp
    [EVIDÊNCIA INDIRETA: nenhuma chamada a webhook-whatsapp apareceu nas
     últimas 24h de logs consultadas — não há mensagem de cliente nesse
     período, não significa que o canal esteja inativo]
  → buscarConfigDB() consulta `funcao_configs` via service_role
  → resposta gerada, fotos reais de `catalogo_produtos` quando aplicável
  → resposta enviada via api.z-api.io (ZAPI_TOKEN/ZAPI_CLIENT_TOKEN)
```

- **Projeto Supabase:** `gftnjvdvzgjkhwxnxnwl` (webhook-whatsapp v35 é a versão mais iterada e mais recente; v1 no projeto Fábrica não mostrou nenhuma atividade nos logs consultados)
- **Lacuna:** sem evento real de WhatsApp na janela de 24h analisada, não há confirmação por tráfego (diferente do Instagram, onde há prova direta). Recomendação: repetir a consulta de logs em um horário/dia com atividade conhecida antes de tratar isso como confirmado.
- **Achado adicional:** a função `webhook-mercadopago` (só existe em `gftnjvdvzgjkhwxnxnwl`) também tem credenciais Z-API reais hardcoded como fallback, no mesmo padrão do incidente já registrado para `webhook-whatsapp` — ver `docs/MISSING_SOURCE_FUNCTIONS.md`.

## Dashboard

```
Browser
  → Vercel (Next.js, SSR + Client Components)
  → lib/supabase/{server,client}.ts — createServerClient/createBrowserClient
    com NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
    (projeto gftnjvdvzgjkhwxnxnwl, RLS aplicado via sessão do usuário)
  → .from('pedidos'), .from('leads') [contagem] → SELECT direto, RLS
    'authenticated' já em vigor (ver DATABASE_SCHEMA_DRIFT.md)
  → (producao)/producao/page.tsx → fetch direto a
    /rest/v1/catalogo_produtos com anon key (hardcoded no arquivo-fonte,
    não via env var — ver observação abaixo) no MESMO projeto
  → dashboard/leads, dashboard/conversas, monitor-social, e a função
    "expandir conversa" de LeadsTable.tsx → fetch para
    FABRICA_URL (ebeapnydeiwuewxatuuw, hardcoded ou via
    NEXT_PUBLIC_FABRICA_URL) → Edge Functions leads-enemeop e
    conversas-enemeop, SEM header de autenticação visível no código
    (endpoints públicos, sem Authorization Bearer)
```

- **Observação de qualidade:** `app/(producao)/producao/page.tsx` tem a
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` do projeto Enemeop hardcoded diretamente
  no arquivo-fonte, em vez de usar a env var como o resto do app. Não é um
  segredo novo (anon key já é pública por design e já está em outros
  lugares, ver `SECURITY_INCIDENTS.md`), mas é uma inconsistência de
  padrão de código.
- **Achado de arquitetura, não de segurança:** o dashboard busca `leads`
  (contagem, homepage) do projeto Enemeop diretamente, mas a **lista
  completa de leads** (`dashboard/leads`) e **conversas** vêm do projeto
  **Fábrica** via Edge Function. Duas fontes diferentes para dado
  logicamente relacionado — risco de inconsistência visível ao usuário
  (contagem da home pode não bater com a lista da página de leads, já que
  vêm de projetos Supabase diferentes com contagens diferentes — 113 vs
  633 leads, ver `INFRASTRUCTURE_MAP.md`).
- **Autenticação das chamadas para o projeto Fábrica:** nenhum Bearer
  token visível no código do frontend — os endpoints `leads-enemeop` e
  `conversas-enemeop` parecem aceitar chamada sem autenticação (consistente
  com `verify_jwt: false` observado em ambos, ver `INFRASTRUCTURE_MAP.md`).
  Isso significa que qualquer pessoa que descubra essas duas URLs pode
  consultá-las diretamente, sem chave nenhuma — **achado de segurança
  relevante**, mesmo não fazendo parte da migration de RLS desta etapa
  (RLS não se aplica a Edge Functions, só a tabelas Postgres).

## Pedidos

```
Flora (via webhook-meta/webhook-whatsapp, service_role)
  → INSERT/UPDATE em `conversas.pedido_info` (rascunho do pedido)
webhook-cielo (pagamento confirmado)
  → tabela `pedidos` (INSERT/UPDATE, service_role)
dashboard/pedidos, dashboard/financeiro, dashboard/entregas,
(producao)/producao
  → SELECT em `pedidos` via anon key + sessão do usuário (RLS
    'authenticated', sem escopo por workspace — ver DATABASE_SCHEMA_DRIFT.md)
app/actions/pedidos.ts (Server Action)
  → INSERT/UPDATE em `pedidos` via anon key + sessão do usuário
```

- **Projeto Supabase:** `gftnjvdvzgjkhwxnxnwl` — único projeto onde a
  tabela `pedidos` existe (confirmado, sem duplicata)
- **Lacuna:** não confirmado se `agente-financeiro`/`agente-logistica`
  (que também tocam pedido/pagamento) rodam exclusivamente contra este
  projeto — os nomes de função só existem em `gftnjvdvzgjkhwxnxnwl`
  (confirmado via `list_edge_functions`), então não há ambiguidade aqui.

## Credenciais

```
Edge Functions (service_role)
  → tabela `funcao_configs` — leitura confirmada em 4 arquivos
    (webhook-meta, webhook-whatsapp, _shared/instagram.ts,
    _shared/anthropic.ts), como fallback quando a env var não está setada
  → tabela `workspace_credentials` — leitura confirmada em
    webhook-mercadopago (chave 'financeiro'); nenhum outro uso direto
    encontrado no código lido
Env vars (Supabase Edge Functions, Render, Vercel)
  → caminho preferencial, usado antes de qualquer fallback de banco
```

- Nenhuma descriptografia de `workspace_credentials.valor`/`iv` foi
  encontrada implementada no código lido (a coluna existe, mas não vi
  função de decrypt sendo chamada sobre ela) — **lacuna**: se o valor
  armazenado é criptografado (como o `README` de `.credentials/cielo.md`
  na Fábrica sugere, mencionando AES-256-GCM), o consumidor dessa
  descriptografia não foi localizado nesta auditoria.
