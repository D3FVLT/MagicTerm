import { useTerminal } from '../contexts/TerminalContext';
import { useServers } from '../contexts/ServersContext';

export function SessionTabs() {
  const { tabs, activeTabId, setActiveSession, disconnect, getSession } = useTerminal();
  const { servers } = useServers();

  if (tabs.length === 0) return null;

  const getServerName = (serverId: string) => {
    const server = servers.find((s) => s.id === serverId);
    return server?.name || 'Unknown';
  };

  const handleClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    disconnect(tabId);
  };

  return (
    <div className="flex items-center gap-1 border-t border-[#292e42] bg-[#1f2335] px-2 py-1.5 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.rootSessionId === activeTabId;
        const serverName = getServerName(tab.serverId);
        const rootSession = getSession(tab.rootSessionId);
        const sessionType = rootSession?.type || 'terminal';
        const sessionStatus = rootSession?.status || 'disconnected';

        const statusColor = sessionStatus === 'connected'
          ? 'bg-green-500'
          : sessionStatus === 'connecting'
          ? 'bg-yellow-500 animate-pulse'
          : sessionStatus === 'error'
          ? 'bg-red-500'
          : 'bg-gray-500';

        const sessionIcon = sessionType === 'sftp' ? (
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        ) : (
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        );

        const paneCount = tab.splitTree.type === 'split' ? countPanes(tab.splitTree) : 1;

        return (
          <button
            key={tab.rootSessionId}
            onClick={() => setActiveSession(tab.rootSessionId)}
            className={`group flex flex-shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
              isActive
                ? 'bg-[#3d59a1] text-white'
                : 'text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${statusColor}`} />
            <span className={isActive ? 'text-white' : 'text-[#7aa2f7]'}>
              {sessionIcon}
            </span>
            <span className="max-w-[120px] truncate">{serverName}</span>
            <span className="text-xs opacity-60">
              {sessionType === 'sftp' ? 'SFTP' : 'SSH'}
            </span>
            {paneCount > 1 && (
              <span className="text-xs opacity-50">[{paneCount}]</span>
            )}

            <span
              onClick={(e) => handleClose(e, tab.rootSessionId)}
              className={`ml-1 rounded p-0.5 transition-colors ${
                isActive
                  ? 'hover:bg-white/20'
                  : 'opacity-0 group-hover:opacity-100 hover:bg-[#292e42]'
              }`}
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
  );
}

function countPanes(node: { type: string; children?: unknown[] }): number {
  if (node.type === 'pane') return 1;
  const children = node.children as { type: string; children?: unknown[] }[];
  if (!children) return 1;
  return children.reduce((sum, child) => sum + countPanes(child), 0);
}
