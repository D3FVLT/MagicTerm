import type { SSHConnectionConfig, TerminalSize } from '@magicterm/shared';

export type SSHDataCallback = (sessionId: string, data: string) => void;
export type SSHStatusCallback = (sessionId: string, status: string, error?: string) => void;

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
    check: () => Promise<{ success: boolean; updateInfo?: UpdateInfo; error?: string }>;
    download: () => Promise<{ success: boolean; error?: string }>;
    install: () => void;
    onStatus: (callback: UpdateStatusCallback) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
