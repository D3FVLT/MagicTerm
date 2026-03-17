export type AuthType = 'password' | 'key';
export type ConnectionType = 'ssh' | 'ftp' | 'sftp';
export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer';
export type InviteStatus = 'pending' | 'active' | 'declined';

export interface Organization {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationInput {
  name: string;
}

export interface OrgMember {
  id: string;
  orgId: string;
  userId: string | null;
  email: string;
  role: MemberRole;
  status: InviteStatus;
  invitedBy: string | null;
  invitedAt: string;
  joinedAt: string | null;
}

export interface InviteMemberInput {
  orgId: string;
  email: string;
  role: MemberRole;
}

export interface Server {
  id: string;
  userId: string | null;
  orgId: string | null;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  connectionType: ConnectionType;
  credentials?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerInput {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  connectionType: ConnectionType;
  credentials: string;
  orgId?: string;
}

export interface EncryptedServer {
  id: string;
  user_id: string | null;
  org_id: string | null;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: AuthType;
  connection_type: ConnectionType;
  credentials: string | null;
  created_at: string;
  updated_at: string;
}

export interface EncryptedOrganization {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface EncryptedOrgMember {
  id: string;
  org_id: string;
  user_id: string | null;
  email: string;
  role: MemberRole;
  status: InviteStatus;
  invited_by: string | null;
  invited_at: string;
  joined_at: string | null;
}

export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export interface SessionState {
  user: User | null;
  isAuthenticated: boolean;
  masterKeyHash: string | null;
}

export interface SSHConnectionConfig {
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKey?: string;
}

export interface FTPConnectionConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  secure?: boolean;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface TerminalSession {
  id: string;
  serverId: string;
  status: ConnectionStatus;
  error?: string;
}

export interface OrganizationWithRole extends Organization {
  role: MemberRole;
  memberCount?: number;
}
