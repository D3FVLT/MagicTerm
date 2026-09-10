import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSnippets } from '../contexts/SnippetsContext';
import { copySecretToClipboard } from '../lib/secret-clipboard';
import { parseSnippetVariables, type SnippetVariable } from '../lib/snippet-template';
import {
  recallSnippetVariables,
  rememberSnippetVariables,
} from '../lib/snippet-variable-memory';
import { SnippetVariablesModal } from './SnippetVariablesModal';
import type { Snippet } from '@magicterm/shared';

interface SnippetsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onPaste?: (text: string) => void;
  captureKeys?: boolean;
}

type SnippetAction = 'paste' | 'copy';

interface PendingSnippet {
  snippet: Snippet;
  template: string;
  variables: SnippetVariable[];
  mode: SnippetAction;
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const MOD_LABEL = isMac ? '⌘' : 'Ctrl';

export function SnippetsPanel({ isOpen, onClose, onPaste, captureKeys = true }: SnippetsPanelProps) {
  const {
    snippets,
    isLoading,
    addSnippet,
    editSnippet,
    removeSnippet,
    reorderSnippets,
    decryptSnippetValue,
  } = useSnippets();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSnippet | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; side: 'before' | 'after' } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const dragIdRef = useRef<string | null>(null);

  const draftVariables = useMemo(() => parseSnippetVariables(value), [value]);

  const deliver = useCallback((snippet: Snippet, text: string, mode: SnippetAction) => {
    if (mode === 'paste') {
      onPaste?.(text);
      onClose();
      return;
    }
    copySecretToClipboard(text);
    setCopiedId(snippet.id);
    setTimeout(() => setCopiedId(null), 1500);
  }, [onPaste, onClose]);

  const run = useCallback(async (snippet: Snippet, mode: SnippetAction) => {
    if (mode === 'paste' && !onPaste) return;
    try {
      setError(null);
      const template = await decryptSnippetValue(snippet);
      const variables = parseSnippetVariables(template);
      if (variables.length > 0) {
        setPending({ snippet, template, variables, mode });
        return;
      }
      deliver(snippet, template, mode);
    } catch {
      setError(mode === 'paste' ? 'Failed to paste' : 'Failed to copy');
    }
  }, [decryptSnippetValue, deliver, onPaste]);

  const handleCopy = useCallback((snippet: Snippet) => run(snippet, 'copy'), [run]);
  const handlePaste = useCallback((snippet: Snippet) => run(snippet, 'paste'), [run]);

  const handleVariablesSubmit = useCallback(
    (result: string, values: Record<string, string>) => {
      if (!pending) return;
      rememberSnippetVariables(pending.snippet.id, values);
      setPending(null);
      deliver(pending.snippet, result, pending.mode);
    },
    [pending, deliver]
  );

  useEffect(() => {
    if (pending) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose, pending]);

  useEffect(() => {
    if (isAdding && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [isAdding]);

  // Keyboard: Esc closes; 1–9 paste corresponding snippet (when not editing).
  useEffect(() => {
    if (!isOpen || !captureKeys) return;
    if (pending) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (isAdding) {
          setIsAdding(false);
          setEditingId(null);
          setName('');
          setValue('');
          setError(null);
        } else {
          onClose();
        }
        return;
      }

      if (isAdding || !onPaste) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const digit = e.code.match(/^Digit([1-9])$/)?.[1] ?? e.key.match(/^([1-9])$/)?.[1];
      if (!digit) return;

      const index = Number(digit) - 1;
      const snippet = snippets[index];
      if (!snippet) return;

      e.preventDefault();
      e.stopPropagation();
      void handlePaste(snippet);
    };

    // Capture so digits don't land in the terminal while the panel is open.
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, captureKeys, isAdding, onPaste, onClose, snippets, handlePaste, pending]);

  const handleSave = async () => {
    if (!name.trim() || !value.trim()) {
      setError('Name and value are required');
      return;
    }

    try {
      setError(null);
      if (editingId) {
        await editSnippet(editingId, { name: name.trim(), value: value.trim() });
      } else {
        await addSnippet({ name: name.trim(), value: value.trim() });
      }
      setIsAdding(false);
      setEditingId(null);
      setName('');
      setValue('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleEdit = async (snippet: Snippet) => {
    try {
      const decrypted = await decryptSnippetValue(snippet);
      setEditingId(snippet.id);
      setName(snippet.name);
      setValue(decrypted);
      setIsAdding(true);
    } catch {
      setError('Failed to load snippet');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this snippet?')) return;
    try {
      await removeSnippet(id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setName('');
    setValue('');
    setError(null);
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    dragIdRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragIdRef.current || dragIdRef.current === id) {
      setDropTarget(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const side = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropTarget({ id, side });
  };

  const handleDragEnd = () => {
    dragIdRef.current = null;
    setDropTarget(null);
  };

  const handleReorderDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const insert = dropTarget;
    const sourceId = dragIdRef.current;
    handleDragEnd();
    if (!sourceId || sourceId === targetId) return;

    const ids = snippets.map((s) => s.id).filter((id) => id !== sourceId);
    let index = ids.indexOf(targetId);
    if (index === -1) return;
    if (insert?.side === 'after') index++;
    ids.splice(index, 0, sourceId);

    try {
      setError(null);
      await reorderSnippets(ids);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className="w-72 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <span className="text-sm font-medium text-[var(--fg)]">Snippets</span>
        <button
          onClick={() => {
            setIsAdding(true);
            setEditingId(null);
            setName('');
            setValue('');
          }}
          className="rounded p-1 text-[var(--accent)] hover:bg-[var(--border)]"
          aria-label="Add snippet" data-tooltip=""
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {error && (
        <div className="border-b border-[var(--border)] bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {isAdding && (
        <div className="border-b border-[var(--border)] p-3 space-y-2">
          <input
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. GitHub Token)"
            className="w-full rounded bg-[var(--border)] px-2 py-1.5 text-sm text-[var(--fg)] placeholder-[var(--fg-subtle)] outline-none"
          />
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Value (will be encrypted)"
            rows={3}
            className="w-full rounded bg-[var(--border)] px-2 py-1.5 text-sm text-[var(--fg)] placeholder-[var(--fg-subtle)] outline-none font-mono"
          />
          {draftVariables.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs text-[var(--fg-subtle)]">Asks for:</span>
              {draftVariables.map((variable) => (
                <span
                  key={variable.name}
                  className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--accent)]"
                  data-tooltip={variable.defaultValue ? `Default: ${variable.defaultValue}` : 'No default'}
                >
                  {variable.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--fg-subtle)]">
              Use <code className="font-mono text-[var(--accent)]">{'{{name}}'}</code> or{' '}
              <code className="font-mono text-[var(--accent)]">{'{{name=default}}'}</code> to be
              asked for a value on use.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={handleCancel}
              className="rounded px-2 py-1 text-xs text-[var(--fg-subtle)] hover:bg-[var(--border)] hover:text-[var(--fg)]"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-fg hover:bg-[var(--accent-hover)]"
            >
              {editingId ? 'Update' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="max-h-64 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          </div>
        ) : snippets.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-[var(--fg-subtle)]">
            No snippets yet
          </div>
        ) : (
          <ul>
            {snippets.map((snippet, index) => {
              const shortcutDigit = index < 9 && onPaste ? String(index + 1) : null;
              return (
                <li
                  key={snippet.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, snippet.id)}
                  onDragOver={(e) => handleDragOver(e, snippet.id)}
                  onDragEnd={handleDragEnd}
                  onDrop={(e) => { void handleReorderDrop(e, snippet.id); }}
                  className="group relative flex items-center gap-2 border-b border-[var(--border)]/50 px-3 py-2 hover:bg-[var(--border)]/50"
                >
                  {dropTarget?.id === snippet.id && (
                    <div
                      className={`pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-[var(--accent)] ${
                        dropTarget.side === 'before' ? 'top-0' : 'bottom-0'
                      }`}
                    />
                  )}
                  {shortcutDigit && (
                    <kbd
                      className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border border-[var(--border)] bg-[var(--surface-2)] font-mono text-[10px] text-[var(--fg-subtle)]"
                      data-tooltip={`Press ${shortcutDigit} to paste — drag the row to reorder`}
                    >
                      {shortcutDigit}
                    </kbd>
                  )}
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => handleCopy(snippet)}
                    data-tooltip="Click to copy"
                  >
                    <div className="flex items-center gap-2">
                      {!shortcutDigit && (
                        <svg className="h-3.5 w-3.5 flex-shrink-0 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                        </svg>
                      )}
                      <span className="truncate text-sm text-[var(--fg)]">{snippet.name}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {copiedId === snippet.id ? (
                      <span className="text-xs text-green-400">Copied!</span>
                    ) : (
                      <>
                        {onPaste && (
                          <button
                            onClick={() => handlePaste(snippet)}
                            className="rounded p-1 text-[var(--fg-subtle)] hover:bg-[var(--accent-hover)] hover:text-fg"
                            aria-label="Paste to terminal"
                            data-tooltip={shortcutDigit ? `Paste to terminal (${shortcutDigit})` : 'Paste to terminal'}
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={() => handleEdit(snippet)}
                          className="rounded p-1 text-[var(--fg-subtle)] hover:bg-[var(--border)] hover:text-[var(--fg)]"
                          aria-label="Edit" data-tooltip=""
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(snippet.id)}
                          className="rounded p-1 text-[var(--fg-subtle)] hover:bg-red-500/20 hover:text-red-400"
                          aria-label="Delete" data-tooltip=""
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-[var(--border)] px-3 py-2 space-y-0.5">
        <p className="text-xs text-[var(--fg-subtle)]">
          {MOD_LABEL}+Shift+S to open • 1–9 paste • Esc close
        </p>
        <p className="text-xs text-[var(--fg-subtle)]">
          Click to copy • Drag to reorder • All values are encrypted
        </p>
      </div>

      {pending && (
        <SnippetVariablesModal
          key={pending.snippet.id}
          snippetName={pending.snippet.name}
          template={pending.template}
          variables={pending.variables}
          initialValues={recallSnippetVariables(pending.snippet.id)}
          submitLabel={pending.mode === 'paste' ? 'Paste' : 'Copy'}
          onSubmit={handleVariablesSubmit}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
