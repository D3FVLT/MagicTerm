import { useState } from 'react';
import type { Server } from '@magicterm/shared';
import { useServices } from '../contexts/ServicesContext';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import {
  describeAction,
  isRiskyAction,
  summarizeActionResult,
  type ActionRequest,
  type ActionResult,
} from '../../common/monitor/actions';

export interface ActionChoice {
  label: string;
  request: ActionRequest;
}

interface Finished {
  label: string;
  command: string;
  result?: ActionResult;
  error?: string;
  cancelled?: boolean;
  seconds: number;
}

/** "Restart api", but "Reload nginx" for a label that already names the target. */
function phrase(label: string, target: string): string {
  return label.toLowerCase().includes(target.toLowerCase()) ? label : `${label} ${target}`;
}

const WARNINGS: Record<string, string> = {
  stop: 'It stays down until someone starts it again.',
  restart: 'Requests in progress may fail while it restarts.',
  reload: 'If the new configuration is broken, the service may stop working.',
  nginx: 'nginx is reloaded only if nginx -t passes.',
};

/**
 * Buttons for service or nginx actions, the confirmation for risky ones, and the output
 * and exit code of the last run.
 */
export function ServiceActions({ server, address, loginUser, target, choices }: {
  server: Server;
  /** user@host, shown in the confirmation. */
  address: string;
  loginUser: string;
  /** What the actions apply to, e.g. "api" or "nginx". */
  target: string;
  choices: ActionChoice[];
}) {
  const { runAction } = useServices();
  const [confirming, setConfirming] = useState<ActionChoice | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [showStatus, setShowStatus] = useState(false);

  const run = async (choice: ActionChoice) => {
    setConfirming(null);
    setRunning(choice.label);
    setFinished(null);
    const started = Date.now();
    const command = describeAction(choice.request, loginUser);
    const outcome = await runAction(server.id, choice.request, phrase(choice.label, target).toLowerCase());
    setRunning(null);
    setShowStatus(Boolean(outcome.result && outcome.result.exitCode !== 0));
    setFinished({ label: choice.label, command, ...outcome, seconds: Math.round((Date.now() - started) / 100) / 10 });
  };

  if (choices.length === 0) return null;
  const result = finished?.result;
  const failed = Boolean(finished && (finished.error || (result && result.exitCode !== 0 && !finished.cancelled)));

  return (
    <div className="py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {choices.map((choice) => (
          <Button
            key={choice.label}
            variant="secondary"
            size="sm"
            disabled={running !== null}
            onClick={() => (isRiskyAction(choice.request) ? setConfirming(choice) : void run(choice))}
          >
            {running === choice.label ? `${choice.label}…` : choice.label}
          </Button>
        ))}
      </div>

      {finished && (
        <div className="mt-2 rounded-md border border-edge bg-app px-2 py-1.5 text-xs">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-fg-muted">{finished.command}</code>
            <span className={finished.cancelled ? 'text-fg-subtle' : failed ? 'text-red-500' : 'text-green-500'}>
              {finished.error ?? (finished.cancelled ? 'Cancelled: no password given.' : result ? summarizeActionResult(result) : '')}
            </span>
            <span className="text-fg-subtle">{finished.seconds} s</span>
            <button className="text-fg-subtle hover:text-fg" onClick={() => setFinished(null)} aria-label="Close">×</button>
          </div>
          {result?.output && !finished.cancelled && (
            <pre className="mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-fg">{result.output}</pre>
          )}
          {result?.status && (
            <>
              <button className="mt-1 text-fg-subtle hover:text-fg" onClick={() => setShowStatus(!showStatus)}>
                {showStatus ? 'Hide status' : 'Show status'}
              </button>
              {showStatus && (
                <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-fg-muted">{result.status}</pre>
              )}
            </>
          )}
        </div>
      )}

      <Modal
        isOpen={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        title={confirming ? `${phrase(confirming.label, target)}?` : ''}
      >
        {confirming && (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              Runs this on <span className="text-fg">{server.name}</span>
            </p>
            <p className="text-xs tabular-nums text-fg-subtle">{address}</p>
            <pre className="whitespace-pre-wrap break-all rounded-lg border border-warning bg-surface-2 px-3 py-2 font-mono text-xs text-fg">
              {describeAction(confirming.request, loginUser)}
            </pre>
            <p className="text-sm text-warning">
              {confirming.request.kind === 'nginx' ? WARNINGS.nginx : WARNINGS[confirming.request.action]}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" size="sm" onClick={() => setConfirming(null)}>Cancel</Button>
              <Button
                type="button"
                size="sm"
                variant={confirming.request.kind === 'service' && confirming.request.action === 'stop' ? 'danger' : 'primary'}
                onClick={() => void run(confirming)}
              >
                {confirming.label}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
