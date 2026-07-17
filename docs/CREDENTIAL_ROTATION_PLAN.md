# Plano de Rotação de Credenciais

> Nenhuma rotação foi executada. Este documento é o plano — execução
> depende de login/painel/MFA em cada provedor, portanto é ação humana.
> Ver incidentes correspondentes em `docs/SECURITY_INCIDENTS.md`.

## Ordem geral (não trocar a ordem sem motivo)

1. Contenção de RLS
2. Senha administrativa
3. Z-API
4. PostgreSQL / Render / Evolution
5. Meta
6. Cielo
7. Limpeza posterior do histórico Git

A lógica da ordem: primeiro fechar o acesso mais amplo e mais barato de
corrigir (RLS, não depende de coordenação com nenhum outro provedor);
depois credenciais de menor complexidade de rotação (senha); depois
credenciais que exigem coordenar redeploy de função (Z-API, Postgres);
depois Meta (mais complexo — reautenticação de token de página depende de
trocar App Secret primeiro); Cielo por último (menor urgência, é
identificador, não segredo pleno); limpeza de histórico Git só faz
sentido depois que todos os valores expostos já não são mais válidos.

---

### 1. Contenção de RLS

- **Quem executa:** Carlos (login Supabase, projeto `gftnjvdvzgjkhwxnxnwl`)
- **Painel:** supabase.com/dashboard/project/gftnjvdvzgjkhwxnxnwl → SQL
  Editor, ou revisar/aplicar `supabase/migrations/202607100001_security_rls_proposal.sql`
- **Ordem:** antes de tudo — não depende de nenhum outro provedor
- **Risco:** política mal escrita pode bloquear acesso legítimo do
  próprio backend (mitigado: proposta usa `service_role`, que ignora RLS
  por padrão no Supabase)
- **Teste:** consulta com anon key às 4 tabelas deve falhar/retornar
  vazio; chamada das Edge Functions que usam `service_role` deve continuar
  funcionando normalmente
- **Rollback:** `ALTER TABLE ... DISABLE ROW LEVEL SECURITY;` (documentado
  na própria migration proposta)
- **Estado atual:** proposta pronta, não aplicada

### 2. Senha administrativa

- **Quem executa:** Carlos (login Supabase Auth, projeto Enemeop)
- **Painel:** supabase.com/dashboard/project/gftnjvdvzgjkhwxnxnwl →
  Authentication → Users
- **Ordem:** 2º — simples, sem dependência de outro provedor
- **Risco:** baixo — apenas invalida sessões ativas com a senha antiga
- **Teste:** login com senha antiga deve falhar; login com nova senha deve
  funcionar
- **Rollback:** não aplicável (trocar senha não tem rollback técnico —
  se necessário, define-se outra senha nova)
- **Estado atual:** pendente

### 3. Z-API

- **Quem executa:** Carlos (login painel Z-API)
- **Painel:** painel da instância Z-API (z-api.io)
- **Ordem:** 3º — depois de RLS/senha, antes de redeploy de código
- **Risco:** médio — janela de indisponibilidade do canal WhatsApp
  durante a troca se a ordem abaixo não for seguida
- **Passos:** 1) gerar novo token da instância → 2) atualizar
  `.credentials/whatsapp/.env` local → 3) atualizar a variável de
  ambiente na função `webhook-whatsapp` deployada (painel Supabase ou
  CLI) → 4) testar envio real → 5) só então revogar o token antigo
- **Teste:** enviar mensagem de teste via Z-API após o passo 4, antes de
  revogar o token antigo
- **Rollback:** manter o token antigo válido até confirmar que o novo
  funciona (por isso a revogação é o último passo, não o primeiro)
- **Estado atual:** pendente

### 4. PostgreSQL / Render / Evolution

- **Quem executa:** Carlos (login Render e/ou provedor do Postgres)
- **Painel:** dashboard.render.com → serviço `enemeop-evolution`
- **Ordem:** 4º
- **Risco:** médio-alto — se o serviço Evolution ainda estiver em uso
  ativo (não confirmado, ver `INFRASTRUCTURE_MAP.md`), trocar a senha sem
  atualizar a env var no Render antes derruba o serviço
- **Passos:** 1) confirmar primeiro se o serviço Evolution ainda recebe
  tráfego real → 2) gerar nova senha do banco → 3) atualizar env var no
  Render → 4) testar conexão → 5) só então remover o valor hardcoded de
  `orchestrator/render.yaml`
- **Teste:** verificar logs do serviço `enemeop-evolution` após redeploy,
  sem erro de conexão
- **Rollback:** manter senha antiga válida até confirmar a nova
- **Estado atual:** pendente — **depende de confirmar primeiro se o
  serviço ainda está em uso** (ver `INFRASTRUCTURE_MAP.md`, linha Render
  Evolution)

### 5. Meta

- **Quem executa:** Carlos (login Meta for Developers)
- **Painel:** developers.facebook.com → App "enemeopflores"
- **Ordem:** 5º — mais complexo, requer coordenação
- **Risco:** alto — trocar o App Secret invalida tokens de acesso
  emitidos, incluindo o token de página/IG usado pelo webhook em produção;
  o webhook do Instagram Direct pararia de responder até reautenticar
- **Passos:** 1) regenerar App Secret → 2) atualizar
  `META_APP_SECRET`/`META_VERIFY_TOKEN` nas Edge Functions deployadas →
  3) reautenticar e gerar novo token de página/usuário → 4) atualizar
  `META_ACCESS_TOKEN`/`META_PAGE_ACCESS_TOKEN` → 5) testar DM real
  (reproduzir o teste da missão M002) antes de considerar concluído
- **Teste:** enviar/receber DM de teste no Instagram Direct e mensagem no
  Messenger após a rotação
- **Rollback:** não há — App Secret não é reversível; se algo quebrar,
  precisa gerar novo token novamente, não voltar ao antigo (Meta invalida
  o anterior)
- **Estado atual:** pendente — recomendo agendar uma janela específica
  para este item por causa do risco de indisponibilidade do canal

### 6. Cielo

- **Quem executa:** Carlos (suporte Cielo, 4002-5472 / 0800 570 8472)
- **Painel:** suporte via telefone/e-mail (Cielo não expõe self-service
  para isso)
- **Ordem:** 6º — menor urgência
- **Risco:** baixo — `client_id` sozinho não completa transação
- **Passos:** contatar suporte Cielo, avaliar se reemissão é recomendada
- **Teste:** confirmar novo Merchant ID funciona no ambiente de teste
  antes de trocar em produção
- **Estado atual:** pendente, baixa prioridade

### 7. Limpeza posterior do histórico Git

- **Quem executa:** Carlos, com autorização explícita e separada
- **Ordem:** por último, só depois de 1-6 concluídos
- **Risco:** alto se feito antes da rotação (não resolve nada — o valor
  exposto continua válido em qualquer clone já baixado) e alto
  operacionalmente mesmo depois (force-push, necessidade de todo clone
  re-sincronizar)
- **Teste:** `git log -S"<padrão>"` não deve mais encontrar o valor em
  nenhuma branch após a limpeza
- **Rollback:** nenhum — reescrita de histórico não é reversível sem um
  backup completo do repositório antes da operação
- **Estado atual:** não iniciado, não planejado em detalhe — decisão
  explícita necessária antes de qualquer execução, conforme já registrado
  em `docs/SECURITY_INCIDENTS.md`
