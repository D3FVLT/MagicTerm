import { IpcMain } from 'electron';
import Store from 'electron-store';
import { IPC_CHANNELS, STORAGE_KEYS } from '@magicterm/shared';
import { createScryptVerifier, isLegacyVerifier, verifyAgainstVerifier } from './scrypt-verifier';

const store = new Store();

// Cached verifier shared across renderer requests. The renderer (or cloud sync
// path) calls SET_VERIFIER once it knows the canonical value; verifications
// after that use this cache so the verifier never has to be sent back to the
// renderer just to compare strings.
let cachedVerifier: string | null = null;

export function setupMasterKeyHandlers(ipcMain: IpcMain): void {
  // Initial cache priming from disk. The renderer can later overwrite this via
  // SET_VERIFIER after it pulled a fresher value from cloud sync.
  const persisted = store.get(STORAGE_KEYS.MASTER_KEY_VERIFIER) as string | undefined;
  if (persisted) {
    cachedVerifier = persisted;
  } else {
    const legacy = store.get(STORAGE_KEYS.MASTER_KEY_HASH) as string | undefined;
    if (legacy) cachedVerifier = legacy;
  }

  ipcMain.handle(
    IPC_CHANNELS.CRYPTO_SET_VERIFIER,
    async (_event, verifier: string | null) => {
      if (verifier === null) {
        cachedVerifier = null;
        store.delete(STORAGE_KEYS.MASTER_KEY_VERIFIER);
        return { success: true };
      }
      if (typeof verifier !== 'string' || verifier.length === 0 || verifier.length > 4096) {
        return { success: false, error: 'invalid_verifier' };
      }
      cachedVerifier = verifier;
      store.set(STORAGE_KEYS.MASTER_KEY_VERIFIER, verifier);
      // Drop the legacy single-SHA256 hash once we have a strong verifier.
      if (!isLegacyVerifier(verifier)) {
        store.delete(STORAGE_KEYS.MASTER_KEY_HASH);
      }
      return { success: true };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CRYPTO_CREATE_VERIFIER,
    async (_event, password: string) => {
      if (typeof password !== 'string' || password.length === 0) {
        return { success: false, error: 'invalid_password' };
      }
      try {
        const verifier = await createScryptVerifier(password);
        cachedVerifier = verifier;
        store.set(STORAGE_KEYS.MASTER_KEY_VERIFIER, verifier);
        store.delete(STORAGE_KEYS.MASTER_KEY_HASH);
        return { success: true, verifier };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CRYPTO_VERIFY_MASTER_PASSWORD,
    async (_event, password: string) => {
      if (!cachedVerifier) {
        return { success: false, valid: false, error: 'no_verifier' };
      }
      if (typeof password !== 'string' || password.length === 0) {
        return { success: false, valid: false, error: 'invalid_password' };
      }

      try {
        const valid = await verifyAgainstVerifier(password, cachedVerifier);
        if (!valid) {
          return { success: true, valid: false, upgraded: false };
        }

        // On success with a legacy verifier, transparently upgrade to scrypt
        // so the leaked-DB attack window closes after the first unlock.
        if (isLegacyVerifier(cachedVerifier)) {
          const upgraded = await createScryptVerifier(password);
          cachedVerifier = upgraded;
          store.set(STORAGE_KEYS.MASTER_KEY_VERIFIER, upgraded);
          store.delete(STORAGE_KEYS.MASTER_KEY_HASH);
          return { success: true, valid: true, upgraded: true, verifier: upgraded };
        }

        return { success: true, valid: true, upgraded: false };
      } catch {
        return { success: false, valid: false, error: 'verify_failed' };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.CRYPTO_GET_VERIFIER, async () => {
    return { verifier: cachedVerifier };
  });

  // Checks a verifier the renderer already fetched (the account copy) without
  // replacing the one stored for this machine.
  ipcMain.handle(
    IPC_CHANNELS.CRYPTO_CHECK_VERIFIER,
    async (_event, password: string, verifier: string) => {
      if (typeof password !== 'string' || password.length === 0) {
        return { success: false, valid: false };
      }
      if (typeof verifier !== 'string' || verifier.length === 0 || verifier.length > 4096) {
        return { success: false, valid: false };
      }
      try {
        const valid = await verifyAgainstVerifier(password, verifier);
        return { success: true, valid };
      } catch {
        return { success: false, valid: false };
      }
    }
  );
}

export function clearCachedVerifier(): void {
  cachedVerifier = null;
}

export function getCachedVerifier(): string | null {
  return cachedVerifier;
}
