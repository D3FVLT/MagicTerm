import assert from 'node:assert/strict';
import test from 'node:test';
import {
  answerCommand,
  buildDeployScript,
  createDeployParser,
  deployInput,
  deployRunner,
  isSecretPrompt,
  suggestScenario,
  validateScenario,
  type DeployEvent,
} from '../src/common/monitor/deploy.js';
import type { DiscoveredService, DiscoveryResult, ProjectInfo } from '../src/common/monitor/types.js';

function service(partial: Partial<DiscoveredService> & Pick<DiscoveredService, 'id' | 'kind' | 'name'>): DiscoveredService {
  return {
    description: null, state: 'running', detail: '', user: null, pids: [], cwd: null, command: null, ports: [], domains: [],
    since: null, restarts: null, autostart: null, projectPath: null, ...partial,
  };
}

function project(partial: Partial<ProjectInfo> & Pick<ProjectInfo, 'path'>): ProjectInfo {
  return { exists: true, language: null, packageManager: null, markers: [], scripts: [], git: null, ...partial };
}

const git = { root: '/srv/api', branch: 'main', remote: 'https://github.com/acme/api.git', upstream: 'origin/main', ahead: 0, behind: 2, dirty: 0, lastCommit: null, fetchedAt: null };

function discovery(user: string, services: DiscoveredService[], projects: ProjectInfo[]): DiscoveryResult {
  return {
    version: 1, scannedAt: '', host: { hostname: 'h', os: null, kernel: null, user, privilege: 'root' }, tools: ['systemd'],
    services, sites: [], ports: [], projects, notes: [],
  };
}

const NOW = new Date('2026-11-02T12:00:00Z');

test('suggested scenarios per manager and language', () => {
  const api = service({ id: 'systemd:api.service', kind: 'systemd', name: 'api', user: 'root', cwd: '/srv/api/dist', projectPath: '/srv/api/dist' });
  const apiProject = project({ path: '/srv/api/dist', language: 'node', packageManager: 'pnpm', markers: ['package.json', 'pnpm-lock.yaml'], scripts: ['build', 'start'], git });
  assert.deepEqual(suggestScenario(discovery('deploy', [api], [apiProject]), api, NOW), {
    cwd: '/srv/api',
    steps: ['git pull --ff-only', 'pnpm install --frozen-lockfile', 'pnpm run build', 'sudo systemctl restart api.service'],
    updatedAt: NOW.toISOString(),
  });

  const web = service({ id: 'pm2:deploy:web', kind: 'pm2', name: 'web', cwd: '/home/deploy/web', projectPath: '/home/deploy/web' });
  const webProject = project({ path: '/home/deploy/web', language: 'node', packageManager: 'npm', markers: ['package.json', 'package-lock.json'], scripts: ['start'], git: { ...git, root: '/home/deploy/web' } });
  assert.deepEqual(suggestScenario(discovery('deploy', [web], [webProject]), web, NOW)?.steps, ['git pull --ff-only', 'npm ci', 'pm2 reload web']);
  // As root, file steps run as the app's user and PM2 is reached through that user.
  assert.deepEqual(suggestScenario(discovery('root', [web], [webProject]), web, NOW)?.steps, [
    "sudo -u deploy -H bash -lc 'cd '\\''/home/deploy/web'\\'' && git pull --ff-only'",
    "sudo -u deploy -H bash -lc 'cd '\\''/home/deploy/web'\\'' && npm ci'",
    "sudo -u deploy -H bash -lc 'pm2 reload web'",
  ]);

  const worker = service({ id: 'systemd:worker.service', kind: 'systemd', name: 'worker', user: 'root', cwd: '/opt/worker', projectPath: '/opt/worker' });
  assert.deepEqual(suggestScenario(discovery('root', [worker], [project({ path: '/opt/worker', language: 'go', packageManager: 'go', markers: ['go.mod'] })]), worker, NOW)?.steps, [
    'go build ./...',
    'systemctl restart worker.service',
  ]);

  const shop = service({
    id: 'docker:shop-web-1', kind: 'docker', name: 'shop-web-1', cwd: '/srv/shop',
    docker: { id: 'a'.repeat(64), image: 'nginx', composeProject: 'shop', composeService: 'web', health: null },
  });
  assert.deepEqual(suggestScenario(discovery('root', [shop], []), shop, NOW)?.steps, ['docker compose pull web', 'docker compose up -d web']);

  const proc = service({ id: 'process:node:9000', kind: 'process', name: 'node' });
  assert.equal(suggestScenario(discovery('root', [proc], []), proc, NOW), null);
  assert.equal(suggestScenario(discovery('root', [api], [{ ...apiProject, exists: false }]), api, NOW), null);
});

test('scenario validation', () => {
  assert.equal(validateScenario({ cwd: '/srv/api', steps: ['ls'], updatedAt: '' }), null);
  assert.match(validateScenario({ cwd: 'srv', steps: ['ls'], updatedAt: '' }) ?? '', /absolute/);
  assert.match(validateScenario({ cwd: '/srv', steps: [' ', ''], updatedAt: '' }) ?? '', /at least one/);
  assert.match(validateScenario({ cwd: '/srv', steps: Array(31).fill('ls'), updatedAt: '' }) ?? '', /up to 30/);
  assert.match(validateScenario({ cwd: '/srv', steps: ['x'.repeat(4001)], updatedAt: '' }) ?? '', /characters/);
});

test('the deploy script keeps secrets out of argv and env and can be cancelled', () => {
  const script = buildDeployScript('n1', { cwd: "/srv/it's", steps: ['git pull', '  ', "echo 'MT_STEP_x' $HOME"], updatedAt: '' });
  assert.match(script, /cd '\/srv\/it'\\''s' \|\| exit 1\ngit pull\nMT_STEP_n1_0/);
  assert.match(script, /<<'MT_STEP_n1_1'\n[\s\S]*echo 'MT_STEP_x' \$HOME\nMT_STEP_n1_1/, 'steps are quoted heredocs, so nothing in them expands early');
  assert.match(script, /for i in 0 1; do/, 'blank steps are dropped');
  assert.match(script, /GIT_ASKPASS="\$MT_T\/askpass"/);
  assert.match(script, /SUDO_ASKPASS="\$MT_T\/askpass"/);
  assert.match(script, /exec %s -A "\$@"/);
  assert.match(script, /GIT_TERMINAL_PROMPT=0/);
  assert.match(script, /BatchMode=yes/);
  assert.match(script, /unset SSH_ASKPASS DISPLAY MT_PW/);
  assert.match(script, /exec 3<&0[\s\S]*cat <&3 >\/dev\/null/);
  assert.match(script, /kill -TERM -- "-\$p"/);
  assert.match(script, /trap 'rm -rf "\$MT_T"' EXIT/);
  assert.match(script, /timeout 130 head -n 1/);
  assert.equal(deployRunner('n1'), `sh -c 'IFS= read -r MT_PW; MT_S=$(sed -n "/^@@END_n1$/q;p"); eval "$MT_S"'`);
  assert.equal(deployInput('echo', 'n1'), '\necho\n@@END_n1\n');
});

test('answers go to the FIFO of a MagicTerm temp folder only', () => {
  assert.equal(answerCommand('/tmp/mt-deploy.AbC123'), `sh -c 'cat > "$1/answer"' mt '/tmp/mt-deploy.AbC123'`);
  assert.equal(answerCommand('/var/tmp/x/mt-deploy.q1'), `sh -c 'cat > "$1/answer"' mt '/var/tmp/x/mt-deploy.q1'`);
  assert.equal(answerCommand('/home/deploy/my tmp/mt-deploy.q1'), `sh -c 'cat > "$1/answer"' mt '/home/deploy/my tmp/mt-deploy.q1'`);
  for (const bad of ['/tmp/other', 'tmp/mt-deploy.a', "/tmp/mt-deploy.a'; rm -rf /", '/tmp/mt-deploy.a/../../etc']) {
    assert.equal(answerCommand(bad), null, bad);
  }
});

test('prompts: user names are plain, everything else is secret', () => {
  assert.equal(isSecretPrompt("Username for 'https://github.com': "), false);
  assert.equal(isSecretPrompt("Password for 'https://u@github.com': "), true);
  assert.equal(isSecretPrompt('[sudo] password for deploy: '), true);
});

test('stream parser handles markers split across chunks', () => {
  const parser = createDeployParser('n9');
  const events: DeployEvent[] = [];
  const chunks = [
    '\n@@n9 tmp /tmp/mt-deploy.x\n\n@@n9 st', 'ep 0\nhello wor', 'ld\nno newline yet', ' still\n\n@@n9 ask Username for \'https://e.com\': \n',
    '\n@@n9 step-end 0 0\n\n@@n9 step 1\n', 'progress 50%\r', 'progress 100%\n\n@@n9 step-end 1 2\n\n@@n9 done 2\n',
    '\n@@n9 bogus x\n@@n9',
  ];
  for (const chunk of chunks) events.push(...parser.push(chunk));
  events.push(...parser.flush());
  const text = events.filter((e) => e.type === 'output').map((e) => (e as { text: string }).text).join('');
  assert.equal(text, 'hello world\nno newline yet still\nprogress 50%\rprogress 100%\n@@n9');
  assert.deepEqual(events.filter((e) => e.type !== 'output'), [
    { type: 'tmp', dir: '/tmp/mt-deploy.x' },
    { type: 'step', index: 0 },
    { type: 'ask', prompt: "Username for 'https://e.com': ", secret: false },
    { type: 'step-end', index: 0, exitCode: 0 },
    { type: 'step', index: 1 },
    { type: 'step-end', index: 1, exitCode: 2 },
    { type: 'done', exitCode: 2 },
  ]);
});
