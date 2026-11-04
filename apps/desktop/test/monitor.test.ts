import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCRIPT_RUNNER,
  buildDiscoveryScript,
  buildProjectScript,
  isSafePath,
  scriptInput,
  shQuote,
  splitSections,
} from '../src/common/monitor/script.js';
import { nginxServers, parseHostPort, tokenizeNginx } from '../src/common/monitor/nginx.js';
import {
  applyProjects,
  cleanRemote,
  containerFromCgroups,
  detectLanguage,
  parseDiscoveryOutput,
  parseDocker,
  parsePm2,
  parseProject,
  parseSs,
  parseSystemdShow,
  parseUnitFile,
  projectPathsFor,
  redactCommand,
  systemdTime,
  unitFromCgroups,
} from '../src/common/monitor/discovery.js';
import { describeService, serviceLine, serviceMatches, siteLine, siteMatches, summarizeService } from '../src/common/monitor/describe.js';

const N = 'abc123';
const sec = (name: string, body: string) => `\n@@${N} ${name}\n${body}\n`;

const SYSTEMD_SHOW = `MainPID=80
ExecStart={ path=/usr/bin/node ; argv[]=/usr/bin/node server.js --token=abc ; ignore_errors=no ; start_time=[n/a] ; pid=80 ; code=(null) ; status=0/0 }
WorkingDirectory=/srv/api
User=
Id=api.service
Description=Demo API
LoadState=loaded
ActiveState=active
SubState=running
UnitFileState=enabled
ActiveEnterTimestamp=Mon 2026-11-02 16:42:57 UTC
NRestarts=2

MainPID=0
ExecStart=
WorkingDirectory=!/opt/worker
User=deploy
Id=worker.service
LoadState=loaded
ActiveState=failed
SubState=failed
UnitFileState=disabled
ActiveEnterTimestamp=

Id=gone.service
LoadState=not-found
ActiveState=inactive`;

const PM2_JLIST = `>>>> In-memory PM2 is out-of-date, do:
>>>> $ pm2 update
[{"pid":149,"name":"web","pm_id":0,"pm2_env":{"status":"online","pm_uptime":1793637777000,"restart_time":1,"pm_cwd":"/home/deploy/web","pm_exec_path":"/home/deploy/web/index.js","exec_interpreter":"node","exec_mode":"cluster_mode","namespace":"default","env":{"DATABASE_URL":"postgres://u:secret@db/x"}}},
{"pid":150,"name":"web","pm_id":1,"pm2_env":{"status":"online","pm_uptime":1793637778000,"restart_time":0,"pm_cwd":"/home/deploy/web","pm_exec_path":"/home/deploy/web/index.js","exec_interpreter":"node","exec_mode":"cluster_mode"}},
{"pid":0,"name":"bot","pm_id":2,"pm2_env":{"status":"errored","pm_cwd":"/home/deploy/bot","pm_exec_path":"/home/deploy/bot/main.py","exec_interpreter":"python3","args":["--api-key","XYZ"]}}]`;

const DOCKER = `{"id":"${'a'.repeat(64)}","name":"/shop-web-1","image":"nginx:alpine","status":"running","exitCode":0,"pid":4242,"startedAt":"2026-11-02T10:00:00.123Z","finishedAt":"0001-01-01T00:00:00Z","health":"healthy","restartCount":0,"restartPolicy":"unless-stopped","labels":{"com.docker.compose.project":"shop","com.docker.compose.service":"web","com.docker.compose.project.working_dir":"/srv/shop"},"ports":{"80/tcp":[{"HostIp":"127.0.0.1","HostPort":"8088"},{"HostIp":"::1","HostPort":"8088"}],"443/tcp":null}}
{"id":"${'b'.repeat(64)}","name":"/old","image":"redis:7","status":"exited","exitCode":137,"pid":0,"startedAt":"2026-11-01T10:00:00Z","finishedAt":"2026-11-01T11:00:00Z","health":null,"restartCount":3,"restartPolicy":"no","labels":null,"ports":{}}
not json`;

const NGINX = `nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
# configuration file /etc/nginx/nginx.conf:
user www-data;
http {
    include /etc/nginx/conf.d/*.conf;
    include sites-enabled/*;
}
# configuration file /etc/nginx/conf.d/upstreams.conf:
upstream api_backend { server 127.0.0.1:3001 weight=5; server unix:/run/api.sock; }
# configuration file /etc/nginx/sites-enabled/app:
# configuration file look-alike in a comment: ignored
server {
    listen 80;
    listen [::]:80;
    server_name app.example.com "www.app.example.com" _;
    location / { proxy_pass http://127.0.0.1:3000; }
    location /api/ { proxy_pass http://api_backend/; }
    location ~ \\.php$ { fastcgi_pass unix:/run/php/php8.2-fpm.sock; }
    location /dyn { proxy_pass http://$backend; }
    location /shop { proxy_pass http://localhost:8088; }
    return 301 https://\${host}$request_uri;
}
# configuration file /etc/nginx/sites-enabled/static:
server {
    listen 443 ssl http2;
    server_name static.example.com;
    ssl_certificate /etc/letsencrypt/live/static.example.com/fullchain.pem;
    location / { root /var/www/static; }
}`;

const SS = `State  Recv-Q Send-Q Local Address:Port Peer Address:PortProcess
LISTEN 0      511        127.0.0.1:3001      0.0.0.0:*    users:(("node",pid=80,fd=24))
LISTEN 0      511        127.0.0.1:3000      0.0.0.0:*    users:(("node /home/depl",pid=151,fd=26))
LISTEN 0      511          0.0.0.0:80        0.0.0.0:*    users:(("nginx",pid=118,fd=5),("nginx",pid=117,fd=5))
LISTEN 0      4096         0.0.0.0:8088      0.0.0.0:*    users:(("docker-proxy",pid=900,fd=4))
LISTEN 0      4096       127.0.0.1:9000      0.0.0.0:*    users:(("python3",pid=700,fd=3))
LISTEN 0      4096            [::]:22           [::]:*    users:(("sshd",pid=97,fd=4))
LISTEN 0      128    127.0.0.53%lo:53        0.0.0.0:*
ESTAB  0      0          10.0.0.1:22      10.0.0.2:5000`;

const PIDINFO = `== 80
cgroup=0::/docker/${'c'.repeat(64)}/system.slice/api.service
cwd=/srv/api
cmd=/usr/bin/node server.js
== 151
cgroup=0::/system.slice/pm2-deploy.service
cwd=/home/deploy/web
cmd=node /home/deploy/web/index.js
== 700
cgroup=0::/user.slice/user-1000.slice/session-4.scope
cwd=/home/deploy/tool
cmd=python3 -m http.server 9000 --password hunter2`;

const PROCS = `    1     0 root     systemd
   80     1 root     node
  149   140 deploy   node
  151   149 deploy   node
  700     1 deploy   python3`;

function fullOutput(meta = 'user=root\npriv=root\nhostname=web-1\nkernel=Linux 6.1\nos=Ubuntu 24.04\ntool=systemctl\ntool=pm2\ntool=docker\ntool=nginx\ntool=ss\nsystemd=1') {
  return `garbage before the first marker\n${sec('meta', meta)}${sec('systemd', SYSTEMD_SHOW)}${sec('pm2 deploy /home/deploy', PM2_JLIST)}`
    + `${sec('docker', DOCKER)}${sec('nginx', NGINX)}${sec('listen', SS)}${sec('pidinfo', PIDINFO)}${sec('procs', PROCS)}${sec('end', '')}`;
}

test('scripts go on stdin with the password as the first line, never in the command', () => {
  assert.doesNotMatch(SCRIPT_RUNNER, /MT_PW=/);
  const input = scriptInput('echo hi', 'pa ss$word');
  assert.equal(input.split('\n')[0], 'pa ss$word');
  assert.equal(scriptInput('echo hi'), '\necho hi\n');
  assert.throws(() => scriptInput('x', 'a\nb'), /line break/);
  const script = buildDiscoveryScript(N);
  assert.match(script, /@@abc123/);
  assert.match(script, /sudo -S -p ''/);
  assert.match(script, /sudo -n/);
  assert.doesNotMatch(script, /\$\{(?!MT_|f##|bin%)/, 'no stray template interpolation');
});

test('project script quotes paths and drops unsafe ones', () => {
  assert.equal(shQuote("it's"), `'it'\\''s'`);
  assert.ok(isSafePath('/srv/api'));
  assert.ok(!isSafePath('relative'));
  assert.ok(!isSafePath('/a\nrm -rf /'));
  const script = buildProjectScript(N, ['/srv/api', "/tmp/it's", 'bad', '/x\ny']);
  assert.match(script, /'\/srv\/api' '\/tmp\/it'\\''s'/);
  assert.doesNotMatch(script, /bad|\/x\ny/);
  assert.match(script, /--no-optional-locks/);
  assert.match(buildProjectScript(N, []), /for d in ''/);
});

test('sections split on the nonce marker only', () => {
  const sections = splitSections(`noise\n@@${N} meta\na=1\n@@other x\n\n@@${N} pm2 deploy /home/my user\n[]\n`, N);
  assert.deepEqual(sections.map((s) => s.name), ['meta', 'pm2']);
  assert.equal(sections[0].body, 'a=1\n@@other x');
  assert.deepEqual(sections[1].args, ['deploy', '/home/my', 'user']);
});

test('systemctl show blocks become services', () => {
  const [api, worker, ...rest] = parseSystemdShow(SYSTEMD_SHOW);
  assert.equal(rest.length, 0, 'not-found units are skipped');
  assert.equal(api.id, 'systemd:api.service');
  assert.equal(api.state, 'running');
  assert.equal(api.detail, 'active (running)');
  assert.equal(api.user, 'root');
  assert.deepEqual(api.pids, [80]);
  assert.equal(api.command, '/usr/bin/node server.js --token=***');
  assert.equal(api.since, '2026-11-02T16:42:57.000Z');
  assert.equal(api.restarts, 2);
  assert.equal(worker.state, 'failed');
  assert.equal(worker.cwd, '/opt/worker');
  assert.deepEqual(worker.pids, []);
  assert.equal(worker.since, null);
});

test('unit files are read when systemd is not running', () => {
  const service = parseUnitFile('api.service', `[Unit]\nDescription=API\n# c\n[Service]\nWorkingDirectory=-/srv/api\nExecStart=-/usr/bin/node app.js\nExecStart=/ignored\n[Install]\nWantedBy=multi-user.target`);
  assert.equal(service.state, 'unknown');
  assert.equal(service.cwd, '/srv/api');
  assert.equal(service.command, '/usr/bin/node app.js');
  assert.equal(service.user, 'root');
  assert.equal(service.description, 'API');
});

test('systemd times', () => {
  assert.equal(systemdTime('Mon 2026-11-02 16:42:57 UTC'), '2026-11-02T16:42:57.000Z');
  assert.equal(systemdTime('Mon 2026-11-02 19:42:57 MSK'), '2026-11-02 19:42:57 MSK');
  assert.equal(systemdTime('n/a'), null);
  assert.equal(systemdTime(''), null);
});

test('pm2 jlist groups cluster instances and keeps no environment', () => {
  const services = parsePm2('deploy', PM2_JLIST);
  assert.equal(services.length, 2);
  const [web, bot] = services;
  assert.equal(web.id, 'pm2:deploy:web');
  assert.deepEqual(web.pids, [149, 150]);
  assert.equal(web.state, 'running');
  assert.equal(web.restarts, 1);
  assert.deepEqual(web.pm2, { namespace: 'default', mode: 'cluster', instances: 2, outLog: null, errLog: null });
  assert.equal(web.since, new Date(1793637777000).toISOString());
  assert.doesNotMatch(JSON.stringify(services), /secret|DATABASE_URL/);
  assert.equal(bot.state, 'failed');
  assert.equal(bot.command, 'python3 /home/deploy/bot/main.py --api-key ***');
  assert.deepEqual(parsePm2('x', 'not json'), []);
  assert.deepEqual(parsePm2('x', '[broken'), []);
});

test('docker inspect lines', () => {
  const [web, old, ...rest] = parseDocker(DOCKER);
  assert.equal(rest.length, 0);
  assert.equal(web.id, 'docker:shop-web-1');
  assert.equal(web.state, 'running');
  assert.equal(web.detail, 'running, healthy');
  assert.deepEqual(web.ports, [8088]);
  assert.equal(web.cwd, '/srv/shop');
  assert.equal(web.docker?.composeProject, 'shop');
  assert.equal(web.since, '2026-11-02T10:00:00.123Z');
  assert.equal(old.state, 'failed');
  assert.equal(old.detail, 'exited (exit 137)');
  assert.equal(old.autostart, 'no');
});

test('ss listeners', () => {
  const listeners = parseSs(SS);
  assert.deepEqual(listeners.map((l) => [l.address, l.port]), [
    ['::', 22], ['127.0.0.53', 53], ['0.0.0.0', 80], ['127.0.0.1', 3000], ['127.0.0.1', 3001], ['0.0.0.0', 8088], ['127.0.0.1', 9000],
  ]);
  const node = listeners.find((l) => l.port === 3000);
  assert.equal(node?.process, 'node /home/depl');
  assert.equal(node?.pid, 151);
  assert.equal(listeners.find((l) => l.port === 53)?.pid, null);
  assert.deepEqual(parseSs('LISTEN 0 128 *:8080 *:*'), [{ address: '*', port: 8080, process: null, pid: null }]);
});

test('cgroup paths', () => {
  assert.equal(unitFromCgroups([`0::/docker/${'c'.repeat(64)}/system.slice/api.service`]), 'api.service');
  assert.equal(unitFromCgroups(['1:name=systemd:/system.slice/nginx.service']), 'nginx.service');
  assert.equal(unitFromCgroups(['0::/user.slice/user-1000.slice/session-4.scope']), null);
  assert.equal(containerFromCgroups([`0::/system.slice/docker-${'d'.repeat(64)}.scope`]), 'd'.repeat(64));
  assert.equal(containerFromCgroups([`0::/docker/${'e'.repeat(64)}`]), 'e'.repeat(64));
  assert.equal(containerFromCgroups([`0::/docker/${'c'.repeat(64)}/system.slice/api.service`]), null);
});

test('nginx tokenizer handles quotes, comments and ${var}', () => {
  const tokens = tokenizeNginx('a "b c" \'d;\' # x;\n e${f}g;');
  assert.deepEqual(tokens, [
    { kind: 'word', value: 'a' },
    { kind: 'word', value: 'b c' },
    { kind: 'word', value: 'd;' },
    { kind: 'word', value: 'e${f}g' },
    { kind: ';' },
  ]);
});

test('nginx servers with includes, upstreams and locations', () => {
  const servers = nginxServers(NGINX);
  assert.equal(servers.length, 2);
  const [app, site] = servers;
  assert.deepEqual(app.domains, ['app.example.com', 'www.app.example.com']);
  assert.deepEqual(app.listen, ['80', '[::]:80']);
  assert.equal(app.ssl, false);
  assert.equal(app.file, '/etc/nginx/sites-enabled/app');
  assert.deepEqual(app.proxies.map((p) => [p.location, p.upstreams]), [
    ['/', [{ host: '127.0.0.1', port: 3000 }]],
    ['/api/', [{ host: '127.0.0.1', port: 3001 }]],
    ['~ \\.php$', []],
    ['/dyn', []],
    ['/shop', [{ host: 'localhost', port: 8088 }]],
  ]);
  assert.equal(site.ssl, true);
  assert.equal(site.root, '/var/www/static');
  assert.equal(site.certificate, '/etc/letsencrypt/live/static.example.com/fullchain.pem');
  assert.deepEqual(nginxServers(''), []);
  assert.deepEqual(nginxServers('# configuration file /etc/nginx/nginx.conf:\nhttp { server { listen 80'), [
    { domains: [], listen: ['80'], ssl: false, root: null, certificate: null, proxies: [], file: '/etc/nginx/nginx.conf' },
  ]);
});

test('host and port parsing', () => {
  assert.deepEqual(parseHostPort('[::1]:8080', 80), { host: '::1', port: 8080 });
  assert.deepEqual(parseHostPort('backend', 80), { host: 'backend', port: 80 });
  assert.equal(parseHostPort('unix:/run/x.sock', 80), null);
  assert.equal(parseHostPort('$up', 80), null);
});

test('redaction and remotes', () => {
  assert.equal(redactCommand('app --password=x --db-pass y -v'), 'app --password=*** --db-pass *** -v');
  assert.equal(redactCommand('API_TOKEN=abc node x'), 'API_TOKEN=*** node x');
  assert.equal(redactCommand('curl https://u:p@host/x'), 'curl https://***@host/x');
  assert.equal(cleanRemote('https://deploy:s3cret@git.example.com/acme/api.git'), 'https://git.example.com/acme/api.git');
  assert.equal(cleanRemote('git@github.com:acme/web.git'), 'git@github.com:acme/web.git');
  assert.equal(cleanRemote(''), null);
});

test('language detection', () => {
  assert.deepEqual(detectLanguage(['package.json', 'pnpm-lock.yaml']), { language: 'node', packageManager: 'pnpm' });
  assert.deepEqual(detectLanguage(['package.json']), { language: 'node', packageManager: 'npm' });
  assert.deepEqual(detectLanguage(['pyproject.toml', 'uv.lock']), { language: 'python', packageManager: 'uv' });
  assert.deepEqual(detectLanguage(['go.mod']), { language: 'go', packageManager: 'go' });
  assert.deepEqual(detectLanguage(['index.html']), { language: 'static', packageManager: null });
  assert.deepEqual(detectLanguage([]), { language: null, packageManager: null });
});

test('project probe output', () => {
  const project = parseProject('/srv/api/dist', [
    'files=index.js/',
    'topfiles=.git/package.json/yarn.lock/src/',
    'package={ "scripts": { "build": "tsc", "start": "node ." } }',
    'git.root=/srv/api',
    'git.branch=main',
    'git.upstream=origin/main',
    'git.remote=https://t:x@github.com/a/b.git',
    'git.counts=3\t1',
    'git.dirty=2',
    'git.last=b7f07b36febb46ad19e26cf6d0228a2fdfef130c\t1793637624\tfix: a\ttab',
    'git.fetched=',
  ].join('\n'));
  assert.equal(project.language, 'node');
  assert.equal(project.packageManager, 'yarn');
  assert.deepEqual(project.markers, ['package.json', 'yarn.lock']);
  assert.deepEqual(project.scripts, ['build', 'start']);
  assert.equal(project.git?.remote, 'https://github.com/a/b.git');
  assert.equal(project.git?.behind, 3);
  assert.equal(project.git?.ahead, 1);
  assert.equal(project.git?.dirty, 2);
  assert.equal(project.git?.lastCommit?.subject, 'fix: a\ttab');
  assert.equal(project.git?.fetchedAt, null);
  assert.equal(parseProject('/x', 'missing=1').exists, false);
  assert.equal(parseProject('/x', 'unreadable=1').exists, false);
  const noUpstream = parseProject('/w', 'files=package.json/\ngit.root=/w\ngit.branch=\ngit.upstream=\ngit.last=');
  assert.equal(noUpstream.git?.branch, null);
  assert.equal(noUpstream.git?.ahead, null);
  assert.equal(noUpstream.git?.lastCommit, null);
});

test('discovery links domain, nginx, port, process, service and folder', () => {
  const draft = parseDiscoveryOutput(fullOutput(), N, new Date('2026-11-02T12:00:00Z'));
  const result = draft.result;
  assert.equal(result.host.hostname, 'web-1');
  assert.deepEqual(result.tools, ['systemd', 'pm2', 'docker', 'nginx', 'ss']);
  assert.deepEqual(result.notes, []);
  const byId = new Map(result.services.map((s) => [s.id, s]));

  const api = byId.get('systemd:api.service');
  assert.deepEqual(api?.ports, [3001], 'by cgroup, even inside a container');
  assert.deepEqual(api?.domains, ['app.example.com', 'www.app.example.com']);

  const web = byId.get('pm2:deploy:web');
  assert.deepEqual(web?.ports, [3000], 'pm2 child process found through its parent');
  assert.deepEqual(web?.domains, ['app.example.com', 'www.app.example.com']);
  assert.deepEqual(byId.get('systemd:worker.service')?.ports, []);

  const shop = byId.get('docker:shop-web-1');
  assert.deepEqual(shop?.ports, [8088]);
  assert.deepEqual(shop?.domains, ['app.example.com', 'www.app.example.com']);

  const tool = byId.get('process:python3:9000');
  assert.equal(tool?.user, 'deploy');
  assert.equal(tool?.cwd, '/home/deploy/tool');
  assert.equal(tool?.command, 'python3 -m http.server 9000 --password ***');

  assert.equal(result.ports.find((p) => p.port === 80)?.serviceId, null, 'nginx itself is infrastructure');
  assert.equal(result.ports.find((p) => p.port === 8088)?.serviceId, 'docker:shop-web-1');
  assert.equal(result.sites[0].proxies[1].serviceIds[0], 'systemd:api.service');

  const paths = projectPathsFor(draft);
  assert.deepEqual(paths.sort(), ['/home/deploy/bot', '/home/deploy/tool', '/home/deploy/web', '/opt/worker', '/srv/api', '/srv/shop', '/var/www/static']);

  const final = applyProjects(draft, `${sec('project /srv/api', 'files=package.json/pnpm-lock.yaml/\ngit.root=/srv/api\ngit.branch=main')}${sec('project /opt/worker', 'missing=1')}${sec('end', '')}`, N);
  assert.equal(final.projects.length, 2);
  assert.equal(final.services.find((s) => s.id === 'systemd:api.service')?.projectPath, '/srv/api');
  assert.equal(final.services.find((s) => s.id === 'systemd:worker.service')?.projectPath, null);
  assert.match(final.notes.at(-1)?.message ?? '', /1 folder is missing/);
});

test('limited users, missing tools and cut-off output give notes, not errors', () => {
  const output = `${sec('meta', 'user=deploy\npriv=needs-password\nhostname=h\ntool=ss')}`
    + `${sec('docker-skip', 'permission denied while trying to connect to the Docker daemon socket')}`
    + `${sec('nginx-error', 'nginx: [emerg] open() "/run/nginx.pid" failed (13: Permission denied)')}`
    + `${sec('nginx-files', '# configuration file /etc/nginx/nginx.conf:\nhttp { server { server_name a.test; } }')}`
    + `${sec('listen', 'LISTEN 0 1 127.0.0.1:5432 0.0.0.0:*')}`;
  const { result } = parseDiscoveryOutput(output, N);
  const messages = result.notes.map((n) => n.message).join('\n');
  assert.match(messages, /did not finish/);
  assert.match(messages, /sudo password/);
  assert.match(messages, /cannot use it/);
  assert.match(messages, /config files were read directly/);
  assert.match(messages, /need root/);
  assert.deepEqual(result.sites[0].domains, ['a.test']);
  assert.equal(result.host.privilege, 'needs-password');

  const empty = parseDiscoveryOutput('', N).result;
  assert.equal(empty.services.length, 0);
  assert.equal(empty.host.privilege, 'limited');
});

test('MCP views find a project by remote, domain or port', () => {
  const draft = parseDiscoveryOutput(fullOutput(), N, new Date('2026-11-02T12:00:00Z'));
  const result = applyProjects(draft, `${sec('project /srv/api', 'files=package.json/pnpm-lock.yaml/\ngit.root=/srv/api\ngit.branch=main\ngit.remote=https://github.com/acme/api.git\ngit.upstream=origin/main\ngit.counts=2\t0\ngit.last=b7f07b36febb46ad19e26cf6d0228a2fdfef130c\t1793637624\tinit')}${sec('end', '')}`, N);
  const api = result.services.find((s) => s.id === 'systemd:api.service');
  assert.ok(api);
  assert.ok(serviceMatches(result, api, 'ACME/api'));
  assert.ok(serviceMatches(result, api, 'app.example.com'));
  assert.ok(serviceMatches(result, api, '3001'));
  assert.ok(!serviceMatches(result, api, 'nothing-like-this'));
  const summary = summarizeService(result, api);
  assert.deepEqual(summary.git, { branch: 'main', remote: 'https://github.com/acme/api.git', ahead: 0, behind: 2, dirty: 0 });
  assert.equal(
    serviceLine(summary),
    'systemd:api.service: systemd, running (active (running)); ports 3001; domains app.example.com, www.app.example.com; folder /srv/api; node/pnpm; git main from https://github.com/acme/api.git (2 behind)'
  );
  assert.match(siteLine(result.sites[0], result), /^app\.example\.com, www\.app\.example\.com \[http\]: \/ -> pm2:deploy:web; \/api\/ -> systemd:api\.service; .*\/dyn -> http:\/\/\$backend/);
  assert.equal(siteLine(result.sites[1], result), 'static.example.com [https]: static files in /var/www/static');
  const text = describeService(result, api);
  assert.match(text, /Command: \/usr\/bin\/node server\.js --token=\*\*\*/);
  assert.match(text, /Git root: \/srv\/api, upstream origin\/main/);
  assert.match(text, /Last commit: b7f07b36febb init/);
  assert.match(text, /Site: app\.example\.com/);
  assert.ok(siteMatches(result.sites[1], 'var/www'));
});
