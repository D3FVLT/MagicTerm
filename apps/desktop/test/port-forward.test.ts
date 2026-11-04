import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SOCKS_REPLY,
  browserUrl,
  describePreset,
  findPortClash,
  friendlyChannelError,
  friendlyListenError,
  isValidHost,
  listenAddress,
  localAddress,
  parsePresets,
  parseSocksGreeting,
  parseSocksRequest,
  serializePresets,
  socksReply,
  validatePreset,
  type PortForwardPreset,
} from '../src/common/port-forward.js';

const panel: PortForwardPreset = { id: 'a', kind: 'local', listenPort: 8080, targetHost: '127.0.0.1', targetPort: 80 };
const back: PortForwardPreset = { id: 'b', kind: 'remote', listenPort: 9000, targetHost: 'localhost', targetPort: 3000 };
const socks: PortForwardPreset = { id: 'c', kind: 'dynamic', listenPort: 1080 };

test('valid presets pass and bad ports or hosts are named', () => {
  assert.equal(validatePreset(panel), null);
  assert.equal(validatePreset(back), null);
  assert.equal(validatePreset(socks), null);
  assert.match(validatePreset({ ...panel, listenPort: 0 }) ?? '', /Local port/);
  assert.match(validatePreset({ ...back, listenPort: 70000 }) ?? '', /Server port/);
  assert.match(validatePreset({ ...panel, targetPort: 1.5 }) ?? '', /Destination port/);
  assert.match(validatePreset({ ...panel, targetHost: '' }) ?? '', /from the server/);
  assert.match(validatePreset({ ...back, targetHost: 'http://x' }) ?? '', /from this computer/);
  assert.match(validatePreset({ ...panel, kind: 'other' as never }) ?? '', /local, remote or SOCKS/);
});

test('hosts accept names and IP literals only', () => {
  for (const ok of ['localhost', '10.0.0.5', 'db.internal', 'my-host_1', '::1', 'fe80::1']) {
    assert.ok(isValidHost(ok), ok);
  }
  for (const bad of ['', ' host', 'host ', 'a b', 'http://x', 'x/y', 'host:80x', 42]) {
    assert.ok(!isValidHost(bad), String(bad));
  }
});

test('listeners bind to loopback unless all interfaces is chosen', () => {
  assert.equal(listenAddress(panel), '127.0.0.1');
  assert.equal(listenAddress(socks), '127.0.0.1');
  assert.equal(listenAddress({ ...panel, allInterfaces: true }), '0.0.0.0');
  assert.equal(listenAddress(back), 'localhost');
  assert.equal(listenAddress({ ...back, allInterfaces: true }), '');
});

test('local and SOCKS forwards clash on this computer, remote ones on the server', () => {
  const list = [panel, back, socks];
  assert.equal(findPortClash(list, { ...socks, id: 'd', listenPort: 8080 })?.id, 'a');
  assert.equal(findPortClash(list, { ...back, id: 'd', listenPort: 8080 }), null);
  assert.equal(findPortClash(list, { ...back, id: 'd' })?.id, 'b');
  assert.equal(findPortClash(list, panel), null, 'a preset does not clash with itself');
});

test('presets round-trip and malformed entries are dropped', () => {
  const list = [{ ...panel, label: 'Panel', autoStart: true }, back, { ...socks, allInterfaces: true }];
  assert.deepEqual(parsePresets(serializePresets(list)), list);
  const mixed = JSON.stringify([
    panel,
    { id: '', kind: 'local', listenPort: 1, targetHost: 'x', targetPort: 1 },
    { id: 'x', kind: 'local', listenPort: 99999, targetHost: 'x', targetPort: 1 },
    { id: 'y', kind: 'dynamic', listenPort: 1081, targetHost: 'ignored', targetPort: 5, autoStart: 'yes' },
    'junk',
    null,
  ]);
  assert.deepEqual(parsePresets(mixed), [panel, { id: 'y', kind: 'dynamic', listenPort: 1081 }]);
  assert.deepEqual(parsePresets('not json'), []);
  assert.deepEqual(parsePresets('{"a":1}'), []);
  assert.deepEqual(parsePresets(undefined), []);
});

test('descriptions and addresses', () => {
  assert.equal(describePreset(panel), '127.0.0.1:8080 → 127.0.0.1:80 on the server');
  assert.equal(describePreset(back), 'localhost:9000 on the server → localhost:3000');
  assert.equal(describePreset({ ...socks, allInterfaces: true }), 'SOCKS5 proxy on *:1080');
  assert.equal(describePreset({ ...panel, targetHost: '::1' }), '127.0.0.1:8080 → [::1]:80 on the server');
  assert.equal(localAddress(panel), '127.0.0.1:8080');
  assert.equal(localAddress(back), null);
  assert.equal(browserUrl(panel), 'http://127.0.0.1:8080');
  assert.equal(browserUrl({ ...panel, targetPort: 443 }), 'https://127.0.0.1:8080');
  assert.equal(browserUrl(socks), null);
});

test('listen and channel errors read plainly', () => {
  assert.equal(friendlyListenError({ code: 'EADDRINUSE' }, 8080), 'Port 8080 is already in use on this computer.');
  assert.match(friendlyListenError({ code: 'EACCES' }, 80), /above 1023/);
  assert.match(friendlyChannelError({ message: '(SSH) Channel open failure: Connection refused' }, '127.0.0.1:81'), /nothing is listening/);
  assert.match(friendlyChannelError({ message: 'administratively prohibited: open failed' }, 'x:1'), /AllowTcpForwarding/);
});

test('SOCKS5 greeting', () => {
  assert.equal(parseSocksGreeting(Buffer.from([0x05])).kind, 'more');
  assert.equal(parseSocksGreeting(Buffer.from([0x05, 0x02, 0x00])).kind, 'more');
  const ok = parseSocksGreeting(Buffer.from([0x05, 0x02, 0x02, 0x00, 0xaa]));
  assert.equal(ok.kind, 'ok');
  if (ok.kind === 'ok') {
    assert.deepEqual([...ok.value.reply], [0x05, 0x00]);
    assert.equal(ok.consumed, 4);
  }
  const auth = parseSocksGreeting(Buffer.from([0x05, 0x01, 0x02]));
  assert.equal(auth.kind, 'error');
  if (auth.kind === 'error') assert.deepEqual([...(auth.reply ?? [])], [0x05, 0xff]);
  const socks4 = parseSocksGreeting(Buffer.from([0x04, 0x01, 0x00, 0x50]));
  assert.equal(socks4.kind, 'error');
  if (socks4.kind === 'error') assert.match(socks4.message, /socks5h/);
});

test('SOCKS5 CONNECT requests for IPv4, names and IPv6', () => {
  const ipv4 = parseSocksRequest(Buffer.from([0x05, 0x01, 0x00, 0x01, 10, 0, 0, 7, 0x1f, 0x90, 0xee]));
  assert.deepEqual(ipv4, { kind: 'ok', value: { host: '10.0.0.7', port: 8080 }, consumed: 10 });

  const name = Buffer.from('example.com');
  const named = parseSocksRequest(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, name.length]), name, Buffer.from([0x01, 0xbb])]));
  assert.deepEqual(named, { kind: 'ok', value: { host: 'example.com', port: 443 }, consumed: 5 + name.length + 2 });

  const v6 = Buffer.alloc(22);
  v6.set([0x05, 0x01, 0x00, 0x04]);
  v6[19] = 1;
  v6.writeUInt16BE(22, 20);
  assert.deepEqual(parseSocksRequest(v6), { kind: 'ok', value: { host: '0:0:0:0:0:0:0:1', port: 22 }, consumed: 22 });

  assert.equal(parseSocksRequest(Buffer.from([0x05, 0x01, 0x00, 0x03, 5, 0x61])).kind, 'more');
  const bind = parseSocksRequest(Buffer.from([0x05, 0x02, 0x00, 0x01, 1, 2, 3, 4, 0, 80]));
  assert.equal(bind.kind, 'error');
  if (bind.kind === 'error') assert.equal(bind.reply?.[1], SOCKS_REPLY.COMMAND_NOT_SUPPORTED);
  assert.deepEqual([...socksReply(SOCKS_REPLY.SUCCEEDED)], [5, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
});
