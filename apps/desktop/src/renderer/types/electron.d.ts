import type {
  SSHConnectionConfig,
  TerminalSize,
  FileEntry,
  TransferProgress,
} from '@magicterm/shared';

export type SSHDataCallback = (sessionId: string, data: string) => void;
export type SSHStatusCallback = (sessionId: string, status: string, error?: string) => void;
export type TransferProgressCallback = (progress: TransferProgress) => void;

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
}

export interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: UpdateInfo;
  progress?: number;
  error?: string;
}

export type UpdateStatusCallback = (status: UpdateStatus) => void;

export type HostKeyChallenge =
  | {
      success: false;
      code: 'host_key_unknown';
      host: string;
      port: number;
      fingerprint: string;
    }
  | {
      success: false;
      code: 'host_key_mismatch';
      host: string;
      port: number;
      fingerprint: string;
      storedFingerprint: string;
    };

export type ConnectFailure = { success: false; error: string; cancelled?: boolean };

export type SshConnectResult = { success: true } | HostKeyChallenge | ConnectFailure;

export type SftpConnectResult =
  | { success: true; homePath: string }
  | HostKeyChallenge
  | ConnectFailure;

export interface ElectronAPI {
  ssh: {
    connect: (sessionId: string, config: SSHConnectionConfig) => Promise<SshConnectResult>;
    disconnect: (sessionId: string) => Promise<{ success: boolean }>;
    sendData: (sessionId: string, data: string) => Promise<void>;
    resize: (sessionId: string, size: TerminalSize) => Promise<{ applied: boolean; queued: boolean }>;
    onData: (callback: SSHDataCallback) => () => void;
    onStatus: (callback: SSHStatusCallback) => () => void;
  };
  auth: {
    /** @deprecated Legacy SHA-256 hash channel. Prefer masterKey.createVerifier. */
    setMasterKeyHash: (hash: string) => Promise<{ success: boolean }>;
    getStatus: () => Promise<{ hasMasterKey: boolean }>;
    logout: () => Promise<{ success: boolean }>;
  };
  servers: {
    list: () => Promise<{ servers: unknown[] }>;
    add: (server: unknown) => Promise<{ server: unknown }>;
    update: (id: string, updates: unknown) => Promise<{ id: string; updates: unknown }>;
    delete: (id: string) => Promise<{ id: string }>;
  };
  updater: {
    getPlatform: () => Promise<{ platform: string; isMac: boolean }>;
    check: () => Promise<{ success: boolean; updateInfo?: UpdateInfo; error?: string }>;
    download: () => Promise<{ success: boolean; error?: string; openedExternal?: boolean }>;
    install: () => void;
    openReleasePage: () => Promise<void>;
    onStatus: (callback: UpdateStatusCallback) => () => void;
  };
  clipboard: {
    writeText: (text: string) => Promise<{ success: boolean; error?: string }>;
    readText: () => Promise<{ success: boolean; text: string; error?: string }>;
  };
  masterPassword: {
    save: (password: string) => Promise<{ success: boolean; error?: string }>;
    get: () => Promise<{ success: boolean; password?: string }>;
    clear: () => Promise<{ success: boolean }>;
  };
  masterKey: {
    setVerifier: (verifier: string | null) => Promise<{ success: boolean; error?: string }>;
    createVerifier: (password: string) => Promise<{ success: boolean; verifier?: string; error?: string }>;
    verify: (
      password: string
    ) => Promise<{
      success: boolean;
      valid?: boolean;
      upgraded?: boolean;
      verifier?: string;
      error?: string;
    }>;
  };
  sshHostKeys: {
    list: () => Promise<{ hostPort: string; fingerprint: string; addedAt: string }[]>;
    trust: (host: string, port: number, fingerprint: string) => Promise<{ success: boolean; error?: string }>;
    forget: (host: string, port: number) => Promise<{ success: boolean; error?: string }>;
  };
  secureStorage: {
    get: (key: string) => Promise<{ success: boolean; value: string | null; error?: string }>;
    set: (key: string, value: string) => Promise<{ success: boolean; error?: string }>;
    remove: (key: string) => Promise<{ success: boolean; error?: string }>;
  };
  proxy: {
    get: () => Promise<{ success: boolean; config: { enabled: boolean; type: string; host: string; port: number; username?: string; password?: string } | null }>;
    set: (config: { enabled: boolean; type: string; host: string; port: number; username?: string; password?: string }) => Promise<{ success: boolean }>;
    test: () => Promise<{ success: boolean; ip?: string; error?: string }>;
  };
  terminalSettings: {
    get: () => Promise<{ success: boolean; settings: Record<string, unknown> | null }>;
    set: (settings: Record<string, unknown>) => Promise<{ success: boolean }>;
  };
  sshConfig: {
    import: () => Promise<{ success: boolean; hosts: { name: string; host: string; port: number; username: string; identityFile?: string }[]; error?: string }>;
  };
  sftp: {
    connect: (sessionId: string, config: SSHConnectionConfig) => Promise<SftpConnectResult>;
    disconnect: (sessionId: string) => Promise<{ success: boolean }>;
    list: (
      sessionId: string,
      remotePath: string
    ) => Promise<{ success: boolean; entries?: FileEntry[]; error?: string }>;
    stat: (
      sessionId: string,
      remotePath: string
    ) => Promise<{ success: boolean; entry?: FileEntry; error?: string }>;
    download: (
      sessionId: string,
      transferId: string,
      remotePath: string,
      localPath: string
    ) => Promise<{ success: boolean; error?: string }>;
    upload: (
      sessionId: string,
      transferId: string,
      localPath: string,
      remotePath: string
    ) => Promise<{ success: boolean; error?: string }>;
    delete: (
      sessionId: string,
      remotePath: string,
      isDirectory: boolean
    ) => Promise<{ success: boolean; error?: string }>;
    rename: (
      sessionId: string,
      oldPath: string,
      newPath: string
    ) => Promise<{ success: boolean; error?: string }>;
    mkdir: (
      sessionId: string,
      remotePath: string
    ) => Promise<{ success: boolean; error?: string }>;
    readFile: (
      sessionId: string,
      remotePath: string
    ) => Promise<{ success: boolean; content?: string; error?: string }>;
    writeFile: (
      sessionId: string,
      remotePath: string,
      content: string
    ) => Promise<{ success: boolean; error?: string }>;
    pickUploadFiles: () => Promise<{ success: boolean; canceled?: boolean; files: string[] }>;
    pickDownloadDestination: (
      suggestedName: string
    ) => Promise<{ success: boolean; canceled?: boolean; filePath?: string }>;
    onProgress: (callback: TransferProgressCallback) => () => void;
  };
  localFs: {
    getHome: () => Promise<{ success: boolean; path?: string }>;
    list: (
      dirPath: string
    ) => Promise<{ success: boolean; entries?: FileEntry[]; error?: string }>;
    openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    reveal: (filePath: string) => Promise<{ success: boolean }>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
  
  const __APP_VERSION__: string;
}

export { };
