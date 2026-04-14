import { app, BrowserWindow, shell, ipcMain, powerMonitor, dialog } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { setupSSHHandlers, cleanupAllSSHSessions, checkSSHSessions, getActiveSessionCount as getSSHCount } from './ssh';
import { setupSFTPHandlers, cleanupAllSFTPSessions, getActiveSessionCount as getSFTPCount } from './sftp';
import { setupLocalFsHandlers } from './local-fs';
import { setupAuthHandlers } from './auth';
import { setupServerHandlers } from './servers';
import { setupAutoUpdater, setupUpdaterHandlers } from './updater';
import { applyProxySettings } from './proxy';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  let forceQuit = false;
  mainWindow.on('close', (e) => {
    if (forceQuit) return;
    const total = getSSHCount() + getSFTPCount();
    if (total > 0) {
      e.preventDefault();
      dialog
        .showMessageBox(mainWindow!, {
          type: 'question',
          buttons: ['Close', 'Cancel'],
          defaultId: 1,
          title: 'Active Connections',
          message: `You have ${total} active connection${total > 1 ? 's' : ''}. Close anyway?`,
        })
        .then(({ response }) => {
          if (response === 0) {
            forceQuit = true;
            mainWindow?.close();
          }
        });
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  if (!is.dev) {
    setupAutoUpdater(mainWindow);
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.magicterm.app');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  applyProxySettings();

  setupSSHHandlers(ipcMain);
  setupSFTPHandlers(ipcMain);
  setupLocalFsHandlers(ipcMain);
  setupAuthHandlers(ipcMain);
  setupServerHandlers(ipcMain);
  setupUpdaterHandlers(ipcMain);

  createWindow();

  powerMonitor.on('resume', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      checkSSHSessions(mainWindow.webContents);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  cleanupAllSSHSessions();
  cleanupAllSFTPSessions();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

export { mainWindow };
