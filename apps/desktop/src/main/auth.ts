import { IpcMain, safeStorage, net } from 'electron';
import Store from 'electron-store';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { IPC_CHANNELS, STORAGE_KEYS } from '@magicterm/shared';
import {
  applyProxySettings,
  readProxyConfig,
  writeProxyConfig,
  type ProxyConfig,
} from './proxy';
import { clearCachedVerifier, getCachedVerifier } from './master-key';
import { parseAiSettings } from '../common/ai-assistant';
import { completeChat, verifyModel } from './ai-complete';

const store = new Store();

const aiRequests = new Map<string, AbortController>();

const PROXY_PROBE_URL = 'https://www.cloudflare.com/cdn-cgi/trace';

function parseTrace(body: string): string | undefined {
  for (const line of body.split('\n')) {
    const [k, v] = line.split('=');
    if (k === 'ip' && v) return v.trim();
  }
  return undefined;
}

export function setupAuthHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.CRYPTO_SET_MASTER_KEY, async (_event, hash: string) => {
    store.set(STORAGE_KEYS.MASTER_KEY_HASH, hash);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_STATUS, async () => {
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

  ipcMain.handle(IPC_CHANNELS.PROXY_SET, async (_event, config: ProxyConfig) => {
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

  ipcMain.handle(IPC_CHANNELS.AI_SETTINGS_GET, async () => {
    return { success: true, settings: store.get(STORAGE_KEYS.AI_ASSISTANT) ?? null };
  });

  ipcMain.handle(IPC_CHANNELS.AI_SETTINGS_SET, async (_event, settings: unknown) => {
    const parsed = parseAiSettings(settings);
    if (!parsed.ok) return { success: false, error: parsed.error };
    store.set(STORAGE_KEYS.AI_ASSISTANT, parsed.settings);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.AI_CANCEL, async (_event, requestId: unknown) => {
    if (typeof requestId === 'string') aiRequests.get(requestId)?.abort();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.AI_COMPLETE, async (event, input: unknown) => {
    if (!input || typeof input !== 'object') return { success: false, error: 'Bad request' };
    const raw = input as Record<string, unknown>;
    const provider = raw.provider;
    if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'openrouter' && provider !== 'ollama') {
      return { success: false, error: 'Unknown provider' };
    }
    if (typeof raw.model !== 'string' || !raw.model.trim() || raw.model.length > 120) {
      return { success: false, error: 'Model is missing' };
    }
    if (typeof raw.baseUrl !== 'string') return { success: false, error: 'URL is missing' };
    const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey : '';
    if (provider !== 'ollama' && !apiKey) return { success: false, error: 'API key is missing' };
    if (apiKey.length > 500) return { success: false, error: 'API key is too long' };
    if (typeof raw.system !== 'string' || raw.system.length > 4000) return { success: false, error: 'Bad request' };
    if (!Array.isArray(raw.messages) || raw.messages.length === 0 || raw.messages.length > 20) {
      return { success: false, error: 'Bad request' };
    }
    const messages: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const message of raw.messages) {
      if (!message || typeof message !== 'object') return { success: false, error: 'Bad request' };
      const role = (message as { role?: unknown }).role;
      const content = (message as { content?: unknown }).content;
      if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || content.length > 8000) {
        return { success: false, error: 'Bad request' };
      }
      messages.push({ role, content });
    }
    const requestId = typeof raw.requestId === 'string' && raw.requestId.length <= 80 ? raw.requestId : '';
    const controller = new AbortController();
    if (requestId) aiRequests.set(requestId, controller);
    try {
      const text = await completeChat(
        {
          provider,
          model: raw.model.trim(),
          baseUrl: raw.baseUrl,
          apiKey,
          system: raw.system,
          messages,
        },
        {
          signal: controller.signal,
          onDelta: requestId
            ? (delta) => {
                if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.AI_DELTA, { requestId, delta });
              }
            : undefined,
        }
      );
      return { success: true, text };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed';
      return { success: false, error: apiKey && message.includes(apiKey) ? 'Request failed' : message.slice(0, 300) };
    } finally {
      if (requestId) aiRequests.delete(requestId);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_VERIFY, async (_event, input: unknown) => {
    if (!input || typeof input !== 'object') return { success: false, error: 'Bad request' };
    const raw = input as Record<string, unknown>;
    const provider = raw.provider;
    if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'openrouter' && provider !== 'ollama') {
      return { success: false, error: 'Unknown provider' };
    }
    if (typeof raw.model !== 'string' || !raw.model.trim() || raw.model.length > 120) {
      return { success: false, error: 'Model is missing' };
    }
    if (typeof raw.baseUrl !== 'string') return { success: false, error: 'URL is missing' };
    const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey : '';
    if (provider !== 'ollama' && !apiKey) return { success: false, error: 'API key is missing' };
    if (apiKey.length > 500) return { success: false, error: 'API key is too long' };
    try {
      await verifyModel({
        provider,
        model: raw.model.trim(),
        baseUrl: raw.baseUrl,
        apiKey,
      });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Check failed';
      return { success: false, error: apiKey && message.includes(apiKey) ? 'Check failed' : message.slice(0, 300) };
    }
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
