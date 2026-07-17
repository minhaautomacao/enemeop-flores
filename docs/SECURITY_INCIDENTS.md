# Registro de Incidentes de Segurança

> Nenhum valor real de segredo é registrado neste documento — apenas
> localização, tipo, classificação e status. Ver
> `docs/CREDENTIAL_ROTATION_PLAN.md` para o plano de ação e
> `docs/RLS_SECURITY_PLAN.md` para o incidente de RLS.

## Contexto

Auditoria realizada em 2026-07-10 durante a separação dos repositórios
Fábrica de SaaS / Enemeop Flores encontrou múltiplos segredos reais
versionados em texto puro, em dois repositórios **públicos** no GitHub, e
uma vulnerabilidade de acesso ativa (RLS desabilitado) em produção.

## Incidente 1 — Connection string PostgreSQL exposta

- **Identificação:** `orchestrator/render.yaml`, chaves
  `DATABASE_CONNECTION_URI` e `DATABASE_URL`
- **Data aproximada:** commit `23dd7e5`, 2026-06-09
- **Repositório:** AI-SaaS-Factory-Fabrica-de-Saas (público)
- **Classificação:** S1 — segredo crítico
- **Impacto:** acesso total de leitura/escrita ao banco Postgres do
  serviço `enemeop-evolution` (Render)
- **Contenção realizada:** nenhuma ainda — apenas documentado
- **Rotação necessária:** sim — regenerar senha do banco no provedor
- **Status:** pendente
- **Teste de encerramento:** tentar conectar com a credencial antiga após
  rotação deve falhar; conexão com a nova credencial, configurada via env
  var do Render (não hardcoded), deve funcionar

## Incidente 2 — Tokens Z-API expostos como fallback

- **Identificação:** `supabase/functions/webhook-whatsapp/index.ts`,
  linhas 13-15 (`ZAPI_INSTANCE_ID`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN`)
- **Data aproximada:** commit `8cda1fa`, 2026-06-22
- **Repositório:** AI-SaaS-Factory-Fabrica-de-Saas (público)
- **Classificação:** S1 (token/client token) + S2 (instance id)
- **Impacto:** acesso à instância WhatsApp Business da Enemeop (enviar/ler
  mensagens em nome do número da loja)
- **Contenção realizada:** nenhuma ainda
- **Rotação necessária:** sim — regenerar token da instância no painel Z-API
- **Status:** pendente
- **Teste de encerramento:** enviar mensagem de teste via Z-API após
  rotação e após redeploy da função sem o fallback hardcoded

## Incidente 3 — Senha administrativa em texto puro

- **Identificação:** `INSTRUCOES-PARA-IA-DO-NOTEBOOK.md:184`,
  `SETUP-NOTEBOOK.md:176`
- **Data aproximada:** commits `1d449f6` e `c0a2f07`, 2026-05-31
- **Repositório:** AI-SaaS-Factory-Fabrica-de-Saas (público)
- **Classificação:** S1
- **Impacto:** acesso ao painel administrativo `/login` da aplicação
  Enemeop (senha fraca, formato numérico sequencial)
- **Contenção realizada:** nenhuma ainda. **Nota adicional:** a mesma
  senha foi inadvertidamente exibida, sem máscara, na saída de um comando
  de diagnóstico durante a sessão de auditoria de 2026-07-10 — está
  também presente na transcrição daquela conversa, elevando a urgência
- **Rotação necessária:** sim — trocar senha do usuário admin no Supabase
  Auth do projeto Enemeop
- **Status:** pendente
- **Teste de encerramento:** tentativa de login com a senha antiga deve
  falhar após a troca

## Incidente 4 — Fragmento de token de acesso Meta visível em screenshots

- **Identificação:** `generate-token.png`, `meta-explorer.png`,
  `meta-explorer-2.png`, `graph-explorer.png` (raiz do repositório) —
  campo "Token de acesso" do Explorador da Graph API, visível como pixels,
  não como texto pesquisável
- **Data aproximada:** commits de auto-commit do hook `Stop`, datas
  variadas (não determinadas individualmente por imagem)
- **Repositório:** AI-SaaS-Factory-Fabrica-de-Saas (público)
- **Classificação:** S1 (fragmento de token real, ~30 caracteres visíveis
  de um token que normalmente tem 200+ caracteres — não é o token
  completo, mas é um fragmento real, não um placeholder)
- **Impacto:** por si só, um fragmento não é suficiente para uso indevido
  direto; ainda assim, indica prática de captura de tela de painéis com
  token visível, que deve parar
- **Contenção realizada:** nenhuma ainda — screenshots continuam
  versionadas
- **Rotação necessária:** por precaução, tratar os tokens Meta envolvidos
  como potencialmente comprometidos (mesmo plano do Incidente 5)
- **Status:** pendente
- **Teste de encerramento:** remoção das imagens do versionamento;
  confirmação visual de que nenhum outro PNG do repositório contém
  material sensível antes de decidir sobre os 42 screenshots restantes

## Incidente 5 — App Secrets da Meta em memória local

- **Identificação:** `.claude/memory/credenciais-meta.md` (App Secret,
  Instagram App Secret)
- **Repositório:** não versionado (arquivo local, fora do Git)
- **Classificação:** S1
- **Impacto:** possibilidade de gerar tokens de acesso Meta válidos
- **Contenção realizada:** nenhum push envolvido — risco limitado à
  máquina local
- **Rotação necessária:** recomendado, por estar em texto puro fora de um
  cofre de senhas
- **Status:** pendente
- **Teste de encerramento:** confirmar remoção do valor em texto puro e
  armazenamento em gerenciador de segredos (Bitwarden/1Password, conforme
  `CLAUDE.md`)

## Incidente 6 — Merchant ID Cielo exposto

- **Identificação:** `.credentials/cielo.md` (`client_id`/Merchant ID,
  CNPJ, e-mail real, razão social)
- **Data aproximada:** commits `49d6ebe` → `3f8e56b`, 2026-06-18
- **Repositório:** enemeop-flores (público)
- **Classificação:** S2 (identificador) + S4 (dado empresarial)
- **Impacto:** o `client_id` sozinho não permite transação (falta o
  `client_secret`, nunca commitado) — mas é um identificador exposto
  publicamente, associado a dados empresariais reais
- **Contenção realizada:** nenhuma ainda
- **Rotação necessária:** avaliar com a Cielo se reemissão é necessária
- **Status:** pendente, baixa urgência relativa
- **Teste de encerramento:** confirmar com suporte Cielo se o `client_id`
  exposto representa risco prático

## Incidente 7 — RLS desabilitado em tabelas com dado sensível (produção)

- **Identificação:** projeto Supabase `gftnjvdvzgjkhwxnxnwl` (Enemeop) —
  tabelas `workspace_credentials`, `conversas`, `qr_temp`,
  `funcao_configs` sem Row Level Security
- **Data aproximada:** não determinável a partir de quando o RLS está
  desabilitado (é estado de configuração do banco, não commit)
- **Repositório:** não aplicável — é configuração de infraestrutura, não
  código versionado
- **Classificação:** S1-equivalente — vulnerabilidade ativa, não histórica
- **Impacto:** **qualquer pessoa com a anon key do projeto (pública por
  design, e adicionalmente exposta nos incidentes acima) pode ler/escrever
  livremente via API REST em `workspace_credentials` (blobs de credencial
  criptografados) e `conversas` (histórico de atendimento a clientes) sem
  autenticação**
- **Contenção realizada:** nenhuma — proposta preparada e **não aplicada**
  em `supabase/migrations/202607100001_security_rls_proposal.sql` e
  detalhada em `docs/RLS_SECURITY_PLAN.md`
- **Rotação necessária:** não é rotação, é aplicação de política — mais
  urgente do que qualquer rotação desta lista
- **Status:** pendente de decisão e aplicação humana
- **Teste de encerramento:** consulta com anon key às 4 tabelas deve
  retornar vazio/erro de permissão após aplicação da política

## Incidente 8 — Auto-commit versionando artefatos de sessão

- **Identificação:** hook `Stop` (`scripts/auto-commit-ao-sair.ps1`,
  `git add -A`) versionou 46 screenshots + `snapshot-acoes.md` na raiz do
  repositório da Fábrica, incluindo os 4 do Incidente 4
- **Repositório:** AI-SaaS-Factory-Fabrica-de-Saas (público)
- **Classificação:** S4 (a maioria) / S1 (os 4 do Incidente 4)
- **Impacto:** exposição de artefatos operacionais não destinados a
  versionamento; mecanismo de causa raiz para o Incidente 4
- **Contenção realizada:** hook `Stop` desativado temporariamente na
  Etapa A (`(.claude/settings.json`, `"Stop": []`) — reduz recorrência,
  não remove o que já foi commitado
- **Rotação necessária:** não aplicável
- **Status:** contido parcialmente (recorrência bloqueada); remoção do
  histórico ainda pendente
- **Teste de encerramento:** confirmar que novos ciclos de sessão não
  geram novo auto-commit enquanto o hook estiver desativado

## Incidente 9 — Repositórios públicos no GitHub

- **Identificação:** `AI-SaaS-Factory-Fabrica-de-Saas` e `enemeop-flores`,
  ambos `visibility: PUBLIC` (confirmado via `gh repo view`)
- **Classificação:** agravante estrutural de todos os incidentes acima —
  todo segredo commitado esteve acessível publicamente desde o commit que
  o introduziu
- **Impacto:** amplia o escopo de exposição de "risco teórico" para
  "vazamento ativo, tempo de exposição de 2 a 6 semanas dependendo do item"
- **Contenção realizada:** nenhuma — decisão de tornar os repositórios
  privados é humana, não foi tomada
- **Status:** pendente de decisão
- **Teste de encerramento:** `gh repo view <repo> --json visibility`
  deve retornar `PRIVATE`

## Incidente 10 — App Secret e Instagram App Secret em memória versionada (achado durante a execução final)

- **Identificação:** `.claude/memory/estado-atual.md` (Fábrica) — seção
  "Credenciais Meta obtidas", continha App Secret e Instagram App Secret
  reais em texto puro. **Diferente do Incidente 5** (que é sobre um
  arquivo local não versionado) — este arquivo **estava rastreado no
  Git**, não foi pego pelas varreduras anteriores porque os padrões de
  busca usados (JWT, connection string, prefixo `EAA`) não cobrem um
  hash hexadecimal de 32 caracteres
- **Data aproximada:** commit `6a99daa`, 2026-05-23 — a exposição mais
  antiga encontrada em toda a auditoria (~48 dias em repositório público
  até a contenção)
- **Repositório:** AI-SaaS-Factory-Fabrica-de-Saas (público)
- **Classificação:** S1
- **Impacto:** mesmo impacto do Incidente 5 (geração de tokens de acesso
  Meta válidos), mas com exposição pública confirmada, não só local
- **Contenção realizada:** o bloco inteiro com o conteúdo específico da
  Enemeop (incluindo as duas credenciais) foi removido do arquivo durante
  a execução final da reorganização (2026-07-10) — arquivo passou a
  conter só o protocolo genérico da Fábrica
- **Rotação necessária:** sim — mesmo plano do Incidente 5, com urgência
  maior pelo tempo de exposição
- **Status:** conteúdo removido da árvore de trabalho; **permanece no
  histórico Git** até rotação + limpeza de histórico (não executadas)
- **Teste de encerramento:** mesmo do Incidente 5 — confirmar rotação no
  painel Meta for Developers
