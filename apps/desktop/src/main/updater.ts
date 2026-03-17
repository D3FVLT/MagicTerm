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
let isUpdaterSetup = false;
let pendingUpdateInfo: UpdateInfo | null = null;

function sendStatusToWindow(status: UpdateStatus) {
  console.log('[Updater] Status:', status.status, status.info?.version || '', status.error || '');
  const targetWindow = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null;
  if (targetWindow) {
    targetWindow.webContents.send('updater:status', status);
  } else {
    console.warn('[Updater] No window available, cannot send status');
  }
}

export function setupAutoUpdater(window: BrowserWindow) {
  mainWindow = window;

  if (isUpdaterSetup) {
    return;
  }
  isUpdaterSetup = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendStatusToWindow({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    pendingUpdateInfo = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    };
    sendStatusToWindow({
      status: 'available',
      info: pendingUpdateInfo,
    });
  });

  autoUpdater.on('update-not-available', () => {
    sendStatusToWindow({ status: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent ?? 0);
    console.log('[Updater] Download progress:', percent + '%');
    sendStatusToWindow({
      status: 'downloading',
      progress: percent,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded:', info.version);
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
    console.error('[Updater] Error:', error);
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
      console.log('[Updater] Download completed');
      // Fallback: update-downloaded event may not fire in some electron-updater versions/configs
      if (pendingUpdateInfo) {
        sendStatusToWindow({
          status: 'downloaded',
          info: pendingUpdateInfo,
        });
      }
      return { success: true };
    } catch (error) {
      console.error('[Updater] Download failed:', error);
      sendStatusToWindow({
        status: 'error',
        error: (error as Error).message,
      });
      return { success: false, error: (error as Error).message };
    }
  });

  ipc.handle('updater:install', () => {
    // setImmediate + short delay: electron-updater needs time to finalize before quitAndInstall
    // (see electron-builder#5521, #7054 - quitAndInstall can fail if called too soon)
    setImmediate(() => {
      setTimeout(() => {
        autoUpdater.quitAndInstall(false, true);
      }, 1500);
    });
  });
}
