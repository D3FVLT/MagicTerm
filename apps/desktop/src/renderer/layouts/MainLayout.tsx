import { useState, useEffect } from 'react';
import { Sidebar } from '../components/Sidebar';
import { TerminalView } from '../components/TerminalView';
import { SFTPView } from '../components/SFTPView';
import { SplitContainer } from '../components/SplitContainer';
import { SessionTabs } from '../components/SessionTabs';
import { AddServerModal } from '../components/AddServerModal';
import { UpdateBanner } from '../components/UpdateBanner';
import { useTerminal } from '../contexts/TerminalContext';
import { useServers } from '../contexts/ServersContext';

export function MainLayout() {
  const [isAddServerOpen, setIsAddServerOpen] = useState(false);
  const { tabs, activeTabId, reconnect, getSession, splitPane, closePane } = useTerminal();
  const { servers } = useServers();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      if (!isMeta) return;

      const activeTab = tabs.find((t) => t.rootSessionId === activeTabId);
      if (!activeTab) return;

      const rootSession = getSession(activeTab.rootSessionId);
      if (rootSession?.type !== 'terminal') return;

      const key = e.key.toLowerCase();

      if (key === 'd') {
        e.preventDefault();
        const direction = e.shiftKey ? 'vertical' : 'horizontal';
        splitPane(activeTab.focusedPaneId, direction);
      }

      if (key === 'w') {
        e.preventDefault();
        closePane(activeTab.focusedPaneId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs, activeTabId, getSession, splitPane, closePane]);

  const getServerName = (serverId: string) => {
    const server = servers.find((s) => s.id === serverId);
    return server?.name;
  };

  const hasActiveTabs = tabs.length > 0;

  return (
    <div className="flex h-screen bg-[#1a1b26]">
      <Sidebar onAddServer={() => setIsAddServerOpen(true)} />

      <main className="flex flex-1 flex-col overflow-hidden bg-[#1a1b26]">
        <UpdateBanner />

        <div className="relative flex-1 overflow-hidden">
          {tabs.map((tab) => {
            const rootSession = getSession(tab.rootSessionId);
            const isActive = tab.rootSessionId === activeTabId;
            const sessionType = rootSession?.type || 'terminal';

            return (
              <div
                key={tab.rootSessionId}
                className={`absolute inset-0 ${
                  isActive ? 'z-10 visible' : 'z-0 invisible'
                }`}
              >
                {sessionType === 'terminal' ? (
                  tab.splitTree.type === 'split' ? (
                    <SplitContainer
                      node={tab.splitTree}
                      tabId={tab.rootSessionId}
                      focusedPaneId={tab.focusedPaneId}
                      isTabActive={isActive}
                    />
                  ) : (
                    <TerminalView
                      sessionId={tab.rootSessionId}
                      serverName={getServerName(tab.serverId)}
                      isActive={isActive}
                      onReconnect={reconnect}
                    />
                  )
                ) : rootSession?.config ? (
                  <SFTPView
                    sessionId={tab.rootSessionId}
                    serverName={getServerName(tab.serverId) || 'SFTP'}
                    config={rootSession.config}
                  />
                ) : null}
              </div>
            );
          })}

          {!hasActiveTabs && (
            <div className="flex h-full items-center justify-center bg-[#1a1b26]">
              <div className="text-center">
                <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3d59a1] to-[#7aa2f7] shadow-lg shadow-[#7aa2f7]/20">
                  <svg
                    className="h-10 w-10 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <h2 className="mb-2 text-xl font-semibold text-[#c0caf5]">
                  No active connection
                </h2>
                <p className="text-sm text-[#565f89]">
                  Select a server from the sidebar to connect
                </p>
              </div>
            </div>
          )}
        </div>

        <SessionTabs />
      </main>

      <AddServerModal
        isOpen={isAddServerOpen}
        onClose={() => setIsAddServerOpen(false)}
      />
    </div>
  );
}
