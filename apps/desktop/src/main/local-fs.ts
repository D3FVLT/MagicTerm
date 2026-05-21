import { IpcMain, shell } from 'electron';
import { readdir, stat } from 'fs/promises';
import { isAbsolute, join, normalize, resolve as resolvePath } from 'path';
import { homedir, platform } from 'os';
import { IPC_CHANNELS, type FileEntry } from '@magicterm/shared';

function parsePermissions(mode: number): string {
  const perms = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  const owner = perms[(mode >> 6) & 7];
  const group = perms[(mode >> 3) & 7];
  const other = perms[mode & 7];
  return owner + group + other;
}


function validatePath(p: unknown, opts: { restrictToHome?: boolean } = {}): string | null {
  if (typeof p !== 'string' || p.length === 0) return null;
  if (p.includes('\0')) return null;
  if (!isAbsolute(p)) return null;

  const normalized = resolvePath(normalize(p));

  if (opts.restrictToHome) {
    const home = resolvePath(homedir());
    const sep = platform() === 'win32' ? '\\' : '/';
    const homeWithSep = home.endsWith(sep) ? home : home + sep;
    if (normalized !== home && !normalized.startsWith(homeWithSep)) {
      return null;
    }
  }

  return normalized;
}

export function setupLocalFsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.LOCAL_GET_HOME, async () => {
    return { success: true, path: homedir() };
  });

  ipcMain.handle(IPC_CHANNELS.LOCAL_LIST, async (_event, dirPath: string) => {
    const safePath = validatePath(dirPath);
    if (!safePath) {
      return { success: false, error: 'invalid_path' };
    }

    try {
      const items = await readdir(safePath, { withFileTypes: true });
      const entries: FileEntry[] = [];

      for (const item of items) {
        if (item.name.startsWith('.')) continue;

        try {
          const fullPath = join(safePath, item.name);
          const stats = await stat(fullPath);

          entries.push({
            name: item.name,
            path: fullPath,
            isDirectory: item.isDirectory(),
            isSymlink: item.isSymbolicLink(),
            size: stats.size,
            modifiedAt: stats.mtimeMs,
            permissions: parsePermissions(stats.mode),
          });
        } catch {
          entries.push({
            name: item.name,
            path: join(safePath, item.name),
            isDirectory: item.isDirectory(),
            isSymlink: item.isSymbolicLink(),
            size: 0,
            modifiedAt: 0,
          });
        }
      }

      entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      return { success: true, entries };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.LOCAL_OPEN_FILE, async (_event, filePath: string) => {
    const safePath = validatePath(filePath, { restrictToHome: true });
    if (!safePath) {
      return { success: false, error: 'invalid_path' };
    }
    try {
      await shell.openPath(safePath);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.LOCAL_REVEAL, async (_event, filePath: string) => {
    const safePath = validatePath(filePath, { restrictToHome: true });
    if (!safePath) {
      return { success: false, error: 'invalid_path' };
    }
    shell.showItemInFolder(safePath);
    return { success: true };
  });
}
