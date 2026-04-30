import { PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH } from '@magicterm/shared';

const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

function getRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function deriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    {
      name: ALGORITHM,
      length: PBKDF2_KEY_LENGTH,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encrypt(
  plaintext: string,
  masterPassword: string
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  const salt = getRandomBytes(SALT_LENGTH);
  const iv = getRandomBytes(IV_LENGTH);
  const key = await deriveKey(masterPassword, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv.buffer as ArrayBuffer },
    key,
    data
  );

  const combined = new Uint8Array(
    salt.length + iv.length + encrypted.byteLength
  );
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);

  return arrayBufferToBase64(combined.buffer);
}

export async function decrypt(
  encryptedData: string,
  masterPassword: string
): Promise<string> {
  const combined = new Uint8Array(base64ToArrayBuffer(encryptedData));

  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const data = combined.slice(SALT_LENGTH + IV_LENGTH);

  const key = await deriveKey(masterPassword, salt);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: iv.buffer as ArrayBuffer },
    key,
    data
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/**
 * @deprecated Legacy verifier — single SHA-256 round, no salt. Brute-forceable
 * offline if the hash leaks (cloud sync row, electron-store file, IPC payload).
 * Kept only so the renderer can detect old verifiers and trigger a transparent
 * upgrade to the scrypt-based verifier owned by the main process.
 *
 * Detect with `isLegacyVerifier(value)`. Verification of new-format strings
 * MUST go through the main process (see CRYPTO_VERIFY_MASTER_PASSWORD IPC).
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return arrayBufferToBase64(hash);
}

/**
 * Returns true when the value looks like the legacy SHA-256 base64 verifier
 * (no `$` separators). New-format scrypt verifiers always start with `scrypt$`.
 */
export function isLegacyVerifier(value: string | null | undefined): boolean {
  if (!value) return false;
  return !value.includes('$');
}

export class CryptoManager {
  private masterPassword: string | null = null;

  setMasterPassword(password: string): void {
    this.masterPassword = password;
  }

  clearMasterPassword(): void {
    this.masterPassword = null;
  }

  hasMasterPassword(): boolean {
    return this.masterPassword !== null;
  }

  async encrypt(plaintext: string): Promise<string> {
    if (!this.masterPassword) {
      throw new Error('Master password not set');
    }
    return encrypt(plaintext, this.masterPassword);
  }

  async decrypt(encryptedData: string): Promise<string> {
    if (!this.masterPassword) {
      throw new Error('Master password not set');
    }
    return decrypt(encryptedData, this.masterPassword);
  }
}

export const cryptoManager = new CryptoManager();
