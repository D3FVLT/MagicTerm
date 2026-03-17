import type { SSHConnectionConfig, TerminalSize } from '@magicterm/shared';

export type SSHDataCallback = (sessionId: string, data: string) => void;
export type SSHStatusCallback = (sessionId: string, status: string, error?: string) => void;

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
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
