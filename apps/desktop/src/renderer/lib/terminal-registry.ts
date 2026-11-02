import type { Terminal } from '@xterm/xterm';

/** Open xterm instances by session id, so AI tools can read what is on screen. */
const terminals = new Map<string, Terminal>();

export function registerTerminal(sessionId: string, terminal: Terminal): () => void {
  terminals.set(sessionId, terminal);
  return () => {
    if (terminals.get(sessionId) === terminal) terminals.delete(sessionId);
  };
}

export function getTerminal(sessionId: string): Terminal | undefined {
  return terminals.get(sessionId);
}
