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
import { Button } from './ui/Button';
import type { Server, SessionType, MemberRole } from '@magicterm/shared';

export function VaultsPage() {
  const { servers, isLoading, decryptServerHost, pinServer, reorderServers } = useServers();
  const { connect, getServerSessions, disconnect, setActiveSession } = useTerminal();
  const { user } = useAuth();
  const { currentOrg, members, changeRole, remove } = useOrganizations();

  const [showAddServer, setShowAddServer] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const [serverMenuId, setServerMenuId] = useState<string | null>(null);
  const [memberMenuId, setMemberMenuId] = useState<string | null>(null);
  const memberMenuRef = useRef<HTMLDivElement>(null);
  const [decryptedHosts, setDecryptedHosts] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [dragInsert, setDragInsert] = useState<{ id: string; side: 'before' | 'after' } | null>(null);
  const dragItemId = useRef<string | null>(null);

  const canManageMembers = currentOrg?.role === 'owner' || currentOrg?.role === 'admin';
  const canInvite = canManageMembers;

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

  const filteredServers = useMemo(() => {
    if (!searchQuery.trim()) return servers;
    const q = searchQuery.toLowerCase();
    return servers.filter((server) => {
      const name = server.name.toLowerCase();
      const host = (decryptedHosts[server.id] || '').toLowerCase();
      const comment = (server.comment || '').toLowerCase();
      return name.includes(q) || host.includes(q) || comment.includes(q);
    });
  }, [servers, searchQuery, decryptedHosts]);

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

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const insertInfo = dragInsert;
    setDragInsert(null);
    const sourceId = dragItemId.current;
    if (!sourceId || sourceId === targetId) return;

    const ids = servers.map((s) => s.id);
    const fromIdx = ids.indexOf(sourceId);
    let toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    ids.splice(fromIdx, 1);
    if (fromIdx < toIdx) toIdx--;
    if (insertInfo?.side === 'after') toIdx++;
    ids.splice(toIdx, 0, sourceId);
    reorderServers(ids);
  }, [servers, reorderServers, dragInsert]);

  useEffect(() => {
    if (!serverMenuId) return;
    const handler = () => setServerMenuId(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [serverMenuId]);

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

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#1a1b26]">
      <div className="mx-auto w-full max-w-5xl px-8 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <OrganizationSwitcher />
            <h1 className="text-xl font-bold text-[#dce0f5]">
              {currentOrg ? 'Team Servers' : 'Personal Servers'}
            </h1>
          </div>
          <Button onClick={() => setShowAddServer(true)}>
            <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Server
          </Button>
        </div>

        {/* Search */}
        {servers.length > 0 && (
          <div className="relative mb-6">
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#565f89]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name, IP, or comment..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-[#292e42] bg-[#1f2335] py-2 pl-10 pr-4 text-sm text-[#c0caf5] placeholder-[#565f89] outline-none transition-colors focus:border-[#3d59a1]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#565f89] hover:text-[#c0caf5]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Pending invites */}
        <PendingInvites />

        {/* Server grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#7aa2f7] border-t-transparent" />
          </div>
        ) : servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#292e42] py-20">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#292e42]">
              <svg className="h-8 w-8 text-[#565f89]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
            <p className="mb-4 text-sm text-[#787c99]">No servers yet</p>
            <Button variant="ghost" onClick={() => setShowAddServer(true)}>
              Add your first server
            </Button>
          </div>
        ) : filteredServers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <svg className="mb-3 h-10 w-10 text-[#565f89]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-sm text-[#787c99]">No servers match "{searchQuery}"</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {filteredServers.map((server, index) => {
              const serverSessions = getServerSessions(server.id);
              const terminalSession = serverSessions.find((s) => s.type === 'terminal');
              const sftpSession = serverSessions.find((s) => s.type === 'sftp');
              const isConnected = serverSessions.some((s) => s.status === 'connected');
              const isConnecting = serverSessions.some((s) => s.status === 'connecting');
              const insertBefore = dragInsert?.id === server.id && dragInsert.side === 'before';
              const insertAfter = dragInsert?.id === server.id && dragInsert.side === 'after';

              return (
                <div
                  key={server.id}
                  className="animate-card-in relative"
                  style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
                >
                  {insertBefore && (
                    <div className="absolute -left-2 top-0 bottom-0 w-1 rounded-full bg-[#7aa2f7] z-10 animate-pulse" />
                  )}
                  {insertAfter && (
                    <div className="absolute -right-2 top-0 bottom-0 w-1 rounded-full bg-[#7aa2f7] z-10 animate-pulse" />
                  )}
                <div
                  draggable={!searchQuery}
                  onDragStart={(e) => handleDragStart(e, server.id)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, server.id)}
                  onDragLeave={() => setDragInsert(null)}
                  onDrop={(e) => handleDrop(e, server.id)}
                  className={`group relative flex h-full flex-col rounded-xl border p-4 transition-all duration-200 cursor-pointer ${
                    isConnected
                      ? 'border-green-500/30 bg-green-500/5 hover:shadow-lg hover:shadow-green-500/5'
                      : 'border-[#292e42] bg-[#1f2335] hover:border-[#3d59a1]/50 hover:shadow-lg hover:shadow-[#7aa2f7]/5'
                  }`}
                  onClick={() => {
                    if (terminalSession) {
                      setActiveSession(terminalSession.id);
                    } else {
                      handleConnect(server, 'terminal');
                    }
                  }}
                >
                  {/* Pin indicator */}
                  {server.isPinned && (
                    <div className="absolute right-2 top-2 text-[#7aa2f7]">
                      <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    </div>
                  )}

                  {/* Status + Name */}
                  <div className="mb-2 flex items-start justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${
                        isConnected ? 'bg-green-500' : isConnecting ? 'bg-yellow-500 animate-pulse' : 'bg-[#565f89]'
                      }`} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[#dce0f5]">{server.name}</div>
                        <div className="truncate text-xs text-[#787c99]">
                          {decryptedHosts[server.id] || '...'}{server.port !== 22 ? `:${server.port}` : ''}
                        </div>
                      </div>
                    </div>

                    {/* More menu */}
                    <div className="relative flex-shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setServerMenuId(serverMenuId === server.id ? null : server.id);
                        }}
                        className="rounded p-1 text-[#565f89] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[#292e42] hover:text-[#c0caf5]"
                      >
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                        </svg>
                      </button>
                      {serverMenuId === server.id && (
                        <div
                          className="animate-slide-down absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-[#292e42] bg-[#1f2335] py-1 shadow-xl"
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setServerMenuId(null);
                              pinServer(server.id, !server.isPinned);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[#c0caf5] hover:bg-[#292e42]"
                          >
                            <svg className={`h-3.5 w-3.5 ${server.isPinned ? 'text-[#7aa2f7]' : 'text-[#565f89]'}`} fill={server.isPinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                            </svg>
                            {server.isPinned ? 'Unpin' : 'Pin to top'}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setServerMenuId(null);
                              setEditingServer(server);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[#c0caf5] hover:bg-[#292e42]"
                          >
                            <svg className="h-3.5 w-3.5 text-[#565f89]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Edit
                          </button>
                          {serverSessions.length > 0 && (
                            <>
                              <div className="my-1 border-t border-[#292e42]" />
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setServerMenuId(null);
                                  for (const session of serverSessions) {
                                    await disconnect(session.id);
                                  }
                                }}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-[#292e42]"
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

                  {/* Comment */}
                  {server.comment && (
                    <p className="mb-3 line-clamp-2 text-xs text-[#787c99]" title={server.comment}>{server.comment}</p>
                  )}

                  {/* Action buttons */}
                  <div className="mt-auto flex items-center gap-1 pt-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (terminalSession) {
                          setActiveSession(terminalSession.id);
                        } else {
                          handleConnect(server, 'terminal');
                        }
                      }}
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        terminalSession
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-[#292e42] text-[#787c99] hover:text-[#c0caf5]'
                      }`}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        sftpSession
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-[#292e42] text-[#787c99] hover:text-[#c0caf5]'
                      }`}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      SFTP
                    </button>
                  </div>
                </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Members section */}
        {currentOrg && (
          <div className="mt-10">
            <button
              onClick={() => setShowMembers(!showMembers)}
              className="mb-4 flex items-center gap-3"
            >
              <svg
                className={`h-3 w-3 text-[#565f89] transition-transform ${showMembers ? 'rotate-90' : ''}`}
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
              <h2 className="text-sm font-medium text-[#787c99]">
                Members ({members.filter((m) => m.status === 'active').length})
              </h2>
              {canInvite && (
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowInviteModal(true);
                  }}
                  className="rounded p-1 text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                </span>
              )}
            </button>

            {showMembers && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
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
                        className="group/member relative flex items-center gap-2 rounded-lg border border-[#292e42] bg-[#1f2335] px-3 py-2"
                      >
                        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#292e42] text-xs uppercase text-[#c0caf5]">
                          {displayName?.[0] || '?'}
                        </div>
                        <span className="flex-1 truncate text-sm text-[#c0caf5]">{displayLabel}</span>
                        <span className={`text-xs ${member.role === 'owner' ? 'text-yellow-500' : member.role === 'admin' ? 'text-blue-400' : 'text-[#565f89]'}`}>
                          {member.role}
                        </span>

                        {canEdit && (
                          <div className="relative" ref={memberMenuId === member.id ? memberMenuRef : null}>
                            <button
                              onClick={() => setMemberMenuId(memberMenuId === member.id ? null : member.id)}
                              className="rounded p-1 text-[#565f89] opacity-0 group-hover/member:opacity-100 hover:bg-[#292e42] hover:text-[#c0caf5]"
                            >
                              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                              </svg>
                            </button>

                            {memberMenuId === member.id && (
                              <div className="animate-slide-down absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border border-[#292e42] bg-[#1f2335] py-1 shadow-xl">
                                <div className="px-3 py-1.5 text-xs text-[#565f89]">Change role</div>
                                {(['admin', 'member', 'viewer'] as MemberRole[]).map((role) => (
                                  <button
                                    key={role}
                                    onClick={() => handleChangeRole(member.id, role)}
                                    disabled={member.role === role}
                                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm ${
                                      member.role === role ? 'text-[#565f89] cursor-default' : 'text-[#c0caf5] hover:bg-[#292e42]'
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
                                <div className="my-1 border-t border-[#292e42]" />
                                <button
                                  onClick={() => handleRemoveMember(member.id)}
                                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-[#292e42]"
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                  Remove
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                {members.filter((m) => m.status === 'pending').length > 0 && (
                  <div className="flex items-center rounded-lg border border-dashed border-[#292e42] px-3 py-2 text-xs text-[#565f89]">
                    {members.filter((m) => m.status === 'pending').length} pending invite(s)
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <AddServerModal isOpen={showAddServer} onClose={() => setShowAddServer(false)} />
      <EditServerModal isOpen={editingServer !== null} onClose={() => setEditingServer(null)} server={editingServer} />
      <InviteMemberModal isOpen={showInviteModal} onClose={() => setShowInviteModal(false)} />
    </div>
  );
}
