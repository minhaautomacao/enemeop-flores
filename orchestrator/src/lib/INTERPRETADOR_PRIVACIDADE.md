# Privacidade — camada de interpretação contextual e sua telemetria

Revisão do que é enviado a provedores externos de IA e do que fica
persistido em `funil_interpretacao_eventos`. Ver também
`INTERPRETADOR_PROVEDORES.md` para o que trafega por chamada ao modelo, e
a migration `202608030001_funil_interpretacao_telemetria.sql` (schema
atual, já com RLS, constraints e grants revisados).

## O que vai para o provedor de IA (Groq/Anthropic)

Cada `montarPrompt*`/`configGate*` em `funil.ts` monta o `systemPrompt` a
partir só de: texto fixo de instrução, a pergunta que a Flora acabou de
fazer, e um resumo textual curto do produto/fase em jogo (ex.: nome do
produto e quantidade, nunca CPF/pagamento). O `userMessage` é a mensagem
literal do cliente — que **pode** conter dado pessoal se o próprio cliente
o escrever ali (nome, telefone, endereço, no meio de uma frase como "meu
telefone é 11999998888, pode confirmar?"). Isso é inerente a processar
linguagem natural de um formulário de entrega — o mesmo texto já seria
armazenado no histórico da conversa independentemente desta camada.

**Nunca enviado a nenhum provedor**: CPF, dado de pagamento/cartão, token/
credencial, `linkPagamento`, `paymentId`, senha ou qualquer segredo do
sistema — nenhum desses campos existe nos prompts montados (auditável
diretamente nas funções `montarPrompt*`/`configGate*` de `funil.ts`, que
nunca leem `linkPagamento`/`paymentId`/`pedidoId` pra dentro do prompt).

## O que fica em `funil_interpretacao_eventos` (schema atual)

O schema foi desenhado por minimização deliberada — **a tabela nunca
armazena o texto literal da mensagem do cliente nem o estado bruto do
pedido**. Cada evento grava só: `conversa_id`, `gate`, `fase_anterior`,
`fase_posterior`, `intencao_primaria`, `intencoes_secundarias`,
`confianca`, `precisa_esclarecimento`, `campos_alterados` (nomes de
campo, nunca valores), `avancou`, `motivo` (rótulo curto e fixo, ex.:
`'confirmou'`, `'cancelamento_pendente_confirmacao'` — nunca texto do
cliente nem frase gerada por IA), `tentativa_numero`, `fallback_acionado`,
`duracao_ms` e `criado_em`.

Não existem mais as colunas `mensagem_recebida`, `ultima_pergunta_texto`,
`estado_antes` nem `estado_depois` que uma versão anterior deste desenho
chegou a propor — foram removidas do schema antes da aplicação da
migration, exatamente para eliminar o risco de PII incidental que elas
representavam. O diagnóstico completo (`intencao_primaria`,
`intencoes_secundarias`, `confianca`, `precisa_esclarecimento`,
`campos_alterados`, `motivo`, `fallback_acionado`, `tentativa_numero`) é
gerado dentro de `funil.ts` (campo `ResultadoEtapa.diagnosticoInterpretacao`,
tipo `DiagnosticoInterpretacao`) e repassado tal qual pelos 4 canais reais
via `eventoDoResultado()` — nenhum canal lê `estado.dados` bruto pra
montar o evento de telemetria.

## Retenção e acesso

- RLS **habilitada**, sem nenhuma política para `anon`/`authenticated` —
  essas duas roles não têm nenhum privilégio na tabela nem na sequência
  da coluna identity (`REVOKE` explícito de ambos, ver migration). Só
  `service_role` tem `INSERT`/`SELECT` na tabela e `USAGE`/`SELECT` na
  sequência, via grants explícitos.
- **Retenção**: nenhuma política de expiração automática foi criada ainda
  — a tabela cresce indefinidamente até uma decisão explícita (job de
  limpeza por idade, usando o índice dedicado em `criado_em`). Como
  `motivo`/`gate`/nomes de campo são metadados de baixo risco (nunca
  texto do cliente), a urgência é menor do que seria com a versão anterior
  do schema, mas a recomendação de definir uma janela (ex.: 90 dias)
  antes de qualquer canal real continua valendo — ainda não implementado.
- **Acesso**: restrito à `service_role` (bypass de RLS por padrão no
  Supabase) — nunca lido/gravado pelo cliente final nem pelo dashboard.

## Recomendação antes do rollout em canal real (não obrigatória para o teste interno)

1. Definir e implementar uma política de retenção (job de limpeza ou
   `TTL`) para `funil_interpretacao_eventos`, usando
   `idx_funil_interpretacao_eventos_criado_em`.
2. Nenhuma ação de mascaramento de texto é necessária (o schema já não
   armazena texto livre do cliente).
