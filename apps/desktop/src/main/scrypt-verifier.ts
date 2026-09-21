import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import {
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

export function isLegacyVerifier(value: string): boolean {
  return !value.includes('$');
}

async function legacyMatches(password: string, legacyHash: string): Promise<boolean> {
  // Legacy verifier was a single SHA-256 of the UTF-8 password, base64 encoded.
  // This only re-derives the old digest to verify a pre-existing legacy verifier.
  // SHA-256 is not used to persist new credentials.
  // codeql[js/insufficient-password-hash]
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
