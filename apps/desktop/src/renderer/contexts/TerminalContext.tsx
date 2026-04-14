import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { Server, TerminalSession, ConnectionStatus, SSHConnectionConfig, SessionType } from '@magicterm/shared';
import { useServers } from './ServersContext';

interface ExtendedSession extends TerminalSession {
  type: SessionType;
  config?: SSHConnectionConfig;
}

interface TerminalContextValue {
  sessions: ExtendedSession[];
  activeSessionId: string | null;
  connect: (server: Server, type?: SessionType) => Promise<string>;
  disconnect: (sessionId: string) => Promise<void>;
  reconnect: (sessionId: string) => Promise<void>;
  setActiveSession: (sessionId: string | null) => void;
  getSession: (sessionId: string) => ExtendedSession | undefined;
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
  const { decryptServerHost, decryptServerUsername, decryptServerCredentials } = useServers();
  const [sessions, setSessions] = useState<ExtendedSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const updateSessionStatus = useCallback(
    (sessionId: string, status: ConnectionStatus, error?: string) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status, error } : s))
      );
    },
    []
  );

  const connect = useCallback(async (server: Server, type: SessionType = 'terminal'): Promise<string> => {
    const sessionId = crypto.randomUUID();

    try {
      const decryptedHost = await decryptServerHost(server);
      const decryptedUsername = await decryptServerUsername(server);
      const decryptedCredentials = await decryptServerCredentials(server);

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

      const newSession: ExtendedSession = {
        id: sessionId,
        serverId: server.id,
        status: 'connecting',
        type,
        config,
      };

      setSessions((prev) => [...prev, newSession]);
      setActiveSessionId(sessionId);

      if (type === 'terminal') {
        await window.electronAPI.ssh.connect(sessionId, config);
      }
      updateSessionStatus(sessionId, 'connected');

      return sessionId;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      updateSessionStatus(sessionId, 'error', errorMessage);
      throw error;
    }
  }, [decryptServerHost, decryptServerUsername, decryptServerCredentials, updateSessionStatus]);

  const reconnect = useCallback(async (sessionId: string): Promise<void> => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session?.config) {
      throw new Error('No config available for reconnect');
    }

    updateSessionStatus(sessionId, 'connecting');
    try {
      await window.electronAPI.ssh.connect(sessionId, session.config);
      updateSessionStatus(sessionId, 'connected');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Reconnect failed';
      updateSessionStatus(sessionId, 'error', errorMessage);
      throw error;
    }
  }, [sessions, updateSessionStatus]);

  const disconnect = useCallback(async (sessionId: string): Promise<void> => {
    const session = sessions.find((s) => s.id === sessionId);
    if (session?.type === 'terminal') {
      await window.electronAPI.ssh.disconnect(sessionId);
    } else if (session?.type === 'sftp') {
      await window.electronAPI.sftp.disconnect(sessionId);
    }
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
    (sessionId: string): ExtendedSession | undefined => {
      return sessions.find((s) => s.id === sessionId);
    },
    [sessions]
  );

  const value: TerminalContextValue = {
    sessions,
    activeSessionId,
    connect,
    disconnect,
    reconnect,
    setActiveSession,
    getSession,
  };

  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>;
}
