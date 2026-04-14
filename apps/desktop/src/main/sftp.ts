import { IpcMain } from 'electron';
import { Client, SFTPWrapper } from 'ssh2';
import { createWriteStream, createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { join, basename } from 'path';
import {
  IPC_CHANNELS,
  type SSHConnectionConfig,
  type FileEntry,
  type TransferProgress,
} from '@magicterm/shared';

interface SFTPSession {
  client: Client;
  sftp: SFTPWrapper;
}

const sessions = new Map<string, SFTPSession>();
const activeTransfers = new Map<string, { abort: () => void }>();

function safeSend(sender: Electron.WebContents, channel: string, ...args: unknown[]): void {
  try {
    if (!sender.isDestroyed()) {
      sender.send(channel, ...args);
    }
  } catch {
    // Window already destroyed during shutdown
  }
}

function parsePermissions(mode: number): string {
  const perms = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  const owner = perms[(mode >> 6) & 7];
  const group = perms[(mode >> 3) & 7];
  const other = perms[mode & 7];
  return owner + group + other;
}

export function getActiveSessionCount(): number {
  return sessions.size;
}

export function cleanupAllSFTPSessions(): void {
  for (const [id, session] of sessions) {
    try {
      session.sftp.end();
      session.client.end();
    } catch {
      // Ignore errors during cleanup
    }
    sessions.delete(id);
  }
  for (const [id, transfer] of activeTransfers) {
    try {
      transfer.abort();
    } catch {
      // Ignore
    }
    activeTransfers.delete(id);
  }
}

export function setupSFTPHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    IPC_CHANNELS.SFTP_CONNECT,
    async (event, sessionId: string, config: SSHConnectionConfig) => {
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
          client.sftp((err, sftp) => {
            if (err) {
              reject(err);
              return;
            }

            sftp.realpath('.', (realpathErr, absPath) => {
              const homePath = realpathErr ? '/' : absPath;
              sessions.set(sessionId, { client, sftp });
              resolve({ success: true, homePath });
            });
          });
        });

        client.on('error', (err) => {
          safeSend(event.sender, IPC_CHANNELS.SFTP_PROGRESS, {
            sessionId,
            status: 'error',
            error: err.message,
          });
          reject(err);
        });

        client.on('close', () => {
          sessions.delete(sessionId);
        });

        client.connect(authConfig);
      });
    }
  );

  ipcMain.handle(IPC_CHANNELS.SFTP_DISCONNECT, async (_event, sessionId: string) => {
    const session = sessions.get(sessionId);
    if (session) {
      session.sftp.end();
      session.client.end();
      sessions.delete(sessionId);
    }
    return { success: true };
  });

  ipcMain.handle(
    IPC_CHANNELS.SFTP_LIST,
    async (_event, sessionId: string, remotePath: string) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      return new Promise((resolve) => {
        session.sftp.readdir(remotePath, (err, list) => {
          if (err) {
            resolve({ success: false, error: err.message });
            return;
          }

          const entries: FileEntry[] = list.map((item) => ({
            name: item.filename,
            path: join(remotePath, item.filename).replace(/\\/g, '/'),
            isDirectory: item.attrs.isDirectory(),
            isSymlink: item.attrs.isSymbolicLink(),
            size: item.attrs.size,
            modifiedAt: (item.attrs.mtime ?? 0) * 1000,
            permissions: parsePermissions(item.attrs.mode ?? 0),
          }));

          entries.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
          });

          resolve({ success: true, entries });
        });
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SFTP_STAT,
    async (_event, sessionId: string, remotePath: string) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      return new Promise((resolve) => {
        session.sftp.stat(remotePath, (err, stats) => {
          if (err) {
            resolve({ success: false, error: err.message });
            return;
          }

          resolve({
            success: true,
            entry: {
              name: basename(remotePath),
              path: remotePath,
              isDirectory: stats.isDirectory(),
              isSymlink: stats.isSymbolicLink(),
              size: stats.size,
              modifiedAt: (stats.mtime ?? 0) * 1000,
              permissions: parsePermissions(stats.mode ?? 0),
            },
          });
        });
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SFTP_DOWNLOAD,
    async (
      event,
      sessionId: string,
      transferId: string,
      remotePath: string,
      localPath: string
    ) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      return new Promise((resolve) => {
        session.sftp.stat(remotePath, (statErr, stats) => {
          if (statErr) {
            resolve({ success: false, error: statErr.message });
            return;
          }

          const total = stats.size;
          let transferred = 0;
          let aborted = false;
          let settled = false;

          const readStream = session.sftp.createReadStream(remotePath);
          const writeStream = createWriteStream(localPath);

          activeTransfers.set(transferId, {
            abort: () => {
              aborted = true;
              readStream.destroy();
              writeStream.destroy();
            },
          });

          const sendProgress = (status: TransferProgress['status']) => {
            safeSend(event.sender, IPC_CHANNELS.SFTP_PROGRESS, {
              id: transferId,
              sessionId,
              filename: basename(remotePath),
              localPath,
              remotePath,
              transferred,
              total,
              direction: 'download',
              status,
            } as TransferProgress);
          };

          sendProgress('transferring');

          readStream.on('data', (chunk: Buffer) => {
            transferred += chunk.length;
            sendProgress('transferring');
          });

          readStream.on('error', (err: Error) => {
            if (settled) return;
            settled = true;
            activeTransfers.delete(transferId);
            if (!aborted) {
              sendProgress('error');
              resolve({ success: false, error: err.message });
            }
          });

          writeStream.on('error', (err: Error) => {
            if (settled) return;
            settled = true;
            activeTransfers.delete(transferId);
            readStream.destroy();
            if (!aborted) {
              sendProgress('error');
              resolve({ success: false, error: err.message });
            }
          });

          const finalize = () => {
            if (settled) return;
            settled = true;
            activeTransfers.delete(transferId);
            if (!aborted) {
              sendProgress('completed');
              resolve({ success: true });
            } else {
              sendProgress('cancelled');
              resolve({ success: false, error: 'Transfer cancelled' });
            }
          };

          writeStream.on('finish', finalize);
          writeStream.on('close', finalize);

          readStream.pipe(writeStream);
        });
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SFTP_UPLOAD,
    async (
      event,
      sessionId: string,
      transferId: string,
      localPath: string,
      remotePath: string
    ) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      try {
        const localStats = await stat(localPath);
        const total = localStats.size;
        let transferred = 0;
        let aborted = false;
        let settled = false;

        const readStream = createReadStream(localPath);
        const writeStream = session.sftp.createWriteStream(remotePath);

        activeTransfers.set(transferId, {
          abort: () => {
            aborted = true;
            readStream.destroy();
            writeStream.destroy();
          },
        });

        const sendProgress = (status: TransferProgress['status']) => {
          safeSend(event.sender, IPC_CHANNELS.SFTP_PROGRESS, {
            id: transferId,
            sessionId,
            filename: basename(localPath),
            localPath,
            remotePath,
            transferred,
            total,
            direction: 'upload',
            status,
          } as TransferProgress);
        };

        sendProgress('transferring');

        return new Promise((resolve) => {
          readStream.on('data', (chunk: Buffer | string) => {
            transferred += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
            sendProgress('transferring');
          });

          readStream.on('error', (err: Error) => {
            if (settled) return;
            settled = true;
            activeTransfers.delete(transferId);
            if (!aborted) {
              sendProgress('error');
              resolve({ success: false, error: err.message });
            }
          });

          writeStream.on('error', (err: Error) => {
            if (settled) return;
            settled = true;
            activeTransfers.delete(transferId);
            readStream.destroy();
            if (!aborted) {
              sendProgress('error');
              resolve({ success: false, error: err.message });
            }
          });

          const finalize = () => {
            if (settled) return;
            settled = true;
            activeTransfers.delete(transferId);
            if (!aborted) {
              sendProgress('completed');
              resolve({ success: true });
            } else {
              sendProgress('cancelled');
              resolve({ success: false, error: 'Transfer cancelled' });
            }
          };

          writeStream.on('finish', finalize);
          writeStream.on('close', finalize);

          readStream.pipe(writeStream);
        });
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SFTP_DELETE,
    async (_event, sessionId: string, remotePath: string, isDirectory: boolean) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      return new Promise((resolve) => {
        if (isDirectory) {
          session.sftp.rmdir(remotePath, (err) => {
            if (err) {
              resolve({ success: false, error: err.message });
            } else {
              resolve({ success: true });
            }
          });
        } else {
          session.sftp.unlink(remotePath, (err) => {
            if (err) {
              resolve({ success: false, error: err.message });
            } else {
              resolve({ success: true });
            }
          });
        }
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SFTP_RENAME,
    async (_event, sessionId: string, oldPath: string, newPath: string) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      return new Promise((resolve) => {
        session.sftp.rename(oldPath, newPath, (err) => {
          if (err) {
            resolve({ success: false, error: err.message });
          } else {
            resolve({ success: true });
          }
        });
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SFTP_MKDIR,
    async (_event, sessionId: string, remotePath: string) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      return new Promise((resolve) => {
        session.sftp.mkdir(remotePath, (err) => {
          if (err) {
            resolve({ success: false, error: err.message });
          } else {
            resolve({ success: true });
          }
        });
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SFTP_READ_FILE,
    async (_event, sessionId: string, remotePath: string) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        const readStream = session.sftp.createReadStream(remotePath);

        readStream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        readStream.on('end', () => {
          const content = Buffer.concat(chunks).toString('utf-8');
          resolve({ success: true, content });
        });

        readStream.on('error', (err: Error) => {
          resolve({ success: false, error: err.message });
        });
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SFTP_WRITE_FILE,
    async (_event, sessionId: string, remotePath: string, content: string) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      return new Promise((resolve) => {
        const writeStream = session.sftp.createWriteStream(remotePath);

        let settled = false;

        const finalize = () => {
          if (settled) return;
          settled = true;
          resolve({ success: true });
        };

        writeStream.on('finish', finalize);
        writeStream.on('close', finalize);

        writeStream.on('error', (err: Error) => {
          if (settled) return;
          settled = true;
          resolve({ success: false, error: err.message });
        });

        writeStream.write(content, 'utf-8');
        writeStream.end();
      });
    }
  );
}

export function cancelTransfer(transferId: string): boolean {
  const transfer = activeTransfers.get(transferId);
  if (transfer) {
    transfer.abort();
    activeTransfers.delete(transferId);
    return true;
  }
  return false;
}
