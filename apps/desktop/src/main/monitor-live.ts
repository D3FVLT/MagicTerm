import { IpcMain, WebContents } from 'electron';
import { IPC_CHANNELS, type SSHConnectionConfig } from '@magicterm/shared';
import { acquire, isConfig, release, runScript } from './monitor';
import { streamOnClient, type RunningStream } from './ssh-exec';
import { newNonce, splitSections } from '../common/monitor/script';
import {
  buildLogScript,
  buildSampleScript,
  buildSiteCheckScript,
  computeLive,
  followRunner,
  parseSample,
  parseSiteChecks,
  watchSpecFrom,
  type LiveSample,
  type SampleMemory,
  type SiteCheck,
  type WatchSpec,
} from '../common/monitor/live';
import type { DiscoveredService, DiscoveryResult } from '../common/monitor/types';
import { buildActionScript, parseActionOutput, type ActionRequest, type ActionResult } from '../common/monitor/actions';

const SAMPLE_EVERY_MS = 5_000;
/** Every sixth sample lists PM2 again, which starts node on the server. */
const SLOW_EVERY = 6;
const SITE_CHECK_EVERY_MS = 60_000;
const SAMPLE_TIMEOUT_MS = 20_000;
const SITE_CHECK_TIMEOUT_MS = 40_000;
const LOG_READ_TIMEOUT_MS = 30_000;
const MAX_LOG_READ_BYTES = 256 * 1024;
/** The script's own limit is 120 s per command, plus status and connection time. */
const ACTION_TIMEOUT_MS = 180_000;

interface Watcher {
  serverId: string;
  config: SSHConnectionConfig;
  discovery: DiscoveryResult;
  spec: WatchSpec;
  sender: WebContents;
  memory: SampleMemory | null;
  count: number;
  timer: NodeJS.Timeout | null;
  busy: boolean;
  sites: Record<string, SiteCheck>;
  checkingSites: boolean;
  lastSiteCheck: number;
  last: LiveSample | null;
  stopped: boolean;
}

const watchers = new Map<string, Watcher>();
const streams = new Map<string, { stream: RunningStream; sender: WebContents; release: () => void }>();

function send(sender: WebContents, channel: string, ...args: unknown[]): void {
  if (!sender.isDestroyed()) sender.send(channel, ...args);
}

async function checkSites(watcher: Watcher): Promise<void> {
  if (watcher.checkingSites || watcher.spec.sites.length === 0) return;
  watcher.checkingSites = true;
  watcher.lastSiteCheck = Date.now();
  const nonce = newNonce();
  try {
    const result = await runScript(watcher.serverId, watcher.config, buildSiteCheckScript(nonce, watcher.spec.sites), {
      timeoutMs: SITE_CHECK_TIMEOUT_MS,
    });
    watcher.sites = parseSiteChecks(result.stdout, nonce, watcher.spec.sites);
    if (watcher.last && !watcher.stopped) {
      watcher.last = { ...watcher.last, sites: watcher.sites };
      send(watcher.sender, IPC_CHANNELS.MONITOR_SAMPLE, watcher.serverId, watcher.last);
    }
  } catch {
    // The next sample reports the connection problem.
  } finally {
    watcher.checkingSites = false;
  }
}

async function sample(watcher: Watcher): Promise<void> {
  if (watcher.busy || watcher.stopped) return;
  watcher.busy = true;
  const slow = watcher.count % SLOW_EVERY === 0;
  const nonce = newNonce();
  try {
    const result = await runScript(watcher.serverId, watcher.config, buildSampleScript(nonce, watcher.spec, slow), {
      timeoutMs: SAMPLE_TIMEOUT_MS,
    });
    if (!result.stdout.includes(`@@${nonce} end`)) {
      throw new Error(result.timedOut ? 'The server took too long to answer.' : (result.stderr.trim().split('\n')[0] || 'No answer from the server'));
    }
    const raw = parseSample(result.stdout, nonce, slow);
    const { live, memory } = computeLive(watcher.discovery, watcher.spec, raw, watcher.memory);
    watcher.memory = memory;
    watcher.count++;
    watcher.last = { ...live, sites: watcher.sites, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : 'Sampling failed';
    // Keep the previous numbers, but mark them as stale.
    watcher.last = watcher.last
      ? { ...watcher.last, error: message }
      : { at: new Date().toISOString(), host: { load: null, cpuPercent: null, cpus: 0, memory: null, uptimeSeconds: null, disks: [] }, services: {}, sites: watcher.sites, error: message };
    watcher.memory = null;
  } finally {
    watcher.busy = false;
  }
  if (watcher.stopped) return;
  send(watcher.sender, IPC_CHANNELS.MONITOR_SAMPLE, watcher.serverId, watcher.last);
  if (Date.now() - watcher.lastSiteCheck >= SITE_CHECK_EVERY_MS) void checkSites(watcher);
}

function stopWatcher(serverId: string): void {
  const watcher = watchers.get(serverId);
  if (!watcher) return;
  watcher.stopped = true;
  if (watcher.timer) clearInterval(watcher.timer);
  watchers.delete(serverId);
}

function stopStream(streamId: string): void {
  const entry = streams.get(streamId);
  if (!entry) return;
  entry.stream.stop();
}

function forgetSender(sender: WebContents): void {
  for (const [serverId, watcher] of watchers) if (watcher.sender === sender) stopWatcher(serverId);
  for (const [streamId, entry] of streams) if (entry.sender === sender) stopStream(streamId);
}

const tracked = new WeakSet<WebContents>();
function track(sender: WebContents): void {
  if (tracked.has(sender)) return;
  tracked.add(sender);
  sender.once('destroyed', () => forgetSender(sender));
}

function isDiscovery(value: unknown): value is DiscoveryResult {
  const raw = value as DiscoveryResult | null;
  return Boolean(raw) && raw?.version === 1 && Array.isArray(raw.services) && Array.isArray(raw.sites);
}

function isService(value: unknown): value is DiscoveredService {
  const raw = value as DiscoveredService | null;
  return Boolean(raw) && typeof raw?.id === 'string' && typeof raw.kind === 'string' && Array.isArray(raw.pids);
}

function optionalPassword(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 1024 || /[\r\n]/.test(value)) return null;
  return value;
}

/** Log text without the section marker the script printed first. */
function logBody(output: string, nonce: string): string {
  const section = splitSections(output, nonce).find((s) => s.name === 'log');
  return section ? section.body : output;
}

/** One-shot log read, also used by the MCP tool. */
export async function readServiceLog(
  serverId: string,
  config: SSHConnectionConfig,
  service: DiscoveredService,
  lines: number,
  sudoPassword?: string
): Promise<{ text: string; truncated: boolean }> {
  const nonce = newNonce();
  const script = buildLogScript(nonce, service, { lines, follow: false });
  if (!script) return { text: 'MagicTerm knows no log for this service.', truncated: false };
  const result = await runScript(serverId, config, script, { timeoutMs: LOG_READ_TIMEOUT_MS, sudoPassword });
  let text = logBody(result.stdout, nonce);
  if (result.stderr.trim()) text += `${text ? '\n' : ''}${result.stderr.trim()}`;
  const truncated = result.truncated || Buffer.byteLength(text) > MAX_LOG_READ_BYTES;
  if (Buffer.byteLength(text) > MAX_LOG_READ_BYTES) text = text.slice(-MAX_LOG_READ_BYTES);
  return { text, truncated };
}

function isActionRequest(value: unknown): value is ActionRequest {
  const raw = value as Record<string, unknown> | null;
  if (!raw) return false;
  if (raw.kind === 'nginx') return (raw.action === 'test' || raw.action === 'reload') && typeof raw.systemd === 'boolean';
  return raw.kind === 'service'
    && isService(raw.service)
    && (raw.action === 'start' || raw.action === 'stop' || raw.action === 'restart' || raw.action === 'reload');
}

/** Runs one action; with no password, sudo is tried without one and the result says if it needs one. */
export async function runServiceAction(
  serverId: string,
  config: SSHConnectionConfig,
  request: ActionRequest,
  sudoPassword?: string
): Promise<ActionResult> {
  const nonce = newNonce();
  const script = buildActionScript(nonce, request);
  if (!script) throw new Error('MagicTerm will not run this action: the name has characters it does not pass to a shell.');
  const result = await runScript(serverId, config, script, { timeoutMs: ACTION_TIMEOUT_MS, sudoPassword });
  const parsed = parseActionOutput(result.stdout, nonce, result.timedOut);
  if (!parsed.output && result.stderr.trim()) parsed.output = result.stderr.trim().slice(-8000);
  // The next sample lists PM2 again and the site checks run, so the view catches up quickly.
  const watcher = watchers.get(serverId);
  if (watcher && !watcher.stopped) {
    watcher.count = 0;
    watcher.lastSiteCheck = 0;
    setTimeout(() => void sample(watcher), 1000);
  }
  return parsed;
}

export function stopAllLive(): void {
  for (const serverId of [...watchers.keys()]) stopWatcher(serverId);
  for (const streamId of [...streams.keys()]) stopStream(streamId);
}

export function setupMonitorLiveHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.MONITOR_WATCH, async (event, serverId: unknown, config: unknown, discovery: unknown) => {
    if (typeof serverId !== 'string' || !serverId || !isConfig(config) || !isDiscovery(discovery)) {
      return { success: false, error: 'Bad arguments' };
    }
    track(event.sender);
    const existing = watchers.get(serverId);
    if (existing && existing.discovery.scannedAt === discovery.scannedAt && existing.sender === event.sender) {
      if (existing.last) send(event.sender, IPC_CHANNELS.MONITOR_SAMPLE, serverId, existing.last);
      return { success: true };
    }
    stopWatcher(serverId);
    const watcher: Watcher = {
      serverId,
      config,
      discovery,
      spec: watchSpecFrom(discovery),
      sender: event.sender,
      memory: null,
      count: 0,
      timer: null,
      busy: false,
      sites: existing?.sites ?? {},
      checkingSites: false,
      lastSiteCheck: 0,
      last: null,
      stopped: false,
    };
    watchers.set(serverId, watcher);
    watcher.timer = setInterval(() => void sample(watcher), SAMPLE_EVERY_MS);
    void sample(watcher);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.MONITOR_UNWATCH, async (_event, serverId: unknown) => {
    if (typeof serverId === 'string') stopWatcher(serverId);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.MONITOR_CHECK_SITES, async (_event, serverId: unknown) => {
    const watcher = typeof serverId === 'string' ? watchers.get(serverId) : undefined;
    if (watcher) await checkSites(watcher);
    return { success: true };
  });

  ipcMain.handle(
    IPC_CHANNELS.MONITOR_LOGS_START,
    async (event, streamId: unknown, serverId: unknown, config: unknown, service: unknown, options: unknown) => {
      if (typeof streamId !== 'string' || !streamId || streams.has(streamId)) return { success: false, error: 'Bad stream id' };
      if (typeof serverId !== 'string' || !isConfig(config) || !isService(service)) return { success: false, error: 'Bad arguments' };
      const raw = (options ?? {}) as { lines?: unknown; sudoPassword?: unknown };
      const lines = typeof raw.lines === 'number' ? raw.lines : 200;
      const password = optionalPassword(raw.sudoPassword);
      if (password === null) return { success: false, error: 'Bad password' };
      const nonce = newNonce();
      const script = buildLogScript(nonce, service, { lines, follow: true });
      if (!script) return { success: false, error: 'MagicTerm knows no log for this service.' };
      track(event.sender);
      const entry = acquire(serverId, config);
      let released = false;
      const releaseOnce = () => {
        if (released) return;
        released = true;
        release(serverId, entry);
      };
      try {
        const client = await entry.client;
        let pending = '';
        let flushTimer: NodeJS.Timeout | null = null;
        let markerSeen = false;
        const flush = () => {
          flushTimer = null;
          if (!pending) return;
          let text = pending;
          pending = '';
          if (!markerSeen) {
            const marker = `@@${nonce} log\n`;
            const index = text.indexOf(marker);
            if (index === -1) {
              pending = text;
              return;
            }
            markerSeen = true;
            text = text.slice(index + marker.length);
          }
          if (text) send(event.sender, IPC_CHANNELS.MONITOR_LOG_DATA, streamId, text);
        };
        const stream = streamOnClient(client, followRunner(script), {
          stdin: `${password ?? ''}\n`,
          onData: (text) => {
            pending += text;
            if (pending.length > 512 * 1024) pending = pending.slice(-512 * 1024);
            flushTimer ??= setTimeout(flush, 100);
          },
          onClose: ({ exitCode, error }) => {
            if (flushTimer) clearTimeout(flushTimer);
            markerSeen = true;
            flush();
            streams.delete(streamId);
            releaseOnce();
            send(event.sender, IPC_CHANNELS.MONITOR_LOG_END, streamId, { exitCode, error });
          },
        });
        streams.set(streamId, { stream, sender: event.sender, release: releaseOnce });
        return { success: true };
      } catch (err) {
        releaseOnce();
        return { success: false, error: err instanceof Error ? err.message.slice(0, 300) : 'Could not open the log' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.MONITOR_ACTION,
    async (_event, serverId: unknown, config: unknown, request: unknown, sudoPassword: unknown) => {
      if (typeof serverId !== 'string' || !isConfig(config) || !isActionRequest(request)) return { success: false, error: 'Bad arguments' };
      const password = optionalPassword(sudoPassword);
      if (password === null) return { success: false, error: 'Bad password' };
      try {
        return { success: true, result: await runServiceAction(serverId, config, request, password) };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message.slice(0, 300) : 'The action failed' };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.MONITOR_LOGS_STOP, async (_event, streamId: unknown) => {
    if (typeof streamId === 'string') stopStream(streamId);
    return { success: true };
  });

  ipcMain.handle(
    IPC_CHANNELS.MONITOR_LOGS_READ,
    async (_event, serverId: unknown, config: unknown, service: unknown, lines: unknown, sudoPassword: unknown) => {
      if (typeof serverId !== 'string' || !isConfig(config) || !isService(service)) return { success: false, error: 'Bad arguments' };
      const password = optionalPassword(sudoPassword);
      if (password === null) return { success: false, error: 'Bad password' };
      const count = typeof lines === 'number' && lines >= 1 ? Math.min(lines, 5000) : 200;
      try {
        return { success: true, ...(await readServiceLog(serverId, config, service, count, password)) };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message.slice(0, 300) : 'Could not read the log' };
      }
    }
  );
}

