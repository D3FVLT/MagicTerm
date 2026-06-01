import { IpcMain } from 'electron';
import { Client, ClientChannel } from 'ssh2';
import { IPC_CHANNELS, type SSHConnectionConfig, type TerminalSize } from '@magicterm/shared';
import { evaluateHostKey } from './known-hosts';

interface SSHSession {
  client: Client;
  stream: ClientChannel | null;
  sender: Electron.WebContents;
  ownerId: number;
}

const sessions = new Map<string, SSHSession>();
const pendingConnections = new Map<string, { ownerId: number; abort: () => void }>();

function safeSend(sender: Electron.WebContents, channel: string, ...args: unknown[]): void {
  try {
    if (!sender.isDestroyed()) {
      sender.send(channel, ...args);
    }
  } catch {
  }
}

function getOwnedSession(sessionId: string, sender: Electron.WebContents): SSHSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.ownerId !== sender.id) return null;
  return session;
}

export function getActiveSessionCount(): number {
  return sessions.size;
}

export function cleanupAllSSHSessions(): void {
  for (const [id, session] of sessions) {
    try {
      session.stream?.close();
      session.client.end();
    } catch {
    }
    sessions.delete(id);
  }
  for (const [, pending] of pendingConnections) {
    try {
      pending.abort();
    } catch {
    }
  }
  pendingConnections.clear();
}

export function checkSSHSessions(sender: Electron.WebContents): void {
  for (const [sessionId, session] of sessions) {
    const sock = (session.client as unknown as { _sock?: { writable: boolean } })._sock;
    if (sock && !sock.writable) {
      safeSend(sender, IPC_CHANNELS.SSH_STATUS, sessionId, 'disconnected');
      try {
        session.stream?.close();
        session.client.end();
      } catch {
      }
      sessions.delete(sessionId);
    }
  }
}

export const READY_TIMEOUT_MS = 15000;

export function friendlyConnectError(err: Error): string {
  const msg = err.message || '';
  const code = (err as NodeJS.ErrnoException).code;
  if (/Timed out while waiting for handshake/i.test(msg)) {
    return "Couldn't reach the host — it didn't respond in time.";
  }
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) {
    return 'Connection refused — check the host address and port.';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo/.test(msg)) {
    return "Host not found — check the address.";
  }
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || /ETIMEDOUT|EHOSTUNREACH/.test(msg)) {
    return "Couldn't reach the host — it may be offline or behind a firewall.";
  }
  if (code === 'ECONNRESET' || /ECONNRESET/.test(msg)) {
    return 'Connection reset by the host.';
  }
  if (/All configured authentication methods failed/i.test(msg)) {
    return 'Authentication failed — check your username and credentials.';
  }
  return msg || 'Connection failed';
}

interface SshAuthConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  keepaliveInterval?: number;
  keepaliveCountMax?: number;
  readyTimeout?: number;
  hostVerifier: (key: Buffer) => boolean;
}

export function setupSSHHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    IPC_CHANNELS.SSH_CONNECT,
    async (event, sessionId: string, config: SSHConnectionConfig) => {
      const existing = sessions.get(sessionId);
      if (existing) {
        if (existing.ownerId !== event.sender.id) {
          return { success: false, error: 'session_id_in_use' };
        }
        try {
          existing.stream?.close();
          existing.client.end();
        } catch {
          // Ignore
        }
        sessions.delete(sessionId);
      }

      const stalePending = pendingConnections.get(sessionId);
      if (stalePending) {
        pendingConnections.delete(sessionId);
        stalePending.abort();
      }

      return new Promise((resolve) => {
        const client = new Client();
        let settled = false;
        const finish = (value: unknown): void => {
          if (settled) return;
          settled = true;
          pendingConnections.delete(sessionId);
          resolve(value);
        };
        const fail = (err: Error): void => {
          finish({ success: false, error: friendlyConnectError(err) });
        };

        pendingConnections.set(sessionId, {
          ownerId: event.sender.id,
          abort: () => {
            finish({ success: false, error: 'cancelled', cancelled: true });
            setImmediate(() => {
              try {
                client.end();
              } catch {
              }
            });
          },
        });

        const authConfig: SshAuthConfig = {
          host: config.host,
          port: config.port,
          username: config.username,
          keepaliveInterval: 10000,
          keepaliveCountMax: 3,
          readyTimeout: READY_TIMEOUT_MS,
          hostVerifier: (key: Buffer) => {
            const decision = evaluateHostKey(config.host, config.port, key);
            if (decision.kind === 'trusted') return true;

            const challenge =
              decision.kind === 'unknown'
                ? {
                    success: false as const,
                    code: 'host_key_unknown' as const,
                    host: config.host,
                    port: config.port,
                    fingerprint: decision.fingerprint,
                  }
                : {
                    success: false as const,
                    code: 'host_key_mismatch' as const,
                    host: config.host,
                    port: config.port,
                    fingerprint: decision.fingerprint,
                    storedFingerprint: decision.storedFingerprint,
                  };

            finish(challenge);
            setImmediate(() => {
              try {
                client.end();
              } catch {
              }
            });
            return false;
          },
        };

        if (config.authType === 'password' && config.password) {
          authConfig.password = config.password;
        } else if (config.authType === 'key' && config.privateKey) {
          authConfig.privateKey = config.privateKey;
        }

        client.on('ready', () => {
          client.shell(
            {
              term: 'xterm-256color',
              cols: 120,
              rows: 40,
            },
            {
              env: {
                COLORTERM: 'truecolor',
                LANG: 'en_US.UTF-8',
              },
            },
            (err, stream) => {
              if (err) {
                fail(err);
                return;
              }

              sessions.set(sessionId, {
                client,
                stream,
                sender: event.sender,
                ownerId: event.sender.id,
              });

              stream.on('data', (data: Buffer) => {
                safeSend(event.sender, IPC_CHANNELS.SSH_DATA, sessionId, data.toString());
              });

              stream.on('close', () => {
                const current = sessions.get(sessionId);
                if (current && current.client !== client) return;
                safeSend(event.sender, IPC_CHANNELS.SSH_STATUS, sessionId, 'disconnected');
                sessions.delete(sessionId);
              });

              stream.stderr.on('data', (data: Buffer) => {
                safeSend(event.sender, IPC_CHANNELS.SSH_DATA, sessionId, data.toString());
              });

              finish({ success: true });
            }
          );
        });

        client.on('error', (err) => {
          if (settled) return;
          safeSend(event.sender, IPC_CHANNELS.SSH_STATUS, sessionId, 'error', err.message);
          fail(err);
        });

        client.on('close', () => {
          const current = sessions.get(sessionId);
          if (current && current.client === client) {
            sessions.delete(sessionId);
          }
        });

        client.connect(authConfig);
      });
    }
  );

  ipcMain.handle(IPC_CHANNELS.SSH_DISCONNECT, async (event, sessionId: string) => {
    const pending = pendingConnections.get(sessionId);
    if (pending && pending.ownerId === event.sender.id) {
      pendingConnections.delete(sessionId);
      pending.abort();
    }
    const session = getOwnedSession(sessionId, event.sender);
    if (session) {
      session.stream?.close();
      session.client.end();
      sessions.delete(sessionId);
    }
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.SSH_DATA, async (event, sessionId: string, data: string) => {
    const session = getOwnedSession(sessionId, event.sender);
    if (session?.stream) {
      session.stream.write(data);
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.SSH_RESIZE,
    async (event, sessionId: string, size: TerminalSize) => {
      const session = getOwnedSession(sessionId, event.sender);
      if (session?.stream) {
        session.stream.setWindow(size.rows, size.cols, 0, 0);
      }
    }
  );
}
