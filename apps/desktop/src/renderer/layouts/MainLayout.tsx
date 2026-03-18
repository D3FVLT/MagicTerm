import { useState } from 'react';
import { Sidebar } from '../components/Sidebar';
import { TerminalView } from '../components/TerminalView';
import { SFTPView } from '../components/SFTPView';
import { SessionTabs } from '../components/SessionTabs';
import { AddServerModal } from '../components/AddServerModal';
import { UpdateBanner } from '../components/UpdateBanner';
import { useTerminal } from '../contexts/TerminalContext';
import { useServers } from '../contexts/ServersContext';

export function MainLayout() {
  const [isAddServerOpen, setIsAddServerOpen] = useState(false);
  const { sessions, activeSessionId } = useTerminal();
  const { servers } = useServers();

  const getServerName = (serverId: string) => {
    const server = servers.find((s) => s.id === serverId);
    return server?.name;
  };

  const hasActiveSessions = sessions.length > 0;

  return (
    <div className="flex h-screen bg-[#1a1b26]">
      <Sidebar onAddServer={() => setIsAddServerOpen(true)} />

      <main className="flex flex-1 flex-col overflow-hidden bg-[#1a1b26]">
        <UpdateBanner />
        
        {/* Content area - render all sessions, show only active */}
        <div className="relative flex-1 overflow-hidden">
          {/* Render all terminal sessions - hidden ones keep their state */}
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`absolute inset-0 ${
                session.id === activeSessionId ? 'z-10 visible' : 'z-0 invisible'
              }`}
            >
              {session.type === 'terminal' ? (
                <TerminalView
                  sessionId={session.id}
                  serverName={getServerName(session.serverId)}
                  isActive={session.id === activeSessionId}
                />
              ) : session.config ? (
                <SFTPView
                  sessionId={session.id}
                  serverName={getServerName(session.serverId)}
                  config={session.config}
                />
              ) : null}
            </div>
          ))}

          {/* Empty state when no sessions */}
          {!hasActiveSessions && (
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

        {/* Session tabs at the bottom */}
        <SessionTabs />
      </main>

      <AddServerModal
        isOpen={isAddServerOpen}
        onClose={() => setIsAddServerOpen(false)}
      />
    </div>
  );
}
