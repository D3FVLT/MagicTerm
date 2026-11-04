/**
 * Turns discovery script output into a DiscoveryResult: one parser per section, then
 * the links domain -> nginx -> port -> process -> service -> folder -> git.
 */
import { nginxServers } from './nginx.js';
import { isSafePath, splitSections, type Section } from './script.js';
import type {
  DiscoveredService,
  DiscoveryNote,
  DiscoveryResult,
  GitInfo,
  ListeningPort,
  Privilege,
  ProjectInfo,
  ServiceState,
  Site,
} from './types.js';

function keyValues(body: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const line of body.split('\n')) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const list = map.get(key) ?? [];
    list.push(line.slice(index + 1));
    map.set(key, list);
  }
  return map;
}

const first = (map: Map<string, string[]>, key: string): string => map.get(key)?.[0]?.trim() ?? '';

/** Hides values of flags and URLs that look like secrets in a command line. */
export function redactCommand(command: string): string {
  return command
    .replace(/(:\/\/)[^/\s@]+@/g, '$1***@')
    .replace(/(--?[\w.-]*(?:pass|secret|token|key|pwd|auth)[\w.-]*)(=|\s+)(?!-)\S+/gi, '$1$2***')
    .replace(/\b([A-Z][A-Z0-9_]*(?:PASS|SECRET|TOKEN|KEY|PWD)[A-Z0-9_]*)=\S+/g, '$1=***')
    .trim();
}

/** Removes user and password from a git remote URL. scp-style git@host:path stays. */
export function cleanRemote(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');
}

/** "Mon 2026-11-02 16:42:57 UTC" -> ISO when the zone is UTC, otherwise the text without the weekday. */
export function systemdTime(value: string): string | null {
  const text = value.trim();
  if (!text || text === 'n/a' || text === '0') return null;
  const m = /^(?:\w{3} )?(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?: (\S+))?$/.exec(text);
  if (!m) return text;
  if (!m[3] || m[3] === 'UTC' || m[3] === 'GMT') return new Date(`${m[1]}T${m[2]}Z`).toISOString();
  return `${m[1]} ${m[2]} ${m[3]}`;
}

export interface Meta {
  user: string;
  privilege: Privilege;
  hostname: string;
  kernel: string | null;
  os: string | null;
  tools: string[];
  systemdRunning: boolean;
}

export function parseMeta(body: string): Meta {
  const kv = keyValues(body);
  const priv = first(kv, 'priv');
  const privileges: Privilege[] = ['root', 'sudo', 'needs-password', 'wrong-password', 'limited'];
  return {
    user: first(kv, 'user') || 'unknown',
    privilege: privileges.includes(priv as Privilege) ? (priv as Privilege) : 'limited',
    hostname: first(kv, 'hostname'),
    kernel: first(kv, 'kernel') || null,
    os: first(kv, 'os') || null,
    tools: (kv.get('tool') ?? []).map((t) => t.trim()).filter(Boolean),
    systemdRunning: first(kv, 'systemd') === '1',
  };
}

function emptyService(id: string, kind: DiscoveredService['kind'], name: string): DiscoveredService {
  return {
    id,
    kind,
    name,
    description: null,
    state: 'unknown',
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
  };
}

function systemdState(active: string, sub: string): ServiceState {
  if (sub === 'auto-restart') return 'restarting';
  switch (active) {
    case 'active':
    case 'reloading':
      return 'running';
    case 'activating':
      return 'starting';
    case 'failed':
      return 'failed';
    case 'inactive':
    case 'deactivating':
      return 'stopped';
    default:
      return 'unknown';
  }
}

function execStartArgv(value: string): string | null {
  const m = /argv\[\]=(.*?) ; /.exec(value);
  if (m) return m[1];
  return value.trim() || null;
}

/** `systemctl show` output: blocks of Key=Value separated by blank lines. */
export function parseSystemdShow(body: string): DiscoveredService[] {
  const services: DiscoveredService[] = [];
  for (const block of body.split(/\n\s*\n/)) {
    const kv = keyValues(block);
    const id = first(kv, 'Id');
    if (!id || first(kv, 'LoadState') === 'not-found') continue;
    const service = emptyService(`systemd:${id}`, 'systemd', id.replace(/\.service$/, ''));
    const active = first(kv, 'ActiveState');
    const sub = first(kv, 'SubState');
    service.description = first(kv, 'Description') || null;
    service.state = systemdState(active, sub);
    service.detail = active ? `${active}${sub ? ` (${sub})` : ''}` : '';
    service.user = first(kv, 'User') || 'root';
    const pid = Number(first(kv, 'MainPID'));
    if (pid > 0) service.pids = [pid];
    const cwd = first(kv, 'WorkingDirectory').replace(/^[-!]+/, '');
    service.cwd = cwd && cwd !== '~' ? cwd : null;
    const exec = execStartArgv(first(kv, 'ExecStart'));
    service.command = exec ? redactCommand(exec) : null;
    service.since = systemdTime(first(kv, 'ActiveEnterTimestamp') || first(kv, 'StateChangeTimestamp'));
    const restarts = first(kv, 'NRestarts');
    service.restarts = /^\d+$/.test(restarts) ? Number(restarts) : null;
    service.autostart = first(kv, 'UnitFileState') || null;
    if (kv.has('CanReload')) service.canReload = first(kv, 'CanReload') === 'yes';
    services.push(service);
  }
  return services;
}

/** A unit file read directly, when systemd is not running (containers, chroots). */
export function parseUnitFile(unit: string, body: string): DiscoveredService {
  const service = emptyService(`systemd:${unit}`, 'systemd', unit.replace(/\.service$/, ''));
  let section = '';
  const values = new Map<string, string>();
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      section = header[1];
      continue;
    }
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = `${section}.${line.slice(0, index).trim()}`;
    if (!values.has(key)) values.set(key, line.slice(index + 1).trim());
  }
  service.description = values.get('Unit.Description') ?? null;
  service.user = values.get('Service.User') || 'root';
  const cwd = (values.get('Service.WorkingDirectory') ?? '').replace(/^[-!]+/, '');
  service.cwd = cwd.startsWith('/') ? cwd : null;
  const exec = (values.get('Service.ExecStart') ?? '').replace(/^[@\-:+!]+/, '');
  service.command = exec ? redactCommand(exec) : null;
  service.detail = 'systemd is not running';
  service.autostart = values.has('Install.WantedBy') ? 'has install section' : null;
  return service;
}

interface Pm2Entry {
  name?: string;
  pid?: number;
  pm_id?: number;
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
    restart_time?: number;
    pm_cwd?: string;
    pm_exec_path?: string;
    exec_interpreter?: string;
    exec_mode?: string;
    namespace?: string;
    args?: string[] | string;
    autorestart?: boolean;
    pm_out_log_path?: string;
    pm_err_log_path?: string;
  };
}

function pm2State(statuses: string[]): ServiceState {
  if (statuses.includes('online')) return 'running';
  if (statuses.includes('launching')) return 'starting';
  if (statuses.includes('errored')) return 'failed';
  if (statuses.some((s) => s === 'stopped' || s === 'stopping')) return 'stopped';
  return 'unknown';
}

/** `pm2 jlist` for one user. Environment variables in the output are never kept. */
export function parsePm2(user: string, body: string): DiscoveredService[] {
  const start = body.search(/^\[/m);
  if (start === -1) return [];
  let list: unknown;
  try {
    list = JSON.parse(body.slice(start));
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const byName = new Map<string, Pm2Entry[]>();
  for (const item of list as Pm2Entry[]) {
    if (!item || typeof item.name !== 'string') continue;
    const entries = byName.get(item.name) ?? [];
    entries.push(item);
    byName.set(item.name, entries);
  }
  const services: DiscoveredService[] = [];
  for (const [name, entries] of byName) {
    const env = entries[0].pm2_env ?? {};
    const service = emptyService(`pm2:${user}:${name}`, 'pm2', name);
    const statuses = entries.map((e) => e.pm2_env?.status ?? '');
    service.state = pm2State(statuses);
    service.detail = [...new Set(statuses.filter(Boolean))].join(', ');
    service.user = user;
    service.pids = entries.map((e) => e.pid ?? 0).filter((pid) => pid > 0);
    service.cwd = typeof env.pm_cwd === 'string' ? env.pm_cwd : null;
    const args = Array.isArray(env.args) ? env.args.join(' ') : typeof env.args === 'string' ? env.args : '';
    const script = typeof env.pm_exec_path === 'string' ? env.pm_exec_path : '';
    const interpreter = env.exec_interpreter && env.exec_interpreter !== 'none' ? `${env.exec_interpreter} ` : '';
    service.command = script ? redactCommand(`${interpreter}${script}${args ? ` ${args}` : ''}`) : null;
    const uptimes = entries.map((e) => e.pm2_env?.pm_uptime ?? 0).filter((t) => t > 0);
    service.since = uptimes.length && service.state === 'running' ? new Date(Math.min(...uptimes)).toISOString() : null;
    service.restarts = entries.reduce((sum, e) => sum + (e.pm2_env?.restart_time ?? 0), 0);
    service.autostart = env.autorestart === false ? 'autorestart off' : 'autorestart';
    service.pm2 = {
      namespace: env.namespace ?? null,
      mode: env.exec_mode ? env.exec_mode.replace(/_mode$/, '') : null,
      instances: entries.length,
      outLog: typeof env.pm_out_log_path === 'string' ? env.pm_out_log_path : null,
      errLog: typeof env.pm_err_log_path === 'string' ? env.pm_err_log_path : null,
    };
    services.push(service);
  }
  return services;
}

interface DockerState {
  Status?: string;
  ExitCode?: number;
  Pid?: number;
  StartedAt?: string;
  FinishedAt?: string;
  Health?: { Status?: string } | null;
}

/** Health status from docker's State, which has no Health key without a health check. */
export function dockerHealth(state: DockerState | null | undefined): string | null {
  return typeof state?.Health?.Status === 'string' ? state.Health.Status : null;
}

interface DockerLine {
  id?: string;
  name?: string;
  image?: string;
  state?: DockerState | null;
  /** Older shape, kept for scans saved before State was printed whole. */
  status?: string;
  exitCode?: number;
  pid?: number;
  startedAt?: string;
  finishedAt?: string;
  health?: string | null;
  restartCount?: number;
  restartPolicy?: string;
  labels?: Record<string, string> | null;
  ports?: Record<string, { HostIp?: string; HostPort?: string }[] | null> | null;
}

function dockerTime(value: string | undefined): string | null {
  if (!value || value.startsWith('0001-')) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** One JSON object per line from `docker inspect --format`. Env is never requested. */
export function parseDocker(body: string): DiscoveredService[] {
  const services: DiscoveredService[] = [];
  for (const line of body.split('\n')) {
    if (!line.startsWith('{')) continue;
    let item: DockerLine;
    try {
      item = JSON.parse(line) as DockerLine;
    } catch {
      continue;
    }
    if (item.state) {
      item = {
        ...item,
        status: item.state.Status,
        exitCode: item.state.ExitCode,
        pid: item.state.Pid,
        startedAt: item.state.StartedAt,
        finishedAt: item.state.FinishedAt,
        health: dockerHealth(item.state),
      };
    }
    if (!item.id || !item.name) continue;
    const name = item.name.replace(/^\//, '');
    const service = emptyService(`docker:${name}`, 'docker', name);
    const status = item.status ?? '';
    service.state = status === 'running'
      ? 'running'
      : status === 'restarting'
        ? 'restarting'
        : status === 'exited' || status === 'dead'
          ? (item.exitCode ? 'failed' : 'stopped')
          : status === 'created' || status === 'paused'
            ? 'stopped'
            : 'unknown';
    const exit = (status === 'exited' || status === 'dead') ? ` (exit ${item.exitCode ?? '?'})` : '';
    service.detail = `${status}${exit}${item.health ? `, ${item.health}` : ''}`;
    if (item.pid && item.pid > 0) service.pids = [item.pid];
    const labels = item.labels ?? {};
    service.cwd = labels['com.docker.compose.project.working_dir'] ?? null;
    service.since = service.state === 'running' ? dockerTime(item.startedAt) : dockerTime(item.finishedAt);
    service.restarts = typeof item.restartCount === 'number' ? item.restartCount : null;
    service.autostart = item.restartPolicy || 'no';
    const ports = new Set<number>();
    for (const bindings of Object.values(item.ports ?? {})) {
      for (const binding of bindings ?? []) {
        const port = Number(binding.HostPort);
        if (port > 0) ports.add(port);
      }
    }
    service.ports = [...ports].sort((a, b) => a - b);
    service.docker = {
      id: item.id,
      image: item.image ?? '',
      composeProject: labels['com.docker.compose.project'] ?? null,
      composeService: labels['com.docker.compose.service'] ?? null,
      health: item.health ?? null,
    };
    services.push(service);
  }
  return services;
}

export interface SsListener {
  address: string;
  port: number;
  process: string | null;
  pid: number | null;
}

/** `ss -ltn[p]`. Header and non-LISTEN lines are skipped; duplicates are merged. */
export function parseSs(body: string): SsListener[] {
  const seen = new Map<string, SsListener>();
  for (const line of body.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== 'LISTEN' || parts.length < 4) continue;
    const local = parts[3];
    const index = local.lastIndexOf(':');
    if (index <= 0) continue;
    const port = Number(local.slice(index + 1));
    if (!Number.isInteger(port) || port <= 0) continue;
    const address = local.slice(0, index).replace(/^\[|\]$/g, '').replace(/%.*$/, '');
    const users = /users:\(\("((?:[^"\\]|\\.)*)",pid=(\d+)/.exec(parts.slice(5).join(' '));
    const key = `${address}:${port}`;
    const previous = seen.get(key);
    if (previous && previous.pid !== null) continue;
    seen.set(key, {
      address,
      port,
      process: users ? users[1] : null,
      pid: users ? Number(users[2]) : null,
    });
  }
  return [...seen.values()].sort((a, b) => a.port - b.port || a.address.localeCompare(b.address));
}

export interface PidInfo {
  cgroups: string[];
  cwd: string | null;
  command: string | null;
}

export function parsePidInfo(body: string): Map<number, PidInfo> {
  const map = new Map<number, PidInfo>();
  let current: PidInfo | null = null;
  for (const line of body.split('\n')) {
    const head = /^== (\d+)$/.exec(line.trim());
    if (head) {
      current = { cgroups: [], cwd: null, command: null };
      map.set(Number(head[1]), current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('cgroup=')) current.cgroups.push(line.slice(7).trim());
    else if (line.startsWith('cwd=')) current.cwd = line.slice(4).trim() || null;
    else if (line.startsWith('cmd=')) current.command = line.slice(4).trim() || null;
  }
  return map;
}

export interface ProcRow {
  pid: number;
  ppid: number;
  user: string;
  comm: string;
}

export function parseProcs(body: string): Map<number, ProcRow> {
  const map = new Map<number, ProcRow>();
  for (const line of body.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (m) map.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), user: m[3], comm: m[4].trim() });
  }
  return map;
}

/** Last `name.service` segment of a cgroup path, if any. */
export function unitFromCgroups(cgroups: string[]): string | null {
  for (const line of cgroups) {
    const path = line.slice(line.lastIndexOf(':') + 1);
    const m = /\/([^/]+\.service)(?:\/[^/]*)?$/.exec(path);
    if (m) return m[1];
  }
  return null;
}

/** Container id when the process itself runs in a Docker container (the path must end there). */
export function containerFromCgroups(cgroups: string[]): string | null {
  for (const line of cgroups) {
    const path = line.slice(line.lastIndexOf(':') + 1);
    const m = /\/(?:docker-|docker\/)([0-9a-f]{64})(?:\.scope)?$/.exec(path);
    if (m) return m[1];
  }
  return null;
}

const LANGUAGE_MARKERS: [string, string, string | null][] = [
  ['package.json', 'node', null],
  ['deno.json', 'deno', null],
  ['deno.jsonc', 'deno', null],
  ['go.mod', 'go', 'go'],
  ['Cargo.toml', 'rust', 'cargo'],
  ['pyproject.toml', 'python', 'pip'],
  ['requirements.txt', 'python', 'pip'],
  ['Pipfile', 'python', 'pipenv'],
  ['setup.py', 'python', 'pip'],
  ['composer.json', 'php', 'composer'],
  ['Gemfile', 'ruby', 'bundler'],
  ['mix.exs', 'elixir', 'mix'],
  ['pom.xml', 'java', 'maven'],
  ['build.gradle', 'java', 'gradle'],
  ['build.gradle.kts', 'java', 'gradle'],
];

const NODE_LOCKS: [string, string][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

const PYTHON_LOCKS: [string, string][] = [
  ['uv.lock', 'uv'],
  ['poetry.lock', 'poetry'],
  ['Pipfile.lock', 'pipenv'],
];

const INTERESTING = new Set([
  ...LANGUAGE_MARKERS.map(([file]) => file),
  ...NODE_LOCKS.map(([file]) => file),
  ...PYTHON_LOCKS.map(([file]) => file),
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml',
  'ecosystem.config.js', 'ecosystem.config.cjs', 'Makefile', '.env', 'index.html', '.nvmrc',
]);

export function detectLanguage(files: string[]): { language: string | null; packageManager: string | null } {
  const set = new Set(files);
  for (const [file, language, manager] of LANGUAGE_MARKERS) {
    if (!set.has(file)) continue;
    if (language === 'node') {
      const lock = NODE_LOCKS.find(([name]) => set.has(name));
      return { language, packageManager: lock ? lock[1] : 'npm' };
    }
    if (language === 'python') {
      const lock = PYTHON_LOCKS.find(([name]) => set.has(name));
      return { language, packageManager: lock ? lock[1] : manager };
    }
    return { language, packageManager: manager };
  }
  if (set.has('index.html')) return { language: 'static', packageManager: null };
  return { language: null, packageManager: null };
}

function packageScripts(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as { scripts?: Record<string, unknown> };
    return parsed.scripts && typeof parsed.scripts === 'object' ? Object.keys(parsed.scripts).slice(0, 50) : [];
  } catch {
    return [];
  }
}

export function parseProject(path: string, body: string): ProjectInfo {
  const kv = keyValues(body);
  const exists = first(kv, 'missing') !== '1';
  const unreadable = first(kv, 'unreadable') === '1';
  const ownFiles = first(kv, 'files').split('/').filter(Boolean);
  const topFiles = first(kv, 'topfiles').split('/').filter(Boolean);
  let detected = detectLanguage(ownFiles);
  let files = ownFiles;
  if (!detected.language && topFiles.length) {
    detected = detectLanguage(topFiles);
    files = topFiles;
  }
  let git: GitInfo | null = null;
  const root = first(kv, 'git.root');
  if (root) {
    const counts = first(kv, 'git.counts').split(/\s+/).map(Number);
    const hasCounts = counts.length === 2 && counts.every((n) => Number.isInteger(n));
    const last = (kv.get('git.last')?.[0] ?? '').split('\t');
    const fetched = Number(first(kv, 'git.fetched'));
    git = {
      root,
      branch: first(kv, 'git.branch') || null,
      remote: cleanRemote(first(kv, 'git.remote')),
      upstream: first(kv, 'git.upstream') || null,
      behind: hasCounts ? counts[0] : null,
      ahead: hasCounts ? counts[1] : null,
      dirty: Number(first(kv, 'git.dirty')) || 0,
      lastCommit: last.length >= 3 && /^[0-9a-f]{7,64}$/.test(last[0])
        ? { hash: last[0], time: Number(last[1]) || 0, subject: last.slice(2).join('\t').slice(0, 200) }
        : null,
      fetchedAt: fetched > 0 ? fetched : null,
    };
  }
  return {
    path,
    exists: exists && !unreadable,
    language: detected.language,
    packageManager: detected.packageManager,
    markers: files.filter((f) => INTERESTING.has(f)),
    scripts: kv.has('package') ? packageScripts(first(kv, 'package')) : [],
    git,
  };
}

/** Daemons whose ports are infrastructure, not something the user deploys. */
const INFRA_PROCESSES = new Set([
  'sshd', 'systemd', 'systemd-resolve', 'systemd-resolved', 'systemd-network', 'systemd-networkd',
  'docker-proxy', 'dockerd', 'containerd', 'rpcbind', 'nginx', 'apache2', 'httpd', 'master', 'exim4',
  'chronyd', 'cupsd', 'avahi-daemon', 'dnsmasq', 'sendmail', 'postfix', 'unbound', 'named', 'tailscaled',
]);

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', '::', '*']);

export interface DiscoveryDraft {
  result: DiscoveryResult;
}

export function parseDiscoveryOutput(output: string, nonce: string, now = new Date()): DiscoveryDraft {
  const sections = splitSections(output, nonce);
  const byName = (name: string) => sections.filter((s) => s.name === name);
  const one = (name: string): Section | undefined => byName(name)[0];
  const notes: DiscoveryNote[] = [];

  const meta = parseMeta(one('meta')?.body ?? '');
  if (!one('end')) notes.push({ source: 'meta', message: 'The scan did not finish; results may be incomplete.' });
  if (meta.privilege === 'needs-password') {
    notes.push({ source: 'meta', message: `Logged in as ${meta.user}. Scan with the sudo password to see other users' processes, PM2 apps and the full nginx config.` });
  } else if (meta.privilege === 'wrong-password') {
    notes.push({ source: 'meta', message: 'sudo did not accept the password, so the scan ran without it.' });
  } else if (meta.privilege === 'limited') {
    notes.push({ source: 'meta', message: `Logged in as ${meta.user} without sudo. Other users' processes, ports and PM2 apps are not visible.` });
  }

  const services: DiscoveredService[] = [];
  const systemd = one('systemd');
  if (systemd) services.push(...parseSystemdShow(systemd.body));
  const unitFiles = byName('unitfile');
  for (const section of unitFiles) {
    if (section.args[0]) services.push(parseUnitFile(section.args[0], section.body));
  }
  if (unitFiles.length) notes.push({ source: 'systemd', message: 'systemd is not running on this host, so unit states are unknown.' });

  for (const section of byName('pm2')) {
    const user = section.args[0] ?? 'unknown';
    const found = parsePm2(user, section.body);
    if (found.length === 0 && section.body.trim() && !section.body.includes('[')) {
      notes.push({ source: 'pm2', message: `PM2 for ${user} did not return a process list.` });
    }
    services.push(...found);
  }
  for (const section of byName('pm2-skip')) {
    notes.push({ source: 'pm2', message: `PM2 runs for ${section.args[0] ?? 'a user'}, but the pm2 command was not found.` });
  }

  const containers = parseDocker(one('docker')?.body ?? '');
  services.push(...containers);
  const dockerSkip = one('docker-skip');
  if (dockerSkip) {
    const text = dockerSkip.body.toLowerCase();
    notes.push({
      source: 'docker',
      message: text.includes('permission denied')
        ? `Docker is installed, but ${meta.user} cannot use it. Add the user to the docker group or allow sudo.`
        : 'Docker is installed, but its daemon is not reachable.',
    });
  }

  const nginxSection = one('nginx') ?? one('nginx-files');
  const nginxError = one('nginx-error');
  if (nginxError) {
    const text = nginxError.body;
    notes.push({
      source: 'nginx',
      message: /permission denied|super-user|must be root/i.test(text) && meta.privilege !== 'root' && meta.privilege !== 'sudo'
        ? 'nginx -T needs root, so the config files were read directly. Files only root can read are missing.'
        : `nginx -T failed: ${(text.split('\n').find((l) => /\[emerg\]|failed/.test(l)) ?? text.split('\n')[0] ?? '').replace(/^\S+ \S+ /, '').slice(0, 200)}`,
    });
  }
  const servers = nginxSection ? nginxServers(nginxSection.body) : [];

  const listen = one('listen');
  const listeners = parseSs(listen?.body ?? '');
  if (!listen && meta.tools.length) notes.push({ source: 'ports', message: 'ss is not installed, so ports are not linked to services.' });
  if (listeners.length && listeners.every((l) => l.pid === null)) {
    notes.push({ source: 'ports', message: 'Process names for ports need root; ports are not linked to services.' });
  } else if (listeners.some((l) => l.pid === null) && meta.privilege !== 'root' && meta.privilege !== 'sudo') {
    notes.push({ source: 'ports', message: 'Some ports belong to other users\' processes; scan with sudo to link them.' });
  }
  const pidInfo = parsePidInfo(one('pidinfo')?.body ?? '');
  const procs = parseProcs(one('procs')?.body ?? '');

  const byId = new Map(services.map((s) => [s.id, s]));
  const pidOwner = new Map<number, DiscoveredService>();
  for (const service of services) {
    if (service.kind === 'pm2') for (const pid of service.pids) pidOwner.set(pid, service);
  }
  const ancestorOwner = (pid: number): DiscoveredService | null => {
    let current: number | undefined = pid;
    for (let depth = 0; current && depth < 12; depth++) {
      const owner = pidOwner.get(current);
      if (owner) return owner;
      current = procs.get(current)?.ppid;
    }
    return null;
  };
  const dockerByPort = new Map<number, DiscoveredService>();
  for (const container of containers) for (const port of container.ports) dockerByPort.set(port, container);

  const ports: ListeningPort[] = [];
  for (const listener of listeners) {
    let owner: DiscoveredService | null = dockerByPort.get(listener.port) ?? null;
    const info = listener.pid !== null ? pidInfo.get(listener.pid) : undefined;
    if (!owner && listener.pid !== null) owner = ancestorOwner(listener.pid);
    if (!owner && info) {
      const containerId = containerFromCgroups(info.cgroups);
      if (containerId) owner = containers.find((c) => c.docker?.id === containerId) ?? null;
    }
    if (!owner && info) {
      const unit = unitFromCgroups(info.cgroups);
      if (unit) owner = byId.get(`systemd:${unit}`) ?? null;
    }
    if (!owner && listener.pid !== null) {
      owner = services.find((s) => s.kind === 'systemd' && s.pids.includes(listener.pid as number)) ?? null;
    }
    const processName = listener.process?.split(/\s/)[0] ?? null;
    if (!owner && listener.pid !== null && processName && !INFRA_PROCESSES.has(processName)
      && !(info && unitFromCgroups(info.cgroups))) {
      // A process nobody manages: started by hand, nohup, screen or a cron @reboot.
      const id = `process:${processName}:${listener.port}`;
      const existing = services.find((s) => s.kind === 'process' && s.pids.includes(listener.pid as number));
      if (existing) {
        owner = existing;
      } else {
        const service = emptyService(id, 'process', processName);
        service.state = 'running';
        service.detail = 'not managed by systemd, PM2 or Docker';
        service.pids = [listener.pid];
        service.user = procs.get(listener.pid)?.user ?? null;
        service.cwd = info?.cwd && info.cwd !== '/' ? info.cwd : null;
        service.command = info?.command ? redactCommand(info.command) : null;
        services.push(service);
        byId.set(id, service);
        owner = service;
      }
    }
    if (owner) {
      if (!owner.ports.includes(listener.port)) owner.ports.push(listener.port);
      if (!owner.cwd && info?.cwd && info.cwd !== '/') owner.cwd = info.cwd;
    }
    ports.push({
      address: listener.address,
      port: listener.port,
      pid: listener.pid,
      process: listener.process,
      serviceId: owner?.id ?? null,
    });
  }
  for (const service of services) service.ports.sort((a, b) => a - b);

  const hostnames = new Set([meta.hostname.toLowerCase()].filter(Boolean));
  const servicesOnPort = (port: number) => services.filter((s) => s.ports.includes(port)).map((s) => s.id);
  const sites: Site[] = servers.map((server) => {
    const proxies = server.proxies.map((proxy) => {
      const serviceIds = new Set<string>();
      for (const upstream of proxy.upstreams) {
        const host = upstream.host.toLowerCase();
        if (LOCAL_HOSTS.has(host) || hostnames.has(host) || host.startsWith('127.')) {
          for (const id of servicesOnPort(upstream.port)) serviceIds.add(id);
        }
      }
      return { ...proxy, serviceIds: [...serviceIds] };
    });
    return {
      domains: server.domains,
      listen: server.listen,
      ssl: server.ssl,
      root: server.root,
      proxies,
      certificate: server.certificate,
      file: server.file,
    };
  });
  for (const site of sites) {
    for (const proxy of site.proxies) {
      for (const id of proxy.serviceIds) {
        const service = byId.get(id);
        if (!service) continue;
        for (const domain of site.domains) if (!service.domains.includes(domain)) service.domains.push(domain);
      }
    }
  }

  return {
    result: {
      version: 1,
      scannedAt: now.toISOString(),
      host: { hostname: meta.hostname, os: meta.os, kernel: meta.kernel, user: meta.user, privilege: meta.privilege },
      tools: meta.systemdRunning ? meta.tools.map((t) => (t === 'systemctl' ? 'systemd' : t)) : meta.tools.filter((t) => t !== 'systemctl'),
      services,
      sites,
      ports,
      projects: [],
      notes,
    },
  };
}

/** Folders worth a project probe: service folders and static site roots. */
export function projectPathsFor(draft: DiscoveryDraft): string[] {
  const paths = new Set<string>();
  for (const service of draft.result.services) {
    if (service.cwd && service.cwd !== '/' && isSafePath(service.cwd)) paths.add(service.cwd);
  }
  for (const site of draft.result.sites) {
    if (site.root && site.root !== '/' && isSafePath(site.root) && !site.root.includes('$')) paths.add(site.root);
  }
  return [...paths].slice(0, 100);
}

export function applyProjects(draft: DiscoveryDraft, output: string, nonce: string): DiscoveryResult {
  const projects = splitSections(output, nonce)
    .filter((section) => section.name === 'project')
    .map((section) => parseProject(section.args.join(' '), section.body));
  const known = new Set(projects.filter((p) => p.exists).map((p) => p.path));
  for (const service of draft.result.services) {
    service.projectPath = service.cwd && known.has(service.cwd) ? service.cwd : null;
  }
  const missing = projects.filter((p) => !p.exists).length;
  const notes = [...draft.result.notes];
  if (missing > 0) {
    notes.push({ source: 'projects', message: `${missing} folder${missing === 1 ? ' is' : 's are'} missing or not readable.` });
  }
  return { ...draft.result, projects, notes };
}
