-- Account self-deletion RPCs.
--
-- Two functions:
--
--   public.account_deletion_preview()
--     Returns a JSONB summary of everything that would happen if the current
--     user deleted their account. The UI uses this to warn the user before
--     anything is touched: personal items lost, organisations dissolved, and
--     organisations transferred to a teammate.
--
--   public.delete_my_account()
--     Actually deletes the current user. Before removing the auth.users row,
--     it transfers ownership of any organisations that have other members
--     to the next-most-senior teammate (oldest admin, else oldest member, else
--     oldest viewer). Organisations where the user is the only active member
--     are dissolved entirely — cascading deletes their servers and members.
--
-- Both are SECURITY DEFINER, scoped to auth.uid(), and granted only to the
-- `authenticated` role.
--
-- Run once in the Supabase SQL editor.

-- ===========================================================================
-- PREVIEW
-- ===========================================================================

create or replace function public.account_deletion_preview()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'personal_servers', (select count(*) from public.servers where user_id = uid),
    'snippets', (select count(*) from public.snippets where user_id = uid),
    'org_memberships', (
      select count(*)
      from public.org_members
      where user_id = uid and status = 'active'
        and org_id not in (select id from public.organizations where owner_id = uid)
    ),
    -- Orgs that will be DELETED (you're the only active member; their servers go too).
    'orgs_to_delete', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'server_count', srv.cnt
        )
      ), '[]'::jsonb)
      from public.organizations o
      cross join lateral (
        select count(*)::int as cnt
        from public.org_members om
        where om.org_id = o.id and om.status = 'active' and om.user_id <> uid and om.user_id is not null
      ) other
      cross join lateral (
        select count(*)::int as cnt from public.servers s where s.org_id = o.id
      ) srv
      where o.owner_id = uid and other.cnt = 0
    ),
    -- Orgs that will SURVIVE with a new owner.
    'orgs_to_transfer', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'new_owner_email', no.email,
          'new_owner_role_was', no.role
        )
      ), '[]'::jsonb)
      from public.organizations o
      cross join lateral (
        select om.email, om.role::text as role
        from public.org_members om
        where om.org_id = o.id
          and om.user_id <> uid
          and om.user_id is not null
          and om.status = 'active'
        order by
          case om.role
            when 'admin' then 1
            when 'member' then 2
            when 'viewer' then 3
            else 4
          end,
          om.joined_at asc nulls last,
          om.invited_at asc
        limit 1
      ) no
      where o.owner_id = uid
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.account_deletion_preview() from public;
grant execute on function public.account_deletion_preview() to authenticated;

-- ===========================================================================
-- DELETE
-- ===========================================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  org_rec record;
  new_owner uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Step 1: handle owned organisations.
  for org_rec in
    select id from public.organizations where owner_id = uid
  loop
    -- Pick the next-most-senior teammate to take over. Order:
    -- admin (oldest) → member (oldest) → viewer (oldest).
    select om.user_id into new_owner
    from public.org_members om
    where om.org_id = org_rec.id
      and om.user_id <> uid
      and om.user_id is not null
      and om.status = 'active'
    order by
      case om.role
        when 'admin' then 1
        when 'member' then 2
        when 'viewer' then 3
        else 4
      end,
      om.joined_at asc nulls last,
      om.invited_at asc
    limit 1;

    if new_owner is not null then
      -- Transfer: promote replacement to 'owner', leave their old role behind.
      update public.organizations
        set owner_id = new_owner, updated_at = now()
        where id = org_rec.id;
      update public.org_members
        set role = 'owner'
        where org_id = org_rec.id and user_id = new_owner;
    else
      -- Solo org — dissolve it. Cascade removes its servers and member rows.
      delete from public.organizations where id = org_rec.id;
    end if;
  end loop;

  -- Step 2: null out any references where we're listed as inviter so the
  -- auth.users delete below isn't blocked by FK constraints.
  update public.org_members set invited_by = null where invited_by = uid;

  -- Step 3: best-effort cleanup of user-owned rows. Most of these would also
  -- be removed by `auth.users` cascade, but being explicit guards against
  -- partial cascades and surfaces row counts in the audit log.
  delete from public.servers where user_id = uid;
  delete from public.snippets where user_id = uid;
  delete from public.org_members where user_id = uid;
  delete from public.user_profiles where id = uid;

  -- Step 4: remove the auth row last. This signs the session out and frees
  -- the email address for re-registration.
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
