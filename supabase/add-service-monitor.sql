-- Services monitor settings and the last scan per server.
-- The app stores them as one encrypted JSON value, like host and username,
-- so the database never sees domains, paths, ports or commands. Nullable
-- and backward compatible: older app versions ignore the column. The
-- existing servers policies apply: viewers can read it, not change it.

ALTER TABLE public.servers
ADD COLUMN IF NOT EXISTS monitor text;
