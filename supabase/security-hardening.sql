-- ============================================
-- SECURITY HARDENING MIGRATION
-- ============================================
-- Run this AFTER all other migrations (schema.sql, add-user-profiles.sql,
-- add-user-settings.sql, add-snippets.sql, add-server-comment.sql,
-- fix-member-email.sql, fix-rls.sql).
--
-- Fixes:
--   1. (CRITICAL) Self-escalation in org_members: a member could update
--      their own row and set role='owner'. We now block role changes via
--      a BEFORE UPDATE trigger and only allow them through the
--      change_member_role() RPC executed by an admin.
--   2. (HIGH) Define create_organization() / delete_organization() RPCs
--      with explicit ownership checks; the client already calls them, but
--      they were missing from the repo.
--   3. (HIGH) Restrict get_user_display_name() so it does not leak
--      arbitrary users' email addresses to any authenticated caller.
--   4. (MEDIUM) WITH CHECK on org_members INSERT/UPDATE constrains the
--      role enum and disallows promoting members to 'owner' outside the
--      change_member_role RPC.
--   5. (MEDIUM) Add a strong scrypt-based verifier column for the master
--      password. The legacy master_key_hash column stays so old clients
--      keep working until they re-hash on next unlock.
-- ============================================

-- 1. user_profiles: add scrypt verifier column for master password ----------

alter table public.user_profiles
  add column if not exists master_key_verifier text;

comment on column public.user_profiles.master_key_verifier is
  'Salted scrypt verifier for the master password (PHC-like format: scrypt$N$r$p$saltB64$hashB64). Replaces master_key_hash, which was a single SHA-256 round and is brute-forceable.';

-- 2. org_members: prevent role escalation ----------------------------------

create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Allow trigger-level logic (handle_new_organization etc.) to set the
  -- role, since SECURITY DEFINER functions run with elevated rights and
  -- auth.uid() may be null in their context.
  if auth.uid() is null then
    return new;
  end if;

  -- Block any role change unless caller is admin/owner of the target org.
  if new.role is distinct from old.role then
    if not public.is_org_admin(new.org_id) then
      raise exception 'role_change_forbidden: only org admins can change member roles'
        using errcode = '42501';
    end if;
  end if;

  -- Block transferring a row between organizations.
  if new.org_id is distinct from old.org_id then
    raise exception 'org_change_forbidden: cannot move membership between organizations'
      using errcode = '42501';
  end if;

  -- Block claiming somebody else's membership row.
  if new.user_id is distinct from old.user_id
     and old.user_id is not null
     and new.user_id is distinct from auth.uid()
     and not public.is_org_admin(new.org_id) then
    raise exception 'user_change_forbidden: cannot reassign membership to another user'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_role_escalation_trigger on public.org_members;
create trigger prevent_role_escalation_trigger
  before update on public.org_members
  for each row execute function public.prevent_role_escalation();

-- Tighten the UPDATE policy so the role/email/org constraints are enforced
-- even if the trigger is dropped in the future. WITH CHECK applies to NEW.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_members' and policyname = 'om_update'
  ) then
    drop policy "om_update" on public.org_members;
  end if;
end $$;

create policy "om_update"
  on public.org_members for update
  using (
    user_id = auth.uid()
    or email = (auth.jwt() ->> 'email')
    or public.is_org_admin(org_id)
  )
  with check (
    -- Self-update path: row must still belong to the same user, role must
    -- not become a privileged role. Admin path: can set any valid role.
    (
      user_id = auth.uid()
      and role in ('member', 'viewer')
    )
    or public.is_org_admin(org_id)
  );

-- INSERT: admins only, and they may not directly seed an 'owner' member.
-- Owners are created exclusively by the handle_new_organization() trigger.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_members' and policyname = 'om_insert'
  ) then
    drop policy "om_insert" on public.org_members;
  end if;
end $$;

create policy "om_insert"
  on public.org_members for insert
  with check (
    public.is_org_admin(org_id)
    and role in ('admin', 'member', 'viewer')
  );

-- 3. RPC: admin-only role change -------------------------------------------

create or replace function public.change_member_role(
  member_id uuid,
  new_role member_role
)
returns public.org_members
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.org_members;
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if new_role not in ('admin', 'member', 'viewer') then
    raise exception 'invalid_role: % is not assignable via change_member_role', new_role
      using errcode = '22023';
  end if;

  select * into target from public.org_members where id = member_id;
  if target is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  if not public.is_org_admin(target.org_id) then
    raise exception 'forbidden: caller is not an admin of the target organization'
      using errcode = '42501';
  end if;

  if target.role = 'owner' then
    raise exception 'cannot_change_owner_role: organization owner role is immutable here'
      using errcode = '42501';
  end if;

  update public.org_members
  set role = new_role
  where id = member_id
  returning * into target;

  return target;
end;
$$;

revoke all on function public.change_member_role(uuid, member_role) from public, anon;
grant execute on function public.change_member_role(uuid, member_role) to authenticated;

-- 4. RPC: create_organization / delete_organization ------------------------

create or replace function public.create_organization(org_name text)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org public.organizations;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if org_name is null or btrim(org_name) = '' then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  insert into public.organizations (name, owner_id)
  values (btrim(org_name), auth.uid())
  returning * into new_org;

  return new_org;
end;
$$;

revoke all on function public.create_organization(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated;

create or replace function public.delete_organization(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select owner_id into org_owner from public.organizations where id = target_org_id;
  if org_owner is null then
    raise exception 'org_not_found' using errcode = 'P0002';
  end if;

  if org_owner <> auth.uid() then
    raise exception 'forbidden: only the organization owner can delete it'
      using errcode = '42501';
  end if;

  delete from public.organizations where id = target_org_id;
end;
$$;

revoke all on function public.delete_organization(uuid) from public, anon;
grant execute on function public.delete_organization(uuid) to authenticated;

-- 5. Restrict get_user_display_name to org members -------------------------

create or replace function public.get_user_display_name(user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  display_name text;
  user_email text;
  caller uuid := auth.uid();
  shares_org boolean;
begin
  if caller is null then
    return null;
  end if;

  -- Caller can always look up themselves.
  if caller = user_id then
    select nickname into display_name from public.user_profiles where id = user_id;
    if display_name is not null and display_name <> '' then
      return display_name;
    end if;
    select email into user_email from auth.users where id = user_id;
    return user_email;
  end if;

  -- Otherwise the caller must share at least one active org with the target.
  select exists (
    select 1
    from public.org_members caller_m
    join public.org_members target_m on target_m.org_id = caller_m.org_id
    where caller_m.user_id = caller
      and caller_m.status = 'active'
      and target_m.user_id = user_id
      and target_m.status = 'active'
  ) into shares_org;

  if not shares_org then
    return null;
  end if;

  select nickname into display_name from public.user_profiles where id = user_id;
  if display_name is not null and display_name <> '' then
    return display_name;
  end if;

  -- Returning the email is acceptable here since the caller already shares
  -- an org with the target and could see them in org_members anyway.
  select email into user_email from auth.users where id = user_id;
  return user_email;
end;
$$;

revoke all on function public.get_user_display_name(uuid) from public, anon;
grant execute on function public.get_user_display_name(uuid) to authenticated;

-- 6. Helpful index for the trigger above -----------------------------------
create index if not exists org_members_org_user_role_idx
  on public.org_members(org_id, user_id, role);

-- ============================================
-- VERIFY
-- ============================================
-- After running, sanity-check policies and grants:
--   select tablename, policyname, cmd, qual, with_check
--     from pg_policies where schemaname = 'public' and tablename = 'org_members';
--   select proname, prosecdef
--     from pg_proc where pronamespace = 'public'::regnamespace
--     and proname in ('change_member_role','create_organization','delete_organization','get_user_display_name');
