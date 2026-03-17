import { useState, useCallback, useEffect } from 'react';
import { useServers } from '../contexts/ServersContext';
import { useTerminal } from '../contexts/TerminalContext';
import { useAuth } from '../contexts/AuthContext';
import { useOrganizations } from '../contexts/OrganizationsContext';
import { Button } from './ui/Button';
import { OrganizationSwitcher } from './OrganizationSwitcher';
import { PendingInvites } from './PendingInvites';
import { InviteMemberModal } from './InviteMemberModal';
import { EditServerModal } from './EditServerModal';
import { UpdateButton } from './UpdateBanner';
import type { Server, SessionType } from '@magicterm/shared';

const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 400;

interface SidebarProps {
  onAddServer: () => void;
}

export function Sidebar({ onAddServer }: SidebarProps) {
  const { servers, isLoading } = useServers();
  const { connect, sessions, activeSessionId, setActiveSession, disconnect } = useTerminal();
  const { logout, user } = useAuth();
  const { currentOrg, members } = useOrganizations();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = useCallback(() => {
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  const handleConnect = async (server: Server, type: SessionType = 'terminal') => {
    const existingSession = sessions.find((s) => s.serverId === server.id && s.type === type);
    if (existingSession) {
      setActiveSession(existingSession.id);
      return;
    }

    try {
      await connect(server, type);
    } catch (error) {
      console.error('Failed to connect:', error);
    }
  };

  const getServerSessions = (serverId: string) => {
    return sessions.filter((s) => s.serverId === serverId);
  };

  const canInvite = currentOrg && (currentOrg.role === 'owner' || currentOrg.role === 'admin');

  return (
    <aside 
      className="relative flex flex-col border-r border-gray-800 bg-gray-900"
      style={{ width: sidebarWidth }}
    >
      {/* Resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary-500/50 transition-colors"
        onMouseDown={handleMouseDown}
      />
      
      <div className="drag-region flex h-14 items-center border-b border-gray-800 pl-20 pr-4">
        <h1 className="font-semibold text-white">Magic Term</h1>
      </div>

      <div className="border-b border-gray-800 p-4">
        <OrganizationSwitcher />
      </div>

      <PendingInvites />

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-400">
            {currentOrg ? 'Team Servers' : 'Personal Servers'}
          </h2>
          <Button variant="ghost" size="sm" onClick={onAddServer}>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
          </div>
        ) : servers.length === 0 ? (
          <div className="rounded-lg bg-gray-800/50 p-4 text-center">
            <p className="text-sm text-gray-400">No servers yet</p>
            <Button variant="ghost" size="sm" className="mt-2" onClick={onAddServer}>
              Add your first server
            </Button>
          </div>
        ) : (
          <ul className="space-y-1">
            {servers.map((server) => {
              const serverSessions = getServerSessions(server.id);
              const terminalSession = serverSessions.find((s) => s.type === 'terminal');
              const sftpSession = serverSessions.find((s) => s.type === 'sftp');
              const hasActiveSession = serverSessions.some((s) => s.id === activeSessionId);
              const isAnyConnected = serverSessions.some((s) => s.status === 'connected');
              const isAnyConnecting = serverSessions.some((s) => s.status === 'connecting');

              return (
                <li key={server.id} className="relative group/item">
                  <div
                    className={`
                      group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors
                      ${hasActiveSession ? 'bg-primary-500/20 text-primary-400' : 'text-gray-300 hover:bg-gray-800'}
                    `}
                  >
                    <div
                      className={`
                        h-2 w-2 rounded-full flex-shrink-0
                        ${isAnyConnected ? 'bg-green-500' : isAnyConnecting ? 'bg-yellow-500 animate-pulse' : 'bg-gray-600'}
                      `}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{server.name}</span>
                        <span className="text-xs text-gray-500 uppercase flex-shrink-0">
                          {server.connectionType}
                        </span>
                      </div>
                      {server.comment ? (
                        <div className="truncate text-xs text-gray-500 italic">
                          {server.comment}
                        </div>
                      ) : server.port !== 22 ? (
                        <div className="truncate text-xs text-gray-500">
                          :{server.port}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      {/* Terminal button */}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (terminalSession) {
                            setActiveSession(terminalSession.id);
                          } else {
                            handleConnect(server, 'terminal');
                          }
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && handleConnect(server, 'terminal')}
                        className={`rounded p-1 cursor-pointer transition-colors ${
                          terminalSession
                            ? 'text-green-400 hover:bg-gray-700'
                            : 'text-gray-400 hover:bg-gray-700 hover:text-white'
                        }`}
                        title={terminalSession ? 'Open Terminal (connected)' : 'Connect Terminal'}
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                          />
                        </svg>
                      </span>
                      {/* SFTP button */}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (sftpSession) {
                            setActiveSession(sftpSession.id);
                          } else {
                            handleConnect(server, 'sftp');
                          }
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && handleConnect(server, 'sftp')}
                        className={`rounded p-1 cursor-pointer transition-colors ${
                          sftpSession
                            ? 'text-green-400 hover:bg-gray-700'
                            : 'text-gray-400 hover:bg-gray-700 hover:text-white'
                        }`}
                        title={sftpSession ? 'Open SFTP (connected)' : 'Connect SFTP'}
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                          />
                        </svg>
                      </span>
                      {/* Edit button - show on hover */}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingServer(server);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.stopPropagation();
                            setEditingServer(server);
                          }
                        }}
                        className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white cursor-pointer opacity-0 group-hover/item:opacity-100 transition-opacity"
                        title="Edit server"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          />
                        </svg>
                      </span>
                      {/* Disconnect button - show if any session exists */}
                      {serverSessions.length > 0 && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={async (e) => {
                            e.stopPropagation();
                            for (const session of serverSessions) {
                              await disconnect(session.id);
                            }
                          }}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                              for (const session of serverSessions) {
                                await disconnect(session.id);
                              }
                            }
                          }}
                          className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-red-400 cursor-pointer opacity-0 group-hover/item:opacity-100 transition-opacity"
                          title="Disconnect all"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {currentOrg && (
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-400">Members</h2>
              {canInvite && (
                <Button variant="ghost" size="sm" onClick={() => setShowInviteModal(true)}>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                    />
                  </svg>
                </Button>
              )}
            </div>
            <ul className="space-y-1">
              {members
                .filter((m) => m.status === 'active')
                .map((member) => {
                  const isCurrentUser = member.userId === user?.id;
                  const displayName = isCurrentUser ? user?.email : member.email;
                  const displayLabel = isCurrentUser ? 'You' : (displayName || 'Unknown');
                  
                  return (
                    <li
                      key={member.id}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400"
                    >
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-700 text-xs uppercase">
                        {displayName?.[0] || '?'}
                      </div>
                      <span className="flex-1 truncate">{displayLabel}</span>
                      <span className="text-xs text-gray-500">{member.role}</span>
                    </li>
                  );
                })}
              {members.filter((m) => m.status === 'pending').length > 0 && (
                <li className="px-3 py-1 text-xs text-gray-500">
                  {members.filter((m) => m.status === 'pending').length} pending invite(s)
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      <div className="border-t border-gray-800 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="truncate text-sm text-gray-400">
            {user?.email || 'Unknown user'}
          </span>
          <span className="text-xs text-gray-600">v{__APP_VERSION__}</span>
        </div>
        <UpdateButton />
        <Button variant="ghost" size="sm" className="w-full mt-1" onClick={logout}>
          <svg
            className="mr-2 h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          Sign Out
        </Button>
      </div>

      <InviteMemberModal isOpen={showInviteModal} onClose={() => setShowInviteModal(false)} />
      <EditServerModal 
        isOpen={editingServer !== null} 
        onClose={() => setEditingServer(null)} 
        server={editingServer}
      />
    </aside>
  );
}
