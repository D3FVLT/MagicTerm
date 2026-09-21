import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useServers } from '../contexts/ServersContext';
import { useTerminal } from '../contexts/TerminalContext';
import { useAuth } from '../contexts/AuthContext';
import { useOrganizations } from '../contexts/OrganizationsContext';
import { OrganizationSwitcher } from './OrganizationSwitcher';
import { PendingInvites } from './PendingInvites';
import { InviteMemberModal } from './InviteMemberModal';
import { EditServerModal } from './EditServerModal';
import { AddServerModal } from './AddServerModal';
import { SupportCard } from './SupportCard';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import type { Server, ServerFolder, SessionType, MemberRole } from '@magicterm/shared';

/** Section id for servers with folderId === null. */
const UNGROUPED = '__ungrouped__';

interface Section {
  id: string;
  folder: ServerFolder | null;
  servers: Server[];
}

export function VaultsPage() {
  const {
    servers,
    folders,
    isLoading,
    decryptServerHost,
    pinServer,
    reorderServers,
    addFolder,
    renameFolder,
    removeFolder,
    moveServer,
  } = useServers();
  const { connect, getServerSessions, disconnect, setActiveSession } = useTerminal();
  const { user, isLocalOnly } = useAuth();
  const { currentOrg, members, changeRole, remove, deleteOrg } = useOrganizations();

  const [showAddServer, setShowAddServer] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const [serverMenuId, setServerMenuId] = useState<string | null>(null);
  const [memberMenuId, setMemberMenuId] = useState<string | null>(null);
  const memberMenuRef = useRef<HTMLDivElement>(null);
  const [decryptedHosts, setDecryptedHosts] = useState<Record<string, string>>({});
  const [copiedServerId, setCopiedServerId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dragInsert, setDragInsert] = useState<{ id: string; side: 'before' | 'after' } | null>(null);
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);
  const dragItemId = useRef<string | null>(null);

  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [folderNameDraft, setFolderNameDraft] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderError, setFolderError] = useState('');
  const [deleteOrgOpen, setDeleteOrgOpen] = useState(false);
  const [deleteOrgText, setDeleteOrgText] = useState('');
  const [deleteOrgError, setDeleteOrgError] = useState<string | null>(null);
  const [deleteOrgBusy, setDeleteOrgBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const canManageMembers = currentOrg?.role === 'owner' || currentOrg?.role === 'admin';
  const canInvite = canManageMembers;
  const scopeKey = currentOrg?.id ?? 'personal';
  const collapsedStorageKey = `vault-folders-collapsed:${scopeKey}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(collapsedStorageKey);
      setCollapsed(raw ? (JSON.parse(raw) as Record<string, boolean>) : {});
    } catch {
      setCollapsed({});
    }
  }, [collapsedStorageKey]);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(collapsedStorageKey, JSON.stringify(next));
      } catch {
        // Collapsed state is a convenience only — ignore quota/private-mode errors.
      }
      return next;
    });
  }, [collapsedStorageKey]);

  useEffect(() => {
    let cancelled = false;
    async function decryptAll() {
      const hosts: Record<string, string> = {};
      for (const server of servers) {
        try {
          hosts[server.id] = await decryptServerHost(server);
        } catch {
          hosts[server.id] = '***';
        }
      }
      if (!cancelled) setDecryptedHosts(hosts);
    }
    if (servers.length > 0) decryptAll();
    return () => { cancelled = true; };
  }, [servers, decryptServerHost]);

  const sections = useMemo<Section[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    const matches = (server: Server) => {
      if (!q) return true;
      const name = server.name.toLowerCase();
      const host = (decryptedHosts[server.id] || '').toLowerCase();
      const comment = (server.comment || '').toLowerCase();
      return name.includes(q) || host.includes(q) || comment.includes(q);
    };

    const known = new Set(folders.map((f) => f.id));
    const grouped = new Map<string, Server[]>();
    for (const server of servers) {
      if (!matches(server)) continue;
      // A folder deleted by a teammate leaves servers pointing at a stale id.
      const key = server.folderId && known.has(server.folderId) ? server.folderId : UNGROUPED;
      const list = grouped.get(key);
      if (list) list.push(server);
      else grouped.set(key, [server]);
    }

    // Pins stick to the top of their own folder.
    const sortSection = (list: Server[]) =>
      [...list].sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name);
      });

    const result: Section[] = folders.map((folder) => ({
      id: folder.id,
      folder,
      servers: sortSection(grouped.get(folder.id) ?? []),
    }));
    result.push({
      id: UNGROUPED,
      folder: null,
      servers: sortSection(grouped.get(UNGROUPED) ?? []),
    });
    return result;
  }, [servers, folders, searchQuery, decryptedHosts]);

  const visibleCount = sections.reduce((total, section) => total + section.servers.length, 0);
  const hasFolders = folders.length > 0;

  const sectionIdOf = useCallback((server: Server) => {
    if (!server.folderId) return UNGROUPED;
    return folders.some((f) => f.id === server.folderId) ? server.folderId : UNGROUPED;
  }, [folders]);

  const handleDragStart = useCallback((e: React.DragEvent, serverId: string) => {
    dragItemId.current = serverId;
    e.dataTransfer.effectAllowed = 'move';
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.4';
      e.currentTarget.style.transform = 'scale(0.97)';
    }
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
      e.currentTarget.style.transform = '';
    }
    dragItemId.current = null;
    setDragInsert(null);
    setDragOverSection(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, serverId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragItemId.current || dragItemId.current === serverId) {
      setDragInsert(null);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const side = e.clientX < midX ? 'before' : 'after';
    setDragInsert({ id: serverId, side });
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetId: string, sectionId: string) => {
    e.preventDefault();
    const insertInfo = dragInsert;
    setDragInsert(null);
    setDragOverSection(null);
    const sourceId = dragItemId.current;
    if (!sourceId || sourceId === targetId) return;

    const source = servers.find((s) => s.id === sourceId);
    const section = sections.find((s) => s.id === sectionId);
    if (!source || !section) return;

    const ids = section.servers.map((s) => s.id).filter((id) => id !== sourceId);
    let toIdx = ids.indexOf(targetId);
    if (toIdx === -1) return;
    if (insertInfo?.side === 'after') toIdx++;
    ids.splice(toIdx, 0, sourceId);

    try {
      if (sectionIdOf(source) !== sectionId) {
        await moveServer(sourceId, sectionId === UNGROUPED ? null : sectionId);
      }
      await reorderServers(ids);
    } catch (err) {
      console.error('Failed to move server:', err);
    }
  }, [servers, sections, sectionIdOf, dragInsert, moveServer, reorderServers]);

  const handleSectionDrop = useCallback(async (e: React.DragEvent, sectionId: string) => {
    e.preventDefault();
    setDragInsert(null);
    setDragOverSection(null);
    const sourceId = dragItemId.current;
    if (!sourceId) return;

    const source = servers.find((s) => s.id === sourceId);
    const section = sections.find((s) => s.id === sectionId);
    if (!source || !section || sectionIdOf(source) === sectionId) return;

    try {
      await moveServer(sourceId, sectionId === UNGROUPED ? null : sectionId);
      await reorderServers([...section.servers.map((s) => s.id), sourceId]);
    } catch (err) {
      console.error('Failed to move server:', err);
    }
  }, [servers, sections, sectionIdOf, moveServer, reorderServers]);

  useEffect(() => {
    if (!serverMenuId) return;
    const handler = () => setServerMenuId(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [serverMenuId]);

  useEffect(() => {
    if (!folderMenuId) return;
    const handler = () => setFolderMenuId(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [folderMenuId]);

  useEffect(() => {
    if (!memberMenuId) return;
    const handler = (e: MouseEvent) => {
      if (memberMenuRef.current && !memberMenuRef.current.contains(e.target as Node)) {
        setMemberMenuId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [memberMenuId]);

  const handleConnect = async (server: Server, type: SessionType) => {
    try {
      await connect(server, type);
    } catch (err) {
      console.error('Connection failed:', err);
    }
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setFolderError('');
    try {
      await addFolder(name);
      setNewFolderName('');
      setIsCreatingFolder(false);
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : 'Failed to create folder');
    }
  };

  const closeFolderDialog = () => {
    setNewFolderName('');
    setFolderError('');
    setIsCreatingFolder(false);
  };

  const handleDeleteOrg = async () => {
    if (!currentOrg || deleteOrgText !== currentOrg.name) return;
    setDeleteOrgBusy(true);
    setDeleteOrgError(null);
    try {
      await deleteOrg(currentOrg.id);
      setDeleteOrgOpen(false);
      setDeleteOrgText('');
    } catch (err) {
      setDeleteOrgError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeleteOrgBusy(false);
    }
  };

  const handleRenameFolder = async (id: string) => {
    const name = folderNameDraft.trim();
    setRenamingFolderId(null);
    if (!name) return;
    try {
      await renameFolder(id, name);
    } catch (err) {
      console.error('Failed to rename folder:', err);
    }
  };

  const handleDeleteFolder = async (folder: ServerFolder, serverCount: number) => {
    const message = serverCount > 0
      ? `Delete "${folder.name}"? Its ${serverCount} server(s) will move to Ungrouped.`
      : `Delete "${folder.name}"?`;
    if (!window.confirm(message)) return;
    try {
      await removeFolder(folder.id);
    } catch (err) {
      console.error('Failed to delete folder:', err);
    }
  };

  const handleChangeRole = async (memberId: string, newRole: MemberRole) => {
    try {
      await changeRole(memberId, newRole);
      setMemberMenuId(null);
    } catch (err) {
      console.error('Failed to change role:', err);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    try {
      await remove(memberId);
      setMemberMenuId(null);
    } catch (err) {
      console.error('Failed to remove member:', err);
    }
  };

  const renderServerCard = (server: Server, sectionId: string) => {
    const serverSessions = getServerSessions(server.id);
    const terminalSession = serverSessions.find((s) => s.type === 'terminal');
    const sftpSession = serverSessions.find((s) => s.type === 'sftp');
    const isConnected = serverSessions.some((s) => s.status === 'connected');
    const isConnecting = serverSessions.some((s) => s.status === 'connecting');
    const insertBefore = dragInsert?.id === server.id && dragInsert.side === 'before';
    const insertAfter = dragInsert?.id === server.id && dragInsert.side === 'after';

    const hostLabel = `${decryptedHosts[server.id] || '...'}${server.port !== 22 ? `:${server.port}` : ''}`;

    return (
      <div
        key={server.id}
        className={`relative ${serverMenuId === server.id ? 'z-50' : ''}`}
      >
        {insertBefore && (
          <div className="absolute inset-x-0 top-0 z-10 h-0.5 bg-accent" />
        )}
        {insertAfter && (
          <div className="absolute inset-x-0 bottom-0 z-10 h-0.5 bg-accent" />
        )}
        <div
          draggable={!searchQuery}
          onDragStart={(e) => handleDragStart(e, server.id)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOver(e, server.id)}
          onDragLeave={() => setDragInsert(null)}
          onDrop={(e) => { void handleDrop(e, server.id, sectionId); }}
          className="group flex h-9 cursor-pointer items-center gap-3 border-b border-edge px-2 hover:bg-surface-1"
          onClick={() => {
            if (terminalSession) {
              setActiveSession(terminalSession.id);
            } else {
              handleConnect(server, 'terminal');
            }
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              isConnected ? 'bg-success' : isConnecting ? 'bg-warning animate-pulse' : 'bg-fg-subtle'
            }`} />
            <span className="w-48 shrink-0 truncate text-[13px] font-medium text-fg">{server.name}</span>
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                const host = decryptedHosts[server.id];
                if (!host) return;
                void window.electronAPI.clipboard.writeText(hostLabel).then(() => {
                  setCopiedServerId(server.id);
                  window.setTimeout(() => {
                    setCopiedServerId((cur) => (cur === server.id ? null : cur));
                  }, 1200);
                });
              }}
              className="w-36 shrink-0 truncate text-left text-xs tabular-nums text-fg-subtle hover:text-fg"
            >
              {copiedServerId === server.id ? 'Copied' : hostLabel}
            </button>
            {server.comment ? (
              <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle" data-tooltip={server.comment}>
                {server.comment}
              </span>
            ) : (
              <span className="min-w-0 flex-1" />
            )}
            {server.isPinned && (
              <svg className="h-3 w-3 shrink-0 text-fg-subtle" viewBox="0 0 24 24" fill="currentColor" aria-label="Pinned" data-tooltip="Pinned">
                <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5v6l1 2 1-2v-6h5v-2l-2-2z" />
              </svg>
            )}

            {/* More menu */}
            <div className="relative flex-shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setServerMenuId(serverMenuId === server.id ? null : server.id);
                }}
                className={`rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg ${
                  serverMenuId === server.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              </button>
              {serverMenuId === server.id && (
                <div
                  className="animate-slide-down absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] py-1 shadow-xl"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setServerMenuId(null);
                      pinServer(server.id, !server.isPinned);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[var(--fg)] hover:bg-[var(--border)]"
                  >
                    <svg className={`h-3.5 w-3.5 ${server.isPinned ? 'text-[var(--accent)]' : 'text-[var(--fg-subtle)]'}`} fill={server.isPinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                    {server.isPinned ? 'Unpin' : 'Pin to top of folder'}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setServerMenuId(null);
                      setEditingServer(server);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[var(--fg)] hover:bg-[var(--border)]"
                  >
                    <svg className="h-3.5 w-3.5 text-[var(--fg-subtle)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit
                  </button>

                  <div className="my-1 border-t border-[var(--border)]" />
                  <div className="px-3 py-1 text-xs text-[var(--fg-subtle)]">Move to</div>
                  <div className="max-h-40 overflow-y-auto">
                    {folders.map((folder) => (
                      <button
                        key={folder.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setServerMenuId(null);
                          if (server.folderId !== folder.id) {
                            void moveServer(server.id, folder.id).catch((moveErr) => {
                              console.error('Failed to move server:', moveErr);
                            });
                          }
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[var(--fg)] hover:bg-[var(--border)]"
                      >
                        <svg className={`h-3.5 w-3.5 flex-shrink-0 ${server.folderId === folder.id ? 'text-[var(--accent)]' : 'text-[var(--fg-subtle)]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                        </svg>
                        <span className="truncate">{folder.name}</span>
                      </button>
                    ))}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setServerMenuId(null);
                        if (server.folderId !== null) {
                          void moveServer(server.id, null).catch((moveErr) => {
                            console.error('Failed to move server:', moveErr);
                          });
                        }
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[var(--fg)] hover:bg-[var(--border)]"
                    >
                      <svg className={`h-3.5 w-3.5 flex-shrink-0 ${server.folderId === null ? 'text-[var(--accent)]' : 'text-[var(--fg-subtle)]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
                      </svg>
                      Ungrouped
                    </button>
                  </div>

                  {serverSessions.length > 0 && (
                    <>
                      <div className="my-1 border-t border-[var(--border)]" />
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          setServerMenuId(null);
                          for (const session of serverSessions) {
                            await disconnect(session.id);
                          }
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-[var(--border)]"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        Disconnect
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              if (terminalSession) {
                setActiveSession(terminalSession.id);
              } else {
                handleConnect(server, 'terminal');
              }
            }}
            className={`flex shrink-0 items-center gap-1 text-xs ${
              terminalSession ? 'text-success' : 'text-fg-subtle hover:text-fg'
            }`}
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            SSH
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (sftpSession) {
                setActiveSession(sftpSession.id);
              } else {
                handleConnect(server, 'sftp');
              }
            }}
            className={`flex shrink-0 items-center gap-1 text-xs ${
              sftpSession ? 'text-success' : 'text-fg-subtle hover:text-fg'
            }`}
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            SFTP
          </button>
        </div>
      </div>
    );
  };

  const renderSection = (section: Section) => {
    const { id, folder, servers: sectionServers } = section;
    const isCollapsed = Boolean(collapsed[id]);
    const isDropTarget = dragOverSection === id;

    // Only Ungrouped can be empty-but-hidden: an empty folder still needs a
    // header so servers can be dragged into it.
    if (sectionServers.length === 0 && (id === UNGROUPED || searchQuery)) return null;

    return (
      <section
        key={id}
        onDragOver={(e) => {
          if (!dragItemId.current) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDragOverSection(id);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragOverSection((prev) => (prev === id ? null : prev));
        }}
        onDrop={(e) => { void handleSectionDrop(e, id); }}
        className={`pt-3 ${isDropTarget ? 'bg-surface-2' : ''}`}
      >
        <div className="flex h-8 items-center gap-2">
          <button
            onClick={() => toggleCollapsed(id)}
            className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-fg-subtle hover:text-fg"
          >
            <svg
              className={`h-3 w-3 flex-shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
            {renamingFolderId === id ? null : (
              <span className="truncate">
                {folder ? folder.name : 'Ungrouped'}
              </span>
            )}
            <span className="flex-shrink-0 text-xs text-fg-subtle">{sectionServers.length}</span>
          </button>

          {renamingFolderId === id && folder && (
            <input
              autoFocus
              value={folderNameDraft}
              onChange={(e) => setFolderNameDraft(e.target.value)}
              onBlur={() => void handleRenameFolder(folder.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRenameFolder(folder.id);
                if (e.key === 'Escape') setRenamingFolderId(null);
              }}
              className="w-40 border-b border-accent bg-transparent px-0 py-0.5 text-[13px] text-fg outline-none"
            />
          )}

          {folder && renamingFolderId !== id && (
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFolderMenuId(folderMenuId === id ? null : id);
                }}
                className="rounded p-1 text-[var(--fg-subtle)] hover:bg-[var(--border)] hover:text-[var(--fg)]"
              >
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              </button>
              {folderMenuId === id && (
                <div
                  className="animate-slide-down absolute left-0 top-full z-50 mt-1 min-w-[150px] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] py-1 shadow-xl"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => {
                      setFolderMenuId(null);
                      setFolderNameDraft(folder.name);
                      setRenamingFolderId(id);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[var(--fg)] hover:bg-[var(--border)]"
                  >
                    <svg className="h-3.5 w-3.5 text-[var(--fg-subtle)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Rename
                  </button>
                  <button
                    onClick={() => {
                      setFolderMenuId(null);
                      void handleDeleteFolder(folder, sectionServers.length);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-[var(--border)]"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {!isCollapsed && (
          sectionServers.length === 0 ? (
            <div className="border-b border-edge px-2 py-2 text-xs text-fg-subtle">
              Empty
            </div>
          ) : (
            <div>
              {sectionServers.map((server) => renderServerCard(server, id))}
            </div>
          )
        )}
      </section>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-app">
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-edge bg-app px-4 py-2">
        <div className="w-52 shrink-0">
          {isLocalOnly ? (
            <div className="flex h-8 items-center text-sm text-fg">Personal</div>
          ) : (
            <OrganizationSwitcher
              onShowInvites={() => {
                document.getElementById('vault-invites')?.scrollIntoView({ block: 'nearest' });
              }}
            />
          )}
        </div>
        <div className="relative min-w-0 flex-1">
          <svg className="absolute left-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full border-b border-edge bg-transparent py-1 pl-6 pr-6 text-[13px] text-fg placeholder-fg-subtle outline-none focus:border-accent"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-0 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg"
              aria-label="Clear search"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setFolderError(''); setIsCreatingFolder(true); }}>
            New Folder
          </Button>
          <Button size="sm" onClick={() => setShowAddServer(true)}>
            Add Server
          </Button>
        </div>
      </div>

      <div className="px-4">
        {!isLocalOnly && <PendingInvites />}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : servers.length === 0 && !hasFolders ? (
          <div className="px-2 py-6">
            <p className="text-[13px] text-fg-subtle">No servers yet</p>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAddServer(true)}>
              Add your first server
            </Button>
          </div>
        ) : visibleCount === 0 && searchQuery ? (
          <p className="px-2 py-6 text-[13px] text-fg-subtle">No matches for "{searchQuery}"</p>
        ) : hasFolders ? (
          <div>{sections.map(renderSection)}</div>
        ) : (
          <div>
            {sections[sections.length - 1].servers.map((server) =>
              renderServerCard(server, UNGROUPED)
            )}
          </div>
        )}

        {/* Members section */}
        {currentOrg && (
          <div className="mt-4">
            <button
              onClick={() => setShowMembers(!showMembers)}
              className="flex h-8 items-center gap-2"
            >
              <svg
                className={`h-3 w-3 text-fg-subtle transition-transform ${showMembers ? 'rotate-90' : ''}`}
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
              <span className="text-[13px] font-medium text-fg-subtle">
                Members ({members.filter((m) => m.status === 'active').length})
              </span>
              {canInvite && (
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowInviteModal(true);
                  }}
                  className="rounded p-1 text-[var(--fg-subtle)] hover:bg-[var(--border)] hover:text-[var(--fg)]"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                </span>
              )}
            </button>

            {showMembers && (
              <div>
                {members
                  .filter((m) => m.status === 'active')
                  .map((member) => {
                    const isCurrentUser = member.userId === user?.id;
                    const isOwner = member.role === 'owner';
                    const displayName = member.nickname || (isCurrentUser ? user?.email : member.email);
                    const displayLabel = isCurrentUser ? 'You' : (displayName || 'Unknown');
                    const canEdit = canManageMembers && !isCurrentUser && !isOwner;

                    return (
                      <div
                        key={member.id}
                        className="group/member relative flex h-9 items-center gap-3 border-b border-edge px-2"
                      >
                        <span className="w-48 shrink-0 truncate text-[13px] font-medium text-fg">{displayLabel}</span>
                        <span className="ml-auto text-xs text-fg-subtle">{member.role}</span>
                        <div
                          className="relative h-6 w-6 shrink-0"
                          ref={canEdit && memberMenuId === member.id ? memberMenuRef : null}
                        >
                          {canEdit && (
                            <>
                            <button
                              onClick={() => setMemberMenuId(memberMenuId === member.id ? null : member.id)}
                              className="rounded p-1 text-[var(--fg-subtle)] opacity-0 group-hover/member:opacity-100 hover:bg-[var(--border)] hover:text-[var(--fg)]"
                            >
                              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                              </svg>
                            </button>

                            {memberMenuId === member.id && (
                              <div className="animate-slide-down absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] py-1 shadow-xl">
                                <div className="px-3 py-1.5 text-xs text-[var(--fg-subtle)]">Change role</div>
                                {(['admin', 'member', 'viewer'] as MemberRole[]).map((role) => (
                                  <button
                                    key={role}
                                    onClick={() => handleChangeRole(member.id, role)}
                                    disabled={member.role === role}
                                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm ${
                                      member.role === role ? 'text-[var(--fg-subtle)] cursor-default' : 'text-[var(--fg)] hover:bg-[var(--border)]'
                                    }`}
                                  >
                                    {member.role === role && (
                                      <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                      </svg>
                                    )}
                                    <span className={member.role === role ? '' : 'ml-5'}>{role}</span>
                                  </button>
                                ))}
                                <div className="my-1 border-t border-[var(--border)]" />
                                <button
                                  onClick={() => handleRemoveMember(member.id)}
                                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-[var(--border)]"
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                  Remove
                                </button>
                              </div>
                            )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                {members.filter((m) => m.status === 'pending').length > 0 && (
                  <div className="flex h-9 items-center px-2 text-xs text-fg-subtle">
                    {members.filter((m) => m.status === 'pending').length} pending
                  </div>
                )}
                {currentOrg.role === 'owner' && (
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteOrgText('');
                      setDeleteOrgError(null);
                      setDeleteOrgOpen(true);
                    }}
                    className="mt-3 px-2 text-[13px] text-fg-subtle hover:text-danger"
                  >
                    Delete organization
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <SupportCard />
      </div>

      <Modal isOpen={isCreatingFolder} onClose={closeFolderDialog} title="New folder">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreateFolder();
          }}
        >
          <label htmlFor="folder-name" className="mb-1 block text-xs text-fg-subtle">Name</label>
          <input
            id="folder-name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            autoFocus
            className="w-full border-b border-edge bg-transparent py-1 text-[13px] text-fg outline-none focus:border-accent"
          />
          {folderError && <p className="mt-2 text-[13px] text-danger">{folderError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={closeFolderDialog}>Cancel</Button>
            <Button type="submit" size="sm">Create</Button>
          </div>
        </form>
      </Modal>

      {deleteOrgOpen && currentOrg && (
        <div className="no-drag fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => !deleteOrgBusy && setDeleteOrgOpen(false)} />
          <form
            className="relative z-10 w-full max-w-md border border-edge bg-surface-1 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleDeleteOrg();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !deleteOrgBusy) setDeleteOrgOpen(false);
            }}
          >
            <h2 className="text-sm font-medium text-fg">Delete {currentOrg.name}</h2>
            <p className="mt-3 text-[13px] text-fg-subtle">Type {currentOrg.name} to confirm.</p>
            <input
              value={deleteOrgText}
              onChange={(e) => setDeleteOrgText(e.target.value)}
              autoFocus
              className="mt-2 w-full border-b border-edge bg-transparent py-1 text-[13px] text-fg outline-none focus:border-accent"
            />
            {deleteOrgError && <p className="mt-2 text-[13px] text-danger">{deleteOrgError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteOrgOpen(false)} disabled={deleteOrgBusy}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" size="sm" disabled={deleteOrgText !== currentOrg.name || deleteOrgBusy}>
                {deleteOrgBusy ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </form>
        </div>
      )}

      <AddServerModal isOpen={showAddServer} onClose={() => setShowAddServer(false)} />
      <EditServerModal isOpen={editingServer !== null} onClose={() => setEditingServer(null)} server={editingServer} />
      <InviteMemberModal isOpen={showInviteModal} onClose={() => setShowInviteModal(false)} />
    </div>
  );
}
