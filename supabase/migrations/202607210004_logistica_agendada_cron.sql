-- Aditiva apenas. Agenda a execução periódica de logistica-agendada-processar
-- (Parte 5) — processa pedidos pagos fora do horário comercial cuja hora de
-- entrega já chegou, sem nunca chamar o motorista antes disso.
--
-- O token de autorização (FACTORY_SECRET) NUNCA é gravado em texto puro
-- nesta migration nem em cron.job.command (visível via tabela cron.job) —
-- é lido do Vault por nome, inserido separadamente e fora do controle de
-- versão, num passo manual de deploy:
--   select vault.create_secret('<valor real do FACTORY_SECRET>', 'factory_secret_cron', 'Usado por pg_cron para autenticar chamadas a Edge Functions');
-- A URL base das Edge Functions não é segredo (é pública), por isso vai
-- direto na migration. Enquanto o secret do Vault não existir, o job roda e
-- não faz nada (WHERE EXISTS abaixo) — nunca chama a função sem
-- autenticação, nunca expõe segredo.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'logistica-agendada-processar';

select cron.schedule(
  'logistica-agendada-processar',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://gftnjvdvzgjkhwxnxnwl.supabase.co/functions/v1/logistica-agendada-processar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'factory_secret_cron')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'factory_secret_cron');
  $$
);
