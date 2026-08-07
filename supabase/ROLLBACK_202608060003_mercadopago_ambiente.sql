-- ROLLBACK de 202608060003_mercadopago_ambiente.sql
--
-- NÃO fica em supabase/migrations/ de propósito: um `supabase db push`
-- futuro só aplica arquivos dentro de migrations/, então este rollback
-- nunca é executado automaticamente por engano — só manualmente, se e
-- quando alguém decidir reverter.
--
-- Efeitos: (1) remove o trigger e a função de imutabilidade de
-- pedidos.mp_ambiente e a própria coluna/constraint; (2) restaura
-- mercadopago_eventos.pkey para (payment_id, status) e remove a coluna
-- ambiente/constraint.
--
-- SEGURO SÓ SE nenhuma linha real já tiver mp_ambiente='teste' (do
-- contrário perde a informação de que aquele pedido não é de produção) e
-- nenhuma linha de mercadopago_eventos tiver ambiente='teste' com a mesma
-- combinação (payment_id, status) de uma linha 'producao' (o que causaria
-- conflito ao restaurar a PK de 2 colunas). Rode antes de aplicar:
--
--   select count(*) from public.pedidos where mp_ambiente = 'teste';
--   select payment_id, status, count(*) from public.mercadopago_eventos
--     group by payment_id, status having count(*) > 1;
--
-- Se qualquer uma retornar > 0, pare e decida manualmente antes de reverter.

drop trigger if exists pedidos_mp_ambiente_imutavel_trigger on public.pedidos;
drop function if exists public.pedidos_mp_ambiente_imutavel();

alter table public.mercadopago_eventos drop constraint if exists mercadopago_eventos_pkey;
alter table public.mercadopago_eventos add constraint mercadopago_eventos_pkey
  primary key (payment_id, status);
alter table public.mercadopago_eventos drop constraint if exists mercadopago_eventos_ambiente_check;
alter table public.mercadopago_eventos drop column if exists ambiente;

alter table public.pedidos drop constraint if exists pedidos_mp_ambiente_check;
alter table public.pedidos drop column if exists mp_ambiente;
