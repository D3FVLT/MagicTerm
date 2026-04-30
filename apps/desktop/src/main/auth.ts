import { IpcMain, safeStorage, net } from 'electron';
import Store from 'electron-store';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { IPC_CHANNELS, STORAGE_KEYS } from '@magicterm/shared';
import { applyProxySettings } from './proxy';
import { clearCachedVerifier, getCachedVerifier } from './master-key';

const store = new Store();

// Probe URL for "is the proxy configured correctly?" — must be a stable,
// privacy-preserving endpoint we control or that returns no PII. Cloudflare's
// /cdn-cgi/trace returns plain text including the egress IP and is
// significantly less likely to log/correlate than third-party services like
// httpbin.org.
const PROXY_PROBE_URL = 'https://www.cloudflare.com/cdn-cgi/trace';

function parseTrace(body: string): string | undefined {
  for (const line of body.split('\n')) {
    const [k, v] = line.split('=');
    if (k === 'ip' && v) return v.trim();
  }
  return undefined;
}

function readProxyConfig(): Record<string, unknown> | null {
  // New encrypted-at-rest format takes precedence; fall back to the legacy
  // plaintext key so existing installs keep working until next save.
  const encrypted = store.get(STORAGE_KEYS.PROXY_CONFIG_ENCRYPTED) as string | undefined;
  if (encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      const json = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      return JSON.parse(json) as Record<string, unknown>;
    } catch {
      store.delete(STORAGE_KEYS.PROXY_CONFIG_ENCRYPTED);
    }
  }
  const legacy = store.get(STORAGE_KEYS.PROXY_CONFIG) as Record<string, unknown> | undefined;
  return legacy ?? null;
}

function writeProxyConfig(config: Record<string, unknown>): void {
  if (safeStorage.isEncryptionAvailable()) {
    const blob = safeStorage.encryptString(JSON.stringify(config));
    store.set(STORAGE_KEYS.PROXY_CONFIG_ENCRYPTED, blob.toString('base64'));
    store.delete(STORAGE_KEYS.PROXY_CONFIG);
  } else {
    // Last resort on Linux without an OS keyring; surface the risk in the UI.
    store.set(STORAGE_KEYS.PROXY_CONFIG, config);
  }
}

export function setupAuthHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.CRYPTO_SET_MASTER_KEY, async (_event, hash: string) => {
    // Legacy IPC kept for backward compatibility with old renderers writing
    // the SHA-256 hash. New code should use CRYPTO_SET_VERIFIER instead.
    store.set(STORAGE_KEYS.MASTER_KEY_HASH, hash);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_STATUS, async () => {
    // SECURITY: never return the verifier or legacy hash to the renderer.
    // The renderer only needs to know whether a master key has been set;
    // verification happens via CRYPTO_VERIFY_MASTER_PASSWORD which keeps
    // the verifier inside the main process.
    const cached = getCachedVerifier();
    const legacyHash = store.get(STORAGE_KEYS.MASTER_KEY_HASH) as string | undefined;
    return {
      hasMasterKey: Boolean(cached || legacyHash),
    };
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    store.delete(STORAGE_KEYS.MASTER_KEY_HASH);
    store.delete(STORAGE_KEYS.MASTER_KEY_VERIFIER);
    store.delete(STORAGE_KEYS.SUPABASE_SESSION);
    store.delete(STORAGE_KEYS.SAVED_MASTER_PASSWORD);
    clearCachedVerifier();
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
    // The plaintext password is still returned to the renderer here because
    // the existing E2E pipeline runs in the renderer (cryptoManager). Until
    // encryption is fully relocated to main, the password necessarily lives
    // in renderer memory after unlock; this handler does not widen that
    // exposure beyond what's already required.
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
    const config = readProxyConfig();
    return { success: true, config: config ?? null };
  });

  ipcMain.handle(IPC_CHANNELS.PROXY_SET, async (_event, config: Record<string, unknown>) => {
    writeProxyConfig(config);
    applyProxySettings();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.PROXY_TEST, async () => {
    try {
      const response = await net.fetch(PROXY_PROBE_URL, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }
      const body = await response.text();
      return { success: true, ip: parseTrace(body) };
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
