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
import { useAuth } from './AuthContext';
import { getLocalDocument } from '../lib/local-vault-session';
import {
  addLocalSnippet,
  editLocalSnippet,
  removeLocalSnippet,
  reorderLocalSnippets,
} from '../lib/local-vault-data';

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
  const { isLocalOnly } = useAuth();
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSnippets = useCallback(async () => {
    if (isLocalOnly) {
      setSnippets(getLocalDocument()?.snippets ?? []);
      setIsLoading(false);
      setError(null);
      return;
    }
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
  }, [isLocalOnly]);

  useEffect(() => {
    if (isLocalOnly) {
      if (cryptoManager.hasMasterPassword()) void refreshSnippets();
      return;
    }
    if (cryptoManager.hasMasterPassword()) {
      void refreshSnippets();
    }
  }, [refreshSnippets, isLocalOnly]);

  // The provider only lives while the vault is unlocked, so its teardown is the
  // right moment to drop remembered snippet variable values.
  useEffect(() => {
    return () => clearSnippetVariableMemory();
  }, []);

  const addSnippet = useCallback(async (input: SnippetInput): Promise<Snippet> => {
    if (isLocalOnly) {
      const snippet = await addLocalSnippet(input, snippets.length);
      setSnippets(getLocalDocument()?.snippets ?? []);
      return snippet;
    }
    const encryptedValue = await cryptoManager.encrypt(input.value);

    const snippet = await createSnippet({
      name: input.name,
      value: encryptedValue,
      // New snippets land at the end so they never displace an existing digit.
      sortOrder: snippets.length,
    });

    setSnippets((prev) => [...prev, snippet]);
    return snippet;
  }, [snippets.length, isLocalOnly]);

  const editSnippet = useCallback(async (id: string, input: Partial<SnippetInput>): Promise<Snippet> => {
    if (isLocalOnly) {
      const snippet = await editLocalSnippet(id, input);
      setSnippets(getLocalDocument()?.snippets ?? []);
      return snippet;
    }
    const updates: Partial<SnippetInput> & { value?: string } = { ...input };

    if (input.value !== undefined) {
      updates.value = await cryptoManager.encrypt(input.value);
    }

    const snippet = await updateSnippet(id, updates);
    setSnippets((prev) => prev.map((s) => (s.id === id ? snippet : s)));
    return snippet;
  }, [isLocalOnly]);

  const removeSnippet = useCallback(async (id: string): Promise<void> => {
    if (isLocalOnly) {
      await removeLocalSnippet(id);
      setSnippets(getLocalDocument()?.snippets ?? []);
      return;
    }
    await deleteSnippet(id);
    // Leaves a gap in sort_order, which is harmless: only the relative order
    // matters, and the next reorder renumbers everything anyway.
    setSnippets((prev) => prev.filter((s) => s.id !== id));
  }, [isLocalOnly]);

  const reorderSnippets = useCallback(async (orderedIds: string[]): Promise<void> => {
    if (isLocalOnly) {
      await reorderLocalSnippets(orderedIds);
      setSnippets(getLocalDocument()?.snippets ?? []);
      return;
    }
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
  }, [isLocalOnly]);

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
