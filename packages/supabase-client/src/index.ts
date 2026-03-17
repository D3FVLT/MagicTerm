import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js';
import type { EncryptedServer, Server, ServerInput } from '@magicterm/shared';

export type { Session, User } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

export function initSupabase(url: string, anonKey: string): SupabaseClient {
  supabaseClient = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
    },
  });
  return supabaseClient;
}

export function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    throw new Error('Supabase client not initialized. Call initSupabase first.');
  }
  return supabaseClient;
}

export async function signUp(email: string, password: string) {
  const { data, error } = await getSupabase().auth.signUp({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await getSupabase().auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signInWithGitHub() {
  const { data, error } = await getSupabase().auth.signInWithOAuth({
    provider: 'github',
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getUser(): Promise<User | null> {
  const { data, error } = await getSupabase().auth.getUser();
  if (error && error.message !== 'Auth session missing!') throw error;
  return data?.user ?? null;
}

export function onAuthStateChange(
  callback: (event: string, session: Session | null) => void
) {
  return getSupabase().auth.onAuthStateChange(callback);
}

function mapToServer(row: EncryptedServer): Server {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type,
    credentials: row.credentials ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listServers(): Promise<Server[]> {
  const { data, error } = await getSupabase()
    .from('servers')
    .select('*')
    .order('name');

  if (error) throw error;
  return (data as EncryptedServer[]).map(mapToServer);
}

export async function getServer(id: string): Promise<Server | null> {
  const { data, error } = await getSupabase()
    .from('servers')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return mapToServer(data as EncryptedServer);
}

export async function createServer(
  server: ServerInput & { host: string; username: string; credentials: string }
): Promise<Server> {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await getSupabase()
    .from('servers')
    .insert({
      user_id: user.id,
      name: server.name,
      host: server.host,
      port: server.port,
      username: server.username,
      auth_type: server.authType,
      credentials: server.credentials,
    })
    .select()
    .single();

  if (error) throw error;
  return mapToServer(data as EncryptedServer);
}

export async function updateServer(
  id: string,
  updates: Partial<ServerInput> & { host?: string; username?: string; credentials?: string }
): Promise<Server> {
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.host !== undefined) updateData.host = updates.host;
  if (updates.port !== undefined) updateData.port = updates.port;
  if (updates.username !== undefined) updateData.username = updates.username;
  if (updates.authType !== undefined) updateData.auth_type = updates.authType;
  if (updates.credentials !== undefined) updateData.credentials = updates.credentials;

  const { data, error } = await getSupabase()
    .from('servers')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return mapToServer(data as EncryptedServer);
}

export async function deleteServer(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from('servers')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export function subscribeToServers(
  callback: (servers: Server[]) => void
) {
  const channel = getSupabase()
    .channel('servers-changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'servers',
      },
      async () => {
        const servers = await listServers();
        callback(servers);
      }
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
}
