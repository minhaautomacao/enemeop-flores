-- Aditiva. GO-LIVE Parte 1 "idempotência real do pedido e da preference".
--
-- Problema confirmado: criarPedidoProvisorio gerava um UUID novo a cada
-- chamada sem nenhuma trava no banco contra duas aprovações concorrentes da
-- mesma jornada (ex.: reentrega do webhook Z-API/Meta pra mesma mensagem
-- "sim" antes da primeira chamada terminar de salvar a conversa) — cada uma
-- criaria seu próprio pedido e sua própria preference. jornada_key resolve
-- isso com um índice único parcial: a segunda tentativa da mesma jornada
-- colide (23505) e o código reaproveita o pedido já criado pela primeira
-- (ver _shared/pedido-repositorio.ts).
--
-- mp_preference_status é o campo de reivindicação atômica da criação da
-- preference (null -> 'criando' -> 'criado'), e também o estado ambíguo
-- permanente ('criando' sem nunca virar 'criado') usado quando a preference
-- FOI criada no Mercado Pago mas a persistência do id/link falhou — nesse
-- caso nunca se tenta de novo sozinho (evitaria uma segunda cobrança real),
-- só reconciliação manual protegida (ver função pagamento-reconciliar).

alter table public.pedidos add column if not exists jornada_key text;

create unique index if not exists pedidos_jornada_key_idx
  on public.pedidos (jornada_key)
  where jornada_key is not null;

alter table public.pedidos add column if not exists mp_preference_status text;

alter table public.pedidos drop constraint if exists pedidos_mp_preference_status_check;
alter table public.pedidos add constraint pedidos_mp_preference_status_check
  check (mp_preference_status is null or mp_preference_status in ('criando', 'criado', 'ambiguo'));

comment on column public.pedidos.jornada_key is 'Chave estável da jornada comercial (conversa_id + marca de início de jornada) — único quando presente, garante que duas aprovações concorrentes da mesma jornada nunca criem dois pedidos.';
comment on column public.pedidos.mp_preference_status is 'Reivindicação atômica da criação da preference no Mercado Pago: null (nunca tentado) -> criando (reivindicado, chamada em andamento ou travada em estado ambíguo) -> criado (id/link persistidos com sucesso). Nunca volta de "criando" para null depois que a chamada externa ao Mercado Pago teve sucesso.';
