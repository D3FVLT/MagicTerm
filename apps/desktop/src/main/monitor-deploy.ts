import { IpcMain, WebContents } from 'electron';
import { randomUUID } from 'crypto';
import { IPC_CHANNELS } from '@magicterm/shared';
import { acquire, isConfig, release } from './monitor';
import { runOnClient, streamOnClient, type RunningStream } from './ssh-exec';
import { newNonce } from '../common/monitor/script';
import {
  answerCommand,
  buildDeployScript,
  createDeployParser,
  deployInput,
  deployRunner,
  validateScenario,
  type DeployEvent,
  type DeployRunEvent,
  type DeployScenario,
} from '../common/monitor/deploy';


interface Run {
  stream: RunningStream;
  sender: WebContents;
  tmpDir: string | null;
  asks: Set<string>;
  client: import('ssh2').Client;
  finished: boolean;
}

const runs = new Map<string, Run>();

function send(sender: WebContents, runId: string, event: DeployRunEvent): void {
  if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.MONITOR_DEPLOY_EVENT, runId, event);
}

function isScenario(value: unknown): value is DeployScenario {
  const raw = value as DeployScenario | null;
  return Boolean(raw) && typeof raw?.cwd === 'string' && Array.isArray(raw.steps) && raw.steps.every((s) => typeof s === 'string');
}

export function cancelAllDeploys(): void {
  for (const run of runs.values()) run.stream.stop();
}

export function setupMonitorDeployHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    IPC_CHANNELS.MONITOR_DEPLOY_START,
    async (event, runId: unknown, serverId: unknown, config: unknown, scenario: unknown) => {
      if (typeof runId !== 'string' || !runId || runs.has(runId)) return { success: false, error: 'Bad run id' };
      if (typeof serverId !== 'string' || !isConfig(config) || !isScenario(scenario)) return { success: false, error: 'Bad arguments' };
      const problem = validateScenario(scenario);
      if (problem) return { success: false, error: problem };

      const sender = event.sender;
      const nonce = newNonce();
      const entry = acquire(serverId, config);
      let released = false;
      const releaseOnce = () => {
        if (released) return;
        released = true;
        release(serverId, entry);
      };
      try {
        const client = await entry.client;
        const parser = createDeployParser(nonce);
        let pendingText = '';
        let flushTimer: NodeJS.Timeout | null = null;
        const flushText = () => {
          if (flushTimer) clearTimeout(flushTimer);
          flushTimer = null;
          if (pendingText) send(sender, runId, { type: 'output', text: pendingText });
          pendingText = '';
        };
        const handle = (events: DeployEvent[]) => {
          const run = runs.get(runId);
          for (const item of events) {
            if (item.type === 'output') {
              pendingText += item.text;
              if (pendingText.length > 256 * 1024) pendingText = pendingText.slice(-256 * 1024);
              flushTimer ??= setTimeout(flushText, 100);
              continue;
            }
            flushText();
            if (item.type === 'tmp') {
              if (run) run.tmpDir = item.dir;
            } else if (item.type === 'ask') {
              const askId = randomUUID();
              run?.asks.add(askId);
              send(sender, runId, { type: 'ask', askId, prompt: item.prompt.slice(0, 200), secret: item.secret });
            } else {
              send(sender, runId, item);
              if (item.type === 'done' && run) {
                run.finished = true;
                // Closing stdin lets the script's cancel watcher exit.
                run.stream.stop();
              }
            }
          }
        };
        const stream = streamOnClient(client, deployRunner(nonce), {
          stdin: deployInput(buildDeployScript(nonce, scenario), nonce),
          onData: (text) => handle(parser.push(text)),
          onClose: ({ error }) => {
            handle(parser.flush());
            flushText();
            runs.delete(runId);
            releaseOnce();
            send(sender, runId, { type: 'closed', error });
          },
        });
        runs.set(runId, { stream, sender, tmpDir: null, asks: new Set(), client, finished: false });
        sender.once('destroyed', () => stream.stop());
        return { success: true };
      } catch (err) {
        releaseOnce();
        return { success: false, error: err instanceof Error ? err.message.slice(0, 300) : 'Could not start the deploy' };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.MONITOR_DEPLOY_ANSWER, async (_event, runId: unknown, askId: unknown, value: unknown) => {
    const run = typeof runId === 'string' ? runs.get(runId) : undefined;
    if (!run || typeof askId !== 'string' || !run.asks.has(askId)) return { success: false, error: 'This prompt is no longer waiting.' };
    run.asks.delete(askId);
    // An empty line makes the askpass helper exit 1, so git or sudo fails instead of waiting.
    const answer = typeof value === 'string' && value.length <= 4096 && !/[\r\n\0]/.test(value) ? value : '';
    const command = run.tmpDir ? answerCommand(run.tmpDir) : null;
    if (!command) return { success: false, error: 'The deploy is not ready for an answer.' };
    try {
      await runOnClient(run.client, command, { timeoutMs: 15_000, stdin: `${answer}\n` });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message.slice(0, 300) : 'Could not pass the answer' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.MONITOR_DEPLOY_CANCEL, async (_event, runId: unknown) => {
    const run = typeof runId === 'string' ? runs.get(runId) : undefined;
    run?.stream.stop();
    return { success: true };
  });
}
