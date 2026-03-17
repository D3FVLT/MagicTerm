import { useServers } from '../contexts/ServersContext';
import { useTerminal } from '../contexts/TerminalContext';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/Button';
import type { Server } from '@magicterm/shared';

interface SidebarProps {
  onAddServer: () => void;
}

export function Sidebar({ onAddServer }: SidebarProps) {
  const { servers, isLoading, removeServer } = useServers();
  const { connect, sessions, activeSessionId, setActiveSession, disconnect } = useTerminal();
  const { logout, user } = useAuth();

  const handleConnect = async (server: Server) => {
    const existingSession = sessions.find((s) => s.serverId === server.id);
    if (existingSession) {
      setActiveSession(existingSession.id);
      return;
    }

    try {
      await connect(server);
    } catch (error) {
      console.error('Failed to connect:', error);
    }
  };

  const handleDisconnect = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await disconnect(sessionId);
  };

  const getServerSession = (serverId: string) => {
    return sessions.find((s) => s.serverId === serverId);
  };

  return (
    <aside className="flex w-64 flex-col border-r border-gray-800 bg-gray-900">
      <div className="drag-region flex h-14 items-center justify-between border-b border-gray-800 px-4">
        <h1 className="font-semibold text-white">MagicTerm</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-400">Servers</h2>
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
              const session = getServerSession(server.id);
              const isActive = session?.id === activeSessionId;
              const isConnected = session?.status === 'connected';
              const isConnecting = session?.status === 'connecting';

              return (
                <li key={server.id}>
                  <button
                    onClick={() => handleConnect(server)}
                    className={`
                      group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors
                      ${isActive ? 'bg-primary-500/20 text-primary-400' : 'text-gray-300 hover:bg-gray-800'}
                    `}
                  >
                    <div
                      className={`
                        h-2 w-2 rounded-full
                        ${isConnected ? 'bg-green-500' : isConnecting ? 'bg-yellow-500 animate-pulse' : 'bg-gray-600'}
                      `}
                    />
                    <div className="flex-1 truncate">
                      <div className="truncate text-sm font-medium">{server.name}</div>
                      <div className="truncate text-xs text-gray-500">
                        {server.port !== 22 ? `:${server.port}` : ''}
                      </div>
                    </div>
                    {session && (
                      <button
                        onClick={(e) => handleDisconnect(session.id, e)}
                        className="hidden rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white group-hover:block"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-gray-800 p-4">
        <div className="mb-3 truncate text-sm text-gray-400">
          {user?.email || 'Unknown user'}
        </div>
        <Button variant="ghost" size="sm" className="w-full" onClick={logout}>
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
    </aside>
  );
}
