-- Aditiva: a migration 202607170001_atendimento_humano.sql não é editada
-- (histórico preservado). O commit 507c43e passou a inserir em
-- atendimentos_humanos com origem_handoff='whatsapp_sdr' (ver
-- supabase/functions/_shared/handoff-whatsapp-sdr.ts), mas a constraint
-- original não previa esse valor — todo INSERT do fluxo whatsapp-sdr
-- falhava em produção. Recria a constraint com o mesmo nome, preservando
-- todos os valores já permitidos e adicionando só o novo.

alter table public.atendimentos_humanos drop constraint if exists atendimentos_humanos_origem_handoff_check;
alter table public.atendimentos_humanos add constraint atendimentos_humanos_origem_handoff_check
  check (origem_handoff in (
    'cliente_solicitou',
    'flora_sem_confianca',
    'limite_tecnico',
    'pagamento',
    'logistica',
    'administrativo',
    'manual',
    'whatsapp_sdr'
  ));
