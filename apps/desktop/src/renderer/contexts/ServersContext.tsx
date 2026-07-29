import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import type { Server, ServerInput, ServerFolder } from '@magicterm/shared';
import {
  listServers,
  createServer,
  updateServer,
  deleteServer,
  subscribeToServers,
  toggleServerPin,
  updateServerOrders,
  listServerFolders,
  createServerFolder,
  renameServerFolder,
  deleteServerFolder,
  moveServerToFolder,
} from '@magicterm/supabase-client';
import { cryptoManager } from '@magicterm/crypto';
import { useOrganizations } from './OrganizationsContext';

interface ServersContextValue {
  servers: Server[];
  folders: ServerFolder[];
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
  /** Ordered ids of a single folder (or the Ungrouped section). */
  reorderServers: (orderedIds: string[]) => Promise<void>;
  addFolder: (name: string) => Promise<ServerFolder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  removeFolder: (id: string) => Promise<void>;
  moveServer: (id: string, folderId: string | null) => Promise<void>;
}

/** Pins stick to the top of the folder the server lives in. */
function sortWithinFolder(list: Server[]): Server[] {
  return [...list].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
  });
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
  const [folders, setFolders] = useState<ServerFolder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reorderLockUntil = useRef(0);
  const realtimeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshServers = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const [serverList, folderList] = await Promise.all([
        currentOrg ? listServers(currentOrg.id) : listServers(),
        // Folders are optional: a project that hasn't run add-server-folders.sql
        // yet must still show its servers.
        (currentOrg ? listServerFolders(currentOrg.id) : listServerFolders()).catch(() => []),
      ]);
      setServers(serverList);
      setFolders(folderList);
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
        // Servers may have been moved into a folder created by a teammate.
        void (currentOrg ? listServerFolders(currentOrg.id) : listServerFolders())
          .then(setFolders)
          .catch(() => {});
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
      folderId: input.folderId ?? null,
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
    if (input.folderId !== undefined) updates.folderId = input.folderId;

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
    setServers((prev) => sortWithinFolder(prev.map((s) => (s.id === id ? { ...s, isPinned } : s))));
    reorderLockUntil.current = Date.now() + 3000;
    await toggleServerPin(id, isPinned);
  };

  const reorderServers = async (orderedIds: string[]): Promise<void> => {
    const orders = orderedIds.map((id, index) => ({ id, sort_order: index }));
    const orderMap = new Map(orders.map((o) => [o.id, o.sort_order]));
    setServers((prev) =>
      prev.map((s) => {
        const sortOrder = orderMap.get(s.id);
        return sortOrder === undefined ? s : { ...s, sortOrder };
      })
    );
    reorderLockUntil.current = Date.now() + 5000;
    await updateServerOrders(orders);
    reorderLockUntil.current = Date.now() + 1000;
  };

  const addFolder = async (name: string): Promise<ServerFolder> => {
    const folder = await createServerFolder({ name, orgId: currentOrg?.id });
    setFolders((prev) => [...prev, folder]);
    return folder;
  };

  const renameFolder = async (id: string, name: string): Promise<void> => {
    const previousName = folders.find((f) => f.id === id)?.name;
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
    try {
      await renameServerFolder(id, name);
    } catch (err) {
      if (previousName !== undefined) {
        setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: previousName } : f)));
      }
      throw err;
    }
  };

  const removeFolder = async (id: string): Promise<void> => {
    await deleteServerFolder(id);
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setServers((prev) => prev.map((s) => (s.folderId === id ? { ...s, folderId: null } : s)));
  };

  const moveServer = async (id: string, folderId: string | null): Promise<void> => {
    const previousFolderId = servers.find((s) => s.id === id)?.folderId ?? null;
    setServers((prev) => prev.map((s) => (s.id === id ? { ...s, folderId } : s)));
    reorderLockUntil.current = Date.now() + 3000;
    try {
      await moveServerToFolder(id, folderId);
    } catch (err) {
      // The scope trigger rejects folders from another vault — don't leave the
      // card sitting in a folder the server never joined.
      setServers((prev) => prev.map((s) => (s.id === id ? { ...s, folderId: previousFolderId } : s)));
      throw err;
    }
  };

  const value: ServersContextValue = {
    servers,
    folders,
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
    addFolder,
    renameFolder,
    removeFolder,
    moveServer,
  };

  return <ServersContext.Provider value={value}>{children}</ServersContext.Provider>;
}
