import { useTerminal } from '../contexts/TerminalContext';
import { useServers } from '../contexts/ServersContext';
import type { ConnectionStatus } from '@magicterm/shared';

export function SessionTabs() {
  const { sessions, activeSessionId, setActiveSession, disconnect } = useTerminal();
  const { servers } = useServers();

  if (sessions.length === 0) return null;

  const getServerName = (serverId: string) => {
    const server = servers.find((s) => s.id === serverId);
    return server?.name || 'Unknown';
  };

  const getStatusColor = (status: ConnectionStatus) => {
    switch (status) {
      case 'connected':
        return 'bg-green-500';
      case 'connecting':
        return 'bg-yellow-500 animate-pulse';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getSessionIcon = (type: 'terminal' | 'sftp') => {
    if (type === 'sftp') {
      return (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      );
    }
    return (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  };

  const handleClose = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    disconnect(sessionId);
  };

  return (
    <div className="flex items-center gap-1 border-t border-[#292e42] bg-[#1f2335] px-2 py-1.5 overflow-x-auto">
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId;
        const serverName = getServerName(session.serverId);
        
        return (
          <button
            key={session.id}
            onClick={() => setActiveSession(session.id)}
            className={`group flex flex-shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
              isActive
                ? 'bg-[#3d59a1] text-white'
                : 'text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]'
            }`}
          >
            {/* Status indicator */}
            <span className={`h-2 w-2 rounded-full ${getStatusColor(session.status)}`} />
            
            <span className={isActive ? 'text-white' : 'text-[#7aa2f7]'}>
              {getSessionIcon(session.type)}
            </span>
            <span className="max-w-[120px] truncate">{serverName}</span>
            <span className="text-xs opacity-60">
              {session.type === 'sftp' ? 'SFTP' : 'SSH'}
            </span>
            
            {/* Close button */}
            <span
              onClick={(e) => handleClose(e, session.id)}
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
