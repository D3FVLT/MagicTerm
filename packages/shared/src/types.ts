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
  nickname?: string;
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
  comment?: string;
  isPinned: boolean;
  sortOrder: number;
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
  comment?: string;
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
  comment: string | null;
  is_pinned: boolean;
  sort_order: number;
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

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
  permissions?: string;
  isSymlink?: boolean;
}

export interface TransferProgress {
  id: string;
  sessionId: string;
  filename: string;
  localPath: string;
  remotePath: string;
  transferred: number;
  total: number;
  direction: 'upload' | 'download';
  status: 'pending' | 'transferring' | 'completed' | 'error' | 'cancelled';
  error?: string;
}

export interface SFTPSession {
  id: string;
  serverId: string;
  status: ConnectionStatus;
  currentPath: string;
  error?: string;
}

export type SessionType = 'terminal' | 'sftp';

export interface UserSettings {
  nickname: string | null;
  defaultOrgId: string | null;
}

export interface EncryptedUserProfile {
  id: string;
  master_key_hash: string | null;
  nickname: string | null;
  default_org_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Snippet {
  id: string;
  userId: string;
  name: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface SnippetInput {
  name: string;
  value: string;
}

export interface EncryptedSnippet {
  id: string;
  user_id: string;
  name: string;
  value: string;
  created_at: string;
  updated_at: string;
}
