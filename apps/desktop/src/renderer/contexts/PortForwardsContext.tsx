import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PortForwardPreset, PortForwardStatus } from '../../common/port-forward';
import { useTerminal } from './TerminalContext';
import { useServers } from './ServersContext';

type StatusMap = Record<string, PortForwardStatus>;

interface PortForwardsContextValue {
  /** Status of each running or failed forward in a tab, by preset id. */
  statusesFor: (tabId: string) => StatusMap;
  start: (tabId: string, preset: PortForwardPreset) => Promise<PortForwardStatus>;
  stop: (tabId: string, presetId: string) => Promise<void>;
}

const PortForwardsContext = createContext<PortForwardsContextValue | null>(null);

export function usePortForwards() {
  const context = useContext(PortForwardsContext);
  if (!context) {
    throw new Error('usePortForwards must be used within a PortForwardsProvider');
  }
  return context;
}

export function PortForwardsProvider({ children }: { children: ReactNode }) {
  const { tabs, sessions } = useTerminal();
  const { servers, decryptServerForwards } = useServers();
  const [statuses, setStatuses] = useState<Record<string, StatusMap>>({});
  const autoStarted = useRef(new Set<string>());

  const apply = useCallback((tabId: string, status: PortForwardStatus) => {
    setStatuses((prev) => {
      const forTab = { ...(prev[tabId] ?? {}) };
      if (status.state === 'stopped') delete forTab[status.presetId];
      else forTab[status.presetId] = status;
      return { ...prev, [tabId]: forTab };
    });
  }, []);

  useEffect(() => window.electronAPI.portForward.onStatus(apply), [apply]);

  // Closed tabs: TerminalContext stops their forwards; forget their state here.
  useEffect(() => {
    const open = new Set(tabs.map((t) => t.rootSessionId));
    setStatuses((prev) => {
      const stale = Object.keys(prev).filter((id) => !open.has(id));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      for (const id of stale) delete next[id];
      return next;
    });
    for (const id of autoStarted.current) {
      if (!open.has(id)) autoStarted.current.delete(id);
    }
  }, [tabs]);

  const configFor = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.rootSessionId === tabId);
      if (!tab) return undefined;
      // The root pane may have been closed in a split; any pane of the server has the same config.
      return (
        sessions.find((s) => s.id === tabId)?.config
        ?? sessions.find((s) => s.serverId === tab.serverId && s.config)?.config
      );
    },
    [tabs, sessions]
  );

  const start = useCallback(
    async (tabId: string, preset: PortForwardPreset): Promise<PortForwardStatus> => {
      const config = configFor(tabId);
      if (!config) {
        const status: PortForwardStatus = {
          presetId: preset.id,
          state: 'error',
          error: 'This tab has no connection details. Reconnect and try again.',
          connections: 0,
        };
        apply(tabId, status);
        return status;
      }
      apply(tabId, { presetId: preset.id, state: 'starting', connections: 0 });
      const status = await window.electronAPI.portForward.start(tabId, config, preset);
      apply(tabId, status);
      return status;
    },
    [apply, configFor]
  );

  const stop = useCallback(
    async (tabId: string, presetId: string) => {
      await window.electronAPI.portForward.stop(tabId, presetId);
      apply(tabId, { presetId, state: 'stopped', connections: 0 });
    },
    [apply]
  );

  // Start presets marked "start on connect" once a tab's first connection succeeds.
  useEffect(() => {
    for (const tab of tabs) {
      if (autoStarted.current.has(tab.rootSessionId)) continue;
      const root = sessions.find((s) => s.id === tab.rootSessionId);
      if (root?.status !== 'connected' || root.type !== 'terminal') continue;
      const server = servers.find((s) => s.id === tab.serverId);
      if (!server) continue;
      autoStarted.current.add(tab.rootSessionId);
      if (!server.portForwards) continue;
      void decryptServerForwards(server)
        .then((presets) => Promise.all(presets.filter((p) => p.autoStart).map((p) => start(tab.rootSessionId, p))))
        .catch(() => {});
    }
  }, [tabs, sessions, servers, decryptServerForwards, start]);

  const statusesFor = useCallback((tabId: string) => statuses[tabId] ?? {}, [statuses]);

  return (
    <PortForwardsContext.Provider value={{ statusesFor, start, stop }}>
      {children}
    </PortForwardsContext.Provider>
  );
}
