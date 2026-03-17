import { IpcMain } from 'electron';
import { IPC_CHANNELS } from '@magicterm/shared';

export function setupServerHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.SERVERS_LIST, async () => {
    return { servers: [] };
  });

  ipcMain.handle(IPC_CHANNELS.SERVERS_ADD, async (_event, server) => {
    return { server };
  });

  ipcMain.handle(IPC_CHANNELS.SERVERS_UPDATE, async (_event, id, updates) => {
    return { id, updates };
  });

  ipcMain.handle(IPC_CHANNELS.SERVERS_DELETE, async (_event, id) => {
    return { id };
  });
}
