import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { Server, TerminalSession, ConnectionStatus, SSHConnectionConfig, SessionType } from '@magicterm/shared';
import { useServers } from './ServersContext';

export type SplitNode =
  | { type: 'pane'; sessionId: string }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; children: [SplitNode, SplitNode]; ratio: number };

interface ExtendedSession extends TerminalSession {
  type: SessionType;
  config?: SSHConnectionConfig;
}

interface TabState {
  rootSessionId: string;
  serverId: string;
  splitTree: SplitNode;
  focusedPaneId: string;
}

interface TerminalContextValue {
  sessions: ExtendedSession[];
  tabs: TabState[];
  activeTabId: string | null;
  activeSessionId: string | null;
  connect: (server: Server, type?: SessionType) => Promise<string>;
  disconnect: (sessionId: string) => Promise<void>;
  reconnect: (sessionId: string) => Promise<void>;
  setActiveSession: (sessionId: string | null) => void;
  getSession: (sessionId: string) => ExtendedSession | undefined;
  splitPane: (paneSessionId: string, direction: 'horizontal' | 'vertical') => Promise<void>;
  closePane: (paneSessionId: string) => Promise<void>;
  setFocusedPane: (tabId: string, paneSessionId: string) => void;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

export function useTerminal() {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within a TerminalProvider');
  }
  return context;
}

function findNodeBySessionId(node: SplitNode, sessionId: string): SplitNode | null {
  if (node.type === 'pane') {
    return node.sessionId === sessionId ? node : null;
  }
  return findNodeBySessionId(node.children[0], sessionId) || findNodeBySessionId(node.children[1], sessionId);
}

function replaceNode(tree: SplitNode, targetSessionId: string, replacement: SplitNode): SplitNode {
  if (tree.type === 'pane') {
    return tree.sessionId === targetSessionId ? replacement : tree;
  }
  return {
    ...tree,
    children: [
      replaceNode(tree.children[0], targetSessionId, replacement),
      replaceNode(tree.children[1], targetSessionId, replacement),
    ],
  };
}

function removeNode(tree: SplitNode, targetSessionId: string): SplitNode | null {
  if (tree.type === 'pane') {
    return tree.sessionId === targetSessionId ? null : tree;
  }
  const left = removeNode(tree.children[0], targetSessionId);
  const right = removeNode(tree.children[1], targetSessionId);
  if (!left) return right;
  if (!right) return left;
  return { ...tree, children: [left, right] };
}

function getAllSessionIds(node: SplitNode): string[] {
  if (node.type === 'pane') return [node.sessionId];
  return [...getAllSessionIds(node.children[0]), ...getAllSessionIds(node.children[1])];
}

function getFirstPaneId(node: SplitNode): string {
  if (node.type === 'pane') return node.sessionId;
  return getFirstPaneId(node.children[0]);
}

interface TerminalProviderProps {
  children: ReactNode;
}

export function TerminalProvider({ children }: TerminalProviderProps) {
  const { decryptServerHost, decryptServerUsername, decryptServerCredentials } = useServers();
  const [sessions, setSessions] = useState<ExtendedSession[]>([]);
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const activeSessionId = activeTabId;

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

      const newTab: TabState = {
        rootSessionId: sessionId,
        serverId: server.id,
        splitTree: { type: 'pane', sessionId },
        focusedPaneId: sessionId,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(sessionId);

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
    const tab = tabs.find((t) => t.rootSessionId === sessionId);
    if (tab) {
      const allIds = getAllSessionIds(tab.splitTree);
      for (const id of allIds) {
        const session = sessions.find((s) => s.id === id);
        if (session?.type === 'terminal') {
          await window.electronAPI.ssh.disconnect(id);
        } else if (session?.type === 'sftp') {
          await window.electronAPI.sftp.disconnect(id);
        }
      }
      setSessions((prev) => prev.filter((s) => !allIds.includes(s.id)));
      setTabs((prev) => prev.filter((t) => t.rootSessionId !== sessionId));

      if (activeTabId === sessionId) {
        const remaining = tabs.filter((t) => t.rootSessionId !== sessionId);
        setActiveTabId(remaining.length > 0 ? remaining[0].rootSessionId : null);
      }
    } else {
      const session = sessions.find((s) => s.id === sessionId);
      if (session?.type === 'terminal') {
        await window.electronAPI.ssh.disconnect(sessionId);
      } else if (session?.type === 'sftp') {
        await window.electronAPI.sftp.disconnect(sessionId);
      }
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));

      if (activeTabId === sessionId) {
        const remaining = tabs.filter((t) => t.rootSessionId !== sessionId);
        setActiveTabId(remaining.length > 0 ? remaining[0].rootSessionId : null);
      }
    }
  }, [activeTabId, sessions, tabs]);

  const splitPane = useCallback(async (paneSessionId: string, direction: 'horizontal' | 'vertical'): Promise<void> => {
    const tab = tabs.find((t) => findNodeBySessionId(t.splitTree, paneSessionId));
    if (!tab) return;

    const sourceSession = sessions.find((s) => s.id === paneSessionId);
    if (!sourceSession?.config) return;

    const newSessionId = crypto.randomUUID();
    const newSession: ExtendedSession = {
      id: newSessionId,
      serverId: sourceSession.serverId,
      status: 'connecting',
      type: 'terminal',
      config: sourceSession.config,
    };

    setSessions((prev) => [...prev, newSession]);

    const newTree = replaceNode(tab.splitTree, paneSessionId, {
      type: 'split',
      direction,
      children: [
        { type: 'pane', sessionId: paneSessionId },
        { type: 'pane', sessionId: newSessionId },
      ],
      ratio: 0.5,
    });

    setTabs((prev) =>
      prev.map((t) =>
        t.rootSessionId === tab.rootSessionId
          ? { ...t, splitTree: newTree, focusedPaneId: newSessionId }
          : t
      )
    );

    try {
      await window.electronAPI.ssh.connect(newSessionId, sourceSession.config);
      updateSessionStatus(newSessionId, 'connected');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      updateSessionStatus(newSessionId, 'error', errorMessage);
    }
  }, [tabs, sessions, updateSessionStatus]);

  const closePane = useCallback(async (paneSessionId: string): Promise<void> => {
    const tab = tabs.find((t) => findNodeBySessionId(t.splitTree, paneSessionId));
    if (!tab) return;

    const allIds = getAllSessionIds(tab.splitTree);
    if (allIds.length <= 1) {
      await disconnect(tab.rootSessionId);
      return;
    }

    const session = sessions.find((s) => s.id === paneSessionId);
    if (session?.type === 'terminal') {
      await window.electronAPI.ssh.disconnect(paneSessionId);
    }
    setSessions((prev) => prev.filter((s) => s.id !== paneSessionId));

    const newTree = removeNode(tab.splitTree, paneSessionId);
    if (!newTree) {
      await disconnect(tab.rootSessionId);
      return;
    }

    const newFocused = tab.focusedPaneId === paneSessionId ? getFirstPaneId(newTree) : tab.focusedPaneId;
    setTabs((prev) =>
      prev.map((t) =>
        t.rootSessionId === tab.rootSessionId
          ? { ...t, splitTree: newTree, focusedPaneId: newFocused }
          : t
      )
    );
  }, [tabs, sessions, disconnect]);

  const setActiveSession = useCallback((sessionId: string | null) => {
    setActiveTabId(sessionId);
  }, []);

  const setFocusedPane = useCallback((tabId: string, paneSessionId: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.rootSessionId === tabId ? { ...t, focusedPaneId: paneSessionId } : t
      )
    );
  }, []);

  const getSession = useCallback(
    (sessionId: string): ExtendedSession | undefined => {
      return sessions.find((s) => s.id === sessionId);
    },
    [sessions]
  );

  const value: TerminalContextValue = {
    sessions,
    tabs,
    activeTabId,
    activeSessionId,
    connect,
    disconnect,
    reconnect,
    setActiveSession,
    getSession,
    splitPane,
    closePane,
    setFocusedPane,
  };

  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>;
}
