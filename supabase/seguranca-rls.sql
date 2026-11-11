-- =====================================================================
-- ACRILIFE — Endurecimento de segurança (RLS) no Supabase
-- ---------------------------------------------------------------------
-- NÃO foi executado automaticamente. Revise e rode no SQL Editor do
-- Supabase (Dashboard → SQL Editor → New query → Run).
--
-- Objetivo: o site público (chave anon) só LÊ dados ativos; somente
-- usuários com profiles.role = 'admin' podem criar/alterar/excluir
-- produtos, categorias, configurações e imagens.
--
-- É idempotente: pode rodar mais de uma vez.
-- Antes de rodar, confira as políticas atuais em
--   Authentication → Policies  (ou: select * from pg_policies;)
-- =====================================================================

-- 1) Função auxiliar: o usuário logado é admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- 2) RLS ligado em todas as tabelas
alter table public.produtos    enable row level security;
alter table public.categorias  enable row level security;
alter table public.config_site enable row level security;
alter table public.profiles    enable row level security;

-- 3) PRODUTOS — público lê só ativos; admin faz tudo
drop policy if exists "produtos_leitura_publica" on public.produtos;
create policy "produtos_leitura_publica" on public.produtos
  for select using (ativo = true or public.is_admin());

drop policy if exists "produtos_admin_escrita" on public.produtos;
create policy "produtos_admin_escrita" on public.produtos
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 4) CATEGORIAS — público lê só ativas; admin faz tudo
drop policy if exists "categorias_leitura_publica" on public.categorias;
create policy "categorias_leitura_publica" on public.categorias
  for select using (ativo = true or public.is_admin());

drop policy if exists "categorias_admin_escrita" on public.categorias;
create policy "categorias_admin_escrita" on public.categorias
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 5) CONFIG_SITE — público lê; só admin altera
drop policy if exists "config_leitura_publica" on public.config_site;
create policy "config_leitura_publica" on public.config_site
  for select using (true);

drop policy if exists "config_admin_escrita" on public.config_site;
create policy "config_admin_escrita" on public.config_site
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 6) PROFILES — cada um lê o próprio perfil; ninguém se promove a admin pelo site
drop policy if exists "profiles_leitura_propria" on public.profiles;
create policy "profiles_leitura_propria" on public.profiles
  for select to authenticated using (auth.uid() = id);
-- (sem políticas de insert/update/delete: role só muda pelo Dashboard)

-- 7) STORAGE (bucket "imagens") — leitura pública, escrita só admin
drop policy if exists "imagens_admin_insert" on storage.objects;
create policy "imagens_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'imagens' and public.is_admin());

drop policy if exists "imagens_admin_update" on storage.objects;
create policy "imagens_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'imagens' and public.is_admin());

drop policy if exists "imagens_admin_delete" on storage.objects;
create policy "imagens_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'imagens' and public.is_admin());

-- 8) Índices para as consultas do site
create index if not exists produtos_ativo_created_idx on public.produtos (ativo, created_at desc);
create index if not exists produtos_categoria_idx    on public.produtos (categoria_id);
create index if not exists categorias_ordem_idx      on public.categorias (ordem, nome);

-- ATENÇÃO: se existirem políticas antigas mais permissivas (ex.: "Enable all
-- for anon"), elas continuam valendo, pois políticas se SOMAM. Liste com
--   select schemaname, tablename, policyname, roles, cmd from pg_policies
--   where schemaname in ('public','storage');
-- e remova as que liberam escrita para anon/authenticated sem is_admin().
