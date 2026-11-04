/**
 * Live view of a scanned server: a sampler script run every few seconds, site checks run
 * every minute, and log commands. Scripts here only read; parsing and the CPU and memory
 * math happen in TypeScript so they can be tested.
 */
import { dockerHealth, parsePm2 } from './discovery.js';
import { DOCKER_INIT, PM2_BLOCK, prelude, shQuote, splitSections } from './script.js';
import type { DiscoveredService, DiscoveryResult, ServiceState } from './types.js';

export interface WatchSpec {
  units: string[];
  containers: string[];
  /** Users with PM2 apps; their PM2 is listed again on the slow tier. */
  pm2: boolean;
  /** Service id -> PIDs from the scan, used until a fresher source has them. */
  scanPids: Record<string, number[]>;
  sites: SiteTarget[];
}

export interface SiteTarget {
  /** scheme://domain:port, also the key in samples. */
  key: string;
  domain: string;
  scheme: 'http' | 'https';
  port: number;
}

const DOMAIN = /^[a-z0-9*]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

function listenPort(listen: string): number | null {
  const first = listen.split(/\s+/)[0] ?? '';
  const m = /(?:^|:)(\d+)$/.exec(first);
  return m ? Number(m[1]) : null;
}

/** Up to three names per nginx server block, 40 in all; wildcard and regex names are skipped. */
export function siteTargets(discovery: DiscoveryResult): SiteTarget[] {
  const targets = new Map<string, SiteTarget>();
  for (const site of discovery.sites) {
    const sslListen = site.listen.find((l) => /\bssl\b|\bquic\b/.test(l));
    const plainListen = site.listen.find((l) => !/\bssl\b|\bquic\b/.test(l));
    const scheme = site.ssl ? 'https' : 'http';
    const port = (site.ssl ? listenPort(sslListen ?? '') : listenPort(plainListen ?? '')) ?? (site.ssl ? 443 : 80);
    for (const domain of site.domains.filter((d) => DOMAIN.test(d) && !d.includes('*')).slice(0, 3)) {
      const key = `${scheme}://${domain}:${port}`;
      if (!targets.has(key)) targets.set(key, { key, domain: domain.toLowerCase(), scheme, port });
      if (targets.size >= 40) return [...targets.values()];
    }
  }
  return [...targets.values()];
}

export function watchSpecFrom(discovery: DiscoveryResult): WatchSpec {
  const units: string[] = [];
  const containers: string[] = [];
  const scanPids: Record<string, number[]> = {};
  let pm2 = false;
  for (const service of discovery.services) {
    scanPids[service.id] = service.pids;
    if (service.kind === 'systemd' && discovery.tools.includes('systemd')) units.push(service.id.slice('systemd:'.length));
    if (service.kind === 'docker' && service.docker?.id) containers.push(service.docker.id);
    if (service.kind === 'pm2') pm2 = true;
  }
  return { units, containers, pm2, scanPids, sites: siteTargets(discovery) };
}

const SAFE_UNIT = /^[\w@.:-]+\.service$/;
const SAFE_ID = /^[0-9a-f]{12,64}$/;

/** Fast tier every few seconds; `slow` adds PM2 (it starts node, so not every time). */
export function buildSampleScript(nonce: string, spec: WatchSpec, slow: boolean): string {
  const units = spec.units.filter((u) => SAFE_UNIT.test(u)).map(shQuote).join(' ');
  const containers = spec.containers.filter((c) => SAFE_ID.test(c)).join(' ');
  return `${prelude(nonce)}
sec host
printf 'load=%s\\n' "$(cat /proc/loadavg 2>/dev/null)"
printf 'cpu=%s\\n' "$(head -n 1 /proc/stat 2>/dev/null)"
printf 'uptime=%s\\n' "$(cut -d' ' -f1 /proc/uptime 2>/dev/null)"
printf 'ncpu=%s\\n' "$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null)"
printf 'page=%s\\n' "$(getconf PAGESIZE 2>/dev/null)"
grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo 2>/dev/null | tr -s ' ' | sed 's/: /=/; s/ kB$//'
sec disk
df -Pk 2>/dev/null
sec stat
cat /proc/[0-9]*/stat 2>/dev/null
${units ? `if have systemctl; then
  sec systemd
  $T systemctl show --no-pager -p Id,ActiveState,SubState,MainPID,NRestarts ${units} 2>/dev/null
fi` : ''}
${containers ? `if have docker; then
  ${DOCKER_INIT}
  if [ -n "$MT_DK" ]; then
    sec docker
    dk inspect --format '{{.Id}} {{.RestartCount}} {{json .State}}' ${containers} 2>/dev/null
  fi
fi` : ''}
${slow && spec.pm2 ? PM2_BLOCK : ''}
sec end
`;
}

export interface CpuTimes {
  total: number;
  idle: number;
}

export interface RawSample {
  load: [number, number, number] | null;
  cpu: CpuTimes | null;
  ncpu: number;
  pageSize: number;
  uptime: number | null;
  memory: { total: number; available: number; swapTotal: number; swapFree: number } | null;
  disks: DiskUsage[];
  /** pid -> parent and CPU ticks (user + system) and RSS pages. */
  procs: Map<number, { ppid: number; ticks: number; rssPages: number }>;
  units: Map<string, { state: ServiceState; detail: string; mainPid: number; restarts: number | null }>;
  containers: Map<string, { pid: number; state: ServiceState; detail: string; restarts: number | null }>;
  /** Only on slow samples. */
  pm2: DiscoveredService[] | null;
}

export interface DiskUsage {
  mount: string;
  filesystem: string;
  sizeBytes: number;
  usedBytes: number;
  percent: number;
}

const PSEUDO_FS = /^(tmpfs|devtmpfs|udev|none|shm|overlay|squashfs|efivarfs|cgroup2?|proc|sysfs)$/;

export function parseDf(body: string): DiskUsage[] {
  const disks: DiskUsage[] = [];
  for (const line of body.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const [filesystem, size, used, , capacity] = parts;
    const mount = parts.slice(5).join(' ');
    if (PSEUDO_FS.test(filesystem) && mount !== '/') continue;
    if (/^\/(proc|sys|dev|run)(\/|$)|^\/snap\//.test(mount)) continue;
    if (mount.startsWith('/etc/')) continue;
    const sizeKb = Number(size);
    if (!sizeKb) continue;
    disks.push({
      mount,
      filesystem,
      sizeBytes: sizeKb * 1024,
      usedBytes: Number(used) * 1024,
      percent: Number(capacity.replace('%', '')) || 0,
    });
  }
  return disks;
}

/** /proc/<pid>/stat lines. The command name is in parentheses and may contain spaces. */
export function parseProcStat(body: string): RawSample['procs'] {
  const procs: RawSample['procs'] = new Map();
  for (const line of body.split('\n')) {
    const close = line.lastIndexOf(')');
    if (close === -1) continue;
    const pid = Number(line.slice(0, line.indexOf(' ')));
    const fields = line.slice(close + 2).split(' ');
    // fields[0] is state (field 3), so field n is fields[n - 3].
    const ppid = Number(fields[1]);
    const ticks = Number(fields[11]) + Number(fields[12]);
    const rssPages = Number(fields[21]);
    if (!Number.isInteger(pid) || pid <= 0 || Number.isNaN(ticks)) continue;
    procs.set(pid, { ppid, ticks, rssPages: Number.isFinite(rssPages) ? rssPages : 0 });
  }
  return procs;
}

export function parseCpuLine(line: string): CpuTimes | null {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== 'cpu') return null;
  const values = parts.slice(1).map(Number);
  if (values.length < 4 || values.some((v) => Number.isNaN(v))) return null;
  // user nice system idle iowait irq softirq steal; guest time is already in user.
  const total = values.slice(0, 8).reduce((a, b) => a + b, 0);
  return { total, idle: values[3] + (values[4] ?? 0) };
}

function systemdState(active: string, sub: string): ServiceState {
  if (sub === 'auto-restart') return 'restarting';
  if (active === 'active' || active === 'reloading') return 'running';
  if (active === 'activating') return 'starting';
  if (active === 'failed') return 'failed';
  if (active === 'inactive' || active === 'deactivating') return 'stopped';
  return 'unknown';
}

/** `slow` says whether this sample listed PM2; otherwise its PM2 state is carried over. */
export function parseSample(output: string, nonce: string, slow = false): RawSample {
  const sections = splitSections(output, nonce);
  const one = (name: string) => sections.find((s) => s.name === name);
  const kv = new Map<string, string>();
  for (const line of (one('host')?.body ?? '').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) kv.set(line.slice(0, i), line.slice(i + 1).trim());
  }
  const loadParts = (kv.get('load') ?? '').split(/\s+/).slice(0, 3).map(Number);
  const kb = (key: string) => Number(kv.get(key) ?? NaN) * 1024;
  const memTotal = kb('MemTotal');

  const units: RawSample['units'] = new Map();
  for (const block of (one('systemd')?.body ?? '').split(/\n\s*\n/)) {
    const map = new Map<string, string>();
    for (const line of block.split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) map.set(line.slice(0, i), line.slice(i + 1).trim());
    }
    const id = map.get('Id');
    if (!id) continue;
    const active = map.get('ActiveState') ?? '';
    const sub = map.get('SubState') ?? '';
    const restarts = map.get('NRestarts') ?? '';
    units.set(id, {
      state: systemdState(active, sub),
      detail: active ? `${active}${sub ? ` (${sub})` : ''}` : '',
      mainPid: Number(map.get('MainPID')) || 0,
      restarts: /^\d+$/.test(restarts) ? Number(restarts) : null,
    });
  }

  const containers: RawSample['containers'] = new Map();
  for (const line of (one('docker')?.body ?? '').split('\n')) {
    const m = /^([0-9a-f]+) (\d+) (\{.*\})$/.exec(line.trim());
    if (!m) continue;
    let dockerState: { Status?: string; ExitCode?: number; Pid?: number; Health?: { Status?: string } | null };
    try {
      dockerState = JSON.parse(m[3]);
    } catch {
      continue;
    }
    const [, id, restarts] = m;
    const status = dockerState.Status ?? '';
    const exitCode = dockerState.ExitCode ?? 0;
    const pid = dockerState.Pid ?? 0;
    const health = dockerHealth(dockerState);
    const state: ServiceState = status === 'running'
      ? 'running'
      : status === 'restarting'
        ? 'restarting'
        : status === 'exited' || status === 'dead'
          ? (Number(exitCode) ? 'failed' : 'stopped')
          : 'stopped';
    containers.set(id, {
      pid: Number(pid) || 0,
      state,
      detail: `${status}${status === 'exited' ? ` (exit ${exitCode})` : ''}${health ? `, ${health}` : ''}`,
      restarts: /^\d+$/.test(restarts ?? '') ? Number(restarts) : null,
    });
  }

  const pm2Sections = sections.filter((s) => s.name === 'pm2');
  return {
    load: loadParts.length === 3 && loadParts.every((n) => !Number.isNaN(n)) ? (loadParts as [number, number, number]) : null,
    cpu: parseCpuLine(kv.get('cpu') ?? ''),
    ncpu: Number(kv.get('ncpu')) || 1,
    pageSize: Number(kv.get('page')) || 4096,
    uptime: kv.has('uptime') && kv.get('uptime') ? Number(kv.get('uptime')) : null,
    memory: memTotal > 0
      ? { total: memTotal, available: kb('MemAvailable') || 0, swapTotal: kb('SwapTotal') || 0, swapFree: kb('SwapFree') || 0 }
      : null,
    disks: parseDf(one('disk')?.body ?? ''),
    procs: parseProcStat(one('stat')?.body ?? ''),
    units,
    containers,
    pm2: slow && one('end') ? pm2Sections.flatMap((s) => parsePm2(s.args[0] ?? 'unknown', s.body)) : null,
  };
}

export interface ServiceLive {
  state: ServiceState;
  detail: string;
  /** Percent of one CPU core, like top; null on the first sample. */
  cpuPercent: number | null;
  memoryBytes: number | null;
  pids: number[];
  restarts: number | null;
}

export interface SiteCheck {
  key: string;
  domain: string;
  /** HTTP status; null when the request failed. */
  status: number | null;
  timeMs: number | null;
  /** dns: through the domain's DNS records. local: straight to this server, for names that do not resolve. */
  via: 'dns' | 'local';
  error: string | null;
  /** Certificate end date and days left, https only. */
  certExpires: string | null;
  certDays: number | null;
  certIssuer: string | null;
  /** Why the certificate is not trusted, if it is not. */
  certProblem: string | null;
  checkedAt: string;
}

export interface LiveSample {
  at: string;
  host: {
    load: [number, number, number] | null;
    cpuPercent: number | null;
    cpus: number;
    memory: RawSample['memory'];
    uptimeSeconds: number | null;
    disks: DiskUsage[];
  };
  services: Record<string, ServiceLive>;
  sites: Record<string, SiteCheck>;
  /** Set when the last sample failed; the numbers are from the one before. */
  error: string | null;
}

/** What the next sample needs from this one. */
export interface SampleMemory {
  cpu: CpuTimes | null;
  ticks: Map<number, number>;
  pm2: DiscoveredService[] | null;
}

function tree(roots: number[], procs: RawSample['procs']): number[] {
  const children = new Map<number, number[]>();
  for (const [pid, info] of procs) {
    const list = children.get(info.ppid) ?? [];
    list.push(pid);
    children.set(info.ppid, list);
  }
  const seen = new Set<number>();
  const stack = roots.filter((pid) => procs.has(pid));
  while (stack.length && seen.size < 5000) {
    const pid = stack.pop() as number;
    if (seen.has(pid)) continue;
    seen.add(pid);
    stack.push(...(children.get(pid) ?? []));
  }
  return [...seen];
}

export function computeLive(
  discovery: DiscoveryResult,
  spec: WatchSpec,
  raw: RawSample,
  previous: SampleMemory | null,
  now = new Date()
): { live: Omit<LiveSample, 'sites' | 'error'>; memory: SampleMemory } {
  const pm2 = raw.pm2 ?? previous?.pm2 ?? null;
  const dTotal = raw.cpu && previous?.cpu ? raw.cpu.total - previous.cpu.total : 0;
  const dIdle = raw.cpu && previous?.cpu ? raw.cpu.idle - previous.cpu.idle : 0;
  const hostCpu = dTotal > 0 ? Math.min(100, Math.max(0, ((dTotal - dIdle) / dTotal) * 100)) : null;

  const services: Record<string, ServiceLive> = {};
  for (const service of discovery.services) {
    let roots = spec.scanPids[service.id] ?? [];
    let state: ServiceState = service.state;
    let detail = service.detail;
    let restarts = service.restarts;
    if (service.kind === 'systemd') {
      const unit = raw.units.get(service.id.slice('systemd:'.length));
      if (unit) {
        ({ state, detail, restarts } = unit);
        roots = unit.mainPid > 0 ? [unit.mainPid] : [];
      }
    } else if (service.kind === 'docker' && service.docker) {
      const container = raw.containers.get(service.docker.id);
      if (container) {
        ({ state, detail, restarts } = container);
        roots = container.pid > 0 ? [container.pid] : [];
      }
    } else if (service.kind === 'pm2') {
      const fresh = pm2?.find((p) => p.id === service.id);
      if (fresh) {
        ({ state, detail, restarts } = fresh);
        roots = fresh.pids;
      } else if (pm2) {
        state = 'unknown';
        detail = 'no longer listed by PM2';
        roots = [];
      }
    }
    // A process MagicTerm only knows by PID: gone means stopped.
    const alive = roots.filter((pid) => raw.procs.has(pid));
    if (service.kind === 'process') {
      state = alive.length ? 'running' : 'stopped';
      detail = alive.length ? service.detail : 'the process is gone';
    } else if (service.kind === 'pm2' && !raw.pm2 && roots.length && !alive.length && state === 'running') {
      state = 'unknown';
      detail = 'restarted; waiting for PM2';
    }
    const pids = tree(alive, raw.procs);
    let ticks = 0;
    let rss = 0;
    let known = previous !== null && dTotal > 0;
    for (const pid of pids) {
      const info = raw.procs.get(pid);
      if (!info) continue;
      rss += info.rssPages * raw.pageSize;
      const before = previous?.ticks.get(pid);
      if (before === undefined) continue;
      ticks += Math.max(0, info.ticks - before);
    }
    if (pids.length === 0) known = false;
    services[service.id] = {
      state,
      detail,
      cpuPercent: known ? Math.round((ticks / dTotal) * raw.ncpu * 1000) / 10 : null,
      memoryBytes: pids.length ? rss : null,
      pids: alive,
      restarts,
    };
  }

  const ticksByPid = new Map<number, number>();
  for (const [pid, info] of raw.procs) ticksByPid.set(pid, info.ticks);
  return {
    live: {
      at: now.toISOString(),
      host: {
        load: raw.load,
        cpuPercent: hostCpu === null ? null : Math.round(hostCpu * 10) / 10,
        cpus: raw.ncpu,
        memory: raw.memory,
        uptimeSeconds: raw.uptime,
        disks: raw.disks,
      },
      services,
    },
    memory: { cpu: raw.cpu, ticks: ticksByPid, pm2 },
  };
}

/**
 * One curl per site from the server itself: first through DNS, then, for names that do not
 * resolve (internal or test domains), straight to 127.0.0.1. Certificates are read from
 * the local nginx with the name as SNI. Runs the checks in parallel.
 */
export function buildSiteCheckScript(nonce: string, targets: SiteTarget[]): string {
  const lines = targets
    .filter((t) => DOMAIN.test(t.domain) && Number.isInteger(t.port) && t.port > 0 && t.port < 65536)
    .map((t) => `mt_check ${shQuote(t.key)} ${shQuote(t.domain)} ${t.scheme} ${t.port} &`)
    .join('\n');
  return `${prelude(nonce)}
MT_W='%{http_code} %{time_total} %{ssl_verify_result}'
mt_check() {
  if have curl; then
    out=$(curl -k -sS -o /dev/null --max-time 8 -w "$MT_W" "$3://$2:$4/" 2>/dev/null); rc=$?
    via=dns
    if [ $rc -eq 6 ]; then
      out=$(curl -k -sS -o /dev/null --max-time 8 --resolve "$2:$4:127.0.0.1" -w "$MT_W" "$3://$2:$4/" 2>/dev/null); rc=$?
      via=local
    fi
    printf 'http\\t%s\\t%s\\t%s\\t%s\\n' "$1" "$via" "$rc" "$out"
  else
    printf 'http\\t%s\\tdns\\t-1\\t\\n' "$1"
  fi
  if [ "$3" = https ] && have openssl; then
    c=$(printf '' | $T openssl s_client -connect "127.0.0.1:$4" -servername "$2" 2>/dev/null | openssl x509 -noout -enddate -issuer 2>/dev/null | tr '\\n' '\\t')
    printf 'cert\\t%s\\t%s\\n' "$1" "$c"
  fi
}
sec checks
${lines}
wait
sec end
`;
}

const CURL_ERRORS: Record<number, string> = {
  [-1]: 'curl is not installed on the server',
  6: 'the name does not resolve',
  7: 'connection refused',
  28: 'timed out after 8 seconds',
  35: 'TLS handshake failed',
  47: 'too many redirects',
  52: 'empty reply',
  56: 'connection reset',
  60: 'certificate problem',
};

/** OpenSSL verify codes curl reports with -k; the common ones get words. */
const VERIFY_ERRORS: Record<number, string> = {
  10: 'certificate has expired',
  18: 'self-signed certificate',
  19: 'self-signed certificate in the chain',
  20: 'issuer certificate not found',
  21: 'cannot verify the first certificate',
  62: 'name does not match the certificate',
};

export function parseSiteChecks(output: string, nonce: string, targets: SiteTarget[], now = new Date()): Record<string, SiteCheck> {
  const body = splitSections(output, nonce).find((s) => s.name === 'checks')?.body ?? '';
  const results: Record<string, SiteCheck> = {};
  const byKey = new Map(targets.map((t) => [t.key, t]));
  const get = (key: string): SiteCheck | null => {
    const target = byKey.get(key);
    if (!target) return null;
    results[key] ??= {
      key,
      domain: target.domain,
      status: null,
      timeMs: null,
      via: 'dns',
      error: null,
      certExpires: null,
      certDays: null,
      certIssuer: null,
      certProblem: null,
      checkedAt: now.toISOString(),
    };
    return results[key];
  };
  for (const line of body.split('\n')) {
    const parts = line.split('\t');
    if (parts[0] === 'http') {
      const check = get(parts[1]);
      if (!check) continue;
      check.via = parts[2] === 'local' ? 'local' : 'dns';
      const rc = Number(parts[3]);
      const [code, time, verify] = (parts[4] ?? '').trim().split(' ');
      const status = Number(code);
      if (rc === 0 && status > 0) {
        check.status = status;
        check.timeMs = Math.round(Number(time) * 1000);
      } else {
        check.error = CURL_ERRORS[rc] ?? `curl exit code ${rc}`;
      }
      const verifyCode = Number(verify);
      if (verifyCode > 0 && byKey.get(parts[1])?.scheme === 'https') {
        check.certProblem = VERIFY_ERRORS[verifyCode] ?? `not trusted (OpenSSL code ${verifyCode})`;
      }
    } else if (parts[0] === 'cert') {
      const check = get(parts[1]);
      if (!check) continue;
      for (const field of parts.slice(2)) {
        if (field.startsWith('notAfter=')) {
          const time = Date.parse(field.slice(9).replace(/\s+/g, ' '));
          if (!Number.isNaN(time)) {
            check.certExpires = new Date(time).toISOString();
            check.certDays = Math.floor((time - now.getTime()) / 86_400_000);
          }
        } else if (field.startsWith('issuer=')) {
          const cn = /CN\s*=\s*([^,/]+)/.exec(field);
          check.certIssuer = (cn ? cn[1] : field.slice(7)).trim().slice(0, 120);
        }
      }
      if (check.certDays === null && !check.certProblem) check.certProblem = 'no certificate was served';
    }
  }
  return results;
}

export interface LogRequest {
  lines: number;
  follow: boolean;
}

/**
 * The script that prints (and with follow, keeps printing) a service's log. Reads as root when
 * that works without a password, with the sudo password when one was given, else as the user.
 * Returns null when MagicTerm knows no log for the service.
 */
export function buildLogScript(nonce: string, service: DiscoveredService, request: LogRequest): string | null {
  const n = Math.max(1, Math.min(5000, Math.floor(request.lines)));
  const follow = request.follow;
  let command: string;
  if (service.kind === 'systemd') {
    const unit = service.id.slice('systemd:'.length);
    if (!SAFE_UNIT.test(unit)) return null;
    command = `have journalctl || { echo 'journalctl is not installed here, so this unit has no journal to read.'; exit 0; }
asroot journalctl -u ${shQuote(unit)} -n ${n} --no-pager -o short-iso${follow ? ' -f' : ''}`;
  } else if (service.kind === 'docker' && service.docker && SAFE_ID.test(service.docker.id)) {
    command = `${DOCKER_INIT}
[ -n "$MT_DK" ] || { echo 'Docker is not reachable for this user.'; exit 0; }
T=
dk logs --tail ${n} --timestamps${follow ? ' -f' : ''} ${service.docker.id} 2>&1`;
  } else if (service.kind === 'pm2' && service.pm2 && (service.pm2.outLog || service.pm2.errLog)) {
    const files = [service.pm2.outLog, service.pm2.errLog].filter((f): f is string => Boolean(f && f.startsWith('/')));
    command = `asroot tail -n ${n}${follow ? ' -F' : ''} ${files.map(shQuote).join(' ')}`;
  } else if (service.kind === 'process' && Number.isInteger(service.pids[0]) && service.pids[0] > 0) {
    // A process started by hand often writes to a file through nohup or a redirect.
    command = `[ -d /proc/${service.pids[0]} ] || { echo 'Process ${service.pids[0]} is gone. Scan the server again to find what runs now.'; exit 0; }
f=$(asroot readlink /proc/${service.pids[0]}/fd/1 2>/dev/null)
case $f in /*) [ -f "$f" ] || f=;; *) f=;; esac
[ -n "$f" ] || { echo 'This process does not write its output to a file MagicTerm can find.'; exit 0; }
echo "$f:"
asroot tail -n ${n}${follow ? ' -F' : ''} "$f"`;
  } else {
    return null;
  }
  // With follow the log runs in the background and is stopped when MagicTerm closes stdin.
  const body = follow
    ? `( ${command} ) &
MT_LOG=$!
cat >/dev/null
pkill -P $MT_LOG 2>/dev/null
kill $MT_LOG 2>/dev/null`
    : command;
  return `${prelude(nonce)}
sec log
${body}
`;
}

/** For a followed log: the runner keeps stdin open after the password line, so EOF can stop it. */
export function followRunner(script: string): string {
  return `sh -c ${shQuote(`IFS= read -r MT_PW; ${script}`)}`;
}
