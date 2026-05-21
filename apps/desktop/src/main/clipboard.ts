import { IpcMain, clipboard } from 'electron';
import { IPC_CHANNELS } from '@magicterm/shared';


export function setupClipboardHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_WRITE, async (_event, value: unknown) => {
    if (typeof value !== 'string') {
      return { success: false, error: 'invalid_value' };
    }
    if (value.length > 4 * 1024 * 1024) {
      return { success: false, error: 'value_too_large' };
    }
    clipboard.writeText(value);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_READ, async () => {
    try {
      const text = clipboard.readText();
      return { success: true, text };
    } catch (err) {
      return { success: false, error: (err as Error).message, text: '' };
    }
  });
}
