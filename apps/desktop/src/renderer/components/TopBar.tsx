import { useState, useRef, useEffect } from 'react';
import { useTerminal } from '../contexts/TerminalContext';
import { useServers } from '../contexts/ServersContext';
import { useAuth } from '../contexts/AuthContext';
import { useOrganizations } from '../contexts/OrganizationsContext';
import { SettingsModal } from './SettingsModal';

declare const __APP_VERSION__: string;

function countPanes(node: { type: string; children?: unknown[] }): number {
  if (node.type === 'pane') return 1;
  const children = node.children as { type: string; children?: unknown[] }[];
  if (!children) return 1;
  return children.reduce((sum, child) => sum + countPanes(child), 0);
}

export function TopBar() {
  const { tabs, activeView, setActiveView, disconnect, getSession } = useTerminal();
  const { servers } = useServers();
  const { logout, user } = useAuth();
  const { currentOrg, members } = useOrganizations();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const currentUserNickname = members.find((m) => m.userId === user?.id)?.nickname;
  const displayName = currentUserNickname || user?.email || 'User';

  useEffect(() => {
    if (!showUserMenu) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showUserMenu]);

  const getServerName = (serverId: string) => {
    return servers.find((s) => s.id === serverId)?.name || 'Unknown';
  };

  return (
    <>
      <div className="drag-region flex h-11 flex-shrink-0 items-center border-b border-[#292e42] bg-[#1f2335]">
        {/* macOS traffic lights spacing */}
        <div className="w-[78px] flex-shrink-0" />

        {/* Vaults tab */}
        <button
          onClick={() => setActiveView('vaults')}
          className={`no-drag flex h-full items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors ${
            activeView === 'vaults'
              ? 'border-[#7aa2f7] text-[#dce0f5]'
              : 'border-transparent text-[#787c99] hover:text-[#c0caf5]'
          }`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
          Vaults
        </button>

        {/* Session tabs */}
        <div className="no-drag flex h-full items-center gap-0.5 overflow-x-auto px-1">
          {tabs.map((tab) => {
            const isActive = activeView === tab.rootSessionId;
            const serverName = getServerName(tab.serverId);
            const rootSession = getSession(tab.rootSessionId);
            const sessionType = rootSession?.type || 'terminal';
            const sessionStatus = rootSession?.status || 'disconnected';
            const paneCount = tab.splitTree.type === 'split' ? countPanes(tab.splitTree) : 1;

            const statusColor = sessionStatus === 'connected'
              ? 'bg-green-500'
              : sessionStatus === 'connecting'
              ? 'bg-yellow-500 animate-pulse'
              : sessionStatus === 'error'
              ? 'bg-red-500'
              : 'bg-gray-500';

            return (
              <button
                key={tab.rootSessionId}
                onClick={() => setActiveView(tab.rootSessionId)}
                className={`group flex h-full flex-shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors ${
                  isActive
                    ? 'border-[#7aa2f7] text-[#dce0f5]'
                    : 'border-transparent text-[#787c99] hover:text-[#c0caf5]'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />
                <span className="max-w-[120px] truncate">{serverName}</span>
                <span className="text-xs opacity-50">
                  {sessionType === 'sftp' ? 'SFTP' : 'SSH'}
                </span>
                {paneCount > 1 && (
                  <span className="text-xs opacity-40">[{paneCount}]</span>
                )}
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    disconnect(tab.rootSessionId);
                  }}
                  className="ml-0.5 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[#292e42]"
                  title="Close"
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </span>
              </button>
            );
          })}
        </div>

        {/* Draggable spacer */}
        <div className="flex-1 h-full" />

        {/* Right side: org indicator + user */}
        <div className="no-drag flex items-center gap-2 pr-4">
          {currentOrg && (
            <div className="flex items-center gap-1.5 rounded-md bg-[#292e42] px-2 py-1">
              <div className="flex h-4 w-4 items-center justify-center rounded bg-primary-500/20 text-[10px] font-medium text-primary-400">
                {currentOrg.name[0].toUpperCase()}
              </div>
                   <span className="text-xs text-[#787c99]">{currentOrg.name}</span>
            </div>
          )}

          {/* User menu */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-600 text-xs font-medium text-white uppercase transition-opacity hover:opacity-90"
              title={displayName}
            >
              {displayName[0]}
            </button>

            {showUserMenu && (
              <div className="animate-slide-down absolute right-0 top-full mt-2 z-50 min-w-[200px] rounded-lg border border-[#292e42] bg-[#1f2335] py-1 shadow-xl">
                <div className="border-b border-[#292e42] px-3 py-2">
                  <div className="text-sm text-[#c0caf5]">{displayName}</div>
                  <div className="text-xs text-[#565f89]">v{__APP_VERSION__}</div>
                </div>
                <button
                  onClick={() => {
                    setShowSettingsModal(true);
                    setShowUserMenu(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[#c0caf5] hover:bg-[#292e42]"
                >
                  <svg className="h-4 w-4 text-[#565f89]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Settings
                </button>
                <button
                  onClick={() => {
                    window.electronAPI.updater.check();
                    setShowUserMenu(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[#c0caf5] hover:bg-[#292e42]"
                >
                  <svg className="h-4 w-4 text-[#565f89]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Check for Updates
                </button>
                <div className="my-1 border-t border-[#292e42]" />
                <button
                  onClick={() => {
                    logout();
                    setShowUserMenu(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-[#292e42]"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <SettingsModal isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} />
    </>
  );
}
