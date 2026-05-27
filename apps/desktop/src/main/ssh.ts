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

interface SshAuthConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  keepaliveInterval?: number;
  keepaliveCountMax?: number;
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

      return new Promise((resolve, reject) => {
        const client = new Client();
        let settled = false;
        const finish = (value: unknown): void => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        const fail = (err: Error): void => {
          if (settled) return;
          settled = true;
          reject(err);
        };

        const authConfig: SshAuthConfig = {
          host: config.host,
          port: config.port,
          username: config.username,
          keepaliveInterval: 10000,
          keepaliveCountMax: 3,
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
          // If we already resolved with a host-key challenge (or any other
          // outcome), ignore the delayed `client-timeout` ssh2 fires after
          // our hostVerifier returned false.
          if (settled) return;
          safeSend(event.sender, IPC_CHANNELS.SSH_STATUS, sessionId, 'error', err.message);
          fail(err);
        });

        client.on('close', () => {
          sessions.delete(sessionId);
        });

        client.connect(authConfig);
      });
    }
  );

  ipcMain.handle(IPC_CHANNELS.SSH_DISCONNECT, async (event, sessionId: string) => {
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
