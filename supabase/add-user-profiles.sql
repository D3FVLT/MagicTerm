-- ============================================
-- USER PROFILES TABLE
-- Stores user-specific settings including master key hash
-- ============================================

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  master_key_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_profiles_id_idx on public.user_profiles(id);

-- Enable RLS
alter table public.user_profiles enable row level security;

-- Users can only access their own profile
create policy "Users can view own profile"
  on public.user_profiles for select
  using (id = auth.uid());

create policy "Users can insert own profile"
  on public.user_profiles for insert
  with check (id = auth.uid());

create policy "Users can update own profile"
  on public.user_profiles for update
  using (id = auth.uid());

-- Trigger for updated_at
drop trigger if exists user_profiles_updated_at on public.user_profiles;
create trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.handle_updated_at();

-- Auto-create profile when user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  -- Link pending invites
  update public.org_members
  set user_id = new.id
  where email = new.email and user_id is null;
  
  -- Create user profile
  insert into public.user_profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  
  return new;
end;
$$ language plpgsql security definer;

-- Enable realtime for user_profiles
alter publication supabase_realtime add table public.user_profiles;
