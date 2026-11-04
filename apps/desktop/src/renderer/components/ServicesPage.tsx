import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Server } from '@magicterm/shared';
import { useServers } from '../contexts/ServersContext';
import { useServices } from '../contexts/ServicesContext';
import { useOrganizations } from '../contexts/OrganizationsContext';
import { useAuth } from '../contexts/AuthContext';
import { useTerminal } from '../contexts/TerminalContext';
import { hostWithPort } from '../lib/server-address';
import { Button } from './ui/Button';
import { ServiceActions } from './ServiceActions';
import { DeployPanel } from './DeployPanel';
import { ACTION_LABELS, availableActions } from '../../common/monitor/actions';
import { ServiceLogs } from './ServiceLogs';
import { siteTargets, type LiveSample, type ServiceLive, type SiteCheck } from '../../common/monitor/live';
import type {
  DiscoveredService,
  DiscoveryResult,
  ProjectInfo,
  ServiceKind,
  ServiceState,
  Site,
} from '../../common/monitor/types';

const KIND_LABELS: Record<ServiceKind, string> = {
  systemd: 'systemd',
  pm2: 'PM2',
  docker: 'Docker',
  process: 'process',
};

const STATE_DOT: Record<ServiceState, string> = {
  running: 'bg-green-500',
  starting: 'bg-yellow-500 animate-pulse',
  restarting: 'bg-yellow-500 animate-pulse',
  stopped: 'bg-fg-subtle',
  failed: 'bg-red-500',
  unknown: 'bg-fg-subtle opacity-50',
};

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function HostBar({ sample }: { sample: LiveSample | null }) {
  if (!sample) {
    return <div className="py-2 text-xs text-fg-subtle">Connecting for live numbers</div>;
  }
  const { host } = sample;
  const memory = host.memory;
  const memUsed = memory ? memory.total - memory.available : null;
  const memPercent = memory && memUsed !== null ? Math.round((memUsed / memory.total) * 100) : null;
  const warn = (value: number | null, at: number, bad: number) =>
    value === null ? 'text-fg' : value >= bad ? 'text-red-500' : value >= at ? 'text-warning' : 'text-fg';
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-edge py-2 text-xs tabular-nums text-fg-subtle">
      <span>
        Load <span className={warn(host.load ? host.load[0] / Math.max(1, host.cpus) * 100 : null, 80, 150)}>{host.load ? host.load.map((n) => n.toFixed(2)).join(' ') : '—'}</span>
      </span>
      <span>
        CPU <span className={warn(host.cpuPercent, 80, 95)}>{host.cpuPercent === null ? '—' : `${Math.round(host.cpuPercent)}%`}</span>
        {host.cpus ? ` of ${host.cpus} core${host.cpus === 1 ? '' : 's'}` : ''}
      </span>
      <span>
        Memory <span className={warn(memPercent, 85, 95)}>{memory && memUsed !== null ? `${formatBytes(memUsed)} of ${formatBytes(memory.total)}` : '—'}</span>
      </span>
      {host.disks.slice(0, 4).map((disk) => (
        <span key={disk.mount} data-tooltip={`${formatBytes(disk.usedBytes)} of ${formatBytes(disk.sizeBytes)} on ${disk.filesystem}`}>
          Disk {disk.mount} <span className={warn(disk.percent, 85, 95)}>{disk.percent}%</span>
        </span>
      ))}
      {sample.error && <span className="text-red-500">Live numbers are stale: {sample.error}</span>}
    </div>
  );
}

function SiteCheckCell({ checks }: { checks: SiteCheck[] }) {
  if (checks.length === 0) return <span className="w-44 shrink-0 text-xs text-fg-subtle">{''}</span>;
  const check = checks[0];
  const statusClass = check.status === null
    ? 'text-red-500'
    : check.status >= 500
      ? 'text-red-500'
      : check.status >= 400
        ? 'text-warning'
        : 'text-green-500';
  const certClass = check.certDays === null
    ? 'text-fg-subtle'
    : check.certDays < 3
      ? 'text-red-500'
      : check.certDays < 14
        ? 'text-warning'
        : 'text-fg-subtle';
  const tooltip = [
    check.status !== null ? `HTTP ${check.status} in ${check.timeMs} ms` : `Failed: ${check.error}`,
    check.via === 'local' ? 'Checked on the server against its own nginx; the name does not resolve in DNS there.' : 'Checked from the server through DNS.',
    check.certExpires ? `Certificate valid until ${check.certExpires.slice(0, 10)}${check.certIssuer ? `, issued by ${check.certIssuer}` : ''}` : '',
    check.certProblem ? `Certificate: ${check.certProblem}` : '',
    `Checked ${timeAgo(check.checkedAt)}`,
  ].filter(Boolean).join('\n');
  return (
    <span className="flex w-44 shrink-0 items-center gap-2 text-xs tabular-nums" data-tooltip={tooltip}>
      <span className={statusClass}>{check.status ?? check.error}</span>
      {check.timeMs !== null && <span className="text-fg-subtle">{check.timeMs} ms</span>}
      {check.certDays !== null && <span className={certClass}>{check.certDays < 0 ? 'cert expired' : `cert ${check.certDays} d`}</span>}
      {check.certProblem && <span className="text-warning">!</span>}
    </span>
  );
}

function serviceLabel(service: DiscoveredService): string {
  if (service.kind === 'docker' && service.docker?.composeProject && service.docker.composeService) {
    return `${service.docker.composeProject}/${service.docker.composeService}`;
  }
  return service.name;
}

function gitSummary(project: ProjectInfo | undefined): string {
  const git = project?.git;
  if (!git) return '';
  const parts = [git.branch ?? 'detached'];
  if (git.ahead) parts.push(`${git.ahead} ahead`);
  if (git.behind) parts.push(`${git.behind} behind`);
  if (git.dirty) parts.push(`${git.dirty} changed`);
  return parts.join(', ');
}

function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="flex h-8 items-center gap-2 pt-3 text-[13px] font-medium text-fg-subtle">
      {children}
      {count !== undefined && <span className="text-xs">{count}</span>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="flex gap-3 py-0.5 text-xs">
      <span className="w-24 shrink-0 text-fg-subtle">{label}</span>
      <span className="min-w-0 break-words text-fg">{children}</span>
    </div>
  );
}

function ServiceDetails({ server, service, project, live, askSudo, sudoNeedsPassword, canManage, address, discovery }: {
  sudoNeedsPassword: boolean;
  canManage: boolean;
  address: string;
  discovery: DiscoveryResult;
  server: Server;
  service: DiscoveredService;
  project?: ProjectInfo;
  live?: ServiceLive;
  askSudo: () => Promise<string | null>;
}) {
  const git = project?.git;
  const actions = canManage
    ? availableActions(service, live?.state ?? service.state, discovery.tools.includes('systemd')).map((action) => ({
      label: ACTION_LABELS[action],
      request: { kind: 'service' as const, service, action },
    }))
    : [];
  return (
    <div className="border-b border-edge bg-surface-1 px-7 py-2">
      <ServiceActions server={server} address={address} loginUser={discovery.host.user} target={service.name} choices={actions} />
      {service.description && <Field label="Description">{service.description}</Field>}
      <Field label="Status">{live?.detail ?? service.detail}</Field>
      <Field label="Command">{service.command && <code className="font-mono">{service.command}</code>}</Field>
      <Field label="User">{service.user}</Field>
      <Field label="PID">{(live?.pids ?? service.pids).join(', ')}</Field>
      <Field label="Since">{service.since && `${service.since.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')} (${timeAgo(service.since)})`}</Field>
      <Field label="Restarts">{(live?.restarts ?? service.restarts) !== null ? String(live?.restarts ?? service.restarts) : ''}</Field>
      <Field label="Starts on boot">{service.autostart}</Field>
      {service.docker && (
        <>
          <Field label="Image">{service.docker.image}</Field>
          <Field label="Compose">{service.docker.composeProject}</Field>
        </>
      )}
      {service.pm2 && <Field label="PM2">{`${service.pm2.mode ?? 'fork'}, ${service.pm2.instances} instance${service.pm2.instances === 1 ? '' : 's'}`}</Field>}
      <Field label="Folder">{service.cwd}</Field>
      {project && (
        <>
          <Field label="Language">{[project.language, project.packageManager].filter(Boolean).join(', ')}</Field>
          <Field label="Scripts">{project.scripts.join(', ')}</Field>
        </>
      )}
      {git && (
        <>
          <Field label="Git remote">{git.remote}</Field>
          <Field label="Branch">{gitSummary(project)}{git.upstream ? ` (vs ${git.upstream}${git.fetchedAt ? `, fetched ${timeAgo(new Date(git.fetchedAt * 1000).toISOString())}` : ', never fetched'})` : ''}</Field>
          <Field label="Last commit">{git.lastCommit && `${git.lastCommit.hash.slice(0, 8)} ${git.lastCommit.subject}`}</Field>
        </>
      )}
      {project && !project.exists && <Field label="Folder">Missing or not readable</Field>}
      <DeployPanel server={server} service={service} discovery={discovery} canManage={canManage} address={address} />
      <ServiceLogs server={server} service={service} askSudo={askSudo} sudoNeedsPassword={sudoNeedsPassword} />
    </div>
  );
}

function siteTarget(site: Site, services: Map<string, DiscoveredService>, listening: Set<number>): ReactNode[] {
  const parts: ReactNode[] = [];
  for (const proxy of site.proxies) {
    const names = proxy.serviceIds.map((id) => services.get(id)).filter(Boolean) as DiscoveredService[];
    const where = proxy.upstreams.map((u) => `${u.host}:${u.port}`).join(', ') || proxy.target;
    parts.push(
      <span key={`${proxy.location}${proxy.target}`} className="mr-3 inline-block">
        {proxy.location !== '/' && <span className="text-fg-subtle">{proxy.location} </span>}
        {names.length > 0
          ? names.map((s) => `${serviceLabel(s)} (${KIND_LABELS[s.kind]})`).join(', ')
          : (
            <span className="text-fg-subtle">
              {where}
              {proxy.upstreams.length === 0
                ? ''
                : proxy.upstreams.some((u) => listening.has(u.port))
                  ? ', owner not visible to this user'
                  : ', nothing listens there'}
            </span>
          )}
      </span>
    );
  }
  if (site.root) parts.push(<span key="root" className="text-fg-subtle">static {site.root}</span>);
  return parts;
}

function matches(service: DiscoveredService, query: string): boolean {
  const q = query.toLowerCase();
  return [service.name, service.cwd ?? '', service.command ?? '', ...service.domains, ...service.ports.map(String)]
    .some((value) => value.toLowerCase().includes(q));
}

function ServerServices({ server, query, active }: { server: Server; query: string; active: boolean }) {
  const { discoveryFor, scanStateFor, scan, removeServer, canManage, liveFor, watch, askSudo: askSudoFor } = useServices();
  const { decryptServerHost, decryptServerUsername } = useServers();
  const [address, setAddress] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showPorts, setShowPorts] = useState(false);
  const discovery: DiscoveryResult | null = discoveryFor(server.id);
  const state = scanStateFor(server.id);
  const autoScanned = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([decryptServerUsername(server), decryptServerHost(server)]).then(([user, host]) => {
      if (!cancelled) setAddress(`${user}@${hostWithPort(host, server.port)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [server, decryptServerHost, decryptServerUsername]);

  // First open of a server that was never scanned.
  useEffect(() => {
    if (!active || autoScanned.current || discovery || state.scanning || state.error) return;
    autoScanned.current = true;
    void scan(server.id, { askHostKey: true });
  }, [active, discovery, state.scanning, state.error, scan, server.id]);

  // Live numbers while this server is on screen; a new scan restarts the watch with its services.
  const watchRef = useRef(watch);
  watchRef.current = watch;
  const scannedAt = discovery?.scannedAt ?? null;
  const discoveryRef = useRef(discovery);
  discoveryRef.current = discovery;
  useEffect(() => {
    if (!active || !scannedAt || !discoveryRef.current) return;
    return watchRef.current(server.id, discoveryRef.current);
  }, [active, scannedAt, server.id]);
  const live = liveFor(server.id);
  const siteChecks = useMemo(() => {
    const byKey = live?.sites ?? {};
    return (site: Site) => siteTargets({ ...(discovery as DiscoveryResult), sites: [site] })
      .map((target) => byKey[target.key])
      .filter((check): check is SiteCheck => Boolean(check));
  }, [live, discovery]);

  const askSudo = (purpose: 'scan' | 'logs') =>
    askSudoFor(server.id, purpose === 'scan' ? 'scan as root' : 'read this log');

  const services = discovery?.services ?? [];
  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const projects = useMemo(() => new Map((discovery?.projects ?? []).map((p) => [p.path, p])), [discovery]);
  const listening = useMemo(() => new Set((discovery?.ports ?? []).map((p) => p.port)), [discovery]);
  const shown = query ? services.filter((s) => matches(s, query)) : services;
  const sites = (discovery?.sites ?? []).filter((site) =>
    !query || site.domains.some((d) => d.toLowerCase().includes(query.toLowerCase())) || (site.root ?? '').includes(query)
  );
  const needsSudo = discovery?.host.privilege === 'needs-password' || discovery?.host.privilege === 'wrong-password';
  const kinds: ServiceKind[] = ['systemd', 'pm2', 'docker', 'process'];

  return (
    <div className="min-w-0 flex-1 overflow-y-auto px-4 pb-8">
      <div className="flex items-center gap-3 border-b border-edge py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">{server.name}</div>
          <div className="truncate text-xs tabular-nums text-fg-subtle">
            {address}
            {discovery && ` · ${[discovery.host.hostname, discovery.host.os].filter(Boolean).join(', ')}`}
            {discovery && ` · scanned ${timeAgo(discovery.scannedAt)}`}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {needsSudo && (
            <Button
              variant="ghost"
              size="sm"
              disabled={state.scanning}
              onClick={() => {
                void askSudo('scan').then((password) => {
                  if (password) void scan(server.id, { sudoPassword: password, askHostKey: true });
                });
              }}
            >
              Scan with sudo
            </Button>
          )}
          <Button variant="secondary" size="sm" disabled={state.scanning} onClick={() => void scan(server.id, { askHostKey: true })}>
            {state.scanning ? 'Scanning…' : 'Rescan'}
          </Button>
          {canManage && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (window.confirm(`Remove ${server.name} from Services? The saved scan is deleted; the server stays in the vault.`)) {
                  void removeServer(server.id);
                }
              }}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      {state.error && <p className="py-2 text-sm text-red-500">{state.error}</p>}

      {!discovery ? (
        state.scanning ? (
          <div className="flex items-center gap-2 py-6 text-[13px] text-fg-subtle">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Reading services, sites and projects over SSH
          </div>
        ) : null
      ) : (
        <>
          <HostBar sample={live} />

          {discovery.notes.length > 0 && (
            <ul className="space-y-0.5 py-2 text-xs text-fg-subtle">
              {discovery.notes.map((note) => <li key={note.message}>{note.message}</li>)}
            </ul>
          )}

          <SectionTitle count={sites.length}>Sites</SectionTitle>
          {canManage && discovery.tools.includes('nginx') && (
            <ServiceActions
              server={server}
              address={address}
              loginUser={discovery.host.user}
              target="nginx"
              choices={[
                { label: 'Test nginx config', request: { kind: 'nginx', action: 'test', systemd: discovery.tools.includes('systemd') } },
                { label: 'Reload nginx', request: { kind: 'nginx', action: 'reload', systemd: discovery.tools.includes('systemd') } },
              ]}
            />
          )}
          {sites.length === 0 ? (
            <p className="border-b border-edge px-2 py-2 text-xs text-fg-subtle">
              {discovery.tools.includes('nginx') ? 'No nginx sites with a server_name' : 'nginx is not installed'}
            </p>
          ) : (
            sites.map((site, index) => (
              <div key={`${site.file}${index}`} className="flex min-h-9 items-center gap-3 border-b border-edge px-2 py-1.5 text-[13px]">
                <span className="w-64 shrink-0 truncate text-fg" data-tooltip={site.domains.join(', ')}>
                  {site.domains[0] ?? <span className="text-fg-subtle">no name</span>}
                  {site.domains.length > 1 && <span className="text-xs text-fg-subtle"> +{site.domains.length - 1}</span>}
                </span>
                <span className="w-14 shrink-0 text-xs text-fg-subtle">{site.ssl ? 'HTTPS' : 'HTTP'}</span>
                <SiteCheckCell checks={siteChecks(site)} />
                <span className="min-w-0 flex-1 truncate text-xs text-fg">{siteTarget(site, byId, listening)}</span>
              </div>
            ))
          )}

          {kinds.map((kind) => {
            const list = shown.filter((s) => s.kind === kind);
            if (list.length === 0) return null;
            return (
              <div key={kind}>
                <SectionTitle count={list.length}>{kind === 'process' ? 'Other processes' : KIND_LABELS[kind]}</SectionTitle>
                {list.map((service) => {
                  const project = service.projectPath ? projects.get(service.projectPath) : undefined;
                  const isOpen = expanded === service.id;
                  const now = live?.services[service.id];
                  const stateNow = now?.state ?? service.state;
                  return (
                    <div key={service.id}>
                      <button
                        onClick={() => setExpanded(isOpen ? null : service.id)}
                        className="flex h-9 w-full items-center gap-3 border-b border-edge px-2 text-left text-[13px] hover:bg-surface-2"
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOT[stateNow]}`} data-tooltip={now?.detail ?? service.detail} />
                        <span className="w-40 shrink-0 truncate font-medium text-fg">{serviceLabel(service)}</span>
                        <span className={`w-20 shrink-0 truncate text-xs ${stateNow === 'failed' ? 'text-red-500' : 'text-fg-subtle'}`}>{stateNow}</span>
                        <span className="w-14 shrink-0 text-right text-xs tabular-nums text-fg-subtle" data-tooltip="CPU, percent of one core">
                          {now?.cpuPercent !== null && now?.cpuPercent !== undefined ? `${now.cpuPercent}%` : ''}
                        </span>
                        <span className="w-16 shrink-0 text-right text-xs tabular-nums text-fg-subtle" data-tooltip="Memory (RSS) of the process and its children">
                          {formatBytes(now?.memoryBytes)}
                        </span>
                        <span className="w-28 shrink-0 truncate text-xs tabular-nums text-fg-subtle">
                          {service.ports.map((p) => `:${p}`).join(' ')}
                        </span>
                        <span className="w-36 shrink-0 truncate text-xs text-fg">{service.domains.join(', ')}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">{service.cwd}</span>
                        <span className="w-36 shrink-0 truncate text-right text-xs text-fg-subtle">
                          {[project?.language, gitSummary(project)].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                      {isOpen && (
                        <ServiceDetails
                          server={server}
                          service={service}
                          project={project}
                          live={now}
                          askSudo={() => askSudo('logs')}
                          sudoNeedsPassword={needsSudo}
                          canManage={canManage}
                          address={address}
                          discovery={discovery}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {services.length === 0 && (
            <p className="py-4 text-[13px] text-fg-subtle">
              No systemd units in /etc/systemd/system, PM2 apps, containers or other listening processes were found.
            </p>
          )}

          <button
            onClick={() => setShowPorts(!showPorts)}
            className="mt-3 flex h-8 items-center gap-2 text-[13px] font-medium text-fg-subtle hover:text-fg"
          >
            <svg className={`h-3 w-3 transition-transform ${showPorts ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            Listening ports <span className="text-xs">{discovery.ports.length}</span>
          </button>
          {showPorts && discovery.ports.map((port) => (
            <div key={`${port.address}:${port.port}`} className="flex h-8 items-center gap-3 border-b border-edge px-2 text-xs">
              <span className="w-40 shrink-0 tabular-nums text-fg">{port.address.includes(':') ? `[${port.address}]` : port.address}:{port.port}</span>
              <span className="w-40 shrink-0 truncate text-fg-subtle">{port.process ?? ''}{port.pid ? ` (${port.pid})` : ''}</span>
              <span className="truncate text-fg">{port.serviceId ? serviceLabel(byId.get(port.serviceId) ?? ({ name: port.serviceId } as DiscoveredService)) : ''}</span>
            </div>
          ))}
        </>
      )}

    </div>
  );
}

export function ServicesPage() {
  const { servers } = useServers();
  const { monitored, addServer, canManage, discoveryFor, scanStateFor } = useServices();
  const { currentOrg } = useOrganizations();
  const { isLocalOnly } = useAuth();
  const { activeView } = useTerminal();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addError, setAddError] = useState('');
  const addRef = useRef<HTMLDivElement>(null);

  const selected = monitored.find((s) => s.id === selectedId) ?? monitored[0] ?? null;
  const candidates = servers.filter((s) => !s.monitor && s.connectionType !== 'ftp');

  useEffect(() => {
    if (!showAdd) return;
    const handler = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setShowAdd(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAdd]);

  const add = async (server: Server) => {
    setShowAdd(false);
    setAddError('');
    try {
      await addServer(server.id);
      setSelectedId(server.id);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not add the server');
    }
  };

  return (
    <div className="flex h-full flex-col bg-app">
      <div className="flex items-center gap-3 border-b border-edge px-4 py-2">
        <div className="flex h-8 w-52 shrink-0 items-center text-sm text-fg">
          {isLocalOnly || !currentOrg ? 'Personal' : currentOrg.name}
        </div>
        <div className="relative min-w-0 flex-1">
          <svg className="absolute left-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Filter by name, domain, port or folder"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full border-b border-edge bg-transparent py-1 pl-6 text-[13px] text-fg placeholder-fg-subtle outline-none focus:border-accent"
          />
        </div>
        {canManage && (
          <div className="relative ml-auto" ref={addRef}>
            <Button size="sm" onClick={() => setShowAdd(!showAdd)} disabled={candidates.length === 0}>
              Add server
            </Button>
            {showAdd && (
              <div className="absolute right-0 top-full z-30 mt-1 max-h-80 w-64 overflow-y-auto rounded-lg border border-edge bg-surface-1 py-1 shadow-lg">
                {candidates.map((server) => (
                  <button
                    key={server.id}
                    onClick={() => void add(server)}
                    className="block w-full truncate px-3 py-1.5 text-left text-[13px] text-fg hover:bg-surface-2"
                  >
                    {server.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {addError && <p className="px-4 py-2 text-sm text-red-500">{addError}</p>}

      {monitored.length === 0 ? (
        <div className="px-6 py-6">
          <p className="text-[13px] text-fg-subtle">
            Add a server to see the systemd units, PM2 apps, containers and nginx sites on it, and the folders and git
            repositories they run from. MagicTerm reads them over SSH; nothing is installed on the server.
          </p>
          {!canManage && <p className="mt-2 text-[13px] text-fg-subtle">Viewers cannot add servers here.</p>}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="w-56 shrink-0 overflow-y-auto border-r border-edge py-2">
            {monitored.map((server) => {
              const discovery = discoveryFor(server.id);
              const scanState = scanStateFor(server.id);
              const failed = discovery?.services.filter((s) => s.state === 'failed').length ?? 0;
              return (
                <button
                  key={server.id}
                  onClick={() => setSelectedId(server.id)}
                  className={`flex h-9 w-full items-center gap-2 px-4 text-left text-[13px] ${
                    selected?.id === server.id ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{server.name}</span>
                  {scanState.scanning ? (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  ) : failed > 0 ? (
                    <span className="text-xs text-red-500" data-tooltip="Failed services">{failed}</span>
                  ) : (
                    <span className="text-xs text-fg-subtle">{discovery?.services.length ?? ''}</span>
                  )}
                </button>
              );
            })}
          </div>
          {selected && <ServerServices key={selected.id} server={selected} query={query} active={activeView === 'services'} />}
        </div>
      )}
    </div>
  );
}
