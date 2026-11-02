export interface McpActivity {
  id: string;
  at: number;
  client: string;
  tool: string;
  target: string;
  outcome: 'ok' | 'denied' | 'error';
  detail: string;
}

const MAX_ENTRIES = 100;
let entries: McpActivity[] = [];
const listeners = new Set<() => void>();

/** What AI tools did in this run of the app. Kept in memory only. */
export function recordMcpActivity(entry: Omit<McpActivity, 'id' | 'at'>): void {
  entries = [{ ...entry, id: crypto.randomUUID(), at: Date.now() }, ...entries].slice(0, MAX_ENTRIES);
  for (const listener of listeners) listener();
}

export function mcpActivity(): McpActivity[] {
  return entries;
}

export function subscribeMcpActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
