import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from './ui/Button';

interface TextEditorModalProps {
  isOpen: boolean;
  filename: string;
  remotePath: string;
  sessionId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function TextEditorModal({
  isOpen,
  filename,
  remotePath,
  sessionId,
  onClose,
  onSaved,
}: TextEditorModalProps) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasChanges = content !== originalContent;

  useEffect(() => {
    if (!isOpen) return;

    const loadFile = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await window.electronAPI.sftp.readFile(sessionId, remotePath);
        if (result.success && result.content !== undefined) {
          setContent(result.content);
          setOriginalContent(result.content);
        } else {
          setError(result.error || 'Failed to load file');
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    };

    loadFile();
  }, [isOpen, sessionId, remotePath]);

  useEffect(() => {
    if (!isLoading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isLoading]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI.sftp.writeFile(sessionId, remotePath, content);
      if (result.success) {
        setOriginalContent(content);
        onSaved();
      } else {
        setError(result.error || 'Failed to save file');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  }, [sessionId, remotePath, content, onSaved]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (hasChanges && !isSaving) {
          handleSave();
        }
      }
      if (e.key === 'Escape') {
        if (hasChanges) {
          if (confirm('You have unsaved changes. Discard them?')) {
            onClose();
          }
        } else {
          onClose();
        }
      }
    },
    [hasChanges, isSaving, handleSave, onClose]
  );

  const handleClose = useCallback(() => {
    if (hasChanges) {
      if (confirm('You have unsaved changes. Discard them?')) {
        onClose();
      }
    } else {
      onClose();
    }
  }, [hasChanges, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="flex h-[80vh] w-[80vw] max-w-4xl flex-col rounded-xl border border-[#292e42] bg-[#1f2335] shadow-2xl"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#292e42] px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-[#7aa2f7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            <span className="font-medium text-[#c0caf5]">{filename}</span>
            {hasChanges && <span className="text-xs text-[#e0af68]">(modified)</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#565f89]">Cmd/Ctrl+S to save</span>
            <button
              onClick={handleClose}
              className="rounded p-1 text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 px-4 py-2 text-sm text-red-400">{error}</div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden p-4">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#7aa2f7] border-t-transparent" />
                <span className="text-sm text-[#565f89]">Loading file...</span>
              </div>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="h-full w-full resize-none rounded-lg border border-[#292e42] bg-[#1a1b26] p-4 font-mono text-sm text-[#c0caf5] outline-none focus:border-[#7aa2f7]"
              spellCheck={false}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#292e42] px-4 py-3">
          <span className="text-xs text-[#565f89]">{remotePath}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
              {isSaving ? (
                <span className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Saving...
                </span>
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
