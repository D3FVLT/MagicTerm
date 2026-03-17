import { useState } from 'react';
import { Sidebar } from '../components/Sidebar';
import { TerminalView } from '../components/TerminalView';
import { AddServerModal } from '../components/AddServerModal';
import { useTerminal } from '../contexts/TerminalContext';

export function MainLayout() {
  const [isAddServerOpen, setIsAddServerOpen] = useState(false);
  const { activeSessionId, sessions } = useTerminal();

  return (
    <div className="flex h-screen bg-gray-950">
      <Sidebar onAddServer={() => setIsAddServerOpen(true)} />

      <main className="flex flex-1 flex-col overflow-hidden">
        {activeSessionId ? (
          <TerminalView sessionId={activeSessionId} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-800">
                <svg
                  className="h-8 w-8 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <h2 className="mb-2 text-lg font-medium text-gray-300">
                No active connection
              </h2>
              <p className="text-sm text-gray-500">
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
