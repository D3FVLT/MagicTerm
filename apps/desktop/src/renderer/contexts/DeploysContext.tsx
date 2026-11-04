import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cryptoManager } from '@magicterm/crypto';
import { createDeployRun, listDeployRuns } from '@magicterm/supabase-client';
import { useServices } from './ServicesContext';
import { useServers } from './ServersContext';
import { useAuth } from './AuthContext';
import { getLocalDocument } from '../lib/local-vault-session';
import { addLocalDeployRun } from '../lib/local-vault-data';
import {
  RECORD_OUTPUT_BYTES,
  type DeployRunEvent,
  type DeployRunRecord,
  type DeployScenario,
  type DeployStatus,
} from '../../common/monitor/deploy';

const MAX_OUTPUT = 512 * 1024;
/** The askpass helper on the server gives up after 130 s; the prompt closes a little earlier. */
const PROMPT_TIMEOUT_MS = 125_000;

export interface DeployStepState {
  command: string;
  state: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  exitCode: number | null;
  startedAt: number | null;
  durationMs: number | null;
}

export interface DeployRun {
  id: string;
  serverId: string;
  serviceId: string;
  cwd: string;
  steps: DeployStepState[];
  output: string;
  status: DeployStatus;
  error: string | null;
  startedBy: string;
  startedAt: string;
  finishedAt: string | null;
  /** Set when the run could not be added to history. */
  historyError: string | null;
}

interface DeploysContextValue {
  /** The newest run of a service in this session, running or finished. */
  latestRun: (serverId: string, serviceId: string) => DeployRun | null;
  /**
   * Starts a scenario whose {{variables}} are already filled in. Resolves when the run ends.
   * git and sudo prompts are asked in MagicTerm while it runs.
   */
  startDeploy: (serverId: string, serviceId: string, scenario: DeployScenario, startedBy: string) => Promise<DeployRun>;
  cancelDeploy: (runId: string) => void;
  /** Saved history of a server, newest first, decrypted. */
  history: (serverId: string) => DeployRunRecord[] | null;
  historyError: (serverId: string) => string | null;
  loadHistory: (serverId: string) => Promise<void>;
}

const DeploysContext = createContext<DeploysContextValue | null>(null);

export function useDeploys() {
  const context = useContext(DeploysContext);
  if (!context) throw new Error('useDeploys must be used within a DeploysProvider');
  return context;
}

function recordFrom(run: DeployRun): DeployRunRecord {
  const output = run.output.length > RECORD_OUTPUT_BYTES ? run.output.slice(-RECORD_OUTPUT_BYTES) : run.output;
  return {
    id: run.id,
    serverId: run.serverId,
    serviceId: run.serviceId,
    cwd: run.cwd,
    steps: run.steps.map((s) => ({ command: s.command, exitCode: s.exitCode, durationMs: s.durationMs })),
    status: run.status === 'running' ? 'error' : run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? new Date().toISOString(),
    startedBy: run.startedBy,
    output,
  };
}

export function DeploysProvider({ children }: { children: ReactNode }) {
  const { connectionConfig, askSecret } = useServices();
  const { servers } = useServers();
  const { isLocalOnly, user } = useAuth();
  const [runs, setRuns] = useState<Record<string, DeployRun>>({});
  const runsRef = useRef(runs);
  const waiters = useRef(new Map<string, (run: DeployRun) => void>());
  const [histories, setHistories] = useState<Record<string, DeployRunRecord[]>>({});
  const [historyErrors, setHistoryErrors] = useState<Record<string, string>>({});

  // The ref is updated at once, so events handled in the same tick (step-end, then done) see each other.
  const update = (runId: string, change: (run: DeployRun) => DeployRun) => {
    const current = runsRef.current[runId];
    if (!current) return;
    const next = { ...runsRef.current, [runId]: change(current) };
    runsRef.current = next;
    setRuns(next);
  };

  const loadHistory = useCallback(
    async (serverId: string) => {
      try {
        const rows = isLocalOnly
          ? (getLocalDocument()?.deployRuns ?? []).filter((r) => r.serverId === serverId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          : await listDeployRuns(serverId);
        const records = (
          await Promise.all(rows.map(async (row) => {
            try {
              return JSON.parse(await cryptoManager.decrypt(row.payload)) as DeployRunRecord;
            } catch {
              return null;
            }
          }))
        ).filter((r): r is DeployRunRecord => r !== null);
        setHistories((prev) => ({ ...prev, [serverId]: records }));
        setHistoryErrors((prev) => {
          const next = { ...prev };
          delete next[serverId];
          return next;
        });
      } catch (err) {
        setHistoryErrors((prev) => ({ ...prev, [serverId]: err instanceof Error ? err.message : 'Could not load the history' }));
      }
    },
    [isLocalOnly]
  );

  const finish = useCallback(
    async (runId: string, status: Exclude<DeployStatus, 'running'>, error: string | null) => {
      const current = runsRef.current[runId];
      if (!current || current.status !== 'running') return;
      const finished: DeployRun = {
        ...current,
        status,
        error,
        finishedAt: new Date().toISOString(),
        steps: current.steps.map((s) => (s.state === 'pending' ? { ...s, state: 'skipped' } : s.state === 'running' ? { ...s, state: 'failed' } : s)),
      };
      runsRef.current = { ...runsRef.current, [runId]: finished };
      setRuns((prev) => ({ ...prev, [runId]: finished }));
      try {
        const payload = await cryptoManager.encrypt(JSON.stringify(recordFrom(finished)));
        if (isLocalOnly) await addLocalDeployRun(finished.serverId, payload, user?.id ?? 'local');
        else await createDeployRun(finished.serverId, payload);
        void loadHistory(finished.serverId);
      } catch (err) {
        update(runId, (run) => ({ ...run, historyError: err instanceof Error ? err.message : 'Not saved to history' }));
      }
      waiters.current.get(runId)?.(runsRef.current[runId] ?? finished);
      waiters.current.delete(runId);
    },
    [isLocalOnly, user, loadHistory]
  );

  useEffect(() => window.electronAPI.monitor.onDeployEvent((runId, event: DeployRunEvent) => {
    const run = runsRef.current[runId];
    if (!run) return;
    const now = Date.now();
    switch (event.type) {
      case 'output':
        update(runId, (r) => {
          const output = r.output + event.text;
          return { ...r, output: output.length > MAX_OUTPUT ? output.slice(-MAX_OUTPUT) : output };
        });
        break;
      case 'step':
        update(runId, (r) => ({
          ...r,
          steps: r.steps.map((s, i) => (i === event.index ? { ...s, state: 'running', startedAt: now } : s)),
        }));
        break;
      case 'step-end':
        update(runId, (r) => ({
          ...r,
          steps: r.steps.map((s, i) => (i === event.index
            ? { ...s, state: event.exitCode === 0 ? 'succeeded' : 'failed', exitCode: event.exitCode, durationMs: s.startedAt ? now - s.startedAt : null }
            : s)),
        }));
        break;
      case 'ask': {
        const server = servers.find((s) => s.id === run.serverId);
        const sudo = /sudo/i.test(event.prompt);
        void askSecret({
          title: sudo ? 'sudo password' : event.secret ? 'Git password or token' : 'Git user name',
          description: `The deploy on ${server?.name ?? 'the server'} asks: "${event.prompt.trim()}" It goes to ${sudo ? 'sudo' : 'git'} through a private pipe on the server, for this run only, and is not saved.`,
          submitLabel: 'Continue',
          secret: event.secret,
        }, PROMPT_TIMEOUT_MS).then((value) => window.electronAPI.monitor.answerDeploy(runId, event.askId, value));
        break;
      }
      case 'done':
        void finish(runId, event.exitCode === 0 ? 'succeeded' : 'failed', null);
        break;
      case 'cancelled':
        void finish(runId, 'cancelled', null);
        break;
      case 'fail':
        update(runId, (r) => ({ ...r, error: event.reason }));
        break;
      case 'closed':
        // Closed without a done marker: the connection dropped or the script could not start.
        void finish(runId, 'error', event.error ?? runsRef.current[runId]?.error ?? 'The connection closed before the deploy finished.');
        break;
    }
  }), [askSecret, finish, servers]);

  const startDeploy = useCallback(
    async (serverId: string, serviceId: string, scenario: DeployScenario, startedBy: string): Promise<DeployRun> => {
      const server = servers.find((s) => s.id === serverId);
      const id = crypto.randomUUID();
      const steps = scenario.steps.map((s) => s.trim()).filter(Boolean);
      const run: DeployRun = {
        id,
        serverId,
        serviceId,
        cwd: scenario.cwd,
        steps: steps.map((command) => ({ command, state: 'pending', exitCode: null, startedAt: null, durationMs: null })),
        output: '',
        status: 'running',
        error: null,
        startedBy,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        historyError: null,
      };
      runsRef.current = { ...runsRef.current, [id]: run };
      setRuns((prev) => ({ ...prev, [id]: run }));
      const done = new Promise<DeployRun>((resolve) => waiters.current.set(id, resolve));
      if (!server) {
        void finish(id, 'error', 'The server is not in the open vault.');
        return done;
      }
      const config = await connectionConfig(server);
      const response = await window.electronAPI.monitor.startDeploy(id, serverId, config, { ...scenario, steps });
      if (!response.success) void finish(id, 'error', response.error ?? 'Could not start the deploy');
      return done;
    },
    [servers, connectionConfig, finish]
  );

  const cancelDeploy = useCallback((runId: string) => {
    void window.electronAPI.monitor.cancelDeploy(runId);
  }, []);

  const latestRun = useCallback(
    (serverId: string, serviceId: string) =>
      Object.values(runs)
        .filter((r) => r.serverId === serverId && r.serviceId === serviceId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null,
    [runs]
  );

  const history = useCallback((serverId: string) => histories[serverId] ?? null, [histories]);
  const historyError = useCallback((serverId: string) => historyErrors[serverId] ?? null, [historyErrors]);

  return (
    <DeploysContext.Provider value={{ latestRun, startDeploy, cancelDeploy, history, historyError, loadHistory }}>
      {children}
    </DeploysContext.Provider>
  );
}
