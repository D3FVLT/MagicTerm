-- ============================================
-- Fix empty email for organization owner members
-- ============================================

-- Update the trigger to properly get email from JWT during creation
create or replace function public.handle_new_organization()
returns trigger as $$
declare
  user_email text;
begin
  -- Get email from auth.users (this works with security definer)
  select email into user_email from auth.users where id = new.owner_id;
  
  -- Fallback: if no email found, use a placeholder based on user_id
  if user_email is null or user_email = '' then
    user_email := 'user-' || new.owner_id::text;
  end if;

  insert into public.org_members (org_id, user_id, email, role, status, joined_at)
  values (
    new.id,
    new.owner_id,
    user_email,
    'owner',
    'active',
    now()
  );
  return new;
end;
$$ language plpgsql security definer;

-- Fix existing members with empty emails
-- This updates org_members where email is empty but user_id exists
update public.org_members
set email = coalesce(
  (select email from auth.users where id = org_members.user_id),
  'user-' || user_id::text
)
where (email is null or email = '')
and user_id is not null;

-- Verify the fix
select id, org_id, user_id, email, role, status 
from public.org_members 
where email = '' or email is null or email like 'user-%';
