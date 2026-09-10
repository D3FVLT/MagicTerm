-- Add manual ordering to snippets
--
-- Until now snippets were listed alphabetically, which also decided which one
-- answered to the 1-9 paste shortcuts. That meant adding a snippet whose name
-- sorted early silently reshuffled everyone's muscle memory.
--
-- Usage by the client:
--   - sort_order → manual reorder index. Lower value = earlier in the list.
-- The list query uses:
--   order by sort_order asc, name asc

ALTER TABLE public.snippets
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Seed the order from the alphabetical listing that was in effect before this
-- migration, so nobody's shortcuts move on upgrade. Guarded so that re-running
-- the file can't overwrite an order the user has since arranged by hand.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.snippets WHERE sort_order <> 0) THEN
    WITH ranked AS (
      SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY name) - 1 AS position
      FROM public.snippets
    )
    UPDATE public.snippets s
    SET sort_order = ranked.position
    FROM ranked
    WHERE s.id = ranked.id;
  END IF;
END $$;

-- Matches the ORDER BY in listSnippets. Supersedes snippets_user_id_idx for
-- that query, which is kept since it still serves plain user_id lookups.
CREATE INDEX IF NOT EXISTS snippets_user_sort_idx
  ON public.snippets (user_id, sort_order ASC);
