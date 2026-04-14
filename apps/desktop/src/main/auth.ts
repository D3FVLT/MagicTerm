import { IpcMain, safeStorage, net } from 'electron';
import Store from 'electron-store';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
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

  ipcMain.handle(IPC_CHANNELS.PROXY_TEST, async () => {
    try {
      const response = await net.fetch('https://httpbin.org/ip', {
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const data = await response.json();
        return { success: true, ip: data.origin };
      }
      return { success: false, error: `HTTP ${response.status}` };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.TERMINAL_SETTINGS_GET, async () => {
    const settings = store.get(STORAGE_KEYS.TERMINAL_SETTINGS) as Record<string, unknown> | undefined;
    return { success: true, settings: settings || null };
  });

  ipcMain.handle(IPC_CHANNELS.TERMINAL_SETTINGS_SET, async (_event, settings: Record<string, unknown>) => {
    store.set(STORAGE_KEYS.TERMINAL_SETTINGS, settings);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.SSH_CONFIG_IMPORT, async () => {
    try {
      const configPath = join(homedir(), '.ssh', 'config');
      const content = await readFile(configPath, 'utf-8');
      const hosts: { name: string; host: string; port: number; username: string; identityFile?: string }[] = [];
      let current: Record<string, string> | null = null;

      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const match = trimmed.match(/^(\S+)\s+(.+)$/);
        if (!match) continue;

        const [, key, value] = match;
        if (key.toLowerCase() === 'host') {
          if (current && current['hostname']) {
            hosts.push({
              name: current['_name'],
              host: current['hostname'],
              port: parseInt(current['port'] || '22', 10),
              username: current['user'] || '',
              identityFile: current['identityfile'],
            });
          }
          if (value.includes('*') || value.includes('?')) {
            current = null;
          } else {
            current = { _name: value };
          }
        } else if (current) {
          current[key.toLowerCase()] = value;
        }
      }
      if (current && current['hostname']) {
        hosts.push({
          name: current['_name'],
          host: current['hostname'],
          port: parseInt(current['port'] || '22', 10),
          username: current['user'] || '',
          identityFile: current['identityfile'],
        });
      }

      return { success: true, hosts };
    } catch (err) {
      return { success: false, error: (err as Error).message, hosts: [] };
    }
  });
}
