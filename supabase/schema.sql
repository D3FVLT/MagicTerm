-- MagicTerm Database Schema
-- Run this in Supabase SQL Editor to set up your database

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Servers table
create table if not exists public.servers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  host text not null,
  port integer not null default 22,
  username text not null,
  auth_type text not null check (auth_type in ('password', 'key')),
  credentials text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Create index for faster queries by user
create index if not exists servers_user_id_idx on public.servers(user_id);

-- Enable Row Level Security
alter table public.servers enable row level security;

-- RLS Policies: Users can only access their own servers
create policy "Users can view own servers"
  on public.servers for select
  using (auth.uid() = user_id);

create policy "Users can insert own servers"
  on public.servers for insert
  with check (auth.uid() = user_id);

create policy "Users can update own servers"
  on public.servers for update
  using (auth.uid() = user_id);

create policy "Users can delete own servers"
  on public.servers for delete
  using (auth.uid() = user_id);

-- Function to update updated_at timestamp
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Trigger to auto-update updated_at
create trigger servers_updated_at
  before update on public.servers
  for each row
  execute function public.handle_updated_at();

-- Enable Realtime for servers table
alter publication supabase_realtime add table public.servers;
