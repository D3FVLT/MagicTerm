/**
 * Plain-text and structured views of a scan for the MCP tools. Shapes stay small: an
 * agent reads them, so only what helps it find and reason about a service.
 */
import type { DiscoveredService, DiscoveryResult, ProjectInfo, Site } from './types.js';

export interface ServiceSummary {
  service_id: string;
  kind: DiscoveredService['kind'];
  name: string;
  state: DiscoveredService['state'];
  detail: string;
  ports: number[];
  domains: string[];
  folder: string | null;
  language: string | null;
  package_manager: string | null;
  git: { branch: string | null; remote: string | null; ahead: number | null; behind: number | null; dirty: number } | null;
}

function projectOf(result: DiscoveryResult, service: DiscoveredService): ProjectInfo | undefined {
  return service.projectPath ? result.projects.find((p) => p.path === service.projectPath) : undefined;
}

export function summarizeService(result: DiscoveryResult, service: DiscoveredService): ServiceSummary {
  const project = projectOf(result, service);
  const git = project?.git;
  return {
    service_id: service.id,
    kind: service.kind,
    name: service.name,
    state: service.state,
    detail: service.detail,
    ports: service.ports,
    domains: service.domains,
    folder: service.cwd,
    language: project?.language ?? null,
    package_manager: project?.packageManager ?? null,
    git: git ? { branch: git.branch, remote: git.remote, ahead: git.ahead, behind: git.behind, dirty: git.dirty } : null,
  };
}

/** Case-insensitive match on name, domain, folder, git remote, command and port. */
export function serviceMatches(result: DiscoveryResult, service: DiscoveredService, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const project = projectOf(result, service);
  return [
    service.id,
    service.name,
    service.cwd ?? '',
    service.command ?? '',
    service.docker?.image ?? '',
    service.docker?.composeProject ?? '',
    project?.git?.remote ?? '',
    project?.git?.root ?? '',
    ...service.domains,
    ...service.ports.map(String),
  ].some((value) => value.toLowerCase().includes(q));
}

export function siteMatches(site: Site, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [...site.domains, site.root ?? '', ...site.proxies.map((p) => p.target)].some((v) => v.toLowerCase().includes(q));
}

export function serviceLine(summary: ServiceSummary): string {
  const parts = [`${summary.service_id}: ${summary.kind}, ${summary.state}${summary.detail && summary.detail !== summary.state ? ` (${summary.detail})` : ''}`];
  if (summary.ports.length) parts.push(`ports ${summary.ports.join(', ')}`);
  if (summary.domains.length) parts.push(`domains ${summary.domains.join(', ')}`);
  if (summary.folder) parts.push(`folder ${summary.folder}`);
  const lang = [summary.language, summary.package_manager].filter(Boolean).join('/');
  if (lang) parts.push(lang);
  if (summary.git) {
    const g = summary.git;
    const sync = [g.ahead ? `${g.ahead} ahead` : '', g.behind ? `${g.behind} behind` : '', g.dirty ? `${g.dirty} changed` : '']
      .filter(Boolean)
      .join(', ');
    parts.push(`git ${g.branch ?? 'detached'}${g.remote ? ` from ${g.remote}` : ''}${sync ? ` (${sync})` : ''}`);
  }
  return parts.join('; ');
}

export function siteLine(site: Site, result: DiscoveryResult): string {
  const names = new Map(result.services.map((s) => [s.id, s.id]));
  const targets = site.proxies.map((proxy) => {
    const to = proxy.serviceIds.map((id) => names.get(id) ?? id);
    const where = to.length ? to.join(', ') : proxy.upstreams.map((u) => `${u.host}:${u.port}`).join(', ') || proxy.target;
    return `${proxy.location} -> ${where}`;
  });
  if (site.root) targets.push(`static files in ${site.root}`);
  return `${site.domains.join(', ') || '(no server_name)'} [${site.ssl ? 'https' : 'http'}]: ${targets.join('; ') || 'no proxy or root'}`;
}

export function describeService(result: DiscoveryResult, service: DiscoveredService): string {
  const project = projectOf(result, service);
  const lines = [serviceLine(summarizeService(result, service))];
  if (service.description) lines.push(`Description: ${service.description}`);
  if (service.command) lines.push(`Command: ${service.command}`);
  if (service.user) lines.push(`Runs as: ${service.user}`);
  if (service.pids.length) lines.push(`PID: ${service.pids.join(', ')}`);
  if (service.since) lines.push(`In this state since: ${service.since}`);
  if (service.restarts !== null) lines.push(`Restarts: ${service.restarts}`);
  if (service.autostart) lines.push(`Starts on boot: ${service.autostart}`);
  if (service.docker) lines.push(`Image: ${service.docker.image}${service.docker.composeProject ? `, compose project ${service.docker.composeProject} service ${service.docker.composeService}` : ''}`);
  if (service.pm2) lines.push(`PM2: ${service.pm2.mode ?? 'fork'} mode, ${service.pm2.instances} instance(s)`);
  if (project) {
    if (!project.exists) lines.push('Folder: missing or not readable');
    if (project.markers.length) lines.push(`Files: ${project.markers.join(', ')}`);
    if (project.scripts.length) lines.push(`package.json scripts: ${project.scripts.join(', ')}`);
    const git = project.git;
    if (git) {
      lines.push(`Git root: ${git.root}${git.upstream ? `, upstream ${git.upstream}` : ', no upstream'}${git.fetchedAt ? `, last fetch ${new Date(git.fetchedAt * 1000).toISOString()}` : ''}`);
      if (git.lastCommit) lines.push(`Last commit: ${git.lastCommit.hash.slice(0, 12)} ${git.lastCommit.subject}`);
    }
  }
  const sites = result.sites.filter((site) => site.proxies.some((p) => p.serviceIds.includes(service.id)));
  for (const site of sites) lines.push(`Site: ${siteLine(site, result)}`);
  return lines.join('\n');
}
