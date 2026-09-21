/** Local mode must not construct a Supabase client or open a realtime channel. */
export function shouldContactSupabase(localOnly: boolean): boolean {
  return !localOnly;
}
