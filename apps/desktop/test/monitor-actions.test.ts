import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availableActions,
  buildActionScript,
  describeAction,
  isRiskyAction,
  parseActionOutput,
  summarizeActionResult,
  type ActionRequest,
} from '../src/common/monitor/actions.js';
import type { DiscoveredService } from '../src/common/monitor/types.js';

const N = 'act';
const sec = (name: string, body = '') => `\n@@${N} ${name}\n${body}\n`;

function service(partial: Partial<DiscoveredService> & Pick<DiscoveredService, 'id' | 'kind' | 'name'>): DiscoveredService {
  return {
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

const api = service({ id: 'systemd:api.service', kind: 'systemd', name: 'api', canReload: true });
const web = service({ id: 'pm2:deploy:web', kind: 'pm2', name: "web's app" });
const shop = service({ id: 'docker:shop', kind: 'docker', name: 'shop', docker: { id: 'a'.repeat(64), image: 'nginx', composeProject: null, composeService: null, health: null } });
const proc = service({ id: 'process:node:9000', kind: 'process', name: 'node' });

test('available actions follow state and manager', () => {
  assert.deepEqual(availableActions(api), ['restart', 'stop', 'reload']);
  assert.deepEqual(availableActions({ ...api, canReload: false }), ['restart', 'stop']);
  assert.deepEqual(availableActions(api, 'failed'), ['start']);
  assert.deepEqual(availableActions(api, 'stopped'), ['start']);
  assert.deepEqual(availableActions(api, 'unknown'), ['start', 'restart', 'stop', 'reload']);
  assert.deepEqual(availableActions(api, 'running', false), []);
  assert.deepEqual(availableActions(web), ['restart', 'stop', 'reload']);
  assert.deepEqual(availableActions(shop), ['restart', 'stop']);
  assert.deepEqual(availableActions(proc), []);
});

test('risky actions are the ones that interrupt something', () => {
  assert.equal(isRiskyAction({ kind: 'service', service: api, action: 'start' }), false);
  assert.equal(isRiskyAction({ kind: 'service', service: api, action: 'restart' }), true);
  assert.equal(isRiskyAction({ kind: 'nginx', action: 'test', systemd: true }), false);
  assert.equal(isRiskyAction({ kind: 'nginx', action: 'reload', systemd: true }), true);
});

test('commands shown to the user', () => {
  assert.equal(describeAction({ kind: 'service', service: api, action: 'restart' }, 'deploy'), 'sudo systemctl restart api.service');
  assert.equal(describeAction({ kind: 'service', service: api, action: 'restart' }, 'root'), 'systemctl restart api.service');
  assert.equal(describeAction({ kind: 'service', service: web, action: 'reload' }, 'deploy'), "pm2 reload web's app");
  assert.equal(describeAction({ kind: 'service', service: web, action: 'reload' }, 'root'), "runuser -u deploy -- pm2 reload web's app");
  assert.equal(describeAction({ kind: 'service', service: web, action: 'stop' }, 'admin'), "sudo -u deploy pm2 stop web's app");
  assert.equal(describeAction({ kind: 'service', service: shop, action: 'reload' }, 'root'), 'docker restart shop');
  assert.equal(describeAction({ kind: 'nginx', action: 'reload', systemd: false }, 'ops'), 'sudo nginx -t && sudo nginx -s reload');
});

test('scripts quote names and refuse unsafe ones', () => {
  const systemd = buildActionScript(N, { kind: 'service', service: api, action: 'restart' }) ?? '';
  assert.match(systemd, /mt_need_root\nsec output\n\( asroot \$TL systemctl restart 'api\.service' \)/);
  assert.match(systemd, /systemctl status 'api\.service' --no-pager -n 15/);
  const pm2 = buildActionScript(N, { kind: 'service', service: web, action: 'reload' }) ?? '';
  assert.match(pm2, /u='deploy'/);
  assert.match(pm2, /"\$bin" reload 'web'\\''s app'/);
  assert.match(pm2, /\[ "\$u" = "\$ME" \] \|\| mt_need_root/);
  const docker = buildActionScript(N, { kind: 'service', service: shop, action: 'reload' }) ?? '';
  assert.match(docker, new RegExp(`dk restart ${'a'.repeat(64)}`));
  const nginx = buildActionScript(N, { kind: 'nginx', action: 'reload', systemd: true }) ?? '';
  assert.match(nginx, /if \[ \$rc -eq 0 \]; then[\s\S]*asroot \$TL systemctl reload nginx[\s\S]*nginx was not reloaded/);
  assert.doesNotMatch(buildActionScript(N, { kind: 'nginx', action: 'test', systemd: true }) ?? '', /reload/);

  const bad: ActionRequest[] = [
    { kind: 'service', service: { ...api, id: 'systemd:x;rm -rf /.service' }, action: 'stop' },
    { kind: 'service', service: { ...web, id: 'pm2:$(id):web' }, action: 'stop' },
    { kind: 'service', service: { ...shop, docker: { ...shop.docker!, id: '$(id)' } }, action: 'stop' },
    { kind: 'service', service: proc, action: 'stop' },
  ];
  for (const request of bad) assert.equal(buildActionScript(N, request), null);
});

test('results: success, failure, sudo states and timeouts', () => {
  const ok = parseActionOutput(`${sec('output', 'done')}${sec('result 0')}${sec('status', '* api.service - Demo API')}${sec('end')}`, N);
  assert.deepEqual(ok, { exitCode: 0, output: 'done', status: '* api.service - Demo API', needsSudo: false, wrongPassword: false, noRoot: false, timedOut: false });
  assert.equal(summarizeActionResult(ok), 'Done, exit code 0.');
  const failed = parseActionOutput(`${sec('output', 'Job failed')}${sec('result 1')}${sec('end')}`, N);
  assert.equal(summarizeActionResult(failed), 'Failed, exit code 1.');
  assert.equal(summarizeActionResult(parseActionOutput(`${sec('needs-sudo')}${sec('end')}`, N)), 'sudo needs a password.');
  assert.equal(summarizeActionResult(parseActionOutput(`${sec('wrong-password')}${sec('end')}`, N)), 'sudo did not accept the password.');
  assert.match(summarizeActionResult(parseActionOutput(`${sec('no-root')}${sec('end')}`, N)), /cannot use sudo/);
  const cut = parseActionOutput(sec('output', 'still going'), N);
  assert.equal(cut.timedOut, true);
  assert.equal(summarizeActionResult(cut), 'Timed out before the server answered.');
  const long = parseActionOutput(`${sec('output', 'x'.repeat(70 * 1024))}${sec('result 0')}${sec('end')}`, N);
  assert.equal(long.output.length, 64 * 1024);
});
