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

create type member_role as enum ('owner', 'admin', 'member', 'viewer');
create type invite_status as enum ('pending', 'active', 'declined');

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
  -- Personal server: user_id is set, org_id is null
  -- Organization server: org_id is set, user_id is null
  user_id uuid references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete cascade,
  
  name text not null,
  host text not null,
  port integer not null default 22,
  username text not null,
  auth_type text not null check (auth_type in ('password', 'key')),
  credentials text,
  
  -- Connection type: ssh, ftp, sftp
  connection_type text not null default 'ssh' check (connection_type in ('ssh', 'ftp', 'sftp')),
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  -- Either user_id or org_id must be set, but not both
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

-- Organizations RLS
alter table public.organizations enable row level security;

create policy "Users can view orgs they belong to"
  on public.organizations for select
  using (
    owner_id = auth.uid() or
    exists (
      select 1 from public.org_members
      where org_id = organizations.id
      and user_id = auth.uid()
      and status = 'active'
    )
  );

create policy "Only owner can update org"
  on public.organizations for update
  using (owner_id = auth.uid());

create policy "Only owner can delete org"
  on public.organizations for delete
  using (owner_id = auth.uid());

create policy "Authenticated users can create orgs"
  on public.organizations for insert
  with check (auth.uid() = owner_id);

-- Org Members RLS
alter table public.org_members enable row level security;

create policy "Members can view org members"
  on public.org_members for select
  using (
    user_id = auth.uid() or
    exists (
      select 1 from public.organizations
      where id = org_members.org_id
      and owner_id = auth.uid()
    ) or
    exists (
      select 1 from public.org_members om
      where om.org_id = org_members.org_id
      and om.user_id = auth.uid()
      and om.status = 'active'
    )
  );

create policy "Admins can invite members"
  on public.org_members for insert
  with check (
    exists (
      select 1 from public.organizations
      where id = org_members.org_id
      and owner_id = auth.uid()
    ) or
    exists (
      select 1 from public.org_members om
      where om.org_id = org_members.org_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'admin')
      and om.status = 'active'
    )
  );

create policy "Admins can update members"
  on public.org_members for update
  using (
    exists (
      select 1 from public.organizations
      where id = org_members.org_id
      and owner_id = auth.uid()
    ) or
    exists (
      select 1 from public.org_members om
      where om.org_id = org_members.org_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'admin')
      and om.status = 'active'
    ) or
    -- Users can accept/decline their own invites
    (email = (select email from auth.users where id = auth.uid()))
  );

create policy "Admins can remove members"
  on public.org_members for delete
  using (
    exists (
      select 1 from public.organizations
      where id = org_members.org_id
      and owner_id = auth.uid()
    ) or
    exists (
      select 1 from public.org_members om
      where om.org_id = org_members.org_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'admin')
      and om.status = 'active'
    ) or
    -- Users can leave orgs
    user_id = auth.uid()
  );

-- Servers RLS
alter table public.servers enable row level security;

-- Personal servers: user can CRUD their own
create policy "Users can view own servers"
  on public.servers for select
  using (
    user_id = auth.uid() or
    (
      org_id is not null and
      exists (
        select 1 from public.org_members
        where org_id = servers.org_id
        and user_id = auth.uid()
        and status = 'active'
      )
    )
  );

create policy "Users can insert own servers"
  on public.servers for insert
  with check (
    user_id = auth.uid() or
    (
      org_id is not null and
      exists (
        select 1 from public.org_members
        where org_id = servers.org_id
        and user_id = auth.uid()
        and role in ('owner', 'admin', 'member')
        and status = 'active'
      )
    )
  );

create policy "Users can update own servers"
  on public.servers for update
  using (
    user_id = auth.uid() or
    (
      org_id is not null and
      exists (
        select 1 from public.org_members
        where org_id = servers.org_id
        and user_id = auth.uid()
        and role in ('owner', 'admin', 'member')
        and status = 'active'
      )
    )
  );

create policy "Users can delete own servers"
  on public.servers for delete
  using (
    user_id = auth.uid() or
    (
      org_id is not null and
      exists (
        select 1 from public.org_members
        where org_id = servers.org_id
        and user_id = auth.uid()
        and role in ('owner', 'admin')
        and status = 'active'
      )
    )
  );

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Auto-update updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function public.handle_updated_at();

create trigger servers_updated_at
  before update on public.servers
  for each row execute function public.handle_updated_at();

-- Auto-add owner as member when org is created
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================
-- ENABLE REALTIME
-- ============================================

alter publication supabase_realtime add table public.organizations;
alter publication supabase_realtime add table public.org_members;
alter publication supabase_realtime add table public.servers;
