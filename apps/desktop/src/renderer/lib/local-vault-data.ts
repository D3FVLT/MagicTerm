import type { Server, ServerFolder, ServerInput, Snippet, SnippetInput } from '@magicterm/shared';
import { cryptoManager } from '@magicterm/crypto';
import { getLocalDocument, mutateLocalDocument } from './local-vault-session';

function now(): string {
  return new Date().toISOString();
}

async function assertUniqueHost(host: string, ignoreId?: string): Promise<void> {
  const doc = getLocalDocument();
  if (!doc) throw new Error('Vault is locked');
  for (const existing of doc.servers) {
    if (existing.id === ignoreId) continue;
    try {
      const decrypted = await cryptoManager.decrypt(existing.host);
      if (decrypted.toLowerCase() === host.toLowerCase()) {
        throw new Error(`Server with host "${host}" already exists`);
      }
    } catch (error) {
      if ((error as Error).message?.includes('already exists')) throw error;
    }
  }
}

export async function addLocalServer(input: ServerInput): Promise<Server> {
  await assertUniqueHost(input.host);
  const encryptedHost = await cryptoManager.encrypt(input.host);
  const encryptedUsername = await cryptoManager.encrypt(input.username);
  const encryptedCredentials = await cryptoManager.encrypt(input.credentials);
  const doc = getLocalDocument();
  if (!doc) throw new Error('Vault is locked');
  const server: Server = {
    id: crypto.randomUUID(),
    userId: null,
    orgId: null,
    name: input.name,
    host: encryptedHost,
    port: input.port,
    username: encryptedUsername,
    authType: input.authType,
    connectionType: input.connectionType,
    credentials: encryptedCredentials,
    comment: input.comment,
    isPinned: false,
    sortOrder: doc.servers.length,
    folderId: input.folderId ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
  await mutateLocalDocument((draft) => {
    draft.servers.push(server);
  });
  return server;
}

export async function editLocalServer(id: string, input: Partial<ServerInput>): Promise<Server> {
  const doc = getLocalDocument();
  const current = doc?.servers.find((server) => server.id === id);
  if (!current) throw new Error('Server not found');
  if (input.host !== undefined) await assertUniqueHost(input.host, id);

  const host = input.host !== undefined ? await cryptoManager.encrypt(input.host) : current.host;
  const username = input.username !== undefined ? await cryptoManager.encrypt(input.username) : current.username;
  const credentials = input.credentials !== undefined ? await cryptoManager.encrypt(input.credentials) : current.credentials;
  const updated: Server = {
    ...current,
    name: input.name ?? current.name,
    host,
    port: input.port ?? current.port,
    username,
    authType: input.authType ?? current.authType,
    connectionType: input.connectionType ?? current.connectionType,
    credentials,
    comment: input.comment !== undefined ? input.comment : current.comment,
    folderId: input.folderId !== undefined ? input.folderId : current.folderId,
    orgId: null,
    updatedAt: now(),
  };
  await mutateLocalDocument((draft) => {
    draft.servers = draft.servers.map((server) => (server.id === id ? updated : server));
  });
  return updated;
}

export async function removeLocalServer(id: string): Promise<void> {
  await mutateLocalDocument((draft) => {
    draft.servers = draft.servers.filter((server) => server.id !== id);
  });
}

export async function pinLocalServer(id: string, isPinned: boolean): Promise<void> {
  await mutateLocalDocument((draft) => {
    draft.servers = draft.servers.map((server) => (
      server.id === id ? { ...server, isPinned, updatedAt: now() } : server
    ));
  });
}

export async function reorderLocalServers(orderedIds: string[]): Promise<void> {
  const order = new Map(orderedIds.map((id, index) => [id, index]));
  await mutateLocalDocument((draft) => {
    draft.servers = draft.servers.map((server) => {
      const sortOrder = order.get(server.id);
      return sortOrder === undefined ? server : { ...server, sortOrder };
    });
  });
}

export async function addLocalFolder(name: string): Promise<ServerFolder> {
  const doc = getLocalDocument();
  if (!doc) throw new Error('Vault is locked');
  const folder: ServerFolder = {
    id: crypto.randomUUID(),
    userId: null,
    orgId: null,
    name,
    sortOrder: doc.folders.length,
    createdAt: now(),
    updatedAt: now(),
  };
  await mutateLocalDocument((draft) => {
    draft.folders.push(folder);
  });
  return folder;
}

export async function renameLocalFolder(id: string, name: string): Promise<void> {
  await mutateLocalDocument((draft) => {
    draft.folders = draft.folders.map((folder) => (
      folder.id === id ? { ...folder, name, updatedAt: now() } : folder
    ));
  });
}

export async function removeLocalFolder(id: string): Promise<void> {
  await mutateLocalDocument((draft) => {
    draft.folders = draft.folders.filter((folder) => folder.id !== id);
    draft.servers = draft.servers.map((server) => (
      server.folderId === id ? { ...server, folderId: null } : server
    ));
  });
}

export async function moveLocalServer(id: string, folderId: string | null): Promise<void> {
  await mutateLocalDocument((draft) => {
    draft.servers = draft.servers.map((server) => (
      server.id === id ? { ...server, folderId, updatedAt: now() } : server
    ));
  });
}

export async function addLocalSnippet(input: SnippetInput, sortOrder: number): Promise<Snippet> {
  const value = await cryptoManager.encrypt(input.value);
  const snippet: Snippet = {
    id: crypto.randomUUID(),
    userId: 'local',
    name: input.name,
    value,
    sortOrder,
    createdAt: now(),
    updatedAt: now(),
  };
  await mutateLocalDocument((draft) => {
    draft.snippets.push(snippet);
  });
  return snippet;
}

export async function editLocalSnippet(id: string, input: Partial<SnippetInput>): Promise<Snippet> {
  const doc = getLocalDocument();
  const current = doc?.snippets.find((snippet) => snippet.id === id);
  if (!current) throw new Error('Snippet not found');
  const value = input.value !== undefined ? await cryptoManager.encrypt(input.value) : current.value;
  const updated: Snippet = {
    ...current,
    name: input.name ?? current.name,
    value,
    updatedAt: now(),
  };
  await mutateLocalDocument((draft) => {
    draft.snippets = draft.snippets.map((snippet) => (snippet.id === id ? updated : snippet));
  });
  return updated;
}

export async function removeLocalSnippet(id: string): Promise<void> {
  await mutateLocalDocument((draft) => {
    draft.snippets = draft.snippets.filter((snippet) => snippet.id !== id);
  });
}

export async function reorderLocalSnippets(orderedIds: string[]): Promise<void> {
  const order = new Map(orderedIds.map((id, index) => [id, index]));
  await mutateLocalDocument((draft) => {
    draft.snippets = draft.snippets
      .map((snippet) => {
        const sortOrder = order.get(snippet.id);
        return sortOrder === undefined ? snippet : { ...snippet, sortOrder };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  });
}
