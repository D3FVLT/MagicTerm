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

  SFTP_CONNECT: 'sftp:connect',
  SFTP_DISCONNECT: 'sftp:disconnect',
  SFTP_LIST: 'sftp:list',
  SFTP_DOWNLOAD: 'sftp:download',
  SFTP_UPLOAD: 'sftp:upload',
  SFTP_DELETE: 'sftp:delete',
  SFTP_RENAME: 'sftp:rename',
  SFTP_MKDIR: 'sftp:mkdir',
  SFTP_STAT: 'sftp:stat',
  SFTP_PROGRESS: 'sftp:progress',
  SFTP_READ_FILE: 'sftp:readFile',
  SFTP_WRITE_FILE: 'sftp:writeFile',

  LOCAL_LIST: 'local:list',
  LOCAL_GET_HOME: 'local:getHome',
  LOCAL_OPEN_FILE: 'local:openFile',
  LOCAL_REVEAL: 'local:reveal',
  
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
  CRYPTO_SAVE_MASTER_PASSWORD: 'crypto:saveMasterPassword',
  CRYPTO_GET_SAVED_MASTER_PASSWORD: 'crypto:getSavedMasterPassword',
  CRYPTO_CLEAR_SAVED_MASTER_PASSWORD: 'crypto:clearSavedMasterPassword',

  CLIPBOARD_WRITE: 'clipboard:write',
  CLIPBOARD_READ: 'clipboard:read',

  PROXY_GET: 'proxy:get',
  PROXY_SET: 'proxy:set',
  PROXY_TEST: 'proxy:test',
} as const;

export const STORAGE_KEYS = {
  MASTER_KEY_HASH: 'masterKeyHash',
  SUPABASE_SESSION: 'supabaseSession',
  SAVED_MASTER_PASSWORD: 'savedMasterPassword',
  PROXY_CONFIG: 'proxyConfig',
} as const;
