import { useState } from 'react';
import { Sidebar } from '../components/Sidebar';
import { TerminalView } from '../components/TerminalView';
import { AddServerModal } from '../components/AddServerModal';
import { UpdateBanner } from '../components/UpdateBanner';
import { useTerminal } from '../contexts/TerminalContext';
import { useServers } from '../contexts/ServersContext';

export function MainLayout() {
  const [isAddServerOpen, setIsAddServerOpen] = useState(false);
  const { activeSessionId, getSession } = useTerminal();
  const { servers } = useServers();
  
  const activeSession = activeSessionId ? getSession(activeSessionId) : null;
  const activeServer = activeSession 
    ? servers.find(s => s.id === activeSession.serverId) 
    : null;

  return (
    <div className="flex h-screen bg-[#1a1b26]">
      <Sidebar onAddServer={() => setIsAddServerOpen(true)} />

      <main className="flex flex-1 flex-col overflow-hidden bg-[#1a1b26]">
        <UpdateBanner />
        
        {activeSessionId ? (
          <TerminalView sessionId={activeSessionId} serverName={activeServer?.name} />
        ) : (
          <div className="flex flex-1 items-center justify-center bg-[#1a1b26]">
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
      </main>

      <AddServerModal
        isOpen={isAddServerOpen}
        onClose={() => setIsAddServerOpen(false)}
      />
    </div>
  );
}
