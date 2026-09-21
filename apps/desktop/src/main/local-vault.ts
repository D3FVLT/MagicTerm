import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'fs';
import { dirname } from 'path';
import type { LocalVaultDocument } from '@magicterm/shared';

export const LOCAL_VAULT_VERSION = 1;
const FILE_MODE = 0o600;
const MIN_CIPHERTEXT_LENGTH = 44;

export type { LocalVaultDocument };

export function emptyLocalVault(): LocalVaultDocument {
  return { version: LOCAL_VAULT_VERSION, servers: [], folders: [], snippets: [] };
}

function isCiphertext(value: unknown): boolean {
  return typeof value === 'string'
    && value.length >= MIN_CIPHERTEXT_LENGTH
    && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function assertNoPasswordKeys(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoPasswordKeys(item);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'password' || key === 'masterPassword' || key === 'master_password') {
      throw new Error('invalid_vault');
    }
    assertNoPasswordKeys(child);
  }
}

function assertSecret(value: unknown, required: boolean): void {
  if (value === undefined || value === null) {
    if (required) throw new Error('invalid_vault');
    return;
  }
  if (!isCiphertext(value)) throw new Error('invalid_vault');
}

export function parseLocalVault(raw: string): LocalVaultDocument {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') throw new Error('invalid_vault');
  const doc = parsed as Partial<LocalVaultDocument>;
  if (doc.version !== LOCAL_VAULT_VERSION || !Array.isArray(doc.servers) || !Array.isArray(doc.folders) || !Array.isArray(doc.snippets)) {
    throw new Error('invalid_vault');
  }
  assertNoPasswordKeys(doc);
  for (const server of doc.servers) {
    assertSecret(server.host, true);
    assertSecret(server.username, true);
    assertSecret(server.credentials, false);
  }
  for (const snippet of doc.snippets) {
    assertSecret(snippet.value, true);
  }
  return doc as LocalVaultDocument;
}

export function writeVaultFile(filePath: string, document: LocalVaultDocument): void {
  const json = JSON.stringify(document);
  parseLocalVault(json);
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.tmp`;
  const fd = openSync(tmp, 'w', FILE_MODE);
  try {
    writeSync(fd, json, undefined, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, FILE_MODE);
  renameSync(tmp, filePath);
  chmodSync(filePath, FILE_MODE);
}

export function createEmptyVault(filePath: string): { ok: true } | { ok: false; error: 'vault_exists' } {
  if (existsSync(filePath)) return { ok: false, error: 'vault_exists' };
  writeVaultFile(filePath, emptyLocalVault());
  return { ok: true };
}

export function readVaultFile(filePath: string): LocalVaultDocument {
  return parseLocalVault(readFileSync(filePath, 'utf8'));
}

export function deleteVaultFile(filePath: string): void {
  if (existsSync(filePath)) unlinkSync(filePath);
  const tmp = `${filePath}.tmp`;
  if (existsSync(tmp)) unlinkSync(tmp);
}

/**
 * Password check and file read are separate. A failed check never reads.
 * A failed check also does not clear an unlock that already happened.
 */
export class VaultSession {
  private unlocked = false;

  constructor(private readonly verify: (password: string, verifier: string) => Promise<boolean>) {}

  async submitPassword(password: string, verifier: string | null): Promise<boolean> {
    if (!verifier || typeof password !== 'string' || password.length === 0) return false;
    const ok = await this.verify(password, verifier);
    if (!ok) return false;
    this.unlocked = true;
    return true;
  }

  isUnlocked(): boolean {
    return this.unlocked;
  }

  lock(): void {
    this.unlocked = false;
  }

  read(readFile: () => string): LocalVaultDocument {
    if (!this.unlocked) throw new Error('locked');
    return parseLocalVault(readFile());
  }
}
