-- Deploy run history for the Services monitor.
-- Each row is one run of a deploy scenario. The app encrypts everything about
-- the run (service, folder, steps, exit codes, output) into `payload`, like
-- server hosts, so the database only sees which server it belongs to and when.
-- Anyone who can see the server can read its runs; members and above can add
-- them. Rows go away with their server, and only the newest 200 per server
-- are kept.

create table if not exists public.service_deploy_runs (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  payload text not null,
  created_at timestamptz not null default now()
);

create index if not exists service_deploy_runs_server_created
  on public.service_deploy_runs (server_id, created_at desc);

alter table public.service_deploy_runs enable row level security;

drop policy if exists "Deploy runs are visible with their server" on public.service_deploy_runs;
create policy "Deploy runs are visible with their server"
  on public.service_deploy_runs for select
  using (
    -- The servers policies decide which servers this subquery can see.
    exists (select 1 from public.servers s where s.id = service_deploy_runs.server_id)
  );

drop policy if exists "Members add deploy runs" on public.service_deploy_runs;
create policy "Members add deploy runs"
  on public.service_deploy_runs for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.servers s
      where s.id = service_deploy_runs.server_id
      and (
        s.user_id = auth.uid()
        or (
          s.org_id is not null
          and exists (
            select 1 from public.org_members m
            where m.org_id = s.org_id
            and m.user_id = auth.uid()
            and m.role in ('owner', 'admin', 'member')
            and m.status = 'active'
          )
        )
      )
    )
  );

create or replace function public.prune_service_deploy_runs()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.service_deploy_runs
  where server_id = new.server_id
    and id not in (
      select id from public.service_deploy_runs
      where server_id = new.server_id
      order by created_at desc
      limit 200
    );
  return null;
end;
$$;

revoke all on function public.prune_service_deploy_runs() from public, anon, authenticated;

drop trigger if exists service_deploy_runs_prune on public.service_deploy_runs;
create trigger service_deploy_runs_prune
  after insert on public.service_deploy_runs
  for each row execute function public.prune_service_deploy_runs();
