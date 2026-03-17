import { IpcMain, BrowserWindow } from 'electron';
import { Client, ClientChannel } from 'ssh2';
import { IPC_CHANNELS, type SSHConnectionConfig, type TerminalSize } from '@magicterm/shared';

interface SSHSession {
  client: Client;
  stream: ClientChannel | null;
}

const sessions = new Map<string, SSHSession>();

export function setupSSHHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    IPC_CHANNELS.SSH_CONNECT,
    async (event, sessionId: string, config: SSHConnectionConfig) => {
      return new Promise((resolve, reject) => {
        const client = new Client();

        const authConfig: {
          host: string;
          port: number;
          username: string;
          password?: string;
          privateKey?: string;
        } = {
          host: config.host,
          port: config.port,
          username: config.username,
        };

        if (config.authType === 'password' && config.password) {
          authConfig.password = config.password;
        } else if (config.authType === 'key' && config.privateKey) {
          authConfig.privateKey = config.privateKey;
        }

        client.on('ready', () => {
          client.shell((err, stream) => {
            if (err) {
              reject(err);
              return;
            }

            sessions.set(sessionId, { client, stream });

            stream.on('data', (data: Buffer) => {
              const window = BrowserWindow.fromWebContents(event.sender);
              if (window) {
                window.webContents.send(IPC_CHANNELS.SSH_DATA, sessionId, data.toString());
              }
            });

            stream.on('close', () => {
              const window = BrowserWindow.fromWebContents(event.sender);
              if (window) {
                window.webContents.send(IPC_CHANNELS.SSH_STATUS, sessionId, 'disconnected');
              }
              sessions.delete(sessionId);
            });

            stream.stderr.on('data', (data: Buffer) => {
              const window = BrowserWindow.fromWebContents(event.sender);
              if (window) {
                window.webContents.send(IPC_CHANNELS.SSH_DATA, sessionId, data.toString());
              }
            });

            resolve({ success: true });
          });
        });

        client.on('error', (err) => {
          const window = BrowserWindow.fromWebContents(event.sender);
          if (window) {
            window.webContents.send(IPC_CHANNELS.SSH_STATUS, sessionId, 'error', err.message);
          }
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
