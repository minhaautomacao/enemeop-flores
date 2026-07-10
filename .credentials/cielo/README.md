# Credenciais Cielo — Enemeop Flores

> **NUNCA commitar o arquivo `.env` desta pasta.** Apenas este README é versionado.

Crie o arquivo `.env` local aqui com os valores reais.

Dados do estabelecimento e onde obter cada credencial: ver
`.credentials/cielo.md` (raiz deste repositório) — **esse arquivo está
hoje versionado no Git e contém o `client_id`/Merchant ID em texto
puro**, achado já registrado em `docs/SECURITY_INCIDENTS.md`. Ainda não
foi sanitizado nesta etapa (aguardando decisão de rotação, ver
`docs/CREDENTIAL_ROTATION_PLAN.md`).

```env
CIELO_MERCHANT_ID=
CIELO_CLIENT_ID=
CIELO_CLIENT_SECRET=
```

`CIELO_CLIENT_SECRET` (Merchant Key) é enviado por e-mail pela Cielo após
solicitação via suporte — nunca fica disponível em nenhum painel, precisa
ser copiado do e-mail recebido e guardado só aqui.
