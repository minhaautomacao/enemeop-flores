# Mapa de Infraestrutura — Enemeop Flores

> Levantado ao vivo via Supabase MCP em 2026-07-10 (Etapa 1.5/B da
> separação de repositórios). Nenhum valor de credencial é registrado
> aqui — apenas nomes, IDs de projeto/serviço (identificadores, não
> segredos) e contagens.
>
> **Regra desta tabela:** nenhuma fonte de verdade é declarada definitiva
> quando depende de confirmação externa (painel Meta, Render, Vercel) que
> eu não pude verificar diretamente.

## Legenda de classificação

`confirmado` · `duplicado` · `divergente` · `legado` · `pendente de validação` · `fonte de verdade provável`

## Tabela principal

| Componente | Provedor | Projeto/Serviço | Função | Ambiente | Estado | Duplicidade | Fonte de verdade atual | Destino esperado | Confirmação necessária |
|---|---|---|---|---|---|---|---|---|---|
| Supabase — projeto Enemeop | Supabase | `gftnjvdvzgjkhwxnxnwl` (nome interno: "enemeop-flores") | Banco + Auth + Edge Functions consumidas pelo frontend | Produção | **confirmado** ativo | — | **fonte de verdade provável** para Auth, e para as Edge Functions mais recentes (`webhook-meta` v25, `webhook-whatsapp` v35) | Único projeto Supabase da Enemeop | Confirmar no painel Meta qual URL de webhook está registrada |
| Supabase — projeto Fábrica | Supabase | `ebeapnydeiwuewxatuuw` (nome interno: "minhaautomacao-Saas") | Deveria ser só da Fábrica; hoje também hospeda dados/funções da Enemeop | Produção (ambos os projetos) | **divergente** | Sim — ver linhas abaixo | Não deveria ser fonte de verdade de nada da Enemeop | Nenhuma tabela/função da Enemeop deveria estar aqui | Confirmar se algo em produção depende ativamente deste projeto antes de desligar qualquer função |
| `webhook-meta` | Supabase Edge Function | Enemeop: v25 ACTIVE / Fábrica: v24 ACTIVE | Recebe webhook Meta (Instagram DM + Messenger) | Produção (as duas versões estão ACTIVE simultaneamente) | **duplicado, divergente** | Sim | Enemeop v25 é **fonte de verdade provável** (contém o fix `graph.instagram.com` validado na missão M002; v24 na Fábrica é a versão *anterior* ao fix) | Só v25, no projeto Enemeop | **Confirmar no painel Meta for Developers** qual URL de webhook está de fato cadastrada — se ainda apontar para o projeto Fábrica, o sistema estaria rodando o bug pré-M002 |
| `webhook-whatsapp` | Supabase Edge Function | Enemeop: v35 ACTIVE / Fábrica: v1 ACTIVE | Recebe mensagem Z-API | Produção (ambas ACTIVE) | **duplicado, divergente** | Sim | Enemeop v35 é **fonte de verdade provável** (muito mais iterada — fotos de produto, catálogo) | Só v35, no projeto Enemeop | Confirmar URL de webhook cadastrada no painel Z-API |
| `captacao-leads` | Supabase Edge Function | Enemeop v16 / Fábrica v12 | Classificação de lead via IA | Produção (ambas ACTIVE) | **duplicado, divergente** | Sim | Enemeop v16 mais provável | Só Enemeop | Confirmar quem chama a versão da Fábrica, se alguém chama |
| `whatsapp-sdr` | Supabase Edge Function | Enemeop v20 / Fábrica v8 | Agente SDR | Produção (ambas ACTIVE) | **duplicado, divergente** | Sim | Enemeop v20 mais provável | Só Enemeop | idem |
| `logistica` | Supabase Edge Function | Enemeop v15 / Fábrica v5 | Cotação de frete | Produção (ambas ACTIVE) | **duplicado, divergente** | Sim | Enemeop v15 mais provável | Só Enemeop | idem |
| `agente-financeiro` | Supabase Edge Function | Enemeop v8 / Fábrica — não existe | Gera link Cielo | Produção | **confirmado** só no projeto Enemeop | Não | Enemeop | Enemeop | — |
| `agente-logistica` | Supabase Edge Function | Enemeop v11 / Fábrica — não existe | Cotação detalhada de frete | Produção | **confirmado** só Enemeop | Não | Enemeop | Enemeop | — |
| `orquestrador` | Supabase Edge Function | Enemeop v15 / Fábrica v6 | Roteamento de eventos | Produção (ambas ACTIVE) | **duplicado, divergente** | Sim | Enemeop v15 mais provável, mas o **orquestrador real de produção parece ser o serviço Render (Node), não esta Edge Function** — não confirmado qual dos dois efetivamente processa tráfego | pendente de decisão arquitetural | Confirmar se a Edge Function `orquestrador` ainda é chamada por algo, ou se é vestígio de uma versão anterior à migração para o serviço Render |
| `leads-enemeop` | Supabase Edge Function | **Só existe no projeto Fábrica** (`ebeapnydeiwuewxatuuw`) | Endpoint interno de leads por canal | Produção | **legado / pendente de validação** | Não (função única, mas no projeto errado) | Fábrica (hoje) | Deveria estar no projeto Enemeop | Confirmar quem chama este endpoint hoje antes de mover/desligar |
| `conversas-enemeop` | Supabase Edge Function | **Só existe no projeto Fábrica** | Serve `app/(dashboard)/dashboard/conversas/page.tsx` do frontend (confirmado por leitura direta do código — `page.tsx:48` chama `https://ebeapnydeiwuewxatuuw.supabase.co/functions/v1/conversas-enemeop`) | Produção | **confirmado ativo, no projeto errado** | Não (função única) | **Fábrica — e é usada de fato pelo frontend hoje** | Deveria estar no projeto Enemeop | Mover exige testar a página `/dashboard/conversas` após a mudança |
| `webhook-whatsapp-proxy`, `renovar-token-instagram`, `atualizar-nomes-leads`, `varredura-leads`, `marketing-scraping` | Supabase Edge Function | **Só existem no projeto Fábrica** | Diversos (ponte sistema antigo, renovação de token IG, scraping de leads) | Produção (todas ACTIVE) | **legado / pendente de validação** | Não (função única cada, mas no projeto errado) | Fábrica (hoje) | Deveriam estar no projeto Enemeop | Confirmar uso real de cada uma antes de mover — `renovar-token-instagram` em particular pode ser crítica para o prazo de renovação de 2026-08-01 citado no `CLAUDE.md` |
| `captura-qr` | Supabase Edge Function | Só existe no projeto Enemeop | Provável integração com QR de sessão WhatsApp/Evolution | Produção | **pendente de validação** | Não | Enemeop | Enemeop | **Código-fonte não encontrado em nenhum dos dois repositórios Git** — função existe deployada mas não versionada. Recuperar o código-fonte antes de qualquer decisão |
| `webhook-mercadopago` | Supabase Edge Function | Só existe no projeto Enemeop | Webhook Mercado Pago | Produção | **pendente de validação** | Não | Enemeop | Enemeop | Código-fonte também não encontrado nos repositórios Git — mesmo achado do `captura-qr` |
| Tabela `leads` | Postgres (Supabase) | Enemeop: 113 linhas / Fábrica: 633 linhas | CRM de leads | Produção (as duas populadas) | **divergente** | Sim | **Não determinável sem investigação adicional** — contagens muito diferentes sugerem histórico de escrita real em ambos os projetos, não uma cópia estática | A decidir | Investigar se as 633 linhas da Fábrica incluem leads de outros contextos/testes ou são genuinamente leads da Enemeop não sincronizados |
| Tabela `conversas` | Postgres (Supabase) | Enemeop: 27 linhas, **RLS desabilitado** / Fábrica: 121 linhas, RLS habilitado | Histórico de conversa | Produção (as duas populadas) | **divergente, uma delas insegura** | Sim | Fábrica parece receber mais escrita real (121 > 27) e é a que o frontend efetivamente lê (via `conversas-enemeop`) | A decidir | Ver `docs/RLS_SECURITY_PLAN.md` para a cópia insegura (Enemeop) |
| Tabela `funcao_configs` | Postgres (Supabase) | Enemeop: 2 linhas, RLS desabilitado / Fábrica: 9 linhas, RLS habilitado | Config chave-valor lida por `_shared/instagram.ts`, `_shared/anthropic.ts`, `webhook-whatsapp`, `webhook-meta` (todas via service_role) | Produção | **divergente, uma delas insegura** | Sim | Não determinado qual cópia as funções realmente leem em produção — depende de qual projeto Supabase cada versão deployada usa | A decidir | Confirmar `SUPABASE_URL` configurada em cada função deployada |
| Tabela `catalogo_produtos` | Postgres (Supabase) | Enemeop: 40 linhas / Fábrica: 62 linhas | Catálogo com foto real | Produção | **divergente** | Sim | Não determinado | A decidir | Comparar conteúdo antes de decidir qual descartar |
| Tabela `workspace_credentials` | Postgres (Supabase) | Enemeop: 5 linhas, **RLS desabilitado** / Fábrica: 0 linhas, RLS habilitado | Credenciais criptografadas por workspace | Produção | **divergente, uma delas crítica** | Sim | Enemeop é a que tem dado real (5 linhas) | A decidir — mas urgente corrigir RLS na cópia Enemeop independente de qual for a definitiva | Ver `docs/RLS_SECURITY_PLAN.md` |
| Tabela `qr_temp` | Postgres (Supabase) | Só existe no projeto Enemeop, 4390 linhas, **RLS desabilitado** | Provável armazenamento de QR code (base64) de sessão | Produção | **pendente de validação** | Não | Enemeop | Enemeop | Nenhum código-fonte encontrado que leia/grave esta tabela (mesmo achado do `captura-qr`) — confirmar antes de definir política de RLS final |
| `pedidos` | Postgres (Supabase) | Só existe no projeto Enemeop | Pedidos de venda | Produção | **confirmado, com drift de schema** | Não | Enemeop | Enemeop | Ver `docs/DATABASE_SCHEMA_DRIFT.md` |
| Render — orquestrador | Render | Serviço Node (`orchestrator/`) | Processa fila de eventos, gera resposta da Flora | Produção | **confirmado** | Não | Render | Render | Sem acesso a API/painel Render nesta auditoria — variáveis de ambiente não confirmadas |
| Render — Evolution API | Render | `enemeop-evolution` | Sessão WhatsApp (relação com Z-API não totalmente clara — z-API é um serviço de terceiro que já abstrai a sessão; presença de um serviço Evolution próprio sugere uma tentativa anterior, ver decisão histórica "Evolution/Baileys descartados" no `CLAUDE.md`) | **pendente de validação** | **legado, possível** | Não | — | A confirmar se ainda está em uso ou é resíduo da tentativa Evolution/Baileys já descartada | Confirmar se este serviço Render ainda recebe tráfego antes de qualquer decisão sobre a connection string exposta |
| Vercel — frontend Enemeop | Vercel | Projeto `enemeop-flores` | Hospeda o dashboard Next.js | Produção | **confirmado** | Não | Vercel | Vercel | MCP Vercel conectado à conta errada — não foi possível confirmar env vars via ferramenta |
| Z-API | Z-API (terceiro) | Instância WhatsApp Enemeop | Canal WhatsApp | Produção | **confirmado** | Não | Z-API | Z-API | Confirmar, junto à rotação de token (`CREDENTIAL_ROTATION_PLAN.md`), qual instância está de fato ativa |
| Cielo | Cielo (terceiro) | Merchant `1017389788` / Link de Pagamento `2897449769` | Pagamento | Produção | **confirmado** | Não | Cielo | Cielo | — |
| WordPress/WooCommerce | HostGator (terceiro) | `www.enemeopflores.com.br` | Catálogo ao vivo (scraping) | Produção | **confirmado** | Não | WordPress | WordPress | — |
| Meta App | Meta for Developers | App "enemeopflores" | Webhook Instagram/Messenger | Produção | **pendente de validação** | — | — | — | **Confirmar no painel qual URL de webhook está cadastrada** — é a peça que resolve a maior parte das dúvidas "fonte de verdade provável" desta tabela |

## Leitura recomendada desta tabela

A causa raiz da maioria das divergências parece ser: a aplicação Enemeop
foi originalmente desenvolvida/deployada usando o projeto Supabase da
própria Fábrica (`ebeapnydeiwuewxatuuw`), e em algum momento (a partir de
`2026-06-` aproximadamente, quando o projeto `gftnjvdvzgjkhwxnxnwl` foi
criado — `created_at: 2026-05-29`) migrou para um projeto dedicado, sem
que a migração de dados/funções fosse completada ou o projeto antigo
desativado. Isso é uma hipótese baseada em evidência circunstancial
(datas de criação, padrão de nomes, contagens de linha), não uma
confirmação — não deve ser tratada como fato até validação humana.
