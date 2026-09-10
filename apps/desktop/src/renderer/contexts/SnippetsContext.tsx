import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { Snippet, SnippetInput } from '@magicterm/shared';
import {
  listSnippets,
  createSnippet,
  updateSnippet,
  deleteSnippet,
  updateSnippetOrders,
} from '@magicterm/supabase-client';
import { cryptoManager } from '@magicterm/crypto';
import { clearSnippetVariableMemory } from '../lib/snippet-variable-memory';

interface SnippetsContextValue {
  snippets: Snippet[];
  isLoading: boolean;
  error: string | null;
  addSnippet: (input: SnippetInput) => Promise<Snippet>;
  editSnippet: (id: string, input: Partial<SnippetInput>) => Promise<Snippet>;
  removeSnippet: (id: string) => Promise<void>;
  /** Persists the given ids as the new list order, front to back. */
  reorderSnippets: (orderedIds: string[]) => Promise<void>;
  decryptSnippetValue: (snippet: Snippet) => Promise<string>;
  refreshSnippets: () => Promise<void>;
}

const SnippetsContext = createContext<SnippetsContextValue | null>(null);

export function useSnippets() {
  const context = useContext(SnippetsContext);
  if (!context) {
    throw new Error('useSnippets must be used within a SnippetsProvider');
  }
  return context;
}

interface SnippetsProviderProps {
  children: ReactNode;
}

export function SnippetsProvider({ children }: SnippetsProviderProps) {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSnippets = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await listSnippets();
      setSnippets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load snippets');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cryptoManager.hasMasterPassword()) {
      refreshSnippets();
    }
  }, [refreshSnippets]);

  // The provider only lives while the vault is unlocked, so its teardown is the
  // right moment to drop remembered snippet variable values.
  useEffect(() => {
    return () => clearSnippetVariableMemory();
  }, []);

  const addSnippet = useCallback(async (input: SnippetInput): Promise<Snippet> => {
    const encryptedValue = await cryptoManager.encrypt(input.value);

    const snippet = await createSnippet({
      name: input.name,
      value: encryptedValue,
      // New snippets land at the end so they never displace an existing digit.
      sortOrder: snippets.length,
    });

    setSnippets((prev) => [...prev, snippet]);
    return snippet;
  }, [snippets.length]);

  const editSnippet = useCallback(async (id: string, input: Partial<SnippetInput>): Promise<Snippet> => {
    const updates: Partial<SnippetInput> & { value?: string } = { ...input };

    if (input.value !== undefined) {
      updates.value = await cryptoManager.encrypt(input.value);
    }

    const snippet = await updateSnippet(id, updates);
    setSnippets((prev) => prev.map((s) => (s.id === id ? snippet : s)));
    return snippet;
  }, []);

  const removeSnippet = useCallback(async (id: string): Promise<void> => {
    await deleteSnippet(id);
    // Leaves a gap in sort_order, which is harmless: only the relative order
    // matters, and the next reorder renumbers everything anyway.
    setSnippets((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const reorderSnippets = useCallback(async (orderedIds: string[]): Promise<void> => {
    const orders = orderedIds.map((id, index) => ({ id, sort_order: index }));
    const orderMap = new Map(orders.map((o) => [o.id, o.sort_order]));

    setSnippets((prev) =>
      prev
        .map((s) => {
          const sortOrder = orderMap.get(s.id);
          return sortOrder === undefined ? s : { ...s, sortOrder };
        })
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    );

    await updateSnippetOrders(orders);
  }, []);

  const decryptSnippetValue = useCallback(async (snippet: Snippet): Promise<string> => {
    return await cryptoManager.decrypt(snippet.value);
  }, []);

  const value: SnippetsContextValue = {
    snippets,
    isLoading,
    error,
    addSnippet,
    editSnippet,
    removeSnippet,
    reorderSnippets,
    decryptSnippetValue,
    refreshSnippets,
  };

  return (
    <SnippetsContext.Provider value={value}>
      {children}
    </SnippetsContext.Provider>
  );
}
