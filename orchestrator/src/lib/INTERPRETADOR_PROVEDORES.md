# Provedores da camada de interpretação contextual

Documento de referência para `ia-interprete.ts` (Node) e
`supabase/functions/_shared/interpretador-chamador.ts` (Deno) — a peça que
implementa `DependenciasFunil.interpretarIntencao` em `funil.ts`.

## Substituição de provedor

Nenhum código precisa mudar para trocar de provedor — é 100% configuração:

| Variável / config | Efeito |
|---|---|
| `GROQ_API_KEY` presente | Groq (`llama-3.1-8b-instant`) é tentado primeiro — rápido e gratuito |
| `GROQ_API_KEY` ausente | Pula direto para Anthropic |
| `ANTHROPIC_API_KEY` presente | Usado como fallback quando Groq falha ou está ausente |
| Nenhuma das duas presente | `interpretarIntencao` nunca é chamado com sucesso — todo gate cai no caminho determinístico, comportamento idêntico a antes desta camada |

No lado Deno (Edge Functions), `_shared/anthropic.ts` também aceita as
mesmas chaves via uma tabela de configuração no banco (`getConfigDB`), não
só variável de ambiente — permite trocar credencial sem redeploy.

Trocar de modelo dentro do mesmo provedor (ex.: outro modelo Groq/Anthropic)
é uma troca de string literal em `callGroq`/`callAnthropic` (Node) ou
`callClaude` (Deno) — nenhum outro ponto do funil depende do nome do modelo.

## Timeout

Fixo em 3000ms por chamada (`interpretarComFallback` em `funil.ts`), via
`Promise.race` contra um timer — nunca espera além disso, mesmo que o
provedor esteja processando. Resultado do timeout é `null`, tratado
exatamente como indisponibilidade total.

## Retry e fallback entre provedores

1. Groq: até 2 tentativas, só re-tenta em erro `429` (rate limit) explícito,
   com 1.5s de espera entre tentativas. Qualquer outro erro (401, 500,
   timeout de rede) desiste imediatamente e cai para Anthropic.
2. Anthropic: 1 tentativa, sem retry — se falhar, o chamador devolve `null`.
3. Nenhum provedor disponível/configurado: lança uma exceção interna que o
   wrapper (`criarChamadorInterpretacao`) captura e converte em `null` —
   nunca escapa para o funil.

## Indisponibilidade total

`null` (por timeout, exceção, ausência de credencial, ou JSON inválido
depois de recebido — ver `validarRespostaInterpretacao` em `funil.ts`) é
tratado por **todo** gate exatamente como "sem sinal do interpretador":
cai no caminho determinístico que já existia antes desta camada (listas de
frases, regex, `pareceConfirmacao`/`pareceNegacao`). O funil nunca trava,
nunca lança erro ao cliente, e nunca fica pior do que estava antes do
rollout — a pior consequência de uma indisponibilidade total é perder a
cobertura de formulações inéditas (a Flora volta a só reconhecer frases já
cadastradas), nunca uma falha visível.

## Limites conhecidos

- **Tamanho do prompt**: o `systemPrompt` de cada gate é fixo e pequeno
  (poucas linhas de instrução + contexto mínimo do estado) — nunca inclui o
  histórico completo da conversa, só a pergunta pendente, a fase e um
  resumo curto dos dados já coletados. Risco de estourar o limite de
  contexto do modelo é desprezível.
- **`max_tokens`**: 512 (Node) / 512 (Deno, via `callClaude(..., 512)`
  passado por `interpretador-chamador.ts`) — suficiente para o JSON de
  `ResultadoInterpretacao`, que é sempre curto.
- **Rate limit do Groq (grátis)**: mitigado pelo retry de 429 acima: na
  prática, a maioria do tráfego real (respostas "sim"/"não"/nome de produto
  exato) nunca chama o modelo — só mensagens genuinamente ambíguas
  acionam a chamada de rede, reduzindo a chance de esbarrar no limite.
- **Custo**: Groq é gratuito no tier usado; Anthropic (fallback) só é
  chamado quando Groq falhar ou estiver ausente — custo real esperado é
  próximo de zero no caminho normal.

## Privacidade — o que trafega para o provedor

Cada chamada envia: o texto da mensagem do cliente, a pergunta que a Flora
fez por último, a fase da conversa, e um resumo textual mínimo do que já
foi coletado (ex.: nome do produto, se um destinatário já foi informado) —
nunca CPF, nunca dado de pagamento, nunca telefone/endereço completo salvo
que não seja estritamente necessário para desambiguar a pergunta em jogo
(ver cada função `montarPrompt*`/`configGate*` em `funil.ts` para o
conteúdo exato passado a cada gate). Revisão completa de retenção/
anonimização dos dados enviados a provedores externos está pendente — ver
relatório de progresso desta fatia.
