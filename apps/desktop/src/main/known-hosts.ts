import { IpcMain } from 'electron';
import Store from 'electron-store';
import { createHash } from 'crypto';
import { STORAGE_KEYS } from '@magicterm/shared';

const store = new Store();

interface KnownHostsMap {
  // key = `${host}:${port}` (lowercased host)
  // value = SHA-256 fingerprint of the server's public key, hex-encoded
  [hostPort: string]: { fingerprint: string; addedAt: string };
}

function readMap(): KnownHostsMap {
  const raw = store.get(STORAGE_KEYS.SSH_KNOWN_HOSTS) as KnownHostsMap | undefined;
  return raw && typeof raw === 'object' ? raw : {};
}

function writeMap(map: KnownHostsMap): void {
  store.set(STORAGE_KEYS.SSH_KNOWN_HOSTS, map);
}

export function fingerprintFor(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex');
}

export type HostKeyDecision =
  | { kind: 'trusted' }
  | { kind: 'unknown'; fingerprint: string }
  | { kind: 'mismatch'; fingerprint: string; storedFingerprint: string };

/**
 * Pure decision logic for the ssh2 hostVerifier callback. Does NOT mutate
 * the trusted-hosts map — every first-time host now requires explicit
 * confirmation in the renderer (see ssh.ts / HostKeyDialog.tsx).
 *
 * Returns:
 *  - 'trusted'  — fingerprint matches a previously trusted entry
 *  - 'unknown'  — first time we see (host, port); renderer must prompt
 *  - 'mismatch' — fingerprint changed since last connection; possible MITM
 */
export function evaluateHostKey(host: string, port: number, key: Buffer): HostKeyDecision {
  const id = `${host.toLowerCase()}:${port}`;
  const fingerprint = fingerprintFor(key);
  const map = readMap();
  const existing = map[id];

  if (!existing) {
    return { kind: 'unknown', fingerprint };
  }

  if (existing.fingerprint !== fingerprint) {
    return { kind: 'mismatch', fingerprint, storedFingerprint: existing.fingerprint };
  }

  return { kind: 'trusted' };
}

export function trustHostKey(host: string, port: number, fingerprint: string): void {
  const map = readMap();
  map[`${host.toLowerCase()}:${port}`] = {
    fingerprint,
    addedAt: new Date().toISOString(),
  };
  writeMap(map);
}

export function forgetHostKey(host: string, port: number): void {
  const map = readMap();
  delete map[`${host.toLowerCase()}:${port}`];
  writeMap(map);
}

export function setupKnownHostsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('sshHostKeys:list', async () => {
    const map = readMap();
    return Object.entries(map).map(([id, value]) => ({
      hostPort: id,
      fingerprint: value.fingerprint,
      addedAt: value.addedAt,
    }));
  });

  ipcMain.handle('sshHostKeys:trust', async (_event, host: string, port: number, fingerprint: string) => {
    if (typeof host !== 'string' || typeof port !== 'number' || typeof fingerprint !== 'string') {
      return { success: false, error: 'invalid_arguments' };
    }
    trustHostKey(host, port, fingerprint);
    return { success: true };
  });

  ipcMain.handle('sshHostKeys:forget', async (_event, host: string, port: number) => {
    if (typeof host !== 'string' || typeof port !== 'number') {
      return { success: false, error: 'invalid_arguments' };
    }
    forgetHostKey(host, port);
    return { success: true };
  });
}
