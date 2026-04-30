-- Add server pinning + manual ordering support
-- Backward compatible: both columns are nullable-by-default with sane fallbacks
-- (false / 0). Existing rows fill in via the DEFAULT clause without touching
-- application code.
--
-- Usage by the client:
--   - is_pinned = true      → server is sticked to the top of the list
--   - sort_order            → manual reorder index inside its (pinned/unpinned)
--                             group. Lower value = earlier in the list.
-- The list query uses:
--   order by is_pinned desc, sort_order asc, name asc

ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Composite index that matches the most common ORDER BY in subscribeToServers /
-- listServers. Keeps reorder + filter-by-org cheap even when there are a lot of
-- servers in a single organization.
CREATE INDEX IF NOT EXISTS servers_org_pinned_sort_idx
  ON public.servers (org_id, is_pinned DESC, sort_order ASC)
  WHERE org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS servers_user_pinned_sort_idx
  ON public.servers (user_id, is_pinned DESC, sort_order ASC)
  WHERE org_id IS NULL;
