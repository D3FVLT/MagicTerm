/**
 * Last values entered for a snippet's variables, so re-running the same command
 * is a couple of keystrokes rather than a full retype.
 *
 * Deliberately in-memory: snippet values are secrets by definition, and so are
 * the arguments people feed them. The map is dropped when SnippetsProvider
 * unmounts, i.e. on logout or lock.
 */

const memory = new Map<string, Record<string, string>>();

export function recallSnippetVariables(snippetId: string): Record<string, string> {
  return memory.get(snippetId) ?? {};
}

export function rememberSnippetVariables(
  snippetId: string,
  values: Record<string, string>
): void {
  memory.set(snippetId, { ...memory.get(snippetId), ...values });
}

export function forgetSnippetVariables(snippetId: string): void {
  memory.delete(snippetId);
}

export function clearSnippetVariableMemory(): void {
  memory.clear();
}
