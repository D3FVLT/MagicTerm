import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import type { Server, ServerInput } from '@magicterm/shared';
import {
  listServers,
  createServer,
  updateServer,
  deleteServer,
  subscribeToServers,
  toggleServerPin,
  updateServerOrders,
} from '@magicterm/supabase-client';
import { cryptoManager } from '@magicterm/crypto';
import { useOrganizations } from './OrganizationsContext';

interface ServersContextValue {
  servers: Server[];
  isLoading: boolean;
  error: string | null;
  addServer: (input: ServerInput) => Promise<Server>;
  editServer: (id: string, input: Partial<ServerInput>) => Promise<Server>;
  removeServer: (id: string) => Promise<void>;
  refreshServers: () => Promise<void>;
  decryptServerCredentials: (server: Server) => Promise<string | undefined>;
  decryptServerHost: (server: Server) => Promise<string>;
  decryptServerUsername: (server: Server) => Promise<string>;
  pinServer: (id: string, isPinned: boolean) => Promise<void>;
  reorderServers: (orderedIds: string[]) => Promise<void>;
}

const ServersContext = createContext<ServersContextValue | null>(null);

export function useServers() {
  const context = useContext(ServersContext);
  if (!context) {
    throw new Error('useServers must be used within a ServersProvider');
  }
  return context;
}

interface ServersProviderProps {
  children: ReactNode;
}

export function ServersProvider({ children }: ServersProviderProps) {
  const { currentOrg } = useOrganizations();
  const [servers, setServers] = useState<Server[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reorderLockUntil = useRef(0);
  const realtimeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshServers = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const serverList = currentOrg
        ? await listServers(currentOrg.id)
        : await listServers();
      setServers(serverList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load servers');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshServers();

    const unsubscribe = subscribeToServers((updatedServers) => {
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current);
      realtimeDebounce.current = setTimeout(() => {
        if (Date.now() < reorderLockUntil.current) return;
        const filtered = currentOrg
          ? updatedServers.filter((s) => s.orgId === currentOrg.id)
          : updatedServers.filter((s) => s.orgId === null);
        setServers(filtered);
      }, 500);
    }, currentOrg?.id);

    return () => {
      unsubscribe();
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current);
    };
  }, [currentOrg]);

  const addServer = async (input: ServerInput): Promise<Server> => {
    // Check for duplicate host in current scope
    for (const existingServer of servers) {
      try {
        const decryptedHost = await cryptoManager.decrypt(existingServer.host);
        if (decryptedHost.toLowerCase() === input.host.toLowerCase()) {
          throw new Error(`Server with host "${input.host}" already exists`);
        }
      } catch (e) {
        // If decryption fails, skip this server
        if ((e as Error).message?.includes('already exists')) throw e;
      }
    }

    const encryptedHost = await cryptoManager.encrypt(input.host);
    const encryptedUsername = await cryptoManager.encrypt(input.username);
    const encryptedCredentials = await cryptoManager.encrypt(input.credentials);

    const server = await createServer({
      name: input.name,
      host: encryptedHost,
      port: input.port,
      username: encryptedUsername,
      authType: input.authType,
      connectionType: input.connectionType,
      credentials: encryptedCredentials,
      comment: input.comment,
      orgId: currentOrg?.id,
    });

    setServers((prev) => [...prev, server]);
    return server;
  };

  const editServer = async (id: string, input: Partial<ServerInput>): Promise<Server> => {
    const updates: Record<string, unknown> = {};

    // Check for duplicate host if host is being changed
    if (input.host !== undefined) {
      for (const existingServer of servers) {
        if (existingServer.id === id) continue; // Skip self
        try {
          const decryptedHost = await cryptoManager.decrypt(existingServer.host);
          if (decryptedHost.toLowerCase() === input.host.toLowerCase()) {
            throw new Error(`Server with host "${input.host}" already exists`);
          }
        } catch (e) {
          if ((e as Error).message?.includes('already exists')) throw e;
        }
      }
      updates.host = await cryptoManager.encrypt(input.host);
    }

    if (input.name !== undefined) updates.name = input.name;
    if (input.port !== undefined) updates.port = input.port;
    if (input.authType !== undefined) updates.authType = input.authType;
    if (input.connectionType !== undefined) updates.connectionType = input.connectionType;
    if (input.comment !== undefined) updates.comment = input.comment;

    if (input.username !== undefined) {
      updates.username = await cryptoManager.encrypt(input.username);
    }
    if (input.credentials !== undefined) {
      updates.credentials = await cryptoManager.encrypt(input.credentials);
    }

    const updatedServer = await updateServer(id, updates as Partial<ServerInput>);
    setServers((prev) => prev.map((s) => (s.id === id ? updatedServer : s)));
    return updatedServer;
  };

  const removeServer = async (id: string): Promise<void> => {
    await deleteServer(id);
    setServers((prev) => prev.filter((s) => s.id !== id));
  };

  const decryptServerCredentials = async (server: Server): Promise<string | undefined> => {
    if (!server.credentials) return undefined;
    return cryptoManager.decrypt(server.credentials);
  };

  const decryptServerHost = async (server: Server): Promise<string> => {
    return cryptoManager.decrypt(server.host);
  };

  const decryptServerUsername = async (server: Server): Promise<string> => {
    return cryptoManager.decrypt(server.username);
  };

  const pinServer = async (id: string, isPinned: boolean): Promise<void> => {
    setServers((prev) => {
      const updated = prev.map((s) => (s.id === id ? { ...s, isPinned } : s));
      return [...updated].sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name);
      });
    });
    reorderLockUntil.current = Date.now() + 3000;
    await toggleServerPin(id, isPinned);
  };

  const reorderServers = async (orderedIds: string[]): Promise<void> => {
    const orders = orderedIds.map((id, index) => ({ id, sort_order: index }));
    setServers((prev) => {
      const map = new Map(prev.map((s) => [s.id, s]));
      return orderedIds
        .map((id, index) => {
          const server = map.get(id);
          return server ? { ...server, sortOrder: index } : null;
        })
        .filter((s): s is Server => s !== null);
    });
    reorderLockUntil.current = Date.now() + 5000;
    await updateServerOrders(orders);
    reorderLockUntil.current = Date.now() + 1000;
  };

  const value: ServersContextValue = {
    servers,
    isLoading,
    error,
    addServer,
    editServer,
    removeServer,
    refreshServers,
    decryptServerCredentials,
    decryptServerHost,
    decryptServerUsername,
    pinServer,
    reorderServers,
  };

  return <ServersContext.Provider value={value}>{children}</ServersContext.Provider>;
}
