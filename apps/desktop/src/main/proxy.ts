import { session } from 'electron';
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

export function applyProxySettings(): void {
  const proxyConfig = store.get(STORAGE_KEYS.PROXY_CONFIG) as ProxyConfig | undefined;

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
