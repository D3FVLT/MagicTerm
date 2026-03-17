export const APP_NAME = 'Magic Term';
export const APP_VERSION = '0.1.0';

export const DEFAULT_SSH_PORT = 22;
export const DEFAULT_SFTP_PORT = 22;
export const DEFAULT_FTP_PORT = 21;

export const PBKDF2_ITERATIONS = 100000;
export const PBKDF2_KEY_LENGTH = 256;
export const ENCRYPTION_ALGORITHM = 'AES-GCM';

export const IPC_CHANNELS = {
  SSH_CONNECT: 'ssh:connect',
  SSH_DISCONNECT: 'ssh:disconnect',
  SSH_DATA: 'ssh:data',
  SSH_RESIZE: 'ssh:resize',
  SSH_STATUS: 'ssh:status',
  
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_STATUS: 'auth:status',
  
  SERVERS_LIST: 'servers:list',
  SERVERS_ADD: 'servers:add',
  SERVERS_UPDATE: 'servers:update',
  SERVERS_DELETE: 'servers:delete',
  
  CRYPTO_SET_MASTER_KEY: 'crypto:setMasterKey',
  CRYPTO_ENCRYPT: 'crypto:encrypt',
  CRYPTO_DECRYPT: 'crypto:decrypt',
} as const;

export const STORAGE_KEYS = {
  MASTER_KEY_HASH: 'masterKeyHash',
  SUPABASE_SESSION: 'supabaseSession',
} as const;
