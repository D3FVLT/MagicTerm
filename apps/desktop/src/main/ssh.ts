import { IpcMain } from 'electron';
import { Client, ClientChannel } from 'ssh2';
import { IPC_CHANNELS, type SSHConnectionConfig, type TerminalSize } from '@magicterm/shared';

interface SSHSession {
  client: Client;
  stream: ClientChannel | null;
  sender: Electron.WebContents;
}

const sessions = new Map<string, SSHSession>();

function safeSend(sender: Electron.WebContents, channel: string, ...args: unknown[]): void {
  try {
    if (!sender.isDestroyed()) {
      sender.send(channel, ...args);
    }
  } catch {
    // Window already destroyed during shutdown
  }
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
      // Ignore errors during cleanup
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
        // Already dead
      }
      sessions.delete(sessionId);
    }
  }
}

export function setupSSHHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    IPC_CHANNELS.SSH_CONNECT,
    async (event, sessionId: string, config: SSHConnectionConfig) => {
      const existing = sessions.get(sessionId);
      if (existing) {
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

        const authConfig: {
          host: string;
          port: number;
          username: string;
          password?: string;
          privateKey?: string;
          keepaliveInterval?: number;
          keepaliveCountMax?: number;
        } = {
          host: config.host,
          port: config.port,
          username: config.username,
          keepaliveInterval: 10000,
          keepaliveCountMax: 3,
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
              reject(err);
              return;
            }

            sessions.set(sessionId, { client, stream, sender: event.sender });

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

            resolve({ success: true });
            }
          );
        });

        client.on('error', (err) => {
          safeSend(event.sender, IPC_CHANNELS.SSH_STATUS, sessionId, 'error', err.message);
          reject(err);
        });

        client.on('close', () => {
          sessions.delete(sessionId);
        });

        client.connect(authConfig);
      });
    }
  );

  ipcMain.handle(IPC_CHANNELS.SSH_DISCONNECT, async (_event, sessionId: string) => {
    const session = sessions.get(sessionId);
    if (session) {
      session.stream?.close();
      session.client.end();
      sessions.delete(sessionId);
    }
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.SSH_DATA, async (_event, sessionId: string, data: string) => {
    const session = sessions.get(sessionId);
    if (session?.stream) {
      session.stream.write(data);
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.SSH_RESIZE,
    async (_event, sessionId: string, size: TerminalSize) => {
      const session = sessions.get(sessionId);
      if (session?.stream) {
        session.stream.setWindow(size.rows, size.cols, 0, 0);
      }
    }
  );
}
