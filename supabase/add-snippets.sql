-- ============================================
-- PERSONAL SNIPPETS TABLE
-- Stores encrypted personal snippets/secrets (tokens, passwords, etc.)
-- Private to each user - no sharing
-- ============================================

create table if not exists public.snippets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  value text not null,  -- encrypted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists snippets_user_id_idx on public.snippets(user_id);

-- Enable RLS
alter table public.snippets enable row level security;

-- Users can only access their own snippets
create policy "Users can view own snippets"
  on public.snippets for select
  using (user_id = auth.uid());

create policy "Users can insert own snippets"
  on public.snippets for insert
  with check (user_id = auth.uid());

create policy "Users can update own snippets"
  on public.snippets for update
  using (user_id = auth.uid());

create policy "Users can delete own snippets"
  on public.snippets for delete
  using (user_id = auth.uid());

-- Trigger for updated_at
drop trigger if exists snippets_updated_at on public.snippets;
create trigger snippets_updated_at
  before update on public.snippets
  for each row execute function public.handle_updated_at();

-- Enable realtime
alter publication supabase_realtime add table public.snippets;
