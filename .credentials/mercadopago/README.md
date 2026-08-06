# Credenciais Mercado Pago — Enemeop Flores (Flora)

> **NUNCA commitar os arquivos `.env` / `contas-teste.env` desta pasta.** Apenas este README é versionado (`.gitignore` raiz já bloqueia `.credentials/**` exceto README.md).

## Aplicação Mercado Pago usada pela Flora

- Nome: **loja-nova-01**
- Número da aplicação: `1373323659024614`
- Painel: https://www.mercadopago.com.br/developers/panel/app/1373323659024614
- Confirmado como a app de produção real (única com "Qualidade da integração: Próximo do ideal" — indicador só disponível para quem processa pagamentos reais ativamente; a outra app da conta, `1914703277326662`, mostra "Ative as credenciais de produção" — nunca foi ativada para produção).
- Credenciais de **produção** (`mp_access_token`) ficam em `workspace_credentials` (Supabase, tipo=`financeiro`, chave=`mp_access_token`) — nunca em arquivo local. Ver `_shared/mercadopago.ts`.

## Credenciais de TESTE (sandbox)

Já existiam ativas na aplicação `loja-nova-01` antes desta sessão (não foram criadas agora, só localizadas). Valores reais em `mercadopago-teste.env` (git-ignored).

```env
MERCADO_PAGO_TEST_PUBLIC_KEY=
MERCADO_PAGO_TEST_ACCESS_TOKEN=
```

Renovar/consultar em: Suas integrações → loja-nova-01 → Testes → Credenciais de teste.

## Contas de teste (comprador/vendedor)

Criadas nesta sessão (2026-08-06) via Suas integrações → Contas de teste. Mercado Pago não permite excluir contas de teste — reutilizar sempre as mesmas. IDs e apelidos abaixo (dados não sensíveis); senha e código de verificação ficam só em `mercadopago-teste.env`.

| Papel | Apelido | User ID |
|---|---|---|
| Comprador | Conta Teste Agente IA | 3595156697 |
| Vendedor (usar este) | Conta Teste Agente IA Ven | 3595156707 |
| Vendedor (duplicata acidental — não usar, MP não deixa apagar) | Conta Teste Agente IA Ven | 3595396199 |

Cartões de teste para simular aprovado/recusado/pendente: painel → Testes → Cartões de teste (números padrão do Mercado Pago, sem dado real).
