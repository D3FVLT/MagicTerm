export const APP_NAME = 'Magic Term';
export const APP_VERSION = '0.1.0';

export const DEFAULT_SSH_PORT = 22;
export const DEFAULT_SFTP_PORT = 22;
export const DEFAULT_FTP_PORT = 21;

export const PBKDF2_ITERATIONS = 100000;
export const PBKDF2_KEY_LENGTH = 256;
export const ENCRYPTION_ALGORITHM = 'AES-GCM';

// Master password policy (UI gates submission; server cannot enforce since it
// only sees the salted scrypt verifier, never the plaintext password).
export const MASTER_PASSWORD_MIN_LENGTH = 12;

// scrypt parameters for the master-password verifier. These run in the main
// process via Node's `crypto.scrypt` and govern how expensive an offline
// brute-force on a leaked verifier becomes. N must be a power of two.
//   N=2^15 (32768), r=8, p=1 — ~32 MiB of RAM and ~80–150 ms per attempt
//   on a modern desktop.
export const SCRYPT_N = 32768;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_SALT_LENGTH = 16;
export const SCRYPT_KEY_LENGTH = 32;
export const SCRYPT_MAX_MEM = 64 * 1024 * 1024; // upper bound passed to crypto.scrypt

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
  CRYPTO_CREATE_VERIFIER: 'crypto:createVerifier',
  CRYPTO_VERIFY_MASTER_PASSWORD: 'crypto:verifyMasterPassword',
  CRYPTO_SET_VERIFIER: 'crypto:setVerifier',

  SECURE_STORAGE_GET: 'secureStorage:get',
  SECURE_STORAGE_SET: 'secureStorage:set',
  SECURE_STORAGE_REMOVE: 'secureStorage:remove',

  CLIPBOARD_WRITE: 'clipboard:write',
  CLIPBOARD_READ: 'clipboard:read',

  PROXY_GET: 'proxy:get',
  PROXY_SET: 'proxy:set',
  PROXY_TEST: 'proxy:test',

  TERMINAL_SETTINGS_GET: 'terminalSettings:get',
  TERMINAL_SETTINGS_SET: 'terminalSettings:set',

  SSH_CONFIG_IMPORT: 'sshConfig:import',
} as const;

export const STORAGE_KEYS = {
  MASTER_KEY_HASH: 'masterKeyHash',
  MASTER_KEY_VERIFIER: 'masterKeyVerifier',
  SUPABASE_SESSION: 'supabaseSession',
  SAVED_MASTER_PASSWORD: 'savedMasterPassword',
  PROXY_CONFIG: 'proxyConfig',
  PROXY_CONFIG_ENCRYPTED: 'proxyConfigEncrypted',
  TERMINAL_SETTINGS: 'terminalSettings',
  SSH_KNOWN_HOSTS: 'sshKnownHosts',
} as const;
