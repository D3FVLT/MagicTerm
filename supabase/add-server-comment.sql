-- Add comment field to servers table
-- This is backward compatible - comment is nullable

ALTER TABLE public.servers 
ADD COLUMN IF NOT EXISTS comment text;
