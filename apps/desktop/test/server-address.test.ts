import assert from 'node:assert/strict';
import test from 'node:test';
import type { Server } from '@magicterm/shared';
import { addressAfterEdit, assertUniqueAddress, changesAddress, hostWithPort } from '../src/renderer/lib/server-address.js';

// Ciphertext in these tests is the plaintext behind a prefix; `bad:` fails to decrypt.
const decrypt = async (value: string) => {
  if (value.startsWith('bad:')) throw new Error('cannot decrypt');
  return value.replace(/^enc:/, '');
};

function server(id: string, host: string, port: number, username: string): Server {
  return {
    id,
    userId: null,
    orgId: null,
    name: id,
    host: `enc:${host}`,
    port,
    username: `enc:${username}`,
    authType: 'password',
    connectionType: 'ssh',
    credentials: 'enc:secret',
    isPinned: false,
    sortOrder: 0,
    folderId: null,
    createdAt: '',
    updatedAt: '',
  } as Server;
}

const servers = [server('a', '10.0.0.5', 22, 'root'), server('b', '10.0.0.5', 2222, 'root')];

test('same host on a different port is a different server (issue #20)', async () => {
  await assertUniqueAddress(servers, { host: '10.0.0.5', port: 2223, username: 'root' }, decrypt);
  await assertUniqueAddress(servers, { host: '10.0.0.5', port: 22, username: 'deploy' }, decrypt);
});

test('same user, host and port is a duplicate, host compared without case', async () => {
  await assert.rejects(
    assertUniqueAddress(servers, { host: '10.0.0.5', port: 2222, username: 'root' }, decrypt),
    /root@10\.0\.0\.5:2222 already exists/
  );
  await assert.rejects(
    assertUniqueAddress([server('c', 'Box.Example.com', 22, 'root')], { host: 'box.example.com ', port: 22, username: 'root' }, decrypt),
    /already exists/
  );
});

test('a server does not collide with itself, and unreadable entries are skipped', async () => {
  await assertUniqueAddress(servers, { host: '10.0.0.5', port: 2222, username: 'root' }, decrypt, 'b');
  const unreadable = { ...server('d', '10.0.0.5', 22, 'root'), host: 'bad:x' };
  await assertUniqueAddress([unreadable], { host: '10.0.0.5', port: 22, username: 'root' }, decrypt);
});

test('an edit that only moves the port is checked against the full address', async () => {
  const input = { port: 22 };
  assert.equal(changesAddress(input), true);
  assert.equal(changesAddress({}), false);
  const next = await addressAfterEdit(servers[1], input, decrypt);
  assert.deepEqual(next, { host: '10.0.0.5', port: 22, username: 'root' });
  await assert.rejects(assertUniqueAddress(servers, next, decrypt, 'b'), /already exists/);
});

test('the default port is left out of labels', () => {
  assert.equal(hostWithPort('10.0.0.5', 22), '10.0.0.5');
  assert.equal(hostWithPort('10.0.0.5', 2222), '10.0.0.5:2222');
});
