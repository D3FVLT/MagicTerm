-- =============================================================================
-- harden-functions.sql
--
-- Closes Supabase Database Advisor warnings of two kinds:
--
--   1. function_search_path_mutable
--        SECURITY DEFINER functions without an explicit search_path can be
--        tricked into resolving objects from a schema the caller controls.
--        Pin search_path = public, pg_temp.
--
--   2. anon/authenticated_security_definer_function_executable
--        Trigger-only and RLS-helper functions accidentally end up in the
--        PostgREST surface (`/rest/v1/rpc/<fn>`). REVOKE them for everyone
--        but the postgres role.
--
--        Business RPCs (account deletion, org management) must remain callable
--        by the `authenticated` role only — never by `anon`.
--
-- The is_org_admin / is_org_member / get_user_org_ids helpers are intentionally
-- left callable by `authenticated` because RLS policies in this schema invoke
-- them at query time and Postgres requires EXECUTE on the calling role even
-- for SECURITY DEFINER functions. Moving them to a non-exposed schema would
-- require rewriting every policy that references them and is left for a
-- follow-up migration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Pin search_path on every SECURITY DEFINER function we own.
--    `public, pg_temp` is the Supabase-recommended value: pg_temp is included
--    last so temp objects resolve normally inside the function.
-- ---------------------------------------------------------------------------

-- Trigger functions
alter function public.handle_updated_at() set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;
alter function public.handle_new_organization() set search_path = public, pg_temp;
alter function public.handle_member_removed() set search_path = public, pg_temp;
alter function public.prevent_role_escalation() set search_path = public, pg_temp;

-- RLS helper functions (kept executable by authenticated, see header comment)
alter function public.get_user_org_ids() set search_path = public, pg_temp;
alter function public.is_org_admin(check_org_id uuid) set search_path = public, pg_temp;
alter function public.is_org_member(check_org_id uuid) set search_path = public, pg_temp;

-- Business RPCs
alter function public.account_deletion_preview() set search_path = public, pg_temp;
alter function public.delete_my_account() set search_path = public, pg_temp;
alter function public.create_organization(org_name text) set search_path = public, pg_temp;
alter function public.delete_organization(target_org_id uuid) set search_path = public, pg_temp;
alter function public.change_member_role(member_id uuid, new_role public.member_role)
  set search_path = public, pg_temp;
alter function public.get_user_display_name(user_id uuid) set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 2. Remove trigger-only functions from the PostgREST API surface.
--    Triggers run as the table owner, so the trigger itself keeps working
--    even after public/anon/authenticated lose EXECUTE.
-- ---------------------------------------------------------------------------

revoke execute on function public.handle_updated_at()        from public, anon, authenticated;
revoke execute on function public.handle_new_user()          from public, anon, authenticated;
revoke execute on function public.handle_new_organization()  from public, anon, authenticated;
revoke execute on function public.handle_member_removed()    from public, anon, authenticated;
revoke execute on function public.prevent_role_escalation()  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Lock down business RPCs to authenticated users only.
--    Each function already checks auth.uid() internally, but defence-in-depth
--    means we don't even hand the API endpoint to anonymous callers.
-- ---------------------------------------------------------------------------

revoke execute on function public.account_deletion_preview()        from public, anon;
revoke execute on function public.delete_my_account()               from public, anon;
revoke execute on function public.create_organization(text)         from public, anon;
revoke execute on function public.delete_organization(uuid)         from public, anon;
revoke execute on function public.change_member_role(uuid, public.member_role)
                                                                    from public, anon;
revoke execute on function public.get_user_display_name(uuid)       from public, anon;

grant  execute on function public.account_deletion_preview()        to authenticated;
grant  execute on function public.delete_my_account()               to authenticated;
grant  execute on function public.create_organization(text)         to authenticated;
grant  execute on function public.delete_organization(uuid)         to authenticated;
grant  execute on function public.change_member_role(uuid, public.member_role)
                                                                    to authenticated;
grant  execute on function public.get_user_display_name(uuid)       to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Lock RLS helpers down to authenticated as well — anon never needs them.
--    (We can't fully revoke from authenticated without rewriting RLS
--    policies; see header comment.)
-- ---------------------------------------------------------------------------

revoke execute on function public.get_user_org_ids()                 from public, anon;
revoke execute on function public.is_org_admin(uuid)                 from public, anon;
revoke execute on function public.is_org_member(uuid)                from public, anon;

grant  execute on function public.get_user_org_ids()                 to authenticated;
grant  execute on function public.is_org_admin(uuid)                 to authenticated;
grant  execute on function public.is_org_member(uuid)                to authenticated;
