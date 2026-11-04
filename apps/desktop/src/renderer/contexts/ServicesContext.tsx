import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Server, SSHConnectionConfig } from '@magicterm/shared';
import { useServers } from './ServersContext';
import { useOrganizations } from './OrganizationsContext';
import { useHostKey } from './HostKeyContext';
import { emptyMonitorConfig, type MonitorConfig } from '../../common/monitor/config';
import type { DiscoveryResult } from '../../common/monitor/types';
import type { LiveSample } from '../../common/monitor/live';
import type { ActionRequest, ActionResult } from '../../common/monitor/actions';
import type { DeployScenario } from '../../common/monitor/deploy';
import { SecretPrompt, type SecretRequest } from '../components/SecretPrompt';
export type { SecretRequest };

interface ScanState {
  scanning: boolean;
  error: string | null;
  /** Newer than the saved scan: from this session, or not saved because the user is a viewer. */
  discovery: DiscoveryResult | null;
}

interface ServicesContextValue {
  /** Servers of the open vault that are in the Services tab. */
  monitored: Server[];
  /** Viewers can look and scan, but not add, remove or save. */
  canManage: boolean;
  discoveryFor: (serverId: string) => DiscoveryResult | null;
  scanStateFor: (serverId: string) => ScanState;
  addServer: (serverId: string) => Promise<void>;
  removeServer: (serverId: string) => Promise<void>;
  /**
   * Runs discovery. The sudo password, if given, is used for this scan only and not kept.
   * `askHostKey` shows the host-key dialog for an untrusted server; off for AI tools.
   */
  scan: (serverId: string, options?: { sudoPassword?: string; askHostKey?: boolean }) => Promise<DiscoveryResult | null>;
  connectionConfig: (server: Server) => Promise<SSHConnectionConfig>;
  /** Latest live sample while the server is watched. */
  liveFor: (serverId: string) => LiveSample | null;
  /** Starts sampling the server; call the returned function to stop. */
  watch: (serverId: string, discovery: DiscoveryResult) => () => void;
  /**
   * Asks the user for the sudo password of the server's login user, for one use.
   * `purpose` finishes the sentence "MagicTerm needs it to …". Resolves to null on cancel.
   */
  askSudo: (serverId: string, purpose: string, error?: string, timeoutMs?: number) => Promise<string | null>;
  /** Asks for any one-time secret, such as a git token. Resolves to null on cancel or after `timeoutMs`. */
  askSecret: (request: SecretRequest, timeoutMs?: number) => Promise<string | null>;
  /** Saves the deploy scenario of one service; null removes it. */
  saveScenario: (serverId: string, serviceId: string, scenario: DeployScenario | null) => Promise<void>;
  scenarioFor: (serverId: string, serviceId: string) => DeployScenario | null;
  /**
   * Runs an action. sudo is tried without a password first; if it needs one, the user is
   * asked in MagicTerm (twice at most), and the password is used for this action only.
   */
  runAction: (serverId: string, request: ActionRequest, purpose: string, options?: { promptTimeoutMs?: number }) => Promise<ActionOutcome>;
}

export interface ActionOutcome {
  result?: ActionResult;
  error?: string;
  /** The user closed the password prompt. */
  cancelled?: boolean;
}

const IDLE: ScanState = { scanning: false, error: null, discovery: null };

const ServicesContext = createContext<ServicesContextValue | null>(null);

export function useServices() {
  const context = useContext(ServicesContext);
  if (!context) throw new Error('useServices must be used within a ServicesProvider');
  return context;
}

export function ServicesProvider({ children }: { children: ReactNode }) {
  const { servers, decryptServerHost, decryptServerUsername, decryptServerCredentials, decryptServerMonitor, saveServerMonitor } =
    useServers();
  const { currentOrg } = useOrganizations();
  const { verifyHostKey } = useHostKey();
  const canManage = !currentOrg || currentOrg.role !== 'viewer';
  const [configs, setConfigs] = useState<Record<string, MonitorConfig>>({});
  const [scans, setScans] = useState<Record<string, ScanState>>({});
  const [live, setLive] = useState<Record<string, LiveSample>>({});
  const [prompts, setPrompts] = useState<{ id: string; request: SecretRequest; resolve: (value: string | null) => void }[]>([]);

  useEffect(
    () => window.electronAPI.monitor.onSample((serverId, sample) => setLive((prev) => ({ ...prev, [serverId]: sample }))),
    []
  );
  const configsRef = useRef(configs);
  configsRef.current = configs;

  const monitored = servers.filter((server) => Boolean(server.monitor));

  // Decrypt saved configs whenever a server's ciphertext changes (own saves and teammates').
  const cipherKey = monitored.map((s) => `${s.id}:${s.monitor?.length ?? 0}:${s.updatedAt}`).join('|');
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      monitored.map(async (server) => [server.id, await decryptServerMonitor(server).catch(() => null)] as const)
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, MonitorConfig> = {};
      for (const [id, config] of entries) if (config) next[id] = config;
      setConfigs(next);
    });
    return () => {
      cancelled = true;
    };
  }, [cipherKey]);

  // Another vault was opened: forget scans of servers that are gone.
  useEffect(() => {
    const ids = new Set(servers.map((s) => s.id));
    setScans((prev) => {
      const stale = Object.keys(prev).filter((id) => !ids.has(id));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      for (const id of stale) {
        delete next[id];
        void window.electronAPI.monitor.disconnect(id);
      }
      return next;
    });
  }, [servers]);

  const connectionConfig = useCallback(
    async (server: Server): Promise<SSHConnectionConfig> => {
      const credentials = await decryptServerCredentials(server);
      return {
        host: await decryptServerHost(server),
        port: server.port,
        username: await decryptServerUsername(server),
        authType: server.authType,
        ...(server.authType === 'password' ? { password: credentials } : { privateKey: credentials }),
      };
    },
    [decryptServerCredentials, decryptServerHost, decryptServerUsername]
  );

  const setScan = (serverId: string, patch: Partial<ScanState>) =>
    setScans((prev) => ({ ...prev, [serverId]: { ...(prev[serverId] ?? IDLE), ...patch } }));

  const scan = useCallback(
    async (serverId: string, options: { sudoPassword?: string; askHostKey?: boolean } = {}): Promise<DiscoveryResult | null> => {
      const server = servers.find((s) => s.id === serverId);
      if (!server) return null;
      setScan(serverId, { scanning: true, error: null });
      try {
        const config = await connectionConfig(server);
        let response = await window.electronAPI.monitor.discover(serverId, config, options.sudoPassword);
        if (response.hostKey && options.askHostKey && await verifyHostKey(response.hostKey)) {
          response = await window.electronAPI.monitor.discover(serverId, config, options.sudoPassword);
        }
        if (!response.success || !response.result) {
          setScan(serverId, { scanning: false, error: response.error || 'Scan failed' });
          return null;
        }
        const result = response.result;
        setScan(serverId, { scanning: false, error: null, discovery: result });
        if (canManage && server.monitor) {
          const saved = configsRef.current[serverId] ?? emptyMonitorConfig();
          await saveServerMonitor(serverId, { ...saved, discovery: result }).catch((err: unknown) => {
            setScan(serverId, { error: `Scanned, but not saved: ${err instanceof Error ? err.message : 'error'}` });
          });
        }
        return result;
      } catch (err) {
        setScan(serverId, { scanning: false, error: err instanceof Error ? err.message : 'Scan failed' });
        return null;
      }
    },
    [servers, connectionConfig, canManage, saveServerMonitor, verifyHostKey]
  );

  const addServer = useCallback(
    async (serverId: string) => {
      await saveServerMonitor(serverId, emptyMonitorConfig());
    },
    [saveServerMonitor]
  );

  const removeServer = useCallback(
    async (serverId: string) => {
      await saveServerMonitor(serverId, null);
      setScans((prev) => {
        const next = { ...prev };
        delete next[serverId];
        return next;
      });
      void window.electronAPI.monitor.disconnect(serverId);
    },
    [saveServerMonitor]
  );

  const discoveryFor = useCallback(
    (serverId: string) => {
      const live = scans[serverId]?.discovery ?? null;
      const saved = configs[serverId]?.discovery ?? null;
      if (live && saved) return live.scannedAt >= saved.scannedAt ? live : saved;
      return live ?? saved;
    },
    [scans, configs]
  );

  const scanStateFor = useCallback((serverId: string) => scans[serverId] ?? IDLE, [scans]);

  const liveFor = useCallback((serverId: string) => live[serverId] ?? null, [live]);

  const askSecret = useCallback(
    (request: SecretRequest, timeoutMs?: number) =>
      new Promise<string | null>((resolve) => {
        const id = crypto.randomUUID();
        let timer: number | null = null;
        const done = (value: string | null) => {
          if (timer !== null) window.clearTimeout(timer);
          resolve(value);
        };
        // An unanswered prompt for an AI tool is withdrawn, so a late answer cannot run an action the tool gave up on.
        if (timeoutMs) {
          timer = window.setTimeout(() => {
            setPrompts((prev) => prev.filter((p) => p.id !== id));
            resolve(null);
          }, timeoutMs);
        }
        setPrompts((prev) => [...prev, { id, request, resolve: done }]);
      }),
    []
  );

  const askSudo = useCallback(
    (serverId: string, purpose: string, error?: string, timeoutMs?: number) => {
      const server = servers.find((s) => s.id === serverId);
      const user = (scans[serverId]?.discovery ?? configs[serverId]?.discovery)?.host.user ?? 'the login user';
      return askSecret({
        title: 'sudo password',
        description: `MagicTerm needs the sudo password of ${user} on ${server?.name ?? 'the server'} to ${purpose}. It goes to sudo on stdin, for this time only, and is not saved.`,
        error,
        submitLabel: 'Continue',
      }, timeoutMs);
    },
    [servers, scans, configs, askSecret]
  );

  const scenarioFor = useCallback(
    (serverId: string, serviceId: string) => configs[serverId]?.scenarios[serviceId] ?? null,
    [configs]
  );

  const saveScenario = useCallback(
    async (serverId: string, serviceId: string, scenario: DeployScenario | null) => {
      const current = configsRef.current[serverId] ?? emptyMonitorConfig();
      const scenarios = { ...current.scenarios };
      if (scenario) scenarios[serviceId] = scenario;
      else delete scenarios[serviceId];
      const next = { ...current, scenarios };
      setConfigs((prev) => ({ ...prev, [serverId]: next }));
      await saveServerMonitor(serverId, next);
    },
    [saveServerMonitor]
  );

  const promptsRef = useRef(prompts);
  promptsRef.current = prompts;
  const answerPrompt = (value: string | null) => {
    const current = promptsRef.current[0];
    setPrompts((prev) => prev.slice(1));
    current?.resolve(value);
  };

  const runAction = useCallback(
    async (serverId: string, request: ActionRequest, purpose: string, options: { promptTimeoutMs?: number } = {}): Promise<ActionOutcome> => {
      const server = servers.find((s) => s.id === serverId);
      if (!server) return { error: 'The server is not in the open vault.' };
      const config = await connectionConfig(server);
      let password: string | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await window.electronAPI.monitor.action(serverId, config, request, password);
        if (!response.success || !response.result) return { error: response.error ?? 'The action failed' };
        const result = response.result;
        if (!result.needsSudo && !result.wrongPassword) return { result };
        if (attempt === 2) return { result };
        const typed = await askSudo(
          serverId,
          purpose,
          result.wrongPassword ? 'sudo did not accept that password.' : undefined,
          options.promptTimeoutMs
        );
        if (!typed) return { cancelled: true, result };
        password = typed;
      }
      return { error: 'The action failed' };
    },
    [servers, connectionConfig, askSudo]
  );

  const watch = useCallback(
    (serverId: string, discovery: DiscoveryResult) => {
      let stopped = false;
      const server = servers.find((s) => s.id === serverId);
      if (server) {
        void connectionConfig(server).then((config) => {
          if (!stopped) void window.electronAPI.monitor.watch(serverId, config, discovery);
        });
      }
      return () => {
        stopped = true;
        void window.electronAPI.monitor.unwatch(serverId);
      };
    },
    [servers, connectionConfig]
  );

  return (
    <ServicesContext.Provider
      value={{
        monitored, canManage, discoveryFor, scanStateFor, addServer, removeServer, scan, connectionConfig, liveFor, watch, askSudo, runAction,
        askSecret, saveScenario, scenarioFor,
      }}
    >
      {children}
      <SecretPrompt request={prompts[0]?.request ?? null} onAnswer={answerPrompt} />
    </ServicesContext.Provider>
  );
}
