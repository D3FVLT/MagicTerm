export type AuthType = 'password' | 'key';

export interface Server {
  id: string;
  userId: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
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
  credentials: string;
}

export interface EncryptedServer {
  id: string;
  user_id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: AuthType;
  credentials: string | null;
  created_at: string;
  updated_at: string;
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
