import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js';
import type {
  EncryptedServer,
  EncryptedOrganization,
  EncryptedOrgMember,
  Server,
  ServerInput,
  Organization,
  OrganizationInput,
  OrgMember,
  InviteMemberInput,
  MemberRole,
  OrganizationWithRole,
} from '@magicterm/shared';

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

// ============================================
// AUTH
// ============================================

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

// ============================================
// ORGANIZATIONS
// ============================================

function mapToOrganization(row: EncryptedOrganization): Organization {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listOrganizations(): Promise<OrganizationWithRole[]> {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: memberships, error: memberError } = await getSupabase()
    .from('org_members')
    .select('org_id, role')
    .eq('user_id', user.id)
    .eq('status', 'active');

  if (memberError) throw memberError;

  if (!memberships || memberships.length === 0) {
    return [];
  }

  const orgIds = memberships.map((m) => m.org_id);
  const roleMap = new Map(memberships.map((m) => [m.org_id, m.role as MemberRole]));

  const { data: orgs, error: orgError } = await getSupabase()
    .from('organizations')
    .select('*')
    .in('id', orgIds)
    .order('name');

  if (orgError) throw orgError;

  return (orgs as EncryptedOrganization[]).map((org) => ({
    ...mapToOrganization(org),
    role: roleMap.get(org.id) || 'member',
  }));
}

export async function getOrganization(id: string): Promise<Organization | null> {
  const { data, error } = await getSupabase()
    .from('organizations')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return mapToOrganization(data as EncryptedOrganization);
}

export async function createOrganization(input: OrganizationInput): Promise<Organization> {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await getSupabase()
    .from('organizations')
    .insert({
      name: input.name,
      owner_id: user.id,
    })
    .select()
    .single();

  if (error) throw error;
  return mapToOrganization(data as EncryptedOrganization);
}

export async function updateOrganization(
  id: string,
  updates: Partial<OrganizationInput>
): Promise<Organization> {
  const { data, error } = await getSupabase()
    .from('organizations')
    .update({
      name: updates.name,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return mapToOrganization(data as EncryptedOrganization);
}

export async function deleteOrganization(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from('organizations')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============================================
// ORGANIZATION MEMBERS
// ============================================

function mapToOrgMember(row: EncryptedOrgMember): OrgMember {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    email: row.email,
    role: row.role,
    status: row.status,
    invitedBy: row.invited_by,
    invitedAt: row.invited_at,
    joinedAt: row.joined_at,
  };
}

export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  const { data, error } = await getSupabase()
    .from('org_members')
    .select('*')
    .eq('org_id', orgId)
    .order('joined_at', { nullsFirst: false });

  if (error) throw error;
  return (data as EncryptedOrgMember[]).map(mapToOrgMember);
}

export async function inviteMember(input: InviteMemberInput): Promise<OrgMember> {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await getSupabase()
    .from('org_members')
    .insert({
      org_id: input.orgId,
      email: input.email,
      role: input.role,
      invited_by: user.id,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;
  return mapToOrgMember(data as EncryptedOrgMember);
}

export async function acceptInvite(memberId: string): Promise<OrgMember> {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await getSupabase()
    .from('org_members')
    .update({
      status: 'active',
      user_id: user.id,
      joined_at: new Date().toISOString(),
    })
    .eq('id', memberId)
    .select()
    .single();

  if (error) throw error;
  return mapToOrgMember(data as EncryptedOrgMember);
}

export async function declineInvite(memberId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('org_members')
    .update({ status: 'declined' })
    .eq('id', memberId);

  if (error) throw error;
}

export async function updateMemberRole(memberId: string, role: MemberRole): Promise<OrgMember> {
  const { data, error } = await getSupabase()
    .from('org_members')
    .update({ role })
    .eq('id', memberId)
    .select()
    .single();

  if (error) throw error;
  return mapToOrgMember(data as EncryptedOrgMember);
}

export async function removeMember(memberId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('org_members')
    .delete()
    .eq('id', memberId);

  if (error) throw error;
}

export async function getPendingInvites(): Promise<OrgMember[]> {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await getSupabase()
    .from('org_members')
    .select('*')
    .eq('email', user.email)
    .eq('status', 'pending');

  if (error) throw error;
  return (data as EncryptedOrgMember[]).map(mapToOrgMember);
}

// ============================================
// SERVERS
// ============================================

function mapToServer(row: EncryptedServer): Server {
  return {
    id: row.id,
    userId: row.user_id,
    orgId: row.org_id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type,
    connectionType: row.connection_type,
    credentials: row.credentials ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listServers(orgId?: string): Promise<Server[]> {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  let query = getSupabase().from('servers').select('*');

  if (orgId) {
    query = query.eq('org_id', orgId);
  } else {
    query = query.eq('user_id', user.id);
  }

  const { data, error } = await query.order('name');

  if (error) throw error;
  return (data as EncryptedServer[]).map(mapToServer);
}

export async function listAllServers(): Promise<Server[]> {
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

  const insertData: Record<string, unknown> = {
    name: server.name,
    host: server.host,
    port: server.port,
    username: server.username,
    auth_type: server.authType,
    connection_type: server.connectionType,
    credentials: server.credentials,
  };

  if (server.orgId) {
    insertData.org_id = server.orgId;
  } else {
    insertData.user_id = user.id;
  }

  const { data, error } = await getSupabase()
    .from('servers')
    .insert(insertData)
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
  if (updates.connectionType !== undefined) updateData.connection_type = updates.connectionType;
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
  callback: (servers: Server[]) => void,
  orgId?: string
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
        const servers = orgId ? await listServers(orgId) : await listAllServers();
        callback(servers);
      }
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
}

export function subscribeToOrgMembers(
  orgId: string,
  callback: (members: OrgMember[]) => void
) {
  const channel = getSupabase()
    .channel(`org-members-${orgId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'org_members',
        filter: `org_id=eq.${orgId}`,
      },
      async () => {
        const members = await listOrgMembers(orgId);
        callback(members);
      }
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
}
