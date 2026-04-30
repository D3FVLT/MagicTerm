import { IpcMain, dialog, BrowserWindow } from 'electron';
import { Client, SFTPWrapper } from 'ssh2';
import { createWriteStream, createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { join, basename, isAbsolute, resolve as resolvePath, normalize } from 'path';
import {
  IPC_CHANNELS,
  type SSHConnectionConfig,
  type FileEntry,
  type TransferProgress,
} from '@magicterm/shared';
import { evaluateHostKey } from './known-hosts';

interface SFTPSession {
  client: Client;
  sftp: SFTPWrapper;
  ownerId: number;
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

function getOwnedSession(sessionId: string, sender: Electron.WebContents): SFTPSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.ownerId !== sender.id) return null;
  return session;
}

/**
 * Reject paths that contain NUL bytes or that are not absolute. The renderer
 * should never be supplying relative paths or null-terminated strings; either
 * is a sign of crafted input from a compromised renderer trying to traverse
 * outside the user-selected directory or trip native APIs that mishandle NUL.
 */
function validateLocalPath(p: unknown): string | null {
  if (typeof p !== 'string' || p.length === 0) return null;
  if (p.includes('\0')) return null;
  if (!isAbsolute(p)) return null;
  // resolvePath collapses `..` segments — call it last so a passed-in
  // `/tmp/../etc/passwd` is normalised to `/etc/passwd` and the consumer can
  // make a properly informed decision.
  return resolvePath(normalize(p));
}

function validateRemotePath(p: unknown): string | null {
  if (typeof p !== 'string' || p.length === 0) return null;
  if (p.includes('\0')) return null;
  return p;
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
      const existing = sessions.get(sessionId);
      if (existing && existing.ownerId !== event.sender.id) {
        return { success: false, error: 'session_id_in_use' };
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
          hostVerifier: (key: Buffer) => boolean;
        } = {
          host: config.host,
          port: config.port,
          username: config.username,
          keepaliveInterval: 10000,
          keepaliveCountMax: 3,
          hostVerifier: (key: Buffer) => {
            const decision = evaluateHostKey(config.host, config.port, key);
            if (decision.kind === 'mismatch') {
              const err = new Error(
                `SSH host key mismatch for ${config.host}:${config.port}. ` +
                  `Expected SHA-256 ${decision.storedFingerprint} but got ${decision.fingerprint}. ` +
                  'Refusing to connect.'
              );
              safeSend(event.sender, IPC_CHANNELS.SFTP_PROGRESS, {
                sessionId,
                status: 'error',
                error: err.message,
              });
              reject(err);
              return false;
            }
            return true;
          },
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
              sessions.set(sessionId, { client, sftp, ownerId: event.sender.id });
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

  ipcMain.handle(IPC_CHANNELS.SFTP_DISCONNECT, async (event, sessionId: string) => {
    const session = getOwnedSession(sessionId, event.sender);
    if (session) {
      session.sftp.end();
      session.client.end();
      sessions.delete(sessionId);
    }
    return { success: true };
  });

  ipcMain.handle(
    IPC_CHANNELS.SFTP_LIST,
    async (event, sessionId: string, remotePath: string) => {
      const session = getOwnedSession(sessionId, event.sender);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }
      const safePath = validateRemotePath(remotePath);
      if (safePath === null) {
        return { success: false, error: 'invalid_path' };
      }

      return new Promise((resolve) => {
        session.sftp.readdir(safePath, (err, list) => {
          if (err) {
            resolve({ success: false, error: err.message });
            return;
          }

          const entries: FileEntry[] = list.map((item) => ({
            name: item.filename,
            path: join(safePath, item.filename).replace(/\\/g, '/'),
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
    async (event, sessionId: string, remotePath: string) => {
      const session = getOwnedSession(sessionId, event.sender);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }
      const safePath = validateRemotePath(remotePath);
      if (safePath === null) {
        return { success: false, error: 'invalid_path' };
      }

      return new Promise((resolve) => {
        session.sftp.stat(safePath, (err, stats) => {
          if (err) {
            resolve({ success: false, error: err.message });
            return;
          }

          resolve({
            success: true,
            entry: {
              name: basename(safePath),
              path: safePath,
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
      const session = getOwnedSession(sessionId, event.sender);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      const safeRemote = validateRemotePath(remotePath);
      const safeLocal = validateLocalPath(localPath);
      if (safeRemote === null || safeLocal === null) {
        return { success: false, error: 'invalid_path' };
      }

      return new Promise((resolve) => {
        session.sftp.stat(safeRemote, (statErr, stats) => {
          if (statErr) {
            resolve({ success: false, error: statErr.message });
            return;
          }

          const total = stats.size;
          let transferred = 0;
          let aborted = false;
          let settled = false;

          const readStream = session.sftp.createReadStream(safeRemote);
          const writeStream = createWriteStream(safeLocal);

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
              filename: basename(safeRemote),
              localPath: safeLocal,
              remotePath: safeRemote,
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
      const session = getOwnedSession(sessionId, event.sender);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      const safeRemote = validateRemotePath(remotePath);
      const safeLocal = validateLocalPath(localPath);
      if (safeRemote === null || safeLocal === null) {
        return { success: false, error: 'invalid_path' };
      }

      try {
        const localStats = await stat(safeLocal);
        const total = localStats.size;
        let transferred = 0;
        let aborted = false;
        let settled = false;

        const readStream = createReadStream(safeLocal);
        const writeStream = session.sftp.createWriteStream(safeRemote);

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
            filename: basename(safeLocal),
            localPath: safeLocal,
            remotePath: safeRemote,
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
    async (event, sessionId: string, remotePath: string, isDirectory: boolean) => {
      const session = getOwnedSession(sessionId, event.sender);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }
      const safePath = validateRemotePath(remotePath);
      if (safePath === null) {
        return { success: false, error: 'invalid_path' };
      }

      return new Promise((resolve) => {
        if (isDirectory) {
          session.sftp.rmdir(safePath, (err) => {
            if (err) {
              resolve({ success: false, error: err.message });
            } else {
              resolve({ success: true });
            }
          });
        } else {
          session.sftp.unlink(safePath, (err) => {
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
    async (event, sessionId: string, oldPath: string, newPath: string) => {
      const session = getOwnedSession(sessionId, event.sender);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }
      const safeOld = validateRemotePath(oldPath);
      const safeNew = validateRemotePath(newPath);
      if (safeOld === null || safeNew === null) {
        return { success: false, error: 'invalid_path' };
      }

      return new Promise((resolve) => {
        session.sftp.rename(safeOld, safeNew, (err) => {
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
    async (event, sessionId: string, remotePath: string) => {
      const session = getOwnedSession(sessionId, event.sender);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }
      const safePath = validateRemotePath(remotePath);
      if (safePath === null) {
        return { success: false, error: 'invalid_path' };
      }

      return new Promise((resolve) => {
        session.sftp.mkdir(safePath, (err) => {
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
    async (event, sessionId: string, remotePath: string) => {
      const session = getOwnedSession(sessionId, event.sender);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }
      const safePath = validateRemotePath(remotePath);
      if (safePath === null) {
        return { success: false, error: 'invalid_path' };
      }

      return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        const readStream = session.sftp.createReadStream(safePath);

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
    async (event, sessionId: string, remotePath: string, content: string) => {
      const session = getOwnedSession(sessionId, event.sender);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }
      const safePath = validateRemotePath(remotePath);
      if (safePath === null) {
        return { success: false, error: 'invalid_path' };
      }

      return new Promise((resolve) => {
        const writeStream = session.sftp.createWriteStream(safePath);

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

  // Native dialog wrappers so the renderer never needs to construct a local
  // FS path itself for upload/download. Used by future "Browse..." entry
  // points; see security plan H2 (block C). Existing dual-pane file manager
  // continues to use SFTP_UPLOAD / SFTP_DOWNLOAD with paths that are now
  // strictly validated above.
  ipcMain.handle('sftp:pickUploadFiles', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return { success: false, canceled: true, files: [] };
    return { success: true, files: result.filePaths };
  });

  ipcMain.handle('sftp:pickDownloadDestination', async (event, suggestedName: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win ?? undefined!, {
      defaultPath: typeof suggestedName === 'string' ? suggestedName : undefined,
    });
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    return { success: true, filePath: result.filePath };
  });
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
