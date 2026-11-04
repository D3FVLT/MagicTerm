/**
 * What the Services monitor finds on a server. Built in main from the discovery
 * script's output, stored encrypted in the vault, read by the renderer and MCP.
 */

export type ServiceKind = 'systemd' | 'pm2' | 'docker' | 'process';

export type ServiceState = 'running' | 'stopped' | 'failed' | 'restarting' | 'starting' | 'unknown';

export interface GitInfo {
  /** Repository root, which can be above the service's folder. */
  root: string;
  /** null when HEAD is detached. */
  branch: string | null;
  /** Remote URL with any user and password removed. */
  remote: string | null;
  /** e.g. origin/main; null without an upstream. */
  upstream: string | null;
  /** Commits counted against the last fetch; null without an upstream. */
  ahead: number | null;
  behind: number | null;
  /** Changed or untracked files. */
  dirty: number;
  lastCommit: { hash: string; time: number; subject: string } | null;
  /** Unix seconds of the last fetch, from FETCH_HEAD. */
  fetchedAt: number | null;
}

export interface ProjectInfo {
  path: string;
  exists: boolean;
  /** node, go, python, rust, php, ruby, java, deno, elixir, static */
  language: string | null;
  /** pnpm, npm, yarn, bun, poetry, uv, pip, cargo, composer, bundler, go */
  packageManager: string | null;
  /** Marker files found, e.g. package.json, pnpm-lock.yaml. */
  markers: string[];
  /** Names of package.json scripts. */
  scripts: string[];
  git: GitInfo | null;
}

export interface DiscoveredService {
  /** Stable across scans: systemd:api.service, pm2:deploy:web, docker:shop-1, process:node:3001. */
  id: string;
  kind: ServiceKind;
  name: string;
  description: string | null;
  state: ServiceState;
  /** Manager's own words, e.g. "active (running)", "online", "Up 3 hours". */
  detail: string;
  user: string | null;
  pids: number[];
  /** Working directory, if known. */
  cwd: string | null;
  command: string | null;
  /** TCP ports this service listens on. */
  ports: number[];
  /** Domains whose nginx site sends traffic to this service. */
  domains: string[];
  /** ISO time it entered its current state, when known. */
  since: string | null;
  restarts: number | null;
  /** systemd: enabled, disabled. docker: restart policy. */
  autostart: string | null;
  docker?: { id: string; image: string; composeProject: string | null; composeService: string | null; health: string | null };
  pm2?: { namespace: string | null; mode: string | null; instances: number; outLog: string | null; errLog: string | null };
  /** Index into DiscoveryResult.projects, by path. */
  projectPath: string | null;
  /** systemd only: the unit has ExecReload. */
  canReload?: boolean;
}

export interface SiteProxy {
  location: string;
  /** As written, e.g. http://127.0.0.1:3000 or http://api_backend/. */
  target: string;
  /** Resolved host:port pairs; empty for unix sockets and variables. */
  upstreams: { host: string; port: number }[];
  /** Ids of the services listening on those ports. */
  serviceIds: string[];
}

export interface Site {
  /** server_name values; "_" and empty names are left out. */
  domains: string[];
  listen: string[];
  ssl: boolean;
  /** Static root, if any. */
  root: string | null;
  proxies: SiteProxy[];
  certificate: string | null;
  /** Config file the server block is in. */
  file: string;
}

export interface ListeningPort {
  address: string;
  port: number;
  pid: number | null;
  process: string | null;
  serviceId: string | null;
}

export type Privilege = 'root' | 'sudo' | 'needs-password' | 'wrong-password' | 'limited';

export interface DiscoveryNote {
  /** meta, systemd, pm2, docker, nginx, ports, projects */
  source: string;
  message: string;
}

export interface DiscoveryResult {
  version: 1;
  scannedAt: string;
  host: { hostname: string; os: string | null; kernel: string | null; user: string; privilege: Privilege };
  /** Which tools were found: systemd, pm2, docker, nginx, git, ss. */
  tools: string[];
  services: DiscoveredService[];
  sites: Site[];
  ports: ListeningPort[];
  projects: ProjectInfo[];
  /** What could not be checked, and why. */
  notes: DiscoveryNote[];
}
