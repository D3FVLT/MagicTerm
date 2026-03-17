import { useState, useRef, useEffect } from 'react';
import { useSnippets } from '../contexts/SnippetsContext';
import type { Snippet } from '@magicterm/shared';

interface SnippetsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onPaste?: (text: string) => void;
}

export function SnippetsPanel({ isOpen, onClose, onPaste }: SnippetsPanelProps) {
  const { snippets, isLoading, addSnippet, editSnippet, removeSnippet, decryptSnippetValue } = useSnippets();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isAdding && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [isAdding]);

  const handleCopy = async (snippet: Snippet) => {
    try {
      const decrypted = await decryptSnippetValue(snippet);
      await navigator.clipboard.writeText(decrypted);
      setCopiedId(snippet.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (err) {
      setError('Failed to copy');
    }
  };

  const handlePaste = async (snippet: Snippet) => {
    if (!onPaste) return;
    try {
      const decrypted = await decryptSnippetValue(snippet);
      onPaste(decrypted);
      onClose();
    } catch (err) {
      setError('Failed to paste');
    }
  };

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
    } catch (err) {
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

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className="w-72 rounded-lg border border-[#292e42] bg-[#1f2335] shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-[#292e42] px-3 py-2">
        <span className="text-sm font-medium text-[#c0caf5]">Snippets</span>
        <button
          onClick={() => {
            setIsAdding(true);
            setEditingId(null);
            setName('');
            setValue('');
          }}
          className="rounded p-1 text-[#7aa2f7] hover:bg-[#292e42]"
          title="Add snippet"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {error && (
        <div className="border-b border-[#292e42] bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {isAdding && (
        <div className="border-b border-[#292e42] p-3 space-y-2">
          <input
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. GitHub Token)"
            className="w-full rounded bg-[#292e42] px-2 py-1.5 text-sm text-[#c0caf5] placeholder-[#565f89] outline-none"
          />
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Value (will be encrypted)"
            rows={3}
            className="w-full rounded bg-[#292e42] px-2 py-1.5 text-sm text-[#c0caf5] placeholder-[#565f89] outline-none font-mono"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={handleCancel}
              className="rounded px-2 py-1 text-xs text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="rounded bg-[#7aa2f7] px-2 py-1 text-xs text-white hover:bg-[#3d59a1]"
            >
              {editingId ? 'Update' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="max-h-64 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#7aa2f7] border-t-transparent" />
          </div>
        ) : snippets.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-[#565f89]">
            No snippets yet
          </div>
        ) : (
          <ul>
            {snippets.map((snippet) => (
              <li
                key={snippet.id}
                className="group flex items-center gap-2 border-b border-[#292e42]/50 px-3 py-2 hover:bg-[#292e42]/50"
              >
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => handleCopy(snippet)}
                  title="Click to copy"
                >
                  <div className="flex items-center gap-2">
                    <svg className="h-3.5 w-3.5 flex-shrink-0 text-[#7aa2f7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                    <span className="truncate text-sm text-[#c0caf5]">{snippet.name}</span>
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
                          className="rounded p-1 text-[#565f89] hover:bg-[#3d59a1] hover:text-white"
                          title="Paste to terminal"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => handleEdit(snippet)}
                        className="rounded p-1 text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]"
                        title="Edit"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(snippet.id)}
                        className="rounded p-1 text-[#565f89] hover:bg-red-500/20 hover:text-red-400"
                        title="Delete"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-[#292e42] px-3 py-2">
        <p className="text-xs text-[#565f89]">
          Click to copy • All values are encrypted
        </p>
      </div>
    </div>
  );
}
