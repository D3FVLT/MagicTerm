import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Server, ServerInput, ConnectionType } from '@magicterm/shared';
import {
  listServers,
  listAllServers,
  createServer,
  updateServer,
  deleteServer,
  subscribeToServers,
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
      const filtered = currentOrg
        ? updatedServers.filter((s) => s.orgId === currentOrg.id)
        : updatedServers.filter((s) => s.orgId === null);
      setServers(filtered);
    }, currentOrg?.id);

    return () => {
      unsubscribe();
    };
  }, [currentOrg]);

  const addServer = async (input: ServerInput): Promise<Server> => {
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
      orgId: currentOrg?.id,
    });

    setServers((prev) => [...prev, server]);
    return server;
  };

  const editServer = async (id: string, input: Partial<ServerInput>): Promise<Server> => {
    const updates: Record<string, unknown> = {};

    if (input.name !== undefined) updates.name = input.name;
    if (input.port !== undefined) updates.port = input.port;
    if (input.authType !== undefined) updates.authType = input.authType;
    if (input.connectionType !== undefined) updates.connectionType = input.connectionType;

    if (input.host !== undefined) {
      updates.host = await cryptoManager.encrypt(input.host);
    }
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
  };

  return <ServersContext.Provider value={value}>{children}</ServersContext.Provider>;
}
