-- ============================================
-- STEP 1: Nuclear cleanup - drop ALL policies regardless of name
-- ============================================

DO $$ 
DECLARE
  pol record;
BEGIN
  FOR pol IN 
    SELECT policyname, tablename 
    FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename IN ('organizations', 'org_members', 'servers')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
    RAISE NOTICE 'Dropped policy: % on %', pol.policyname, pol.tablename;
  END LOOP;
END $$;

-- ============================================
-- STEP 2: Create helper functions (security definer = bypass RLS)
-- ============================================

create or replace function public.get_user_org_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select org_id from public.org_members
  where user_id = auth.uid()
  and status = 'active';
$$;

create or replace function public.is_org_admin(check_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
    where org_id = check_org_id
    and user_id = auth.uid()
    and role in ('owner', 'admin')
    and status = 'active'
  );
$$;

create or replace function public.is_org_member(check_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
    where org_id = check_org_id
    and user_id = auth.uid()
    and role in ('owner', 'admin', 'member')
    and status = 'active'
  );
$$;

-- ============================================
-- STEP 3: org_members policies (NO self-reference, NO auth.users)
-- ============================================

create policy "om_select"
  on public.org_members for select
  using (
    user_id = auth.uid()
    or email = (auth.jwt() ->> 'email')
    or org_id in (select public.get_user_org_ids())
  );

create policy "om_insert"
  on public.org_members for insert
  with check (
    public.is_org_admin(org_id)
  );

create policy "om_update"
  on public.org_members for update
  using (
    user_id = auth.uid()
    or email = (auth.jwt() ->> 'email')
    or public.is_org_admin(org_id)
  );

create policy "om_delete"
  on public.org_members for delete
  using (
    user_id = auth.uid()
    or public.is_org_admin(org_id)
  );

-- ============================================
-- STEP 4: organizations policies
-- ============================================

create policy "org_select"
  on public.organizations for select
  using (
    id in (select public.get_user_org_ids())
  );

create policy "org_insert"
  on public.organizations for insert
  with check (auth.uid() = owner_id);

create policy "org_update"
  on public.organizations for update
  using (owner_id = auth.uid());

create policy "org_delete"
  on public.organizations for delete
  using (owner_id = auth.uid());

-- ============================================
-- STEP 5: servers policies
-- ============================================

create policy "srv_select"
  on public.servers for select
  using (
    user_id = auth.uid()
    or (org_id is not null and org_id in (select public.get_user_org_ids()))
  );

create policy "srv_insert"
  on public.servers for insert
  with check (
    user_id = auth.uid()
    or (org_id is not null and public.is_org_member(org_id))
  );

create policy "srv_update"
  on public.servers for update
  using (
    user_id = auth.uid()
    or (org_id is not null and public.is_org_member(org_id))
  );

create policy "srv_delete"
  on public.servers for delete
  using (
    user_id = auth.uid()
    or (org_id is not null and public.is_org_admin(org_id))
  );

-- Verify
SELECT tablename, policyname, cmd FROM pg_policies 
WHERE schemaname = 'public' ORDER BY tablename, policyname;
