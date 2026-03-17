import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { Snippet, SnippetInput } from '@magicterm/shared';
import { listSnippets, createSnippet, updateSnippet, deleteSnippet } from '@magicterm/supabase-client';
import { cryptoManager } from '@magicterm/crypto';

interface SnippetsContextValue {
  snippets: Snippet[];
  isLoading: boolean;
  error: string | null;
  addSnippet: (input: SnippetInput) => Promise<Snippet>;
  editSnippet: (id: string, input: Partial<SnippetInput>) => Promise<Snippet>;
  removeSnippet: (id: string) => Promise<void>;
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

  const addSnippet = useCallback(async (input: SnippetInput): Promise<Snippet> => {
    const encryptedValue = await cryptoManager.encrypt(input.value);

    const snippet = await createSnippet({
      name: input.name,
      value: encryptedValue,
    });

    setSnippets((prev) => [...prev, snippet].sort((a, b) => a.name.localeCompare(b.name)));
    return snippet;
  }, []);

  const editSnippet = useCallback(async (id: string, input: Partial<SnippetInput>): Promise<Snippet> => {
    const updates: Partial<SnippetInput> & { value?: string } = { ...input };

    if (input.value !== undefined) {
      updates.value = await cryptoManager.encrypt(input.value);
    }

    const snippet = await updateSnippet(id, updates);
    setSnippets((prev) => 
      prev.map((s) => (s.id === id ? snippet : s)).sort((a, b) => a.name.localeCompare(b.name))
    );
    return snippet;
  }, []);

  const removeSnippet = useCallback(async (id: string): Promise<void> => {
    await deleteSnippet(id);
    setSnippets((prev) => prev.filter((s) => s.id !== id));
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
    decryptSnippetValue,
    refreshSnippets,
  };

  return (
    <SnippetsContext.Provider value={value}>
      {children}
    </SnippetsContext.Provider>
  );
}
