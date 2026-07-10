# Fonte de Verdade Preliminar — Supabase e Componentes

> Classificações baseadas em evidência direta (logs de tráfego real,
> código-fonte recuperado, referências cruzadas), não em suposição pelo
> nome do projeto. Onde a evidência é insuficiente, a linha diz
> explicitamente "depende de confirmação humana" — nenhuma fonte de
> verdade foi declarada por padrão.

| Componente | Classificação | Evidência |
|---|---|---|
| Banco de dados (geral) | **duplicata ativa** | Dois projetos Supabase com tabelas de mesmo nome e dados diferentes, ambos com escrita recente — não é um caso simples de "um é cópia do outro" |
| `webhook-meta` | **fonte de verdade confirmada: projeto Enemeop (`gftnjvdvzgjkhwxnxnwl`), v25** | `get_logs` mostra dezenas de `POST 200` reais nas últimas 24h nesta versão; código recuperado do projeto Fábrica (v24) confirma estruturalmente que essa versão ainda usa `graph.facebook.com` para o envio de DM (pré-fix M002) — a v24 não deveria estar recebendo tráfego do Meta |
| `orquestrador` (Edge Function) | **fonte de verdade provável: projeto Enemeop, v15 — com ressalva** | Recebe POST logo após cada webhook-meta bem-sucedido, mas **também acumula 401 intercalados** (falha de autenticação em parte das chamadas). A versão do projeto Fábrica (v6) só mostrou 401 nas últimas 24h — nenhum 200. Isso não confirma que o orquestrador Edge Function é o "cérebro" da orquestração — o serviço Render (Node, `orchestrator/`) pode ser o consumidor real da fila; a relação entre a Edge Function `orquestrador` e o serviço Render não foi confirmada nesta auditoria — **depende de confirmação humana** |
| `captacao-leads` | **fonte de verdade provável: projeto Enemeop, v16** | POST 200 nos logs, encadeado com webhook-meta |
| `webhook-whatsapp` | **fonte de verdade provável: projeto Enemeop, v35 — sem confirmação por tráfego** | v35 é muito mais iterada que a v1 do projeto Fábrica; nenhuma chamada registrada nas últimas 24h em nenhum dos dois projetos — sem evento de WhatsApp na janela observada |
| `conversas-enemeop` | **fonte de verdade confirmada: projeto Fábrica (`ebeapnydeiwuewxatuuw`)** | Único lugar onde esta função existe; confirmado por leitura direta do código do frontend (`conversas/page.tsx`, `LeadsTable.tsx`, `monitor-social/page.tsx`) que é isso que o dashboard chama hoje |
| `leads-enemeop` | **fonte de verdade confirmada: projeto Fábrica** | Mesmo tipo de evidência — `dashboard/leads/page.tsx` e `monitor-social/page.tsx` chamam esta função, neste projeto |
| Tabela `leads` (dado) | **desconhecido / depende de confirmação humana** | O frontend lê a contagem de `leads` do projeto Enemeop (113 linhas) na home, mas a lista completa vem de `leads-enemeop`, que roda no projeto Fábrica (633 linhas) — **os dois números que o usuário vê no mesmo dashboard vêm de fontes diferentes**. Não há evidência suficiente para dizer qual dos dois "deveria" ser a fonte única |
| Tabela `conversas` (dado) | **desconhecido / depende de confirmação humana** | `webhook-meta`/`webhook-whatsapp` (projeto Enemeop) escrevem na cópia do projeto Enemeop (27 linhas); o dashboard lê a cópia do projeto Fábrica (121 linhas) via `conversas-enemeop`. Isso sugere que o dashboard pode estar mostrando conversas desatualizadas ou de uma fase anterior da operação — **achado funcional, não só de segurança** |
| Tabela `pedidos` | **fonte de verdade confirmada: projeto Enemeop** | Única tabela `pedidos` existente — sem duplicata em nenhum dos dois projetos |
| Tabela `catalogo_produtos` (dado) | **desconhecido** | Ambos os projetos têm a tabela (40 vs 62 linhas); o frontend (`producao/page.tsx`) lê do projeto Enemeop; não confirmado se algo lê a cópia da Fábrica |
| Credenciais (`workspace_credentials`) | **fonte de verdade provável: projeto Enemeop** | 5 linhas de dado real no projeto Enemeop contra 0 no projeto Fábrica — mas RLS desabilitado só no Enemeop (ver `RLS_SECURITY_PLAN.md`) |
| Webhook Meta (URL registrada no painel) | **depende de confirmação humana** | Todas as evidências indiretas (tráfego real, `render.yaml` da raiz do repo Fábrica linha 18, `.env.example`) apontam para o projeto Enemeop — mas nenhuma delas é a confirmação direta no painel Meta for Developers, que é a única fonte realmente autoritativa |
| Webhook WhatsApp (Z-API) | **depende de confirmação humana** | Sem evidência de tráfego na janela observada; confirmação só é possível no painel Z-API |
| Webhook Cielo | **divergente, depende de confirmação humana** | O comentário em `supabase/functions/webhook-cielo/index.ts` (repo Fábrica) documenta a URL de notificação como sendo do projeto **Fábrica**; `.credentials/cielo.md` (repo Enemeop) documenta a mesma URL como sendo do projeto **Enemeop**. As duas fontes discordam entre si — nenhuma pode ser tratada como correta sem checar o painel Cielo diretamente |
| Orquestrador (serviço Render, Node) | **fonte de verdade provável para processamento assíncrono real** | É o único componente com fila (BullMQ/Redis) e lógica de retry — mas sem acesso ao painel Render, não foi possível confirmar se está de fato recebendo e processando eventos hoje |
| Financeiro (`agente-financeiro`, `webhook-cielo`) | **fonte de verdade confirmada: projeto Enemeop** | `agente-financeiro` só existe neste projeto |
| Logística (`agente-logistica`, `logistica`) | **fonte de verdade provável: projeto Enemeop** | `agente-logistica` só existe aqui; `logistica` (Edge Function genérica duplicada) tem versão mais recente aqui também |
| Dashboard (Vercel) | **fonte de verdade confirmada** | Único frontend, projeto Vercel `enemeop-flores` — sem duplicata conhecida |
| Serviço Render `enemeop-whatsapp-bridge` | **desconhecido — achado novo desta etapa** | Definido em `render.yaml` (raiz do repositório Fábrica), aponta `rootDir: whatsapp-bridge` — **esse diretório não existe em nenhum lugar do repositório Git**. Não há evidência de que este serviço esteja de fato implantado e ativo no Render hoje. Ver `docs/MISSING_SOURCE_FUNCTIONS.md` |

## Leitura geral

Nenhum componente teve sua fonte de verdade "escolhida" nesta etapa —
apenas classificada com o grau de evidência disponível. Os itens
marcados **confirmado** têm prova direta (tráfego real ou referência de
código inequívoca). Os marcados **provável** têm evidência forte mas
indireta. Os marcados **depende de confirmação humana** exigem acesso a
um painel externo (Meta, Z-API, Cielo, Render) que esta auditoria não
teve.
