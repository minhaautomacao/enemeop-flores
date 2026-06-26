# Credenciais Cielo — Enemeop Flores

## Dados do Estabelecimento

| Campo | Valor |
|---|---|
| Razão social | ENEMEOP COMERCIO DE FLORES E PRESENTES LTDA |
| EC (maquininha) | 1017389788 |
| EC (Link de Pagamento) | 2897449769 |
| CNPJ | 02.231.772/0001-60 |

## API Link de Pagamento (SuperLink)

Solicitar via suporte Cielo: 4002-5472 (SP capital) / 0800 570 8472 (demais)
Email: cieloecommerce@cielo.com.br

| Chave | Valor |
|---|---|
| client_id (Merchant ID) | 429e98c5-43c9-4f9d-954f-890d98c1e865 |
| client_secret (Merchant Key) | (enviado por email para enemeopflores@gmail.com — ver email gerado em 2026-06-18) |

## Como cadastrar no painel da Fábrica

Após receber as credenciais da Cielo, cadastre em `workspace_credentials`:

```sql
INSERT INTO workspace_credentials (workspace_id, tipo, chave, valor, iv, ativo)
VALUES
  ('<workspace_id>', 'cielo', 'client_id',     '<ciphertext>', '<iv>', true),
  ('<workspace_id>', 'cielo', 'client_secret',  '<ciphertext>', '<iv>', true);
```

Os valores devem ser criptografados com AES-256-GCM antes de inserir.
Use o endpoint `/api/credentials/encrypt` do painel da Fábrica.

## Meios de pagamento habilitados

- Cartão de Crédito: Visa, Master, Elo, Amex, Diners, Discover, Aura ✅
- Cartão de Débito: Visa, Master, Elo ✅
- Pix: ✅ HABILITADO (2026-06-18)

## URLs de notificação (configurar após integração)

| Campo | URL |
|---|---|
| URL de Retorno | https://enemeop-flores-three.vercel.app/pagamento/retorno |
| URL de Notificação | https://gftnjvdvzgjkhwxnxnwl.supabase.co/functions/v1/webhook-cielo |
| URL de Mudança de Status | https://gftnjvdvzgjkhwxnxnwl.supabase.co/functions/v1/webhook-cielo |
