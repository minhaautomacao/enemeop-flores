# Bloqueio externo — `enemeop-whatsapp-bridge`

Serviço Render referenciado em `render.yaml` (raiz do repositório Fábrica,
`AI-SaaS-Factory-Fabrica-de-Saas`), nome `enemeop-whatsapp-bridge`,
`rootDir: whatsapp-bridge`.

**O diretório `whatsapp-bridge/` não existe em nenhum repositório Git**
(nem Fábrica, nem Enemeop). Diferente de `captura-qr` e
`webhook-mercadopago`, este código não pôde ser recuperado via Supabase
MCP porque não é uma Edge Function — é um serviço Node hospedado
diretamente no Render, sem ferramenta de acesso disponível nesta sessão.

**Não é possível confirmar se este serviço está de fato deployado e ativo
no Render hoje** — a única evidência é a definição no `render.yaml`, que
pode ou não ter sido efetivamente aplicada no painel Render.

## Bloqueio

Recuperação do código-fonte, se existir, depende de acesso ao painel
Render (`dashboard.render.com`) — ação humana, fora do escopo desta
reorganização.

## Isso não impede a conclusão da reorganização

O `render.yaml` da Fábrica que referencia este serviço **não foi copiado**
para o Enemeop nesta etapa — não há código correspondente para trazer. Se
o serviço existir e estiver ativo, ele continua rodando a partir da
configuração já aplicada no Render, independente desta reorganização de
repositórios Git.

## Pendência registrada

Ver `docs/KNOWN_ISSUES.md` — confirmar no painel Render se o serviço está
ativo; se estiver, recuperar o código-fonte manualmente (acesso ao
console/deploy do Render) e versioná-lo em `enemeop-flores/` numa etapa
futura.
