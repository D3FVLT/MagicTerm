import { IpcMain } from 'electron';
import Store from 'electron-store';
import { IPC_CHANNELS, STORAGE_KEYS } from '@magicterm/shared';

const store = new Store();

export function setupAuthHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.CRYPTO_SET_MASTER_KEY, async (_event, hash: string) => {
    store.set(STORAGE_KEYS.MASTER_KEY_HASH, hash);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_STATUS, async () => {
    const masterKeyHash = store.get(STORAGE_KEYS.MASTER_KEY_HASH) as string | undefined;
    return {
      hasMasterKey: !!masterKeyHash,
      masterKeyHash,
    };
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    store.delete(STORAGE_KEYS.MASTER_KEY_HASH);
    store.delete(STORAGE_KEYS.SUPABASE_SESSION);
    return { success: true };
  });
}
