-- MagicTerm Database Schema
-- Run this in Supabase SQL Editor to set up your database

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================
-- ORGANIZATIONS
-- ============================================

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists organizations_owner_id_idx on public.organizations(owner_id);

-- ============================================
-- ORGANIZATION MEMBERS
-- ============================================

do $$ begin
  create type member_role as enum ('owner', 'admin', 'member', 'viewer');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type invite_status as enum ('pending', 'active', 'declined');
exception when duplicate_object then null;
end $$;

create table if not exists public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  role member_role not null default 'member',
  status invite_status not null default 'pending',
  invited_by uuid references auth.users(id),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  
  unique(org_id, email)
);

create index if not exists org_members_org_id_idx on public.org_members(org_id);
create index if not exists org_members_user_id_idx on public.org_members(user_id);
create index if not exists org_members_email_idx on public.org_members(email);

-- ============================================
-- SERVERS (supports both personal and org)
-- ============================================

create table if not exists public.servers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete cascade,
  
  name text not null,
  host text not null,
  port integer not null default 22,
  username text not null,
  auth_type text not null check (auth_type in ('password', 'key')),
  credentials text,
  connection_type text not null default 'ssh' check (connection_type in ('ssh', 'ftp', 'sftp')),
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  constraint server_owner_check check (
    (user_id is not null and org_id is null) or
    (user_id is null and org_id is not null)
  )
);

create index if not exists servers_user_id_idx on public.servers(user_id);
create index if not exists servers_org_id_idx on public.servers(org_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.servers enable row level security;

-- ============================================
-- ORG_MEMBERS policies FIRST (no reference to organizations table)
-- This prevents circular dependency with organizations policies
-- ============================================

create policy "Users can view org members"
  on public.org_members for select
  using (
    user_id = auth.uid()
    or email = (auth.jwt() ->> 'email')
    or org_id in (
      select om.org_id from public.org_members om
      where om.user_id = auth.uid()
      and om.status = 'active'
    )
  );

create policy "Admins can invite members"
  on public.org_members for insert
  with check (
    exists (
      select 1 from public.org_members om
      where om.org_id = org_members.org_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'admin')
      and om.status = 'active'
    )
  );

create policy "Admins and self can update members"
  on public.org_members for update
  using (
    user_id = auth.uid()
    or email = (auth.jwt() ->> 'email')
    or exists (
      select 1 from public.org_members om
      where om.org_id = org_members.org_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'admin')
      and om.status = 'active'
    )
  );

create policy "Admins and self can remove members"
  on public.org_members for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.org_members om
      where om.org_id = org_members.org_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'admin')
      and om.status = 'active'
    )
  );

-- ============================================
-- ORGANIZATIONS policies (safely references org_members)
-- ============================================

create policy "Users can view orgs they belong to"
  on public.organizations for select
  using (
    exists (
      select 1 from public.org_members
      where org_members.org_id = organizations.id
      and org_members.user_id = auth.uid()
      and org_members.status = 'active'
    )
  );

create policy "Authenticated users can create orgs"
  on public.organizations for insert
  with check (auth.uid() = owner_id);

create policy "Only owner can update org"
  on public.organizations for update
  using (owner_id = auth.uid());

create policy "Only owner can delete org"
  on public.organizations for delete
  using (owner_id = auth.uid());

-- ============================================
-- SERVERS policies
-- ============================================

create policy "Users can view own servers"
  on public.servers for select
  using (
    user_id = auth.uid()
    or (
      org_id is not null
      and exists (
        select 1 from public.org_members
        where org_members.org_id = servers.org_id
        and org_members.user_id = auth.uid()
        and org_members.status = 'active'
      )
    )
  );

create policy "Users can insert own servers"
  on public.servers for insert
  with check (
    user_id = auth.uid()
    or (
      org_id is not null
      and exists (
        select 1 from public.org_members
        where org_members.org_id = servers.org_id
        and org_members.user_id = auth.uid()
        and org_members.role in ('owner', 'admin', 'member')
        and org_members.status = 'active'
      )
    )
  );

create policy "Users can update own servers"
  on public.servers for update
  using (
    user_id = auth.uid()
    or (
      org_id is not null
      and exists (
        select 1 from public.org_members
        where org_members.org_id = servers.org_id
        and org_members.user_id = auth.uid()
        and org_members.role in ('owner', 'admin', 'member')
        and org_members.status = 'active'
      )
    )
  );

create policy "Users can delete own servers"
  on public.servers for delete
  using (
    user_id = auth.uid()
    or (
      org_id is not null
      and exists (
        select 1 from public.org_members
        where org_members.org_id = servers.org_id
        and org_members.user_id = auth.uid()
        and org_members.role in ('owner', 'admin')
        and org_members.status = 'active'
      )
    )
  );

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists organizations_updated_at on public.organizations;
create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function public.handle_updated_at();

drop trigger if exists servers_updated_at on public.servers;
create trigger servers_updated_at
  before update on public.servers
  for each row execute function public.handle_updated_at();

-- Auto-add owner as member when org is created (security definer bypasses RLS)
create or replace function public.handle_new_organization()
returns trigger as $$
begin
  insert into public.org_members (org_id, user_id, email, role, status, joined_at)
  select 
    new.id,
    new.owner_id,
    (select email from auth.users where id = new.owner_id),
    'owner',
    'active',
    now();
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_organization_created on public.organizations;
create trigger on_organization_created
  after insert on public.organizations
  for each row execute function public.handle_new_organization();

-- Link pending invites when user registers
create or replace function public.handle_new_user()
returns trigger as $$
begin
  update public.org_members
  set user_id = new.id
  where email = new.email and user_id is null;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================
-- ENABLE REALTIME
-- ============================================

alter publication supabase_realtime add table public.organizations;
alter publication supabase_realtime add table public.org_members;
alter publication supabase_realtime add table public.servers;
