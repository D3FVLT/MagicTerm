-- ============================================
-- USER SETTINGS EXTENSION
-- Adds nickname and default organization settings
-- ============================================

-- Add new columns to user_profiles
alter table public.user_profiles 
  add column if not exists nickname text,
  add column if not exists default_org_id uuid references public.organizations(id) on delete set null;

-- Index for default_org lookup
create index if not exists user_profiles_default_org_idx on public.user_profiles(default_org_id);

-- Function to get user display name (nickname or email fallback)
create or replace function public.get_user_display_name(user_id uuid)
returns text as $$
declare
  display_name text;
  user_email text;
begin
  -- Try to get nickname
  select nickname into display_name
  from public.user_profiles
  where id = user_id;
  
  -- If nickname is set, return it
  if display_name is not null and display_name != '' then
    return display_name;
  end if;
  
  -- Fallback to email
  select email into user_email
  from auth.users
  where id = user_id;
  
  return user_email;
end;
$$ language plpgsql security definer;

-- When user is removed from an org, reset default_org_id if it was that org
create or replace function public.handle_member_removed()
returns trigger as $$
begin
  -- If user was removed (not just updated) and this was their default org
  if old.user_id is not null then
    update public.user_profiles
    set default_org_id = null
    where id = old.user_id 
      and default_org_id = old.org_id;
  end if;
  return old;
end;
$$ language plpgsql security definer;

-- Trigger for member removal
drop trigger if exists on_member_removed on public.org_members;
create trigger on_member_removed
  after delete on public.org_members
  for each row execute function public.handle_member_removed();
