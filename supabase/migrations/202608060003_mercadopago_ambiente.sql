-- Separação de ambiente teste/produção do Mercado Pago — hoje o sistema só
-- sabe usar a credencial de produção (mp_access_token); esta migration
-- prepara o schema para o pedido carregar, de forma imutável, qual
-- ambiente (produção ou teste) foi usado para gerar seu pagamento. Nenhuma
-- credencial de teste é usada por causa desta migration — só o código
-- (supabase/functions/_shared/mercadopago.ts e afins) passa a decidir isso.
--
-- Aditiva apenas: nenhuma coluna/constraint/valor existente é removido.
-- Todas as linhas existentes de pedidos/mercadopago_eventos recebem
-- 'producao' por default — são, de fato, todas de produção (não existia
-- outro ambiente possível até agora).

-- 1) pedidos.mp_ambiente — decidido uma única vez na criação do pedido
--    (ver _shared/pedido-repositorio.ts::criarOuReusarPedido), nunca mais
--    alterado depois.
alter table public.pedidos add column if not exists mp_ambiente text not null default 'producao';
alter table public.pedidos drop constraint if exists pedidos_mp_ambiente_check;
alter table public.pedidos add constraint pedidos_mp_ambiente_check
  check (mp_ambiente in ('producao', 'teste'));

comment on column public.pedidos.mp_ambiente is 'Ambiente do Mercado Pago usado para gerar o pagamento deste pedido — imutável após a criação (ver trigger pedidos_mp_ambiente_imutavel_trigger). Nunca escolhido pelo cliente/navegador, sempre decidido pelo servidor no momento da criação do pedido.';

-- Requisito "um pedido de teste nunca pode virar produção depois" (e
-- vice-versa) garantido pelo SCHEMA, não só por convenção de código —
-- qualquer UPDATE que tente mudar o valor falha explicitamente.
create or replace function public.pedidos_mp_ambiente_imutavel()
returns trigger as $$
begin
  if new.mp_ambiente is distinct from old.mp_ambiente then
    raise exception 'pedidos.mp_ambiente é imutável (tentativa de mudar de % para %, pedido %)', old.mp_ambiente, new.mp_ambiente, old.id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists pedidos_mp_ambiente_imutavel_trigger on public.pedidos;
create trigger pedidos_mp_ambiente_imutavel_trigger
  before update on public.pedidos
  for each row execute function public.pedidos_mp_ambiente_imutavel();

-- 2) mercadopago_eventos.ambiente — payment_id é controlado pelo Mercado
--    Pago, não pelo nosso sistema; sem garantia documental de que nunca
--    colide entre um app de teste e um app de produção. A chave de
--    idempotência passa a incluir o ambiente REALMENTE resolvido pela API
--    (nunca o pedido.mp_ambiente, que pode ser exatamente o campo
--    divergente que a checagem em nucleo.ts existe para detectar).
alter table public.mercadopago_eventos add column if not exists ambiente text not null default 'producao';
alter table public.mercadopago_eventos drop constraint if exists mercadopago_eventos_ambiente_check;
alter table public.mercadopago_eventos add constraint mercadopago_eventos_ambiente_check
  check (ambiente in ('producao', 'teste'));

alter table public.mercadopago_eventos drop constraint if exists mercadopago_eventos_pkey;
alter table public.mercadopago_eventos add constraint mercadopago_eventos_pkey
  primary key (payment_id, status, ambiente);

comment on column public.mercadopago_eventos.ambiente is 'Ambiente que a API do Mercado Pago confirmou para este payment_id (resolverPagamentoEAmbiente, _shared/resolucao-ambiente.ts) — nunca o ambiente gravado no pedido.';
