import { useEffect, useMemo, useRef, useState } from 'react';
import type { Server } from '@magicterm/shared';
import { useServices } from '../contexts/ServicesContext';
import { useDeploys, type DeployRun } from '../contexts/DeploysContext';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { SnippetVariablesModal } from './SnippetVariablesModal';
import { parseSnippetVariables } from '../lib/snippet-template';
import { useAuth } from '../contexts/AuthContext';
import { suggestScenario, validateScenario, type DeployRunRecord, type DeployScenario } from '../../common/monitor/deploy';
import type { DiscoveredService, DiscoveryResult } from '../../common/monitor/types';

const STEP_MARK: Record<string, string> = {
  pending: 'text-fg-subtle',
  running: 'text-accent',
  succeeded: 'text-green-500',
  failed: 'text-red-500',
  skipped: 'text-fg-subtle line-through',
};

const STATUS_TEXT: Record<string, string> = {
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  error: 'Stopped',
};

function seconds(ms: number | null): string {
  return ms === null ? '' : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function OutputBox({ text, follow }: { text: string; follow: boolean }) {
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text, follow]);
  return (
    <pre ref={box} className="mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md border border-edge bg-app px-2 py-1.5 font-mono text-[11px] text-fg">
      {text || ' '}
    </pre>
  );
}

function RunView({ run, onCancel }: { run: DeployRun; onCancel: () => void }) {
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 text-xs">
        <span className={run.status === 'succeeded' ? 'text-green-500' : run.status === 'running' ? 'text-accent' : 'text-red-500'}>
          {STATUS_TEXT[run.status]}
        </span>
        <span className="text-fg-subtle">started by {run.startedBy}</span>
        {run.error && <span className="text-red-500">{run.error}</span>}
        {run.historyError && <span className="text-warning">History: {run.historyError}</span>}
        {run.status === 'running' && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onCancel}>Cancel</Button>
        )}
      </div>
      <ol className="mt-1 space-y-0.5 text-xs">
        {run.steps.map((step, i) => (
          <li key={i} className="flex gap-2">
            <span className={`w-4 shrink-0 text-right ${STEP_MARK[step.state]}`}>{i + 1}</span>
            <code className={`min-w-0 flex-1 truncate font-mono ${STEP_MARK[step.state]}`}>{step.command}</code>
            <span className="shrink-0 tabular-nums text-fg-subtle">
              {step.state === 'running' ? 'running' : step.exitCode !== null ? `exit ${step.exitCode}` : ''} {seconds(step.durationMs)}
            </span>
          </li>
        ))}
      </ol>
      <OutputBox text={run.output} follow={run.status === 'running'} />
    </div>
  );
}

function HistoryList({ records }: { records: DeployRunRecord[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (records.length === 0) return <p className="text-xs text-fg-subtle">No deploys yet.</p>;
  return (
    <div>
      {records.slice(0, 10).map((record) => {
        const failedStep = record.steps.findIndex((s) => s.exitCode !== null && s.exitCode !== 0);
        const total = record.steps.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
        return (
          <div key={record.id}>
            <button
              onClick={() => setOpen(open === record.id ? null : record.id)}
              className="flex h-7 w-full items-center gap-3 text-left text-xs hover:bg-surface-2"
            >
              <span className="w-36 shrink-0 tabular-nums text-fg-subtle">{record.startedAt.replace('T', ' ').slice(0, 19)}</span>
              <span className={`w-20 shrink-0 ${record.status === 'succeeded' ? 'text-green-500' : 'text-red-500'}`}>{STATUS_TEXT[record.status]}</span>
              <span className="w-32 shrink-0 truncate text-fg-subtle">{record.startedBy}</span>
              <span className="min-w-0 flex-1 truncate text-fg-subtle">
                {failedStep >= 0 ? `step ${failedStep + 1}: ${record.steps[failedStep].command}` : `${record.steps.length} steps`}
              </span>
              <span className="shrink-0 tabular-nums text-fg-subtle">{seconds(total)}</span>
            </button>
            {open === record.id && <OutputBox text={record.output} follow={false} />}
          </div>
        );
      })}
    </div>
  );
}

/** Deploy scenario, runs and history of one service. */
export function DeployPanel({ server, service, discovery, canManage, address }: {
  server: Server;
  service: DiscoveredService;
  discovery: DiscoveryResult;
  canManage: boolean;
  address: string;
}) {
  const { scenarioFor, saveScenario } = useServices();
  const { latestRun, startDeploy, cancelDeploy, history, historyError, loadHistory } = useDeploys();
  const { user, isLocalOnly } = useAuth();
  const me = isLocalOnly ? 'you' : (user?.email ?? 'you');
  const saved = scenarioFor(server.id, service.id);
  const suggested = useMemo(() => suggestScenario(discovery, service), [discovery, service]);
  const scenario = saved ?? suggested;
  const [editing, setEditing] = useState(false);
  const [cwd, setCwd] = useState('');
  const [stepsText, setStepsText] = useState('');
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const [confirm, setConfirm] = useState<DeployScenario | null>(null);
  const run = latestRun(server.id, service.id);
  const records = (history(server.id) ?? []).filter((r) => r.serviceId === service.id);

  useEffect(() => {
    void loadHistory(server.id);
  }, [server.id, loadHistory]);

  const beginEdit = (from: DeployScenario | null) => {
    setCwd(from?.cwd ?? service.cwd ?? '');
    setStepsText((from?.steps ?? []).join('\n'));
    setError('');
    setEditing(true);
  };

  const save = async () => {
    const next: DeployScenario = { cwd: cwd.trim(), steps: stepsText.split('\n').map((s) => s.trim()).filter(Boolean), updatedAt: new Date().toISOString() };
    const problem = validateScenario(next);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      await saveScenario(server.id, service.id, next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  };

  const template = scenario ? scenario.steps.join('\n') : '';
  const variables = useMemo(() => parseSnippetVariables(`${scenario?.cwd ?? ''}\n${template}`), [scenario, template]);

  const confirmWith = (filledSteps: string, filledCwd: string) => {
    if (!scenario) return;
    setConfirm({ cwd: filledCwd, steps: filledSteps.split('\n'), updatedAt: scenario.updatedAt });
  };

  return (
    <div className="mt-3 border-t border-edge pt-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-fg-subtle">Deploy</span>
        {!saved && scenario && <span className="text-xs text-fg-subtle">suggested from the project, not saved</span>}
        {canManage && !editing && (
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => beginEdit(scenario)}>{scenario ? 'Edit' : 'Add steps'}</Button>
            {scenario && (
              <Button
                variant="secondary"
                size="sm"
                disabled={run?.status === 'running'}
                onClick={() => (variables.length ? setAsking(true) : confirmWith(template, scenario.cwd))}
              >
                Run deploy
              </Button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <div className="mt-1.5 space-y-1.5">
          <label className="flex items-center gap-2 text-xs text-fg-subtle">
            Folder
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              className="min-w-0 flex-1 border-b border-edge bg-transparent py-0.5 font-mono text-xs text-fg outline-none focus:border-accent"
            />
          </label>
          <textarea
            value={stepsText}
            onChange={(e) => setStepsText(e.target.value)}
            rows={Math.max(4, stepsText.split('\n').length + 1)}
            spellCheck={false}
            placeholder="One command per line, e.g. git pull --ff-only"
            className="w-full rounded-md border border-edge bg-app px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent"
          />
          <p className="text-xs text-fg-subtle">
            One command per line, run as {discovery.host.user} in a login shell; the deploy stops at the first that fails.
            {' '}Use {'{{name}}'} for values asked at each run. git and sudo prompts are asked in MagicTerm.
          </p>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={() => void save()}>Save</Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            {suggested && <Button variant="ghost" size="sm" onClick={() => beginEdit(suggested)}>Use suggestion</Button>}
            {saved && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => {
                  void saveScenario(server.id, service.id, null).then(() => setEditing(false));
                }}
              >
                Delete scenario
              </Button>
            )}
          </div>
        </div>
      ) : scenario ? (
        !run && (
          <div className="mt-1 text-xs">
            <div className="text-fg-subtle">in <code className="font-mono">{scenario.cwd}</code></div>
            <ol className="mt-0.5 space-y-0.5">
              {scenario.steps.map((step, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-4 shrink-0 text-right text-fg-subtle">{i + 1}</span>
                  <code className="min-w-0 flex-1 truncate font-mono text-fg">{step}</code>
                </li>
              ))}
            </ol>
          </div>
        )
      ) : (
        <p className="mt-1 text-xs text-fg-subtle">No scenario. MagicTerm found no project to suggest one from.</p>
      )}

      {run && <RunView run={run} onCancel={() => cancelDeploy(run.id)} />}

      <div className="mt-2">
        <div className="pb-0.5 text-xs text-fg-subtle">History</div>
        {historyError(server.id) ? <p className="text-xs text-warning">{historyError(server.id)}</p> : <HistoryList records={records} />}
      </div>

      {asking && scenario && (
        <SnippetVariablesModal
          snippetName={`Deploy ${service.name}`}
          template={`${scenario.cwd}\n${template}`}
          variables={variables}
          initialValues={{}}
          submitLabel="Next"
          onCancel={() => setAsking(false)}
          onSubmit={(result) => {
            setAsking(false);
            const [filledCwd, ...rest] = result.split('\n');
            confirmWith(rest.join('\n'), filledCwd);
          }}
        />
      )}

      <Modal isOpen={Boolean(confirm)} onClose={() => setConfirm(null)} title={`Deploy ${service.name}?`} size="lg">
        {confirm && (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              Runs these steps on <span className="text-fg">{server.name}</span> in <code className="font-mono text-fg">{confirm.cwd}</code>, stopping at the first that fails.
            </p>
            <p className="text-xs tabular-nums text-fg-subtle">{address}</p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-warning bg-surface-2 px-3 py-2 font-mono text-xs text-fg">
              {confirm.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
            </pre>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" size="sm" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  const chosen = confirm;
                  setConfirm(null);
                  void startDeploy(server.id, service.id, chosen, me);
                }}
              >
                Deploy
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

