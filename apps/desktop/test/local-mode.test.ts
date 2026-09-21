import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cryptoManager, encrypt } from '@magicterm/crypto';
import type { LocalVaultDocument, Server, ServerFolder, Snippet } from '@magicterm/shared';
import {
  createEmptyVault,
  readVaultFile,
  VaultSession,
  writeVaultFile,
} from '../src/main/local-vault.js';
import { createScryptVerifier, verifyAgainstVerifier } from '../src/main/scrypt-verifier.js';
import { shouldContactSupabase } from '../src/renderer/lib/vault-mode.js';
import { moveVaultToAccount, type MoveVaultCloud } from '../src/renderer/lib/move-vault.js';

const HOST = 'vault-host.example';
const PASSWORD = 'vault-secret-password';
const USERNAME = 'vault-user';

function server(overrides: Partial<Server> = {}): Server {
  return {
    id: 'server-1',
    userId: null,
    orgId: null,
    name: 'box',
    host: 'A'.repeat(48),
    port: 22,
    username: 'B'.repeat(48),
    authType: 'password',
    connectionType: 'ssh',
    credentials: 'C'.repeat(48),
    isPinned: false,
    sortOrder: 0,
    folderId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('wrong password does not open or replace the vault file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mt-vault-'));
  const filePath = join(dir, 'local-vault.json');
  const verifier = await createScryptVerifier('correct-master-password');
  writeVaultFile(filePath, {
    version: 1,
    servers: [server()],
    folders: [],
    snippets: [],
  });
  const before = readFileSync(filePath);

  const session = new VaultSession(verifyAgainstVerifier);
  const opened = await session.submitPassword('wrong-master-password', verifier);
  assert.equal(opened, false);
  assert.equal(session.isUnlocked(), false);
  let reads = 0;
  assert.throws(() => session.read(() => {
    reads += 1;
    return readFileSync(filePath, 'utf8');
  }), /locked/);
  assert.equal(reads, 0);

  const created = createEmptyVault(filePath);
  assert.deepEqual(created, { ok: false, error: 'vault_exists' });
  assert.deepEqual(readFileSync(filePath), before);
  const saved = readVaultFile(filePath);
  assert.equal(saved.servers.length, 1);
  assert.equal(saved.servers[0]?.name, 'box');
});

test('vault file keeps host and password as ciphertext', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mt-vault-'));
  const filePath = join(dir, 'local-vault.json');
  const master = 'correct-master-password';
  const document: LocalVaultDocument = {
    version: 1,
    servers: [server({
      host: await encrypt(HOST, master),
      username: await encrypt(USERNAME, master),
      credentials: await encrypt(PASSWORD, master),
    })],
    folders: [],
    snippets: [{
      id: 'snippet-1',
      userId: 'local',
      name: 'hello',
      value: await encrypt('echo secret-snippet', master),
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
  };
  writeVaultFile(filePath, document);
  const raw = readFileSync(filePath, 'utf8');
  assert.equal(raw.includes(HOST), false);
  assert.equal(raw.includes(PASSWORD), false);
  assert.equal(raw.includes(USERNAME), false);
  assert.equal(raw.includes('secret-snippet'), false);
  assert.equal(raw.includes('masterPassword'), false);
  assert.equal(statSync(filePath).mode & 0o777, 0o600);

  const parsed = readVaultFile(filePath);
  assert.notEqual(parsed.servers[0]?.host, HOST);
  assert.throws(() => writeVaultFile(filePath, {
    ...parsed,
    servers: [{ ...parsed.servers[0]!, host: HOST }],
  }));
  assert.equal(readFileSync(filePath, 'utf8').includes(HOST), false);
});

test('local mode does not contact Supabase', () => {
  assert.equal(shouldContactSupabase(true), false);
  assert.equal(shouldContactSupabase(false), true);

  const auth = readFileSync(join(process.cwd(), 'src/renderer/contexts/AuthContext.tsx'), 'utf8');
  const gate = auth.indexOf('shouldContactSupabase');
  const sessionCall = auth.indexOf('getSession(');
  const localReturn = auth.indexOf('setIsLocalOnly(true)');
  assert.ok(gate !== -1 && gate < sessionCall);
  assert.ok(localReturn !== -1 && localReturn < sessionCall);
  assert.equal(auth.includes('initSupabase(') && auth.indexOf('function ensureSupabase') < auth.indexOf('initSupabase('), true);

  const servers = readFileSync(join(process.cwd(), 'src/renderer/contexts/ServersContext.tsx'), 'utf8');
  assert.ok(servers.indexOf('if (isLocalOnly)') < servers.indexOf('subscribeToServers('));
  const snippets = readFileSync(join(process.cwd(), 'src/renderer/contexts/SnippetsContext.tsx'), 'utf8');
  assert.ok(snippets.indexOf('if (isLocalOnly)') < snippets.indexOf('listSnippets('));
  const orgs = readFileSync(join(process.cwd(), 'src/renderer/contexts/OrganizationsContext.tsx'), 'utf8');
  assert.ok(orgs.indexOf('if (isLocalOnly)') < orgs.indexOf('listOrganizations('));
});

test('locking clears the in-memory master password', async () => {
  const master = 'correct-master-password';
  const ciphertext = await encrypt(PASSWORD, master);
  cryptoManager.setMasterPassword(master);
  assert.equal(cryptoManager.hasMasterPassword(), true);
  assert.equal(await cryptoManager.decrypt(ciphertext), PASSWORD);

  cryptoManager.clearMasterPassword();
  assert.equal(cryptoManager.hasMasterPassword(), false);
  await assert.rejects(() => cryptoManager.decrypt(ciphertext), /Master password not set/);

  const session = new VaultSession(async () => true);
  assert.equal(await session.submitPassword('correct-master-password', 'scrypt$1$1$1$aa$bb'), true);
  session.lock();
  let reads = 0;
  assert.throws(() => session.read(() => {
    reads += 1;
    return '{}';
  }), /locked/);
  assert.equal(reads, 0);
});

function cloudFixture(list: MoveVaultCloud['listPersonal']): MoveVaultCloud & { deleted: boolean; order: string[] } {
  const order: string[] = [];
  return {
    order,
    deleted: false,
    listPersonal: list,
    createFolder: async (folder) => ({ ...folder, id: `cloud-${folder.id}` }),
    createServer: async (item, folderId) => ({ ...item, id: `cloud-${item.id}`, folderId, orgId: null }),
    createSnippet: async (item) => ({ ...item, id: `cloud-${item.id}` }),
    removeFolder: async () => {},
    removeServer: async () => {},
    removeSnippet: async () => {},
    getVerifier: async () => null,
    setVerifier: async () => {},
  };
}

test('move waits for confirmation and keeps the local file when upload fails', async () => {
  const local: LocalVaultDocument = {
    version: 1,
    servers: [server()],
    folders: [] as ServerFolder[],
    snippets: [] as Snippet[],
  };
  let file = 'local-file';
  let mode: 'local' | 'cloud' = 'local';
  const calls: string[] = [];
  const base = {
    confirmed: false,
    sameMasterPassword: true,
    localPasswordOk: true,
    accountPasswordOk: true,
    localVerifier: 'scrypt$local',
    createNextVerifier: async () => {
      calls.push('verifier');
      return 'scrypt$next';
    },
    local,
    crypto: {
      decrypt: async (value: string) => value,
      encrypt: async (value: string) => value,
      useNextPassword: () => {},
      restorePassword: () => {},
    },
    deleteLocalFile: async () => {
      calls.push('delete');
      file = '';
    },
    disableLocalMode: async () => {
      calls.push('disable');
      mode = 'cloud';
    },
    restoreLocalVerifier: async () => {
      calls.push('restore');
    },
  };

  const idle = cloudFixture(async () => {
    calls.push('list');
    return { servers: [], folders: [], snippets: [] };
  });
  const declined = await moveVaultToAccount({ ...base, cloud: idle });
  assert.deepEqual(declined, { ok: false, reason: 'not_confirmed' });
  assert.equal(calls.length, 0);
  assert.equal(file, 'local-file');

  calls.length = 0;
  const failing = cloudFixture(async () => ({ servers: [], folders: [], snippets: [] }));
  failing.createServer = async () => {
    calls.push('upload');
    throw new Error('network');
  };
  const failed = await moveVaultToAccount({ ...base, confirmed: true, cloud: failing });
  assert.deepEqual(failed, { ok: false, reason: 'upload_failed' });
  assert.equal(calls.includes('delete'), false);
  assert.equal(calls.includes('disable'), false);
  assert.equal(file, 'local-file');
  assert.equal(mode, 'local');

  calls.length = 0;
  const occupied = cloudFixture(async () => ({
    servers: [server({ id: 'already' })],
    folders: [],
    snippets: [],
  }));
  const blocked = await moveVaultToAccount({ ...base, confirmed: true, cloud: occupied });
  assert.deepEqual(blocked, { ok: false, reason: 'cloud_not_empty' });
  assert.equal(calls.includes('delete'), false);
  assert.equal(file, 'local-file');
});
