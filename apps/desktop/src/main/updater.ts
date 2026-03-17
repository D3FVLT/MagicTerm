import pkg from 'electron-updater';
const { autoUpdater } = pkg;
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
  console.log('[Updater] Status:', status.status, status.info?.version || '');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', status);
  } else {
    console.warn('[Updater] Window not available, cannot send status');
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
    console.log('Download progress:', Math.round(progress.percent) + '%');
    sendStatusToWindow({
      status: 'downloading',
      progress: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version);
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
      console.log('[Updater] Starting download...');
      await autoUpdater.downloadUpdate();
      console.log('[Updater] Download started successfully');
      return { success: true };
    } catch (error) {
      console.error('[Updater] Download failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipc.handle('updater:install', () => {
    autoUpdater.quitAndInstall(false, true);
  });
}
