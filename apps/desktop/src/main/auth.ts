import { IpcMain, safeStorage } from 'electron';
import Store from 'electron-store';
import { IPC_CHANNELS, STORAGE_KEYS } from '@magicterm/shared';
import { applyProxySettings } from './proxy';

const store = new Store();

export function setupAuthHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.CRYPTO_SET_MASTER_KEY, async (_event, hash: string) => {
    store.set(STORAGE_KEYS.MASTER_KEY_HASH, hash);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_STATUS, async () => {
    const masterKeyHash = store.get(STORAGE_KEYS.MASTER_KEY_HASH) as string | undefined;
    return {
      hasMasterKey: !!masterKeyHash,
      masterKeyHash,
    };
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    store.delete(STORAGE_KEYS.MASTER_KEY_HASH);
    store.delete(STORAGE_KEYS.SUPABASE_SESSION);
    store.delete(STORAGE_KEYS.SAVED_MASTER_PASSWORD);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.CRYPTO_SAVE_MASTER_PASSWORD, async (_event, password: string) => {
    if (!safeStorage.isEncryptionAvailable()) {
      return { success: false, error: 'Encryption not available on this system' };
    }
    const encrypted = safeStorage.encryptString(password);
    store.set(STORAGE_KEYS.SAVED_MASTER_PASSWORD, encrypted.toString('base64'));
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.CRYPTO_GET_SAVED_MASTER_PASSWORD, async () => {
    const stored = store.get(STORAGE_KEYS.SAVED_MASTER_PASSWORD) as string | undefined;
    if (!stored || !safeStorage.isEncryptionAvailable()) {
      return { success: false };
    }
    try {
      const decrypted = safeStorage.decryptString(Buffer.from(stored, 'base64'));
      return { success: true, password: decrypted };
    } catch {
      store.delete(STORAGE_KEYS.SAVED_MASTER_PASSWORD);
      return { success: false };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CRYPTO_CLEAR_SAVED_MASTER_PASSWORD, async () => {
    store.delete(STORAGE_KEYS.SAVED_MASTER_PASSWORD);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.PROXY_GET, async () => {
    const config = store.get(STORAGE_KEYS.PROXY_CONFIG) as Record<string, unknown> | undefined;
    return { success: true, config: config || null };
  });

  ipcMain.handle(IPC_CHANNELS.PROXY_SET, async (_event, config: Record<string, unknown>) => {
    store.set(STORAGE_KEYS.PROXY_CONFIG, config);
    applyProxySettings();
    return { success: true };
  });
}
