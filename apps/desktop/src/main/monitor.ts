import { IpcMain } from 'electron';
import type { Client } from 'ssh2';
import { IPC_CHANNELS, type SSHConnectionConfig } from '@magicterm/shared';
import { HostKeyError, connectTrusted, runOnClient } from './ssh-exec';
import {
  SCRIPT_RUNNER,
  buildDiscoveryScript,
  buildProjectScript,
  newNonce,
  scriptInput,
} from '../common/monitor/script';
import { applyProjects, parseDiscoveryOutput, projectPathsFor } from '../common/monitor/discovery';
import type { DiscoveryResult } from '../common/monitor/types';

/** Background connections are closed after this long without use. */
const IDLE_CLOSE_MS = 60_000;
const DISCOVERY_TIMEOUT_MS = 90_000;
const PROJECT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface PooledConnection {
  /** host, port and user: a change means a new connection. */
  identity: string;
  client: Promise<Client>;
  users: number;
  idleTimer: NodeJS.Timeout | null;
}

/**
 * One connection per server for the Services monitor, separate from the user's terminals.
 * Several scripts can run on it at once as separate channels.
 */
const pool = new Map<string, PooledConnection>();

function identityOf(config: SSHConnectionConfig): string {
  return `${config.username}@${config.host.toLowerCase()}:${config.port}`;
}

function drop(serverId: string, entry: PooledConnection): void {
  if (pool.get(serverId) !== entry) return;
  pool.delete(serverId);
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  void entry.client.then((client) => client.end()).catch(() => {});
}

export function acquire(serverId: string, config: SSHConnectionConfig): PooledConnection {
  const identity = identityOf(config);
  const existing = pool.get(serverId);
  if (existing && existing.identity === identity) {
    if (existing.idleTimer) clearTimeout(existing.idleTimer);
    existing.idleTimer = null;
    existing.users++;
    return existing;
  }
  if (existing) drop(serverId, existing);
  const entry: PooledConnection = { identity, client: connectTrusted(config, { keepalive: true }), users: 1, idleTimer: null };
  pool.set(serverId, entry);
  entry.client.then(
    (client) => {
      client.on('close', () => drop(serverId, entry));
      client.on('error', () => drop(serverId, entry));
    },
    () => drop(serverId, entry)
  );
  return entry;
}

export function release(serverId: string, entry: PooledConnection): void {
  entry.users--;
  if (entry.users > 0 || pool.get(serverId) !== entry) return;
  entry.idleTimer = setTimeout(() => drop(serverId, entry), IDLE_CLOSE_MS);
}

/** Runs a script on the server's background connection, with the sudo password on stdin if given. */
export async function runScript(
  serverId: string,
  config: SSHConnectionConfig,
  script: string,
  options: { timeoutMs: number; sudoPassword?: string }
) {
  const entry = acquire(serverId, config);
  try {
    const client = await entry.client;
    return await runOnClient(client, SCRIPT_RUNNER, {
      timeoutMs: options.timeoutMs,
      stdin: scriptInput(script, options.sudoPassword),
      maxBytes: MAX_OUTPUT_BYTES,
    });
  } finally {
    release(serverId, entry);
  }
}

export async function discoverServer(
  serverId: string,
  config: SSHConnectionConfig,
  sudoPassword?: string
): Promise<DiscoveryResult> {
  const nonce = newNonce();
  const first = await runScript(serverId, config, buildDiscoveryScript(nonce), {
    timeoutMs: DISCOVERY_TIMEOUT_MS,
    sudoPassword,
  });
  if (!first.stdout.includes(`@@${nonce} meta`)) {
    const reason = first.timedOut
      ? 'The scan timed out before the server answered.'
      : (first.stderr.trim().split('\n')[0] || 'The server did not run the scan.').slice(0, 300);
    throw new Error(reason);
  }
  const draft = parseDiscoveryOutput(first.stdout, nonce);
  if (first.timedOut) draft.result.notes.push({ source: 'meta', message: 'The scan timed out; results are partial.' });

  const paths = projectPathsFor(draft);
  if (paths.length === 0) return applyProjects(draft, '', nonce);
  const projectNonce = newNonce();
  try {
    const second = await runScript(serverId, config, buildProjectScript(projectNonce, paths), {
      timeoutMs: PROJECT_TIMEOUT_MS,
      sudoPassword,
    });
    const result = applyProjects(draft, second.stdout, projectNonce);
    if (second.timedOut) result.notes.push({ source: 'projects', message: 'Reading project folders timed out; some are missing.' });
    return result;
  } catch (err) {
    const result = applyProjects(draft, '', projectNonce);
    result.notes.push({ source: 'projects', message: `Project folders were not read: ${err instanceof Error ? err.message : 'error'}` });
    return result;
  }
}

export function isConfig(value: unknown): value is SSHConnectionConfig {
  const raw = value as Record<string, unknown> | null;
  return Boolean(raw)
    && typeof raw?.host === 'string'
    && typeof raw.port === 'number'
    && typeof raw.username === 'string'
    && (raw.authType === 'password' || raw.authType === 'key');
}

export function closeMonitorConnections(): void {
  for (const [serverId, entry] of pool) drop(serverId, entry);
}

export function setupMonitorHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    IPC_CHANNELS.MONITOR_DISCOVER,
    async (_event, serverId: unknown, config: unknown, sudoPassword: unknown) => {
      if (typeof serverId !== 'string' || !serverId || !isConfig(config)) {
        return { success: false, error: 'Bad arguments' };
      }
      if (sudoPassword !== undefined && (typeof sudoPassword !== 'string' || sudoPassword.length > 1024)) {
        return { success: false, error: 'Bad password' };
      }
      try {
        const result = await discoverServer(serverId, config, sudoPassword || undefined);
        return { success: true, result };
      } catch (err) {
        if (err instanceof HostKeyError) return { success: false, error: err.message, hostKey: err.challenge };
        return { success: false, error: err instanceof Error ? err.message.slice(0, 300) : 'Scan failed' };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.MONITOR_DISCONNECT, async (_event, serverId: unknown) => {
    const entry = typeof serverId === 'string' ? pool.get(serverId) : undefined;
    if (entry && typeof serverId === 'string') drop(serverId, entry);
    return { success: true };
  });
}
