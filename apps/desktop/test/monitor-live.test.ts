import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLogScript,
  buildSampleScript,
  buildSiteCheckScript,
  computeLive,
  followRunner,
  parseCpuLine,
  parseDf,
  parseProcStat,
  parseSample,
  parseSiteChecks,
  siteTargets,
  watchSpecFrom,
} from '../src/common/monitor/live.js';
import { parseDocker } from '../src/common/monitor/discovery.js';
import type { DiscoveredService, DiscoveryResult } from '../src/common/monitor/types.js';

const N = 'n0nce';
const sec = (name: string, body: string) => `\n@@${N} ${name}\n${body}\n`;

function service(partial: Partial<DiscoveredService> & Pick<DiscoveredService, 'id' | 'kind'>): DiscoveredService {
  return {
    name: partial.id,
    description: null,
    state: 'running',
    detail: '',
    user: null,
    pids: [],
    cwd: null,
    command: null,
    ports: [],
    domains: [],
    since: null,
    restarts: null,
    autostart: null,
    projectPath: null,
    ...partial,
  };
}

const CONTAINER = 'a'.repeat(64);

const discovery: DiscoveryResult = {
  version: 1,
  scannedAt: '2026-11-02T12:00:00.000Z',
  host: { hostname: 'web-1', os: null, kernel: null, user: 'root', privilege: 'root' },
  tools: ['systemd', 'docker', 'pm2', 'nginx'],
  services: [
    service({ id: 'systemd:api.service', kind: 'systemd', pids: [80] }),
    service({ id: 'pm2:deploy:web', kind: 'pm2', pids: [149], pm2: { namespace: null, mode: 'fork', instances: 1, outLog: '/home/deploy/.pm2/logs/web-out.log', errLog: '/home/deploy/.pm2/logs/web-error.log' } }),
    service({ id: 'docker:shop', kind: 'docker', docker: { id: CONTAINER, image: 'nginx', composeProject: null, composeService: null, health: null } }),
    service({ id: 'process:node:9000', kind: 'process', pids: [700] }),
  ],
  sites: [
    { domains: ['app.example.com', 'www.app.example.com', 'c.example.com', 'd.example.com'], listen: ['80'], ssl: false, root: null, proxies: [], certificate: null, file: '/a' },
    { domains: ['app.example.com', '*.example.com'], listen: ['[::]:8443 ssl http2', '8080'], ssl: true, root: null, proxies: [], certificate: null, file: '/b' },
    { domains: ['bad name;rm'], listen: ['80'], ssl: false, root: null, proxies: [], certificate: null, file: '/c' },
  ],
  ports: [],
  projects: [],
  notes: [],
};

const stat = (pid: number, ppid: number, utime: number, stime: number, rss: number, comm = 'node') =>
  `${pid} (${comm}) S ${ppid} 1 1 0 -1 4194560 100 0 0 0 ${utime} ${stime} 0 0 20 0 1 0 100 1000000 ${rss} 18446744073709551615`;

function sampleOutput(ticks: { api: number; child: number; web: number; idle: number; total: number }, slow: boolean) {
  return [
    sec('host', [
      'load=0.50 0.40 0.30 1/200 1234',
      `cpu=cpu  ${ticks.total - ticks.idle} 0 0 ${ticks.idle} 0 0 0 0 0 0`,
      'uptime=3600.5',
      'ncpu=2',
      'page=4096',
      'MemTotal=2048000',
      'MemAvailable=1024000',
      'SwapTotal=0',
      'SwapFree=0',
    ].join('\n')),
    sec('disk', 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000000 900000 100000 90% /\ntmpfs 1000 0 1000 0% /run\n/dev/sdb1 2000000 200000 1800000 10% /mnt/my data'),
    sec('stat', [
      stat(80, 1, ticks.api, 0, 1000),
      stat(81, 80, ticks.child, 0, 500, 'node worker (x)'),
      stat(149, 140, ticks.web, 0, 2000),
      stat(700, 1, 5, 5, 100, 'python3'),
    ].join('\n')),
    sec('systemd', 'Id=api.service\nActiveState=active\nSubState=running\nMainPID=80\nNRestarts=1'),
    sec('docker', `${CONTAINER} 2 {"Status":"running","ExitCode":0,"Pid":4242,"Health":{"Status":"healthy","Log":[{"Output":"secret"}]}}\nnot a line`),
    slow ? sec('pm2 deploy /home/deploy', '[{"pid":150,"name":"web","pm2_env":{"status":"online","restart_time":3}}]') : '',
    sec('end', ''),
  ].join('');
}

test('watch spec and site targets come from the scan', () => {
  const spec = watchSpecFrom(discovery);
  assert.deepEqual(spec.units, ['api.service']);
  assert.deepEqual(spec.containers, [CONTAINER]);
  assert.equal(spec.pm2, true);
  assert.deepEqual(spec.sites.map((s) => s.key), [
    'http://app.example.com:80',
    'http://www.app.example.com:80',
    'http://c.example.com:80',
    'https://app.example.com:8443',
  ]);
  assert.deepEqual(siteTargets({ ...discovery, sites: [] }), []);
});

test('sample script only lists safe names and adds PM2 on the slow tier', () => {
  const spec = { ...watchSpecFrom(discovery), units: ['api.service', 'x; rm -rf /.service'], containers: [CONTAINER, '$(id)'] };
  const fast = buildSampleScript(N, spec, false);
  assert.match(fast, /'api\.service'/);
  assert.doesNotMatch(fast, /rm -rf|\$\(id\)/);
  assert.doesNotMatch(fast, /jlist/);
  assert.match(buildSampleScript(N, spec, true), /jlist/);
  assert.doesNotMatch(buildSampleScript(N, { ...spec, units: [], containers: [] }, false), /systemctl show|dk inspect/);
});

test('proc stat, cpu line and df parsing', () => {
  const procs = parseProcStat(`${stat(81, 80, 7, 3, 500, 'node worker (x)')}\ngarbage`);
  assert.deepEqual(procs.get(81), { ppid: 80, ticks: 10, rssPages: 500 });
  assert.equal(procs.size, 1);
  assert.deepEqual(parseCpuLine('cpu  100 5 50 800 20 0 5 0 0 0'), { total: 980, idle: 820 });
  assert.equal(parseCpuLine('intr 1 2'), null);
  const disks = parseDf('Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 100 50 50 50% /\noverlay 100 50 50 50% /var/lib/docker/x\ntmpfs 10 0 10 0% /dev/shm\n/dev/vda1 10 9 1 95% /srv data\n/dev/loop0 10 10 0 100% /snap/core/1');
  assert.deepEqual(disks.map((d) => [d.mount, d.percent]), [['/', 50], ['/srv data', 95]]);
});

test('CPU and memory per service from two samples', () => {
  const spec = watchSpecFrom(discovery);
  const first = parseSample(sampleOutput({ api: 100, child: 50, web: 10, idle: 900, total: 1000 }, true), N, true);
  assert.deepEqual(first.load, [0.5, 0.4, 0.3]);
  assert.equal(first.memory?.total, 2048000 * 1024);
  assert.equal(first.units.get('api.service')?.restarts, 1);
  assert.deepEqual(first.containers.get(CONTAINER), { pid: 4242, state: 'running', detail: 'running, healthy', restarts: 2 });
  assert.equal(first.pm2?.[0].id, 'pm2:deploy:web');

  const a = computeLive(discovery, spec, first, null);
  assert.equal(a.live.services['systemd:api.service'].cpuPercent, null, 'no CPU on the first sample');
  assert.equal(a.live.services['systemd:api.service'].memoryBytes, 1500 * 4096, 'main process and child');
  assert.equal(a.live.host.cpuPercent, null);

  // 200 ticks pass on 2 CPUs; the API and its child use 20 + 10, PM2 restarted web as pid 150 (gone from /proc).
  const second = parseSample(sampleOutput({ api: 120, child: 60, web: 10, idle: 1050, total: 1200 }, false), N, false);
  assert.equal(second.pm2, null);
  const b = computeLive(discovery, spec, second, a.memory);
  assert.equal(b.live.host.cpuPercent, 25);
  assert.equal(b.live.services['systemd:api.service'].cpuPercent, 30, '30 of 200 ticks on 2 cores is 30% of one core');
  assert.equal(b.live.services['systemd:api.service'].state, 'running');
  assert.equal(b.live.services['pm2:deploy:web'].state, 'unknown', 'the PID from PM2 is gone and PM2 was not listed again');
  assert.equal(b.live.services['docker:shop'].memoryBytes, null, 'container PID not visible from here');
  assert.equal(b.live.services['docker:shop'].detail, 'running, healthy');
  assert.equal(b.live.services['process:node:9000'].state, 'running');
  assert.equal(b.live.services['process:node:9000'].cpuPercent, 0);
});

test('a hand-started process that exits is reported stopped', () => {
  const spec = watchSpecFrom(discovery);
  const raw = parseSample(sec('stat', stat(80, 1, 1, 1, 1)) + sec('end', ''), N);
  const live = computeLive(discovery, spec, raw, null).live;
  assert.equal(live.services['process:node:9000'].state, 'stopped');
  assert.equal(live.services['process:node:9000'].memoryBytes, null);
  assert.equal(live.host.memory, null);
});

test('site checks: status, local fallback, errors and certificates', () => {
  const targets = watchSpecFrom(discovery).sites;
  const script = buildSiteCheckScript(N, targets);
  assert.match(script, /--resolve "\$2:\$4:127\.0\.0\.1"/);
  assert.match(script, /mt_check 'https:\/\/app\.example\.com:8443' 'app\.example\.com' https 8443 &/);
  const output = sec('checks', [
    'http\thttp://app.example.com:80\tdns\t0\t301 0.042 0',
    'http\thttp://www.app.example.com:80\tlocal\t7\t000 0.001 0',
    'http\thttp://c.example.com:80\tdns\t28\t000 8.0 0',
    'http\thttps://app.example.com:8443\tlocal\t0\t200 0.010 18',
    'cert\thttps://app.example.com:8443\tnotAfter=Nov 22 16:40:24 2026 GMT\tissuer=C = US, O = Let\'s Encrypt, CN = R11\t',
    'http\thttps://unknown:1\tdns\t0\t200 0 0',
  ].join('\n')) + sec('end', '');
  const checks = parseSiteChecks(output, N, targets, new Date('2026-11-02T12:00:00Z'));
  assert.equal(Object.keys(checks).length, 4);
  assert.equal(checks['http://app.example.com:80'].status, 301);
  assert.equal(checks['http://app.example.com:80'].timeMs, 42);
  assert.equal(checks['http://www.app.example.com:80'].error, 'connection refused');
  assert.equal(checks['http://www.app.example.com:80'].via, 'local');
  assert.equal(checks['http://c.example.com:80'].error, 'timed out after 8 seconds');
  const tls = checks['https://app.example.com:8443'];
  assert.equal(tls.certDays, 20);
  assert.equal(tls.certExpires, '2026-11-22T16:40:24.000Z');
  assert.equal(tls.certIssuer, 'R11');
  assert.equal(tls.certProblem, 'self-signed certificate');
  const noCert = parseSiteChecks(sec('checks', 'cert\thttps://app.example.com:8443\t'), N, targets);
  assert.equal(noCert['https://app.example.com:8443'].certProblem, 'no certificate was served');
});

test('log scripts per manager', () => {
  const [api, web, shop, proc] = discovery.services;
  assert.match(buildLogScript(N, api, { lines: 200, follow: false }) ?? '', /asroot journalctl -u 'api\.service' -n 200 --no-pager -o short-iso\n/);
  assert.match(buildLogScript(N, api, { lines: 99999, follow: true }) ?? '', /-n 5000 --no-pager -o short-iso -f/);
  assert.match(buildLogScript(N, web, { lines: 10, follow: true }) ?? '', /asroot tail -n 10 -F '\/home\/deploy\/\.pm2\/logs\/web-out\.log' '\/home\/deploy\/\.pm2\/logs\/web-error\.log'/);
  assert.match(buildLogScript(N, shop, { lines: 10, follow: false }) ?? '', new RegExp(`dk logs --tail 10 --timestamps ${CONTAINER} 2>&1`));
  assert.match(buildLogScript(N, proc, { lines: 10, follow: false }) ?? '', /readlink \/proc\/700\/fd\/1/);
  assert.equal(buildLogScript(N, service({ id: 'systemd:x; y.service', kind: 'systemd' }), { lines: 1, follow: false }), null);
  assert.equal(buildLogScript(N, service({ id: 'pm2:a:b', kind: 'pm2' }), { lines: 1, follow: false }), null);
  const followed = buildLogScript(N, api, { lines: 5, follow: true }) ?? '';
  assert.match(followed, /cat >\/dev\/null\npkill -P \$MT_LOG/);
  assert.match(followRunner('echo hi'), /^sh -c 'IFS= read -r MT_PW; echo hi'$/);
});

test('docker scan reads health from the whole State', () => {
  const [svc] = parseDocker(`{"id":"${CONTAINER}","name":"/shop","image":"nginx","state":{"Status":"running","ExitCode":0,"Pid":9,"StartedAt":"2026-11-02T10:00:00Z","FinishedAt":"0001-01-01T00:00:00Z"},"restartCount":0,"restartPolicy":"always","labels":{},"ports":{}}`);
  assert.equal(svc.state, 'running');
  assert.equal(svc.docker?.health, null);
  assert.deepEqual(svc.pids, [9]);
  assert.equal(svc.since, '2026-11-02T10:00:00.000Z');
});
