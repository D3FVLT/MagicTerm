import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { Server, TerminalSession, ConnectionStatus, SSHConnectionConfig } from '@magicterm/shared';
import { cryptoManager } from '@magicterm/crypto';

interface TerminalContextValue {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  connect: (server: Server) => Promise<string>;
  disconnect: (sessionId: string) => Promise<void>;
  setActiveSession: (sessionId: string | null) => void;
  getSession: (sessionId: string) => TerminalSession | undefined;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

export function useTerminal() {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within a TerminalProvider');
  }
  return context;
}

interface TerminalProviderProps {
  children: ReactNode;
}

export function TerminalProvider({ children }: TerminalProviderProps) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const updateSessionStatus = useCallback(
    (sessionId: string, status: ConnectionStatus, error?: string) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status, error } : s))
      );
    },
    []
  );

  const connect = useCallback(async (server: Server): Promise<string> => {
    const sessionId = crypto.randomUUID();

    const newSession: TerminalSession = {
      id: sessionId,
      serverId: server.id,
      status: 'connecting',
    };

    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(sessionId);

    try {
      const decryptedHost = await cryptoManager.decrypt(server.host);
      const decryptedUsername = await cryptoManager.decrypt(server.username);
      const decryptedCredentials = server.credentials
        ? await cryptoManager.decrypt(server.credentials)
        : undefined;

      const config: SSHConnectionConfig = {
        host: decryptedHost,
        port: server.port,
        username: decryptedUsername,
        authType: server.authType,
      };

      if (server.authType === 'password') {
        config.password = decryptedCredentials;
      } else {
        config.privateKey = decryptedCredentials;
      }

      await window.electronAPI.ssh.connect(sessionId, config);
      updateSessionStatus(sessionId, 'connected');

      return sessionId;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      updateSessionStatus(sessionId, 'error', errorMessage);
      throw error;
    }
  }, [updateSessionStatus]);

  const disconnect = useCallback(async (sessionId: string): Promise<void> => {
    await window.electronAPI.ssh.disconnect(sessionId);
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));

    if (activeSessionId === sessionId) {
      const remaining = sessions.filter((s) => s.id !== sessionId);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
    }
  }, [activeSessionId, sessions]);

  const setActiveSession = useCallback((sessionId: string | null) => {
    setActiveSessionId(sessionId);
  }, []);

  const getSession = useCallback(
    (sessionId: string): TerminalSession | undefined => {
      return sessions.find((s) => s.id === sessionId);
    },
    [sessions]
  );

  const value: TerminalContextValue = {
    sessions,
    activeSessionId,
    connect,
    disconnect,
    setActiveSession,
    getSession,
  };

  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>;
}
