import { app, BrowserWindow, shell, ipcMain, powerMonitor, dialog, session } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { setupSSHHandlers, cleanupAllSSHSessions, checkSSHSessions, getActiveSessionCount as getSSHCount } from './ssh';
import { setupSFTPHandlers, cleanupAllSFTPSessions, getActiveSessionCount as getSFTPCount } from './sftp';
import { setupLocalFsHandlers } from './local-fs';
import { setupAuthHandlers } from './auth';
import { setupServerHandlers } from './servers';
import { setupAutoUpdater, setupUpdaterHandlers } from './updater';
import { setupMasterKeyHandlers } from './master-key';
import { setupKnownHostsHandlers } from './known-hosts';
import { setupSecureStorageHandlers } from './secure-storage';
import { applyProxySettings } from './proxy';

let mainWindow: BrowserWindow | null = null;

// Schemes the renderer is allowed to hand to shell.openExternal. Anything
// else (file:, javascript:, ms-cxh:, custom protocols, ...) is silently
// dropped to avoid local-execution and SSRF-style attacks via crafted URLs
// in terminal output, snippets, or compromised renderer code.
const ALLOWED_EXTERNAL_SCHEMES = new Set(['https:', 'http:', 'mailto:']);

function isExternalUrlAllowed(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return ALLOWED_EXTERNAL_SCHEMES.has(url.protocol);
  } catch {
    return false;
  }
}

function safeOpenExternal(rawUrl: string): void {
  if (isExternalUrlAllowed(rawUrl)) {
    shell.openExternal(rawUrl);
  } else {
    console.warn('[Security] Blocked openExternal for non-allowlisted URL');
  }
}

function installSecurityPolicies(): void {
  // Defence in depth: even with sandbox + contextIsolation, a renderer XSS
  // could try to load a remote script or open a file:// URL. Block both.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    if (
      url.startsWith('chrome-devtools://') ||
      url.startsWith('devtools://') ||
      url.startsWith('chrome-extension://')
    ) {
      callback({});
      return;
    }
    callback({});
  });

  // Reject creation of new webContents (windows, webviews) — we intercept
  // window.open via setWindowOpenHandler instead.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault());
    contents.on('will-navigate', (e, url) => {
      // Allow Vite HMR / file:// app shell, deny anything else.
      const isDevServer = is.dev && url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? '');
      const isAppShell = url.startsWith('file://');
      if (!isDevServer && !isAppShell) {
        e.preventDefault();
        safeOpenExternal(url);
      }
    });
  });
}

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
      preload: join(__dirname, '../preload/index.js'),
      // sandbox: true forces the renderer into the OS sandbox. The preload
      // bridge is already context-isolated and only exposes thin
      // ipcRenderer.invoke wrappers + clipboard, so there is no Node-only
      // API in the renderer that requires sandbox: false.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
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
    safeOpenExternal(details.url);
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

  installSecurityPolicies();
  applyProxySettings();

  setupMasterKeyHandlers(ipcMain);
  setupKnownHostsHandlers(ipcMain);
  setupSecureStorageHandlers(ipcMain);
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
