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

export interface ElectronAPI {
  ssh: {
    connect: (sessionId: string, config: SSHConnectionConfig) => Promise<{ success: boolean }>;
    disconnect: (sessionId: string) => Promise<{ success: boolean }>;
    sendData: (sessionId: string, data: string) => Promise<void>;
    resize: (sessionId: string, size: TerminalSize) => Promise<void>;
    onData: (callback: SSHDataCallback) => () => void;
    onStatus: (callback: SSHStatusCallback) => () => void;
  };
  auth: {
    setMasterKeyHash: (hash: string) => Promise<{ success: boolean }>;
    getStatus: () => Promise<{ hasMasterKey: boolean; masterKeyHash?: string }>;
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
  sftp: {
    connect: (
      sessionId: string,
      config: SSHConnectionConfig
    ) => Promise<{ success: boolean; error?: string }>;
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

export {};
