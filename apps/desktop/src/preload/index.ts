import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type SSHConnectionConfig, type TerminalSize } from '@magicterm/shared';

export type SSHDataCallback = (sessionId: string, data: string) => void;
export type SSHStatusCallback = (sessionId: string, status: string, error?: string) => void;

const api = {
  ssh: {
    connect: (sessionId: string, config: SSHConnectionConfig) =>
      ipcRenderer.invoke(IPC_CHANNELS.SSH_CONNECT, sessionId, config),
    disconnect: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SSH_DISCONNECT, sessionId),
    sendData: (sessionId: string, data: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SSH_DATA, sessionId, data),
    resize: (sessionId: string, size: TerminalSize) =>
      ipcRenderer.invoke(IPC_CHANNELS.SSH_RESIZE, sessionId, size),
    onData: (callback: SSHDataCallback) => {
      const handler = (_event: Electron.IpcRendererEvent, sessionId: string, data: string) => {
        callback(sessionId, data);
      };
      ipcRenderer.on(IPC_CHANNELS.SSH_DATA, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SSH_DATA, handler);
    },
    onStatus: (callback: SSHStatusCallback) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        sessionId: string,
        status: string,
        error?: string
      ) => {
        callback(sessionId, status, error);
      };
      ipcRenderer.on(IPC_CHANNELS.SSH_STATUS, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SSH_STATUS, handler);
    },
  },
  auth: {
    setMasterKeyHash: (hash: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CRYPTO_SET_MASTER_KEY, hash),
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_STATUS),
    logout: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT),
  },
  servers: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.SERVERS_LIST),
    add: (server: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SERVERS_ADD, server),
    update: (id: string, updates: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.SERVERS_UPDATE, id, updates),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SERVERS_DELETE, id),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
