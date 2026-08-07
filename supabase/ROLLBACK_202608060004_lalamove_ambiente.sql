-- ROLLBACK de 202608060004_lalamove_ambiente.sql
--
-- NÃO fica em supabase/migrations/ de propósito: um `supabase db push`
-- futuro só aplica arquivos dentro de migrations/, então este rollback
-- nunca é executado automaticamente por engano — só manualmente, se e
-- quando alguém decidir reverter.
--
-- Efeitos: (1) remove o trigger e a função de imutabilidade de
-- pedidos.lalamove_ambiente e a própria coluna/constraint; (2) remove o
-- hardening de frete_ambiente (constraint de valores aceitos e a garantia
-- de par com frete_transportadora='Lalamove').
--
-- SEGURO SÓ SE nenhuma linha real já tiver lalamove_ambiente='teste' (do
-- contrário perde a informação de que aquele pedido não usou a Lalamove de
-- produção). Rode antes de aplicar:
--
--   select count(*) from public.pedidos where lalamove_ambiente = 'teste';
--
-- Se retornar > 0, pare e decida manualmente antes de reverter.

drop trigger if exists pedidos_lalamove_ambiente_imutavel_trigger on public.pedidos;
drop function if exists public.pedidos_lalamove_ambiente_imutavel();

alter table public.pedidos drop constraint if exists pedidos_frete_lalamove_tem_ambiente_check;
alter table public.pedidos drop constraint if exists pedidos_frete_ambiente_check;

alter table public.pedidos drop constraint if exists pedidos_lalamove_ambiente_check;
alter table public.pedidos drop column if exists lalamove_ambiente;
