-- ============================================
-- SERVER FOLDERS
-- Single-level grouping for the server list. A folder belongs either to one
-- user (personal vault) or to one organization (team vault) — never both,
-- mirroring the scoping rules of public.servers.
--
-- servers.folder_id = null means "Ungrouped": the server is rendered in a
-- trailing section instead of a folder. Existing rows keep working untouched.
--
-- Ordering used by the client:
--   folders            → sort_order asc, name asc
--   servers per folder → is_pinned desc, sort_order asc, name asc
-- Pins are scoped to the folder a server lives in, so sort_order only ever
-- needs to be unique inside one folder.
-- ============================================

create table if not exists public.server_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Exactly one owner: personal folder or org folder.
  constraint server_folders_scope_check check (
    (user_id is not null and org_id is null)
    or (user_id is null and org_id is not null)
  )
);

-- Folder membership. ON DELETE SET NULL: deleting a folder never deletes
-- servers, they fall back to Ungrouped.
alter table public.servers
  add column if not exists folder_id uuid
  references public.server_folders(id) on delete set null;

create index if not exists server_folders_user_sort_idx
  on public.server_folders (user_id, sort_order asc)
  where org_id is null;

create index if not exists server_folders_org_sort_idx
  on public.server_folders (org_id, sort_order asc)
  where org_id is not null;

create index if not exists servers_folder_idx
  on public.servers (folder_id)
  where folder_id is not null;

alter table public.server_folders enable row level security;

-- Policies mirror the srv_* policies in fix-rls.sql: every active member of an
-- org can read and manage its folders, only admins can delete them.
drop policy if exists "sf_select" on public.server_folders;
create policy "sf_select"
  on public.server_folders for select
  using (
    user_id = auth.uid()
    or (org_id is not null and org_id in (select public.get_user_org_ids()))
  );

drop policy if exists "sf_insert" on public.server_folders;
create policy "sf_insert"
  on public.server_folders for insert
  with check (
    user_id = auth.uid()
    or (org_id is not null and public.is_org_member(org_id))
  );

drop policy if exists "sf_update" on public.server_folders;
create policy "sf_update"
  on public.server_folders for update
  using (
    user_id = auth.uid()
    or (org_id is not null and public.is_org_member(org_id))
  );

drop policy if exists "sf_delete" on public.server_folders;
create policy "sf_delete"
  on public.server_folders for delete
  using (
    user_id = auth.uid()
    or (org_id is not null and public.is_org_admin(org_id))
  );

drop trigger if exists server_folders_updated_at on public.server_folders;
create trigger server_folders_updated_at
  before update on public.server_folders
  for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- Integrity guards
--
-- RLS alone is not enough here. srv_update lets any active org member update a
-- server row, and sf_update lets them update a shared folder — neither policy
-- can express "the folder must live in the same vault as the server". Without
-- the triggers below a member could point an org server at a personal folder,
-- or reparent a shared folder to themselves, which makes the server look
-- Ungrouped for every teammate.
--
-- Both triggers no-op when folder_id is null, so clients running an older app
-- version (which never send folder_id) are unaffected.
-- ---------------------------------------------------------------------------

create or replace function public.validate_server_folder_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  folder_user_id uuid;
  folder_org_id uuid;
begin
  if new.folder_id is null then
    return new;
  end if;

  select user_id, org_id into folder_user_id, folder_org_id
  from public.server_folders
  where id = new.folder_id;

  if not found then
    raise exception 'Folder % does not exist', new.folder_id;
  end if;

  if new.org_id is not null then
    if folder_org_id is distinct from new.org_id then
      raise exception 'Folder does not belong to this organization';
    end if;
  elsif folder_org_id is not null or folder_user_id is distinct from new.user_id then
    raise exception 'Folder does not belong to this user';
  end if;

  return new;
end;
$$;

drop trigger if exists servers_validate_folder_scope on public.servers;
create trigger servers_validate_folder_scope
  before insert or update on public.servers
  for each row execute function public.validate_server_folder_scope();

-- A folder never changes hands: personal stays personal, org stays that org.
create or replace function public.freeze_server_folder_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.org_id is distinct from old.org_id then
    raise exception 'Folder ownership cannot be changed';
  end if;

  return new;
end;
$$;

drop trigger if exists server_folders_freeze_scope on public.server_folders;
create trigger server_folders_freeze_scope
  before update on public.server_folders
  for each row execute function public.freeze_server_folder_scope();

-- Trigger-only functions must not be reachable through /rest/v1/rpc/.
-- Triggers run as the table owner, so they keep working after the revoke.
revoke execute on function public.validate_server_folder_scope() from public, anon, authenticated;
revoke execute on function public.freeze_server_folder_scope()   from public, anon, authenticated;

-- Guarded so the whole file stays re-runnable: plain ALTER PUBLICATION errors
-- out if the table is already a member.
do $$
begin
  alter publication supabase_realtime add table public.server_folders;
exception
  when duplicate_object then null;
end $$;
