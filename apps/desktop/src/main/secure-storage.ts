import { IpcMain, safeStorage } from 'electron';
import Store from 'electron-store';
import { IPC_CHANNELS } from '@magicterm/shared';

const store = new Store({ name: 'secure-storage' });

const PREFIX = 'enc:';

function encryptValue(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    // Linux without keyring: persist as plain text but tag the entry so we
    // know not to attempt decryption later. Surface a warning so operators
    // notice they have an unencrypted Supabase session on disk.
    console.warn('[secure-storage] safeStorage unavailable; falling back to plain text storage');
    return value;
  }
  return PREFIX + safeStorage.encryptString(value).toString('base64');
}

function decryptValue(stored: string): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) {
    // Legacy / fallback plain-text entry.
    return stored;
  }
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(PREFIX.length), 'base64'));
  } catch {
    return null;
  }
}

/**
 * Backing store for the renderer-side Supabase auth `storage` adapter. The
 * renderer used to keep the Supabase session in localStorage as JSON; that
 * means a renderer XSS could exfiltrate the refresh token directly. By
 * routing reads/writes through here we land the encrypted blob in the OS
 * keychain (via Electron `safeStorage`) so the on-disk artifact is no
 * longer trivially exfiltrable.
 */
export function setupSecureStorageHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.SECURE_STORAGE_GET, async (_event, key: string) => {
    if (typeof key !== 'string' || key.length === 0 || key.length > 256) {
      return { success: false, error: 'invalid_key', value: null };
    }
    const stored = store.get(key) as string | undefined;
    if (!stored) return { success: true, value: null };
    return { success: true, value: decryptValue(stored) };
  });

  ipcMain.handle(IPC_CHANNELS.SECURE_STORAGE_SET, async (_event, key: string, value: string) => {
    if (typeof key !== 'string' || key.length === 0 || key.length > 256) {
      return { success: false, error: 'invalid_key' };
    }
    if (typeof value !== 'string') {
      return { success: false, error: 'invalid_value' };
    }
    store.set(key, encryptValue(value));
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.SECURE_STORAGE_REMOVE, async (_event, key: string) => {
    if (typeof key !== 'string' || key.length === 0) {
      return { success: false, error: 'invalid_key' };
    }
    store.delete(key);
    return { success: true };
  });
}
