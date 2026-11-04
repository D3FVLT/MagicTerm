-- Port forward presets per server.
-- The app stores them as one encrypted JSON list, like host and username,
-- so the database never sees the forward targets. Nullable and backward
-- compatible: older app versions ignore the column.

ALTER TABLE public.servers
ADD COLUMN IF NOT EXISTS port_forwards text;
