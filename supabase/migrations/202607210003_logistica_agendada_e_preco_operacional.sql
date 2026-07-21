-- Aditiva apenas: nenhuma coluna/constraint existente é removida. Cobre a
-- cauda da Parte 3 (recotação pós-pagamento com limite operacional) e a
-- Parte 5 (nunca chamar motorista fora do horário) da correção de
-- reinício/formulário/horário.

-- 1) Preço operacional final — separado do preço cotado ao cliente
--    (frete_preco_real, travado no checkout e nunca cobrado de novo). Quando
--    a cotação expira e precisa ser refeita antes de criar a corrida, este
--    campo registra o custo operacional realmente usado (pode divergir do
--    original dentro do limite configurado — a loja absorve a diferença; ver
--    _shared/logistica-processamento.ts).
alter table pedidos add column if not exists frete_preco_operacional_final numeric;

-- 2) Logística agendada — pagamento aprovado fora do horário marca o pedido
--    como pago e envia pra produção normalmente, mas NUNCA chama o motorista
--    (POST /v3/orders) na hora: agenda a criação da corrida pro próximo
--    horário comercial. 'agendada' é um estado novo, nunca retriável pela
--    função de retry manual/logistica-retry (só o job agendado processa).
alter table pedidos drop constraint if exists pedidos_status_logistica_check;
alter table pedidos add constraint pedidos_status_logistica_check
  check (status_logistica is null or status_logistica in (
    'pendente', 'criada', 'erro_logistica', 'revisao_logistica', 'agendada'
  ));

-- logistica_executar_em: quando a corrida agendada deve ser criada (próximo
-- horário comercial no momento do pagamento). Null pra todo pedido que não
-- passou pelo fluxo de logística agendada.
alter table pedidos add column if not exists logistica_executar_em timestamptz;
create index if not exists pedidos_logistica_agendada_executar_em_idx
  on pedidos(logistica_executar_em) where status_logistica = 'agendada';
