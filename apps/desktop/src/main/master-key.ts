import { IpcMain } from 'electron';
import Store from 'electron-store';
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import {
  IPC_CHANNELS,
  STORAGE_KEYS,
  SCRYPT_N,
  SCRYPT_R,
  SCRYPT_P,
  SCRYPT_SALT_LENGTH,
  SCRYPT_KEY_LENGTH,
  SCRYPT_MAX_MEM,
} from '@magicterm/shared';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

const store = new Store();

// Cached verifier shared across renderer requests. The renderer (or cloud sync
// path) calls SET_VERIFIER once it knows the canonical value; verifications
// after that use this cache so the verifier never has to be sent back to the
// renderer just to compare strings.
let cachedVerifier: string | null = null;

interface ParsedScryptVerifier {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parseScryptVerifier(value: string): ParsedScryptVerifier {
  const parts = value.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    throw new Error('invalid_verifier_format');
  }

  const N = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    throw new Error('invalid_verifier_params');
  }

  const salt = Buffer.from(parts[4], 'base64');
  const hash = Buffer.from(parts[5], 'base64');
  if (salt.length === 0 || hash.length === 0) {
    throw new Error('invalid_verifier_payload');
  }

  return { N, r, p, salt, hash };
}

function isLegacyVerifier(value: string): boolean {
  return !value.includes('$');
}

async function legacyMatches(password: string, legacyHash: string): Promise<boolean> {
  // Legacy verifier was a single SHA-256 of the UTF-8 password, base64 encoded.
  // Constant-time compare to avoid leaking timing info if it matters.
  const expected = Buffer.from(legacyHash, 'base64');
  const actual = createHash('sha256').update(password, 'utf8').digest();
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

async function scryptDerive(password: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> {
  return scrypt(password, salt, SCRYPT_KEY_LENGTH, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: SCRYPT_MAX_MEM,
  });
}

export async function createScryptVerifier(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_LENGTH);
  const hash = await scryptDerive(password, salt, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyAgainstVerifier(password: string, verifier: string): Promise<boolean> {
  if (isLegacyVerifier(verifier)) {
    return legacyMatches(password, verifier);
  }

  let parsed: ParsedScryptVerifier;
  try {
    parsed = parseScryptVerifier(verifier);
  } catch {
    return false;
  }

  const candidate = await scryptDerive(password, parsed.salt, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
  });

  if (candidate.length !== parsed.hash.length) return false;
  return timingSafeEqual(candidate, parsed.hash);
}

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
      } catch (err) {
        return { success: false, valid: false, error: (err as Error).message };
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
