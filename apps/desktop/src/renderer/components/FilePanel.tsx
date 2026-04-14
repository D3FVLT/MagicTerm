import { useState, useEffect, useCallback, useRef } from 'react';
import type { FileEntry } from '@magicterm/shared';

interface FilePanelProps {
  title: string;
  type: 'local' | 'remote';
  currentPath: string;
  entries: FileEntry[];
  isLoading: boolean;
  error?: string;
  selectedFiles: Set<string>;
  onNavigate: (path: string) => void;
  onSelect: (files: Set<string>) => void;
  onTransfer: (files: FileEntry[], targetPath: string) => void;
  onDelete: (files: FileEntry[]) => void;
  onRename: (file: FileEntry, newName: string) => void;
  onCreateFolder: (name: string) => void;
  onRefresh: () => void;
  onOpenFile?: (file: FileEntry) => void;
  onEditFile?: (file: FileEntry) => void;
}

const TEXT_EXTENSIONS = [
  '.txt', '.md', '.json', '.yml', '.yaml', '.xml', '.html', '.htm', '.css', '.js', '.ts',
  '.jsx', '.tsx', '.py', '.rb', '.php', '.java', '.c', '.cpp', '.h', '.hpp', '.go', '.rs',
  '.sh', '.bash', '.zsh', '.fish', '.env', '.gitignore', '.dockerignore', '.editorconfig',
  '.eslintrc', '.prettierrc', '.babelrc', '.conf', '.cfg', '.ini', '.toml', '.log',
  '.sql', '.graphql', '.vue', '.svelte', '.astro', '.htaccess', '.csv', '.tsv',
  '.example', '.sample', '.local', '.development', '.production', '.staging', '.test',
  '.lock', '.map', '.d.ts', '.mjs', '.cjs', '.mts', '.cts',
];

const TEXT_PATTERNS = ['.env.', '.eslintrc.', '.prettierrc.', '.babelrc.'];

export function isTextFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  if (TEXT_PATTERNS.some((pattern) => lower.includes(pattern))) return true;
  if (lower.startsWith('.') && !lower.includes('.', 1)) return true;
  if (['dockerfile', 'makefile', 'readme', 'license', 'changelog', 'authors', 'contributing', 'codeowners'].includes(lower)) return true;
  return false;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(timestamp: number): string {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function FilePanel({
  title,
  type,
  currentPath,
  entries,
  isLoading,
  error,
  selectedFiles,
  onNavigate,
  onSelect,
  onTransfer,
  onDelete,
  onRename,
  onCreateFolder,
  onRefresh,
  onOpenFile,
  onEditFile,
}: FilePanelProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file?: FileEntry } | null>(
    null
  );
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'date'>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [pathCopied, setPathCopied] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (creatingFolder && newFolderInputRef.current) {
      newFolderInputRef.current.focus();
    }
  }, [creatingFolder]);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const pathParts = currentPath.split('/').filter(Boolean);
  const isWindows = type === 'local' && currentPath.includes('\\');
  const separator = isWindows ? '\\' : '/';

  const handleBreadcrumbClick = (index: number) => {
    if (isWindows) {
      const newPath = pathParts.slice(0, index + 1).join('\\');
      onNavigate(newPath);
    } else {
      const newPath = '/' + pathParts.slice(0, index + 1).join('/');
      onNavigate(newPath);
    }
  };

  const handleGoUp = () => {
    const parentPath = currentPath.split(separator).slice(0, -1).join(separator) || '/';
    onNavigate(parentPath);
  };

  const handleDoubleClick = (file: FileEntry) => {
    if (file.isDirectory) {
      onNavigate(file.path);
    } else if (onOpenFile) {
      onOpenFile(file);
    } else if (onEditFile && isTextFile(file.name)) {
      onEditFile(file);
    }
  };

  const handleClick = (file: FileEntry, e: React.MouseEvent) => {
    if (e.shiftKey && selectedFiles.size > 0) {
      const lastSelected = Array.from(selectedFiles).pop();
      const lastIndex = entries.findIndex((f) => f.path === lastSelected);
      const currentIndex = entries.findIndex((f) => f.path === file.path);
      const start = Math.min(lastIndex, currentIndex);
      const end = Math.max(lastIndex, currentIndex);
      const newSelection = new Set(selectedFiles);
      for (let i = start; i <= end; i++) {
        newSelection.add(entries[i].path);
      }
      onSelect(newSelection);
    } else if (e.metaKey || e.ctrlKey) {
      const newSelection = new Set(selectedFiles);
      if (newSelection.has(file.path)) {
        newSelection.delete(file.path);
      } else {
        newSelection.add(file.path);
      }
      onSelect(newSelection);
    } else {
      onSelect(new Set([file.path]));
    }
  };

  const handleContextMenu = (e: React.MouseEvent, file?: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    if (file && !selectedFiles.has(file.path)) {
      onSelect(new Set([file.path]));
    }
    const padding = 8;
    const approxWidth = 220;
    const approxHeight = 320;
    const maxX = window.innerWidth - approxWidth - padding;
    const maxY = window.innerHeight - approxHeight - padding;
    const x = Math.max(padding, Math.min(e.clientX, maxX));
    const y = Math.max(padding, Math.min(e.clientY, maxY));
    setContextMenu({ x, y, file });
  };

  const handleRenameSubmit = (file: FileEntry) => {
    if (newName && newName !== file.name) {
      onRename(file, newName);
    }
    setRenaming(null);
    setNewName('');
  };

  const handleCreateFolderSubmit = () => {
    if (newFolderName) {
      onCreateFolder(newFolderName);
    }
    setCreatingFolder(false);
    setNewFolderName('');
  };

  const handleSort = (column: 'name' | 'size' | 'date') => {
    if (sortBy === column) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(column);
      setSortAsc(true);
    }
  };

  const sortedEntries = [...entries].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;

    let cmp = 0;
    switch (sortBy) {
      case 'name':
        cmp = a.name.localeCompare(b.name);
        break;
      case 'size':
        cmp = a.size - b.size;
        break;
      case 'date':
        cmp = a.modifiedAt - b.modifiedAt;
        break;
    }
    return sortAsc ? cmp : -cmp;
  });

  const getSelectedFiles = useCallback((): FileEntry[] => {
    return entries.filter((f) => selectedFiles.has(f.path));
  }, [entries, selectedFiles]);

  const SortIcon = ({ column }: { column: 'name' | 'size' | 'date' }) => {
    if (sortBy !== column) return null;
    return (
      <svg
        className={`ml-1 h-3 w-3 inline ${sortAsc ? '' : 'rotate-180'}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    );
  };

  return (
    <div className="flex h-full flex-col bg-[#1a1b26]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#292e42] bg-[#1f2335] px-3 py-2">
        <span className="text-sm font-medium text-[#7aa2f7]">{title}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            className="rounded p-1 text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]"
            title="Refresh"
          >
            <svg
              className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
          <button
            onClick={() => setCreatingFolder(true)}
            className="rounded p-1 text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]"
            title="New Folder"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 border-b border-[#292e42] bg-[#1f2335] px-3 py-1.5">
        <button
          onClick={handleGoUp}
          className="rounded p-1 text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]"
          title="Go up"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <div className="flex flex-1 items-center gap-0.5 overflow-hidden text-sm">
          <button
            onClick={() => onNavigate(isWindows ? pathParts[0] : '/')}
            className="rounded px-1.5 py-0.5 text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]"
          >
            {isWindows ? pathParts[0] : '/'}
          </button>
          {pathParts.slice(isWindows ? 1 : 0).map((part, i) => (
            <div key={i} className="flex items-center">
              <span className="text-[#565f89]">/</span>
              <button
                onClick={() => handleBreadcrumbClick(isWindows ? i + 1 : i)}
                className="truncate rounded px-1.5 py-0.5 text-[#c0caf5] hover:bg-[#292e42]"
              >
                {part}
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => {
            window.electronAPI.clipboard.writeText(currentPath);
            setPathCopied(true);
            setTimeout(() => setPathCopied(false), 1500);
          }}
          className="rounded p-1 text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5] flex-shrink-0"
          title="Copy path"
        >
          {pathCopied ? (
            <svg className="h-3.5 w-3.5 text-[#9ece6a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>
      )}

      {/* File List Header */}
      <div className="grid grid-cols-[1fr_80px_140px] gap-2 border-b border-[#292e42] bg-[#1f2335] px-3 py-1.5 text-xs text-[#565f89]">
        <button
          onClick={() => handleSort('name')}
          className="flex items-center text-left hover:text-[#c0caf5]"
        >
          Name
          <SortIcon column="name" />
        </button>
        <button
          onClick={() => handleSort('size')}
          className="flex items-center justify-end hover:text-[#c0caf5]"
        >
          Size
          <SortIcon column="size" />
        </button>
        <button
          onClick={() => handleSort('date')}
          className="flex items-center justify-end hover:text-[#c0caf5]"
        >
          Modified
          <SortIcon column="date" />
        </button>
      </div>

      {/* File List */}
      <div
        className="relative flex-1 overflow-y-auto"
        onContextMenu={(e) => handleContextMenu(e)}
      >
        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#1a1b26]/80">
            <div className="flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#7aa2f7] border-t-transparent" />
              <span className="text-xs text-[#565f89]">Loading...</span>
            </div>
          </div>
        )}
        {entries.length === 0 && !isLoading ? (
          <div className="flex h-full items-center justify-center">
            <span className="text-sm text-[#565f89]">Empty folder</span>
          </div>
        ) : (
          <>
            {creatingFolder && (
              <div className="grid grid-cols-[1fr_80px_140px] gap-2 border-b border-[#292e42] px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <svg
                    className="h-4 w-4 text-[#7aa2f7]"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                  </svg>
                  <input
                    ref={newFolderInputRef}
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateFolderSubmit();
                      if (e.key === 'Escape') {
                        setCreatingFolder(false);
                        setNewFolderName('');
                      }
                    }}
                    onBlur={handleCreateFolderSubmit}
                    placeholder="New folder name"
                    className="flex-1 rounded bg-[#292e42] px-2 py-0.5 text-sm text-[#c0caf5] outline-none ring-1 ring-[#7aa2f7]"
                  />
                </div>
                <div />
                <div />
              </div>
            )}

            {sortedEntries.map((file) => (
              <div
                key={file.path}
                className={`grid cursor-pointer grid-cols-[1fr_80px_140px] gap-2 border-b border-[#292e42]/50 px-3 py-1.5 text-sm hover:bg-[#292e42]/50 ${
                  selectedFiles.has(file.path) ? 'bg-[#3d59a1]/30' : ''
                }`}
                onClick={(e) => handleClick(file, e)}
                onDoubleClick={() => handleDoubleClick(file)}
                onContextMenu={(e) => handleContextMenu(e, file)}
                draggable
                onDragStart={(e) => {
                  const files = selectedFiles.has(file.path)
                    ? getSelectedFiles()
                    : [file];
                  e.dataTransfer.setData(
                    'application/json',
                    JSON.stringify({ type, files })
                  );
                  e.dataTransfer.effectAllowed = 'copy';
                }}
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  {file.isDirectory ? (
                    <svg
                      className="h-4 w-4 flex-shrink-0 text-[#7aa2f7]"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                    </svg>
                  ) : (
                    <svg
                      className={`h-4 w-4 flex-shrink-0 ${isTextFile(file.name) ? 'text-[#9ece6a]' : 'text-[#565f89]'}`}
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" />
                    </svg>
                  )}
                  {renaming === file.path ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameSubmit(file);
                        if (e.key === 'Escape') {
                          setRenaming(null);
                          setNewName('');
                        }
                      }}
                      onBlur={() => handleRenameSubmit(file)}
                      className="flex-1 rounded bg-[#292e42] px-1 text-[#c0caf5] outline-none ring-1 ring-[#7aa2f7]"
                    />
                  ) : (
                    <span className={`truncate ${isTextFile(file.name) && !file.isDirectory ? 'text-[#c0caf5]' : 'text-[#c0caf5]'}`}>{file.name}</span>
                  )}
                  {file.isSymlink && (
                    <span className="text-xs text-[#565f89]">→</span>
                  )}
                  {!file.isDirectory && isTextFile(file.name) && type === 'remote' && onEditFile && (
                    <span title="Editable - double-click to edit">
                      <svg
                        className="h-3 w-3 flex-shrink-0 text-[#9ece6a] opacity-60"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                    </span>
                  )}
                </div>
                <span className="text-right text-[#565f89]">
                  {file.isDirectory ? '—' : formatFileSize(file.size)}
                </span>
                <span className="text-right text-[#565f89]">
                  {formatDate(file.modifiedAt)}
                </span>
              </div>
            ))}

          </>
        )}
      </div>

      {/* Status bar */}
      <div className="border-t border-[#292e42] bg-[#1f2335] px-3 py-1 text-xs text-[#565f89]">
        {isLoading ? (
          <span className="flex items-center gap-1">
            <div className="h-3 w-3 animate-spin rounded-full border border-[#7aa2f7] border-t-transparent" />
            Loading...
          </span>
        ) : selectedFiles.size > 0 ? (
          `${selectedFiles.size} selected`
        ) : (
          `${entries.length} items`
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-lg border border-[#292e42] bg-[#1f2335] py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.file && (
            <>
              <button
                onClick={() => {
                  handleDoubleClick(contextMenu.file!);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[#c0caf5] hover:bg-[#292e42]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
                Open
              </button>
              {onEditFile && !contextMenu.file!.isDirectory && isTextFile(contextMenu.file!.name) && (
                <button
                  onClick={() => {
                    onEditFile(contextMenu.file!);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[#c0caf5] hover:bg-[#292e42]"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                  Edit
                </button>
              )}
              <button
                onClick={() => {
                  const files = getSelectedFiles();
                  onTransfer(files.length > 0 ? files : [contextMenu.file!], currentPath);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[#c0caf5] hover:bg-[#292e42]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={type === 'local' ? 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12' : 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4'}
                  />
                </svg>
                {type === 'local' ? 'Upload' : 'Download'}
              </button>
              <div className="my-1 border-t border-[#292e42]" />
              <button
                onClick={() => {
                  setRenaming(contextMenu.file!.path);
                  setNewName(contextMenu.file!.name);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[#c0caf5] hover:bg-[#292e42]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
                Rename
              </button>
              <button
                onClick={() => {
                  const files = getSelectedFiles();
                  onDelete(files.length > 0 ? files : [contextMenu.file!]);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-[#292e42]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                Delete
              </button>
            </>
          )}
          {!contextMenu.file && (
            <>
              <button
                onClick={() => {
                  setCreatingFolder(true);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[#c0caf5] hover:bg-[#292e42]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
                  />
                </svg>
                New Folder
              </button>
              <button
                onClick={() => {
                  onRefresh();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[#c0caf5] hover:bg-[#292e42]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Refresh
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
