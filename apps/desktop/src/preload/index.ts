import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type SSHConnectionConfig,
  type TerminalSize,
  type TransferProgress,
} from '@magicterm/shared';

export type SSHDataCallback = (sessionId: string, data: string) => void;
export type SSHStatusCallback = (sessionId: string, status: string, error?: string) => void;
export type TransferProgressCallback = (progress: TransferProgress) => void;

export interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: {
    version: string;
    releaseDate: string;
    releaseNotes?: string;
  };
  progress?: number;
  error?: string;
}

export type UpdateStatusCallback = (status: UpdateStatus) => void;

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
  updater: {
    getPlatform: () => ipcRenderer.invoke('updater:getPlatform'),
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    openReleasePage: () => ipcRenderer.invoke('updater:openReleasePage'),
    onStatus: (callback: UpdateStatusCallback) => {
      const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => {
        callback(status);
      };
      ipcRenderer.on('updater:status', handler);
      return () => ipcRenderer.removeListener('updater:status', handler);
    },
  },
  sftp: {
    connect: (sessionId: string, config: SSHConnectionConfig) =>
      ipcRenderer.invoke(IPC_CHANNELS.SFTP_CONNECT, sessionId, config),
    disconnect: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SFTP_DISCONNECT, sessionId),
    list: (sessionId: string, remotePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SFTP_LIST, sessionId, remotePath),
    stat: (sessionId: string, remotePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SFTP_STAT, sessionId, remotePath),
    download: (sessionId: string, transferId: string, remotePath: string, localPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SFTP_DOWNLOAD, sessionId, transferId, remotePath, localPath),
    upload: (sessionId: string, transferId: string, localPath: string, remotePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SFTP_UPLOAD, sessionId, transferId, localPath, remotePath),
    delete: (sessionId: string, remotePath: string, isDirectory: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.SFTP_DELETE, sessionId, remotePath, isDirectory),
    rename: (sessionId: string, oldPath: string, newPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SFTP_RENAME, sessionId, oldPath, newPath),
    mkdir: (sessionId: string, remotePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SFTP_MKDIR, sessionId, remotePath),
    readFile: (sessionId: string, remotePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SFTP_READ_FILE, sessionId, remotePath),
    writeFile: (sessionId: string, remotePath: string, content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SFTP_WRITE_FILE, sessionId, remotePath, content),
    onProgress: (callback: TransferProgressCallback) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: TransferProgress) => {
        callback(progress);
      };
      ipcRenderer.on(IPC_CHANNELS.SFTP_PROGRESS, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SFTP_PROGRESS, handler);
    },
  },
  localFs: {
    getHome: () => ipcRenderer.invoke(IPC_CHANNELS.LOCAL_GET_HOME),
    list: (dirPath: string) => ipcRenderer.invoke(IPC_CHANNELS.LOCAL_LIST, dirPath),
    openFile: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.LOCAL_OPEN_FILE, filePath),
    reveal: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.LOCAL_REVEAL, filePath),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
