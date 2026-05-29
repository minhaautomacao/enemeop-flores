-- Enemeop Flores — Schema inicial

-- Extensões
create extension if not exists "uuid-ossp";

-- Profiles
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  nome          text,
  cargo         text default 'Gerente',
  criado_em     timestamptz default now(),
  atualizado_em timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Usuário vê só o próprio perfil"
  on public.profiles for select using (auth.uid() = id);

create policy "Usuário atualiza só o próprio perfil"
  on public.profiles for update using (auth.uid() = id);

-- Trigger para criar profile automaticamente
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, nome)
  values (new.id, new.email, new.raw_user_meta_data->>'nome');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Pedidos
create table public.pedidos (
  id               uuid primary key default uuid_generate_v4(),
  cliente_nome     text not null,
  cliente_telefone text not null,
  produto          text not null,
  valor            numeric(10,2) not null default 0,
  status           text not null default 'novo'
                   check (status in ('novo','confirmado','preparando','saiu','entregue','cancelado')),
  horario_entrega  text,
  bairro           text,
  canal            text not null default 'WhatsApp',
  obs              text,
  criado_em        timestamptz default now(),
  atualizado_em    timestamptz default now()
);

alter table public.pedidos enable row level security;

create policy "Autenticados leem pedidos"
  on public.pedidos for select using (auth.role() = 'authenticated');

create policy "Autenticados gerenciam pedidos"
  on public.pedidos for all using (auth.role() = 'authenticated');

-- Leads
create table public.leads (
  id              uuid primary key default uuid_generate_v4(),
  nome            text,
  telefone        text not null unique,
  canal           text not null default 'WhatsApp',
  intencao        text check (intencao in ('urgente','pesquisando','recorrente','corporativo')),
  ultimo_contato  timestamptz default now(),
  total_pedidos   int default 0,
  ltv             numeric(10,2) default 0,
  criado_em       timestamptz default now()
);

alter table public.leads enable row level security;

create policy "Autenticados gerenciam leads"
  on public.leads for all using (auth.role() = 'authenticated');

-- Index de performance
create index idx_pedidos_status    on public.pedidos(status);
create index idx_pedidos_criado_em on public.pedidos(criado_em desc);
create index idx_leads_telefone    on public.leads(telefone);
create index idx_leads_intencao    on public.leads(intencao);
