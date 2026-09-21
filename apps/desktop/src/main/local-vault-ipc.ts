import { app, IpcMain } from 'electron';
import Store from 'electron-store';
import { existsSync } from 'fs';
import { join } from 'path';
import { IPC_CHANNELS, STORAGE_KEYS } from '@magicterm/shared';
import { getCachedVerifier } from './master-key';
import { verifyAgainstVerifier } from './scrypt-verifier';
import {
  createEmptyVault,
  deleteVaultFile,
  readVaultFile,
  VaultSession,
  writeVaultFile,
  type LocalVaultDocument,
} from './local-vault';

const store = new Store();
const session = new VaultSession(verifyAgainstVerifier);

function vaultPath(): string {
  return join(app.getPath('userData'), 'local-vault.json');
}

function isLocalOnly(): boolean {
  return store.get(STORAGE_KEYS.LOCAL_ONLY) === true;
}

export function setupLocalVaultHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.LOCAL_VAULT_STATUS, async () => {
    return {
      localOnly: isLocalOnly(),
      exists: existsSync(vaultPath()),
      hasVerifier: Boolean(getCachedVerifier()),
    };
  });

  ipcMain.handle(IPC_CHANNELS.LOCAL_VAULT_SET_MODE, async (_event, enabled: boolean) => {
    if (enabled !== true && enabled !== false) return { success: false, error: 'invalid_mode' };
    store.set(STORAGE_KEYS.LOCAL_ONLY, enabled);
    if (!enabled) session.lock();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.LOCAL_VAULT_CREATE, async () => {
    const created = createEmptyVault(vaultPath());
    if (!created.ok) return { success: false, error: created.error };
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.LOCAL_VAULT_UNLOCK, async (_event, password: string) => {
    const valid = await session.submitPassword(password, getCachedVerifier());
    return { success: true, valid };
  });

  ipcMain.handle(IPC_CHANNELS.LOCAL_VAULT_OPEN, async () => {
    if (!session.isUnlocked()) return { success: false, error: 'locked' };
    try {
      return { success: true, vault: readVaultFile(vaultPath()) };
    } catch {
      return { success: false, error: 'vault_unreadable' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.LOCAL_VAULT_REPLACE, async (_event, document: LocalVaultDocument) => {
    if (!session.isUnlocked()) return { success: false, error: 'locked' };
    if (!existsSync(vaultPath())) return { success: false, error: 'missing_vault' };
    try {
      writeVaultFile(vaultPath(), document);
      return { success: true };
    } catch {
      return { success: false, error: 'invalid_vault' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.LOCAL_VAULT_LOCK, async () => {
    session.lock();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.LOCAL_VAULT_DELETE, async () => {
    if (!session.isUnlocked()) return { success: false, error: 'locked' };
    try {
      deleteVaultFile(vaultPath());
      session.lock();
      return { success: true };
    } catch {
      return { success: false, error: 'delete_failed' };
    }
  });
}
