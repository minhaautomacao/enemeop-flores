-- Separação de ambiente teste/produção da Lalamove — mesmo espírito de
-- 202608060003_mercadopago_ambiente.sql. Hoje o sistema só sabe usar a
-- credencial de produção da Lalamove (lalamove_key/lalamove_secret); esta
-- migration prepara o schema para o pedido carregar, de forma imutável,
-- qual ambiente (produção ou teste) foi usado para cotar/entregar. Nenhuma
-- credencial de teste é usada por causa desta migration — só o código
-- (supabase/functions/_shared/lalamove*.ts) passa a decidir isso.
--
-- Aditiva apenas: nenhuma coluna/constraint/valor existente é removido.
-- Todas as linhas existentes recebem 'producao' por default — são, de
-- fato, todas de produção (não existia outro ambiente possível até agora).

-- 1) pedidos.lalamove_ambiente — DERIVADO de frete_ambiente (o ambiente
--    REAL observado na cotação, nunca uma intenção declarada em paralelo)
--    no momento da criação do pedido (ver
--    _shared/lalamove-config.ts::derivarLalamoveAmbiente e
--    _shared/pedido-repositorio.ts::criarOuReusarPedido), nunca mais
--    alterado depois.
alter table public.pedidos add column if not exists lalamove_ambiente text not null default 'producao';
alter table public.pedidos drop constraint if exists pedidos_lalamove_ambiente_check;
alter table public.pedidos add constraint pedidos_lalamove_ambiente_check
  check (lalamove_ambiente in ('producao', 'teste'));

comment on column public.pedidos.lalamove_ambiente is 'Ambiente da Lalamove usado para cotar/entregar este pedido — derivado de frete_ambiente na criação, imutável depois (ver trigger pedidos_lalamove_ambiente_imutavel_trigger). Semântica diferente de mp_ambiente (ambiente do pagamento): um pedido real pode ter frete por outra transportadora (ex. Melhor Envio) e lalamove_ambiente fica ''producao'' neutro, sem que isso seja uma divergência.';

-- Requisito "um pedido de teste nunca pode virar produção depois" (e
-- vice-versa) garantido pelo SCHEMA — trigger dedicado (semântica diferente
-- de pedidos_mp_ambiente_imutavel, não reaproveitada).
create or replace function public.pedidos_lalamove_ambiente_imutavel()
returns trigger as $$
begin
  if new.lalamove_ambiente is distinct from old.lalamove_ambiente then
    raise exception 'pedidos.lalamove_ambiente é imutável (tentativa de mudar de % para %, pedido %)', old.lalamove_ambiente, new.lalamove_ambiente, old.id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists pedidos_lalamove_ambiente_imutavel_trigger on public.pedidos;
create trigger pedidos_lalamove_ambiente_imutavel_trigger
  before update on public.pedidos
  for each row execute function public.pedidos_lalamove_ambiente_imutavel();

-- 2) Hardening de frete_ambiente (coluna já existente desde
--    202607200001_lalamove_producao.sql, sempre foi `text` livre, sem
--    constraint nenhuma) — os únicos dois valores que o código já escreve
--    ali são os literais do tipo LalamoveAmbiente ('sandbox'/'production').
alter table public.pedidos drop constraint if exists pedidos_frete_ambiente_check;
alter table public.pedidos add constraint pedidos_frete_ambiente_check
  check (frete_ambiente is null or frete_ambiente in ('sandbox', 'production'));

-- 3) Garantia que fecha a derivação do item 1: toda cotação cuja
--    transportadora vencedora foi a Lalamove tem que ter um frete_ambiente
--    registrado (nunca null) — sem isso, derivarLalamoveAmbiente não teria
--    como confirmar o ambiente real observado na cotação.
--
--    NOT VALID de propósito: 4 dos 5 pedidos reais já existentes têm
--    frete_transportadora='Lalamove' e frete_ambiente nulo (frete_ambiente
--    nunca foi consistentemente preenchido antes de agora) — validar contra
--    o histórico faria esta migration falhar. NOT VALID aplica a regra só
--    para INSERT/UPDATE daqui pra frente (exatamente o que importa: nenhum
--    pedido NOVO pode ficar nesse estado), sem exigir alterar nenhum dado
--    de pedido real já existente. derivarLalamoveAmbiente já trata
--    frete_ambiente nulo com segurança (cai em 'producao'), então os 5
--    pedidos históricos continuam corretos mesmo sem a constraint valer
--    retroativamente pra eles.
alter table public.pedidos drop constraint if exists pedidos_frete_lalamove_tem_ambiente_check;
alter table public.pedidos add constraint pedidos_frete_lalamove_tem_ambiente_check
  check (frete_transportadora is distinct from 'Lalamove' or frete_ambiente is not null) not valid;
