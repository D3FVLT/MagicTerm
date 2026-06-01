import { useState, useEffect, useCallback, useRef } from 'react';
import { FilePanel } from './FilePanel';
import { TransferPanel } from './TransferPanel';
import { TextEditorModal } from './TextEditorModal';
import type { FileEntry, TransferProgress, SSHConnectionConfig } from '@magicterm/shared';
import { useHostKey } from '../contexts/HostKeyContext';
import type { SftpConnectResult } from '../types/electron';

interface SFTPViewProps {
  sessionId: string;
  serverName?: string;
  config: SSHConnectionConfig;
}

export function SFTPView({ sessionId, serverName, config }: SFTPViewProps) {
  type UploadConflictDecision = 'skip' | 'replace' | 'cancel';

  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const [localPath, setLocalPath] = useState('');
  const [localEntries, setLocalEntries] = useState<FileEntry[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>();
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set());

  const [remotePath, setRemotePath] = useState('/');
  const [remoteEntries, setRemoteEntries] = useState<FileEntry[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | undefined>();
  const [remoteSelected, setRemoteSelected] = useState<Set<string>>(new Set());

  const [transfers, setTransfers] = useState<TransferProgress[]>([]);
  const [splitPosition, setSplitPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [editingFile, setEditingFile] = useState<FileEntry | null>(null);

  const [uploadConflict, setUploadConflict] = useState<{
    localFile: FileEntry;
    remoteFile: FileEntry;
    remoteFilePath: string;
  } | null>(null);
  const uploadConflictResolver = useRef<((d: UploadConflictDecision) => void) | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { verifyHostKey } = useHostKey();

  const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[Math.min(i, sizes.length - 1)];
  };

  const formatDate = (timestamp: number): string => {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  useEffect(() => {
    let active = true;

    const connect = async () => {
      setIsConnecting(true);
      setConnectionError(null);
      try {
        let result: SftpConnectResult | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          result = await window.electronAPI.sftp.connect(sessionId, config);
          if (!active) return;
          if (result.success) break;
          if ('code' in result) {
            const trusted = await verifyHostKey(result);
            if (!active) return;
            if (!trusted) {
              setConnectionError('Host key verification cancelled');
              return;
            }
            continue;
          }
          break;
        }
        if (!active) return;
        if (result && result.success) {
          const initialPath = result.homePath || '/';
          setRemotePath(initialPath);
          loadRemoteDir(initialPath);
        } else if (result && 'cancelled' in result && result.cancelled) {
          return;
        } else if (result && 'error' in result) {
          setConnectionError(result.error || 'Failed to connect');
        } else {
          setConnectionError('Failed to connect');
        }
      } catch (err) {
        if (active) setConnectionError((err as Error).message);
      } finally {
        if (active) setIsConnecting(false);
      }
    };

    const initLocalPath = async () => {
      const result = await window.electronAPI.localFs.getHome();
      if (!active) return;
      if (result.success && result.path) {
        setLocalPath(result.path);
        loadLocalDir(result.path);
      }
    };

    connect();
    initLocalPath();

    return () => {
      active = false;
      window.electronAPI.sftp.disconnect(sessionId);
    };
  }, [sessionId, config, verifyHostKey, retryNonce]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.sftp.onProgress((progress) => {
      if (progress.sessionId !== sessionId) return;

      setTransfers((prev) => {
        const idx = prev.findIndex((t) => t.id === progress.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = progress;
          if (progress.status === 'completed' || progress.status === 'error') {
            setTimeout(() => {
              setTransfers((p) => p.filter((t) => t.id !== progress.id));
            }, 3000);
          }
          return updated;
        }
        return [...prev, progress];
      });

      if (progress.status === 'completed') {
        if (progress.direction === 'download') {
          loadLocalDir(localPath);
        } else {
          loadRemoteDir(remotePath);
        }
      }
    });

    return () => unsubscribe();
  }, [sessionId, localPath, remotePath]);

  const loadLocalDir = useCallback(async (path: string) => {
    setLocalLoading(true);
    setLocalError(undefined);
    try {
      const result = await window.electronAPI.localFs.list(path);
      if (result.success && result.entries) {
        setLocalEntries(result.entries);
        setLocalPath(path);
        setLocalSelected(new Set());
      } else {
        setLocalError(result.error);
      }
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setLocalLoading(false);
    }
  }, []);

  const loadRemoteDir = useCallback(
    async (path: string) => {
      setRemoteLoading(true);
      setRemoteError(undefined);
      try {
        const result = await window.electronAPI.sftp.list(sessionId, path);
        if (result.success && result.entries) {
          setRemoteEntries(result.entries);
          setRemotePath(path);
          setRemoteSelected(new Set());
        } else {
          setRemoteError(result.error);
        }
      } catch (err) {
        setRemoteError((err as Error).message);
      } finally {
        setRemoteLoading(false);
      }
    },
    [sessionId]
  );

  const resolveUploadConflict = (decision: UploadConflictDecision) => {
    uploadConflictResolver.current?.(decision);
    uploadConflictResolver.current = null;
    setUploadConflict(null);
  };

  const handleLocalTransfer = useCallback(
    async (files: FileEntry[]) => {
      for (const file of files) {
        if (file.isDirectory) continue;

        const remoteFilePath = remotePath + '/' + file.name;

        const remoteStat = await window.electronAPI.sftp.stat(sessionId, remoteFilePath);
        if (remoteStat.success && remoteStat.entry && !remoteStat.entry.isDirectory) {
          const decision = await new Promise<UploadConflictDecision>((resolve) => {
            uploadConflictResolver.current = resolve;
            setUploadConflict({
              localFile: file,
              remoteFile: remoteStat.entry!,
              remoteFilePath,
            });
          });

          if (decision === 'cancel') break;
          if (decision === 'skip') continue;
        }

        const transferId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await window.electronAPI.sftp.upload(sessionId, transferId, file.path, remoteFilePath);
      }
    },
    [sessionId, remotePath]
  );

  const handleRemoteTransfer = useCallback(
    async (files: FileEntry[]) => {
      for (const file of files) {
        if (file.isDirectory) continue;
        const transferId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const localFilePath = localPath + '/' + file.name;
        await window.electronAPI.sftp.download(sessionId, transferId, file.path, localFilePath);
      }
    },
    [sessionId, localPath]
  );

  const handleLocalDelete = useCallback(async (_files: FileEntry[]) => {
    console.log('Local delete not implemented for security reasons');
  }, []);

  const handleRemoteDelete = useCallback(
    async (files: FileEntry[]) => {
      for (const file of files) {
        await window.electronAPI.sftp.delete(sessionId, file.path, file.isDirectory);
      }
      loadRemoteDir(remotePath);
    },
    [sessionId, remotePath, loadRemoteDir]
  );

  const handleLocalRename = useCallback(async () => {
    console.log('Local rename not implemented for security reasons');
  }, []);

  const handleRemoteRename = useCallback(
    async (file: FileEntry, newName: string) => {
      const newPath = remotePath + '/' + newName;
      await window.electronAPI.sftp.rename(sessionId, file.path, newPath);
      loadRemoteDir(remotePath);
    },
    [sessionId, remotePath, loadRemoteDir]
  );

  const handleLocalCreateFolder = useCallback(async () => {
    console.log('Local mkdir not implemented for security reasons');
  }, []);

  const handleRemoteCreateFolder = useCallback(
    async (name: string) => {
      const newPath = remotePath + '/' + name;
      await window.electronAPI.sftp.mkdir(sessionId, newPath);
      loadRemoteDir(remotePath);
    },
    [sessionId, remotePath, loadRemoteDir]
  );

  const handleLocalOpenFile = useCallback(async (file: FileEntry) => {
    await window.electronAPI.localFs.openFile(file.path);
  }, []);

  const handleRemoteEditFile = useCallback((file: FileEntry) => {
    setEditingFile(file);
  }, []);

  const handleSplitterMouseDown = useCallback(() => {
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = Math.min(80, Math.max(20, (x / rect.width) * 100));
      setSplitPosition(percent);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging]);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetType: 'local' | 'remote') => {
      e.preventDefault();
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'));
        if (data.type === targetType) return;

        if (data.type === 'local' && targetType === 'remote') {
          handleLocalTransfer(data.files);
        } else if (data.type === 'remote' && targetType === 'local') {
          handleRemoteTransfer(data.files);
        }
      } catch {
        // Invalid drop data
      }
    },
    [handleLocalTransfer, handleRemoteTransfer]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  if (isConnecting) {
    return (
      <div className="flex h-full flex-col bg-[var(--bg)]">
        <div className="drag-region flex h-10 items-center border-b border-[var(--border)] bg-[var(--surface-1)] px-4">
          <span className="text-sm font-medium text-[var(--fg)]">
            {serverName || 'SFTP'} - Connecting...
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            <p className="text-[var(--fg-subtle)]">Connecting to server...</p>
          </div>
        </div>
      </div>
    );
  }

  if (connectionError) {
    return (
      <div className="flex h-full flex-col bg-[var(--bg)]">
        <div className="drag-region flex h-10 items-center border-b border-[var(--border)] bg-[var(--surface-1)] px-4">
          <span className="text-sm font-medium text-[var(--fg)]">
            {serverName || 'SFTP'} - Connection Failed
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20">
              <svg className="h-6 w-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="mb-2 text-[var(--fg)]">Connection failed</p>
            <p className="mb-5 text-sm text-red-400">{connectionError}</p>
            <button
              type="button"
              onClick={() => {
                setConnectionError(null);
                setRetryNonce((n) => n + 1);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)]"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--bg)]">
      {/* Header */}
      <div className="drag-region flex h-10 items-center justify-between border-b border-[var(--border)] bg-[var(--surface-1)] px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-3 w-3 items-center justify-center rounded-full bg-green-500">
            <div className="h-1.5 w-1.5 rounded-full bg-green-300 animate-pulse" />
          </div>
          <span className="text-sm font-medium text-[var(--fg)]">
            {serverName || 'SFTP'}
          </span>
        </div>
      </div>

      {/* Main content with panels */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* Local Panel */}
        <div
          className="h-full overflow-hidden"
          style={{ width: `${splitPosition}%` }}
          onDrop={(e) => handleDrop(e, 'local')}
          onDragOver={handleDragOver}
        >
          <FilePanel
            title="Local"
            type="local"
            currentPath={localPath}
            entries={localEntries}
            isLoading={localLoading}
            error={localError}
            selectedFiles={localSelected}
            onNavigate={loadLocalDir}
            onSelect={setLocalSelected}
            onTransfer={handleLocalTransfer}
            onDelete={handleLocalDelete}
            onRename={handleLocalRename}
            onCreateFolder={handleLocalCreateFolder}
            onRefresh={() => loadLocalDir(localPath)}
            onOpenFile={handleLocalOpenFile}
          />
        </div>

        {/* Splitter */}
        <div
          className="relative w-1 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)]/50 transition-colors"
          onMouseDown={handleSplitterMouseDown}
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>

        {/* Remote Panel */}
        <div
          className="h-full flex-1 overflow-hidden"
          onDrop={(e) => handleDrop(e, 'remote')}
          onDragOver={handleDragOver}
        >
          <FilePanel
            title={`Remote (${config.host})`}
            type="remote"
            currentPath={remotePath}
            entries={remoteEntries}
            isLoading={remoteLoading}
            error={remoteError}
            selectedFiles={remoteSelected}
            onNavigate={loadRemoteDir}
            onSelect={setRemoteSelected}
            onTransfer={handleRemoteTransfer}
            onDelete={handleRemoteDelete}
            onRename={handleRemoteRename}
            onCreateFolder={handleRemoteCreateFolder}
            onRefresh={() => loadRemoteDir(remotePath)}
            onEditFile={handleRemoteEditFile}
          />
        </div>
      </div>

      {/* Transfer Panel */}
      {transfers.length > 0 && <TransferPanel transfers={transfers} />}

      {/* Text Editor Modal */}
      {editingFile && (
        <TextEditorModal
          isOpen={!!editingFile}
          filename={editingFile.name}
          remotePath={editingFile.path}
          sessionId={sessionId}
          onClose={() => setEditingFile(null)}
          onSaved={() => loadRemoteDir(remotePath)}
        />
      )}

      {/* Upload conflict modal */}
      {uploadConflict && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60" onClick={() => resolveUploadConflict('cancel')} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="w-full max-w-xl rounded-xl border border-edge bg-surface-1 p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-500/10">
                  <svg className="h-5 w-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86l-8.02 14.13a2 2 0 0 0 1.71 3h16.04a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-fg">File already exists</h3>
                  <p className="text-sm text-fg-muted">Choose what to do with the server version.</p>
                </div>
              </div>

              <p className="mb-4 text-sm text-fg-muted">
                <span className="font-medium text-fg">{uploadConflict.localFile.name}</span> exists on the server:
                <span className="ml-2 font-mono text-fg-muted">{uploadConflict.remoteFilePath}</span>
              </p>

              <div className="space-y-2 rounded-lg border border-edge bg-surface-2/30 p-3 text-sm text-fg-muted">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-fg-muted">Local</span>
                  <span className="text-right">
                    {formatBytes(uploadConflict.localFile.size)} · {formatDate(uploadConflict.localFile.modifiedAt)}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-fg-muted">Server</span>
                  <span className="text-right">
                    {formatBytes(uploadConflict.remoteFile.size)} · {formatDate(uploadConflict.remoteFile.modifiedAt)}
                  </span>
                </div>
              </div>

              <div className="mt-5 flex justify-end gap-3">
                <button
                  onClick={() => resolveUploadConflict('skip')}
                  className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-3"
                >
                  Skip
                </button>
                <button
                  onClick={() => resolveUploadConflict('replace')}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-[var(--accent-hover)]"
                >
                  Replace
                </button>
                <button
                  onClick={() => resolveUploadConflict('cancel')}
                  className="rounded-lg border border-edge bg-transparent px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
