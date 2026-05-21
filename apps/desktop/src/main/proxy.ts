import { session, safeStorage } from 'electron';
import Store from 'electron-store';
import { STORAGE_KEYS } from '@magicterm/shared';

const store = new Store();

export interface ProxyConfig {
  enabled: boolean;
  type: 'http' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
}


export function readProxyConfig(): ProxyConfig | null {
  const encrypted = store.get(STORAGE_KEYS.PROXY_CONFIG_ENCRYPTED) as string | undefined;
  if (encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      const json = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      return JSON.parse(json) as ProxyConfig;
    } catch {
      store.delete(STORAGE_KEYS.PROXY_CONFIG_ENCRYPTED);
    }
  }
  const legacy = store.get(STORAGE_KEYS.PROXY_CONFIG) as ProxyConfig | undefined;
  return legacy ?? null;
}

export function writeProxyConfig(config: ProxyConfig): void {
  if (safeStorage.isEncryptionAvailable()) {
    const blob = safeStorage.encryptString(JSON.stringify(config));
    store.set(STORAGE_KEYS.PROXY_CONFIG_ENCRYPTED, blob.toString('base64'));
    store.delete(STORAGE_KEYS.PROXY_CONFIG);
  } else {
    store.set(STORAGE_KEYS.PROXY_CONFIG, config);
  }
}

export function applyProxySettings(): void {
  const proxyConfig = readProxyConfig();

  if (proxyConfig?.enabled && proxyConfig.host && proxyConfig.port) {
    const auth = proxyConfig.username
      ? `${proxyConfig.username}:${proxyConfig.password || ''}@`
      : '';
    const proxyUrl = `${proxyConfig.type === 'socks5' ? 'socks5' : 'http'}://${auth}${proxyConfig.host}:${proxyConfig.port}`;
    session.defaultSession.setProxy({ proxyRules: proxyUrl });
  } else {
    session.defaultSession.setProxy({ proxyRules: '' });
  }
}
