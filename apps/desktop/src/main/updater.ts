import { autoUpdater } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';

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

let mainWindow: BrowserWindow | null = null;

function sendStatusToWindow(status: UpdateStatus) {
  if (mainWindow) {
    mainWindow.webContents.send('updater:status', status);
  }
}

export function setupAutoUpdater(window: BrowserWindow) {
  mainWindow = window;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendStatusToWindow({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendStatusToWindow({
      status: 'available',
      info: {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      },
    });
  });

  autoUpdater.on('update-not-available', () => {
    sendStatusToWindow({ status: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendStatusToWindow({
      status: 'downloading',
      progress: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendStatusToWindow({
      status: 'downloaded',
      info: {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      },
    });
  });

  autoUpdater.on('error', (error) => {
    sendStatusToWindow({
      status: 'error',
      error: error.message,
    });
  });
}

export function setupUpdaterHandlers(ipc: typeof ipcMain) {
  ipc.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return { success: true, updateInfo: result?.updateInfo };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipc.handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipc.handle('updater:install', () => {
    autoUpdater.quitAndInstall(false, true);
  });
}
