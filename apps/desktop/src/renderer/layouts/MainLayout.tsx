import { useEffect } from 'react';
import { TerminalView } from '../components/TerminalView';
import { SFTPView } from '../components/SFTPView';
import { SplitContainer } from '../components/SplitContainer';
import { TopBar } from '../components/TopBar';
import { VaultsPage } from '../components/VaultsPage';
import { UpdateBanner } from '../components/UpdateBanner';
import { useTerminal } from '../contexts/TerminalContext';
import { useServers } from '../contexts/ServersContext';

export function MainLayout() {
  const { tabs, activeTabId, activeView, reconnect, getSession, splitPane, closePane } = useTerminal();
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
    return servers.find((s) => s.id === serverId)?.name;
  };

  return (
    <div className="flex h-screen flex-col bg-[#1a1b26]">
      <TopBar />
      <UpdateBanner />

      <div className="relative flex-1 overflow-hidden">
        {/* Vaults page */}
        <div className={`absolute inset-0 ${activeView === 'vaults' ? 'z-10 visible' : 'z-0 invisible'}`}>
          <VaultsPage />
        </div>

        {/* Session views */}
        {tabs.map((tab) => {
          const rootSession = getSession(tab.rootSessionId);
          const isActive = activeView === tab.rootSessionId;
          const sessionType = rootSession?.type || 'terminal';

          return (
            <div
              key={tab.rootSessionId}
              className={`absolute inset-0 ${isActive ? 'z-10 visible' : 'z-0 invisible'}`}
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
      </div>
    </div>
  );
}
