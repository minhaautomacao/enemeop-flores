/**
 * zapi-auth.ts — autenticação do webhook Z-API (GO-LIVE Parte 3).
 *
 * A Z-API não assina nem autentica as chamadas que faz ao nosso webhook —
 * confirmado na documentação oficial (developer.z-api.io): o "Client-Token"
 * documentado ali é só pra chamadas QUE NÓS fazemos à API da Z-API
 * (outbound), nunca um header que a Z-API envia de volta. A única
 * configuração possível do lado da Z-API é a própria URL do webhook — por
 * isso a defesa real é um token secreto embutido nessa URL (?token=...),
 * comparado aqui em tempo constante (via digest SHA-256, tamanho sempre
 * fixo em 32 bytes) pra nunca vazar o segredo por diferença de tempo de
 * resposta.
 *
 * 'sem_segredo_configurado' (mesmo padrão de validarAssinaturaWebhook em
 * mercadopago.ts): até o proprietário configurar ZAPI_WEBHOOK_SECRET E
 * atualizar a URL cadastrada no painel Z-API (nenhuma das duas coisas pode
 * ser feita por este código — são ações fora do repositório), o webhook
 * segue aceitando chamadas sem token, só com aviso alto no log. Depois de
 * configurado, a exigência passa a ser estrita (401 pra ausente/incorreto).
 * Nunca trocar isso por "sempre exigir" sem confirmar que o segredo já foi
 * configurado, senão o canal WhatsApp para de funcionar sem aviso.
 */

export type ResultadoAutenticacaoWebhook = 'valido' | 'invalido' | 'sem_segredo_configurado';

export async function validarTokenWebhook(secretConfigurado: string, tokenRecebido: string): Promise<ResultadoAutenticacaoWebhook> {
  if (!secretConfigurado) return 'sem_segredo_configurado';
  if (!tokenRecebido) return 'invalido';
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(tokenRecebido)),
    crypto.subtle.digest('SHA-256', enc.encode(secretConfigurado)),
  ]);
  const ba = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0 ? 'valido' : 'invalido';
}
