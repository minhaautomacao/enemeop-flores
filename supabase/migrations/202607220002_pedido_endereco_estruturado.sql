-- Aditiva apenas. Parte 7 da correção "fechar bloqueios do agendamento" —
-- o pedido criado a partir do formulário (WhatsApp/Instagram/Facebook)
-- precisa persistir o endereço estruturado (nunca só o texto concatenado em
-- endereco_entrega) e o nome de quem fez o pedido, pra nunca depender de
-- reconstituir esses dados a partir de texto livre depois.

alter table pedidos add column if not exists cep text;
alter table pedidos add column if not exists numero text;
alter table pedidos add column if not exists complemento text;
alter table pedidos add column if not exists cidade text;
alter table pedidos add column if not exists uf text;
alter table pedidos add column if not exists nome_comprador text;
