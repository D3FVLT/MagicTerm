import type { LocalVaultDocument, Server, ServerFolder, Snippet } from '@magicterm/shared';

export interface MoveVaultCloud {
  listPersonal: () => Promise<{
    servers: Server[];
    folders: ServerFolder[];
    snippets: Snippet[];
  }>;
  createFolder: (folder: ServerFolder) => Promise<ServerFolder>;
  createServer: (server: Server, folderId: string | null) => Promise<Server>;
  createSnippet: (snippet: Snippet) => Promise<Snippet>;
  removeFolder: (id: string) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  removeSnippet: (id: string) => Promise<void>;
  getVerifier: () => Promise<string | null>;
  setVerifier: (verifier: string) => Promise<void>;
}

export interface MoveVaultCrypto {
  decrypt: (value: string) => Promise<string>;
  encrypt: (value: string) => Promise<string>;
  useNextPassword: () => void;
  restorePassword: () => void;
}

export interface MoveVaultInput {
  confirmed: boolean;
  sameMasterPassword: boolean;
  /** True when the typed password matches the local verifier. Required for a same-password move. */
  localPasswordOk: boolean;
  /** True when the account has no verifier yet, or the typed password matches it. */
  accountPasswordOk: boolean;
  localVerifier: string | null;
  /** Builds a scrypt verifier for the new master password and stores it. Called only after the account vault is confirmed empty. */
  createNextVerifier: () => Promise<string>;
  local: LocalVaultDocument;
  cloud: MoveVaultCloud;
  crypto: MoveVaultCrypto;
  deleteLocalFile: () => Promise<void>;
  disableLocalMode: () => Promise<void>;
  restoreLocalVerifier: (verifier: string) => Promise<void>;
}

export type MoveVaultResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'not_confirmed' | 'cloud_not_empty' | 'password_rejected' | 'upload_failed' | 'mismatch';
    };

function folderName(folders: ServerFolder[], id: string | null): string {
  if (!id) return '';
  return folders.find((folder) => folder.id === id)?.name ?? '';
}

function serverKey(server: Server, folders: ServerFolder[]): string {
  return [
    server.name,
    server.host,
    String(server.port),
    server.username,
    server.credentials ?? '',
    server.authType,
    server.connectionType,
    folderName(folders, server.folderId),
  ].join('\u0000');
}

function snippetKey(snippet: Snippet): string {
  return `${snippet.name}\u0000${snippet.value}`;
}

function folderKey(folder: ServerFolder): string {
  return folder.name;
}

function sameMultiset(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  for (const item of left) counts.set(item, (counts.get(item) ?? 0) + 1);
  for (const item of right) {
    const next = (counts.get(item) ?? 0) - 1;
    if (next < 0) return false;
    counts.set(item, next);
  }
  return true;
}

function listsMatch(
  uploaded: LocalVaultDocument,
  remote: { servers: Server[]; folders: ServerFolder[]; snippets: Snippet[] }
): boolean {
  return sameMultiset(
    uploaded.servers.map((server) => serverKey(server, uploaded.folders)),
    remote.servers.map((server) => serverKey(server, remote.folders))
  ) && sameMultiset(
    uploaded.folders.map(folderKey),
    remote.folders.map(folderKey)
  ) && sameMultiset(
    uploaded.snippets.map(snippetKey),
    remote.snippets.map(snippetKey)
  );
}

async function reencrypt(local: LocalVaultDocument, crypto: MoveVaultCrypto): Promise<LocalVaultDocument> {
  const servers = await Promise.all(local.servers.map(async (server) => ({
    ...server,
    hostPlain: await crypto.decrypt(server.host),
    usernamePlain: await crypto.decrypt(server.username),
    credentialsPlain: server.credentials ? await crypto.decrypt(server.credentials) : undefined,
  })));
  const snippets = await Promise.all(local.snippets.map(async (snippet) => ({
    ...snippet,
    valuePlain: await crypto.decrypt(snippet.value),
  })));

  crypto.useNextPassword();
  try {
    return {
      version: 1 as const,
      folders: local.folders.map((folder) => ({ ...folder, orgId: null })),
      servers: await Promise.all(servers.map(async (server) => ({
        id: server.id,
        userId: server.userId,
        orgId: null,
        name: server.name,
        host: await crypto.encrypt(server.hostPlain),
        port: server.port,
        username: await crypto.encrypt(server.usernamePlain),
        authType: server.authType,
        connectionType: server.connectionType,
        credentials: server.credentialsPlain === undefined ? undefined : await crypto.encrypt(server.credentialsPlain),
        comment: server.comment,
        isPinned: server.isPinned,
        sortOrder: server.sortOrder,
        folderId: server.folderId,
        createdAt: server.createdAt,
        updatedAt: server.updatedAt,
      }))),
      snippets: await Promise.all(snippets.map(async (snippet) => ({
        id: snippet.id,
        userId: snippet.userId,
        name: snippet.name,
        value: await crypto.encrypt(snippet.valuePlain),
        sortOrder: snippet.sortOrder,
        createdAt: snippet.createdAt,
        updatedAt: snippet.updatedAt,
      }))),
    };
  } catch (error) {
    crypto.restorePassword();
    throw error;
  }
}

function personalCopy(local: LocalVaultDocument): LocalVaultDocument {
  return {
    version: 1,
    folders: local.folders.map((folder) => ({ ...folder, orgId: null })),
    servers: local.servers.map((server) => ({ ...server, orgId: null })),
    snippets: local.snippets.map((snippet) => ({ ...snippet })),
  };
}

export async function moveVaultToAccount(input: MoveVaultInput): Promise<MoveVaultResult> {
  if (!input.confirmed) return { ok: false, reason: 'not_confirmed' };
  if (!input.localPasswordOk || !input.accountPasswordOk) return { ok: false, reason: 'password_rejected' };
  if (input.sameMasterPassword && !input.localVerifier && (input.local.servers.length > 0 || input.local.snippets.length > 0)) {
    return { ok: false, reason: 'password_rejected' };
  }

  let remote: { servers: Server[]; folders: ServerFolder[]; snippets: Snippet[] };
  try {
    remote = await input.cloud.listPersonal();
  } catch {
    return { ok: false, reason: 'upload_failed' };
  }
  if (remote.servers.length > 0 || remote.snippets.length > 0) {
    return { ok: false, reason: 'cloud_not_empty' };
  }

  const createdFolders: string[] = [];
  const createdServers: string[] = [];
  const createdSnippets: string[] = [];
  let switched = false;
  let nextVerifier: string | null = null;

  const rollback = async () => {
    if (switched) input.crypto.restorePassword();
    if (input.localVerifier) {
      try { await input.restoreLocalVerifier(input.localVerifier); } catch { /* keep the file either way */ }
    }
    for (const id of createdServers) {
      try { await input.cloud.removeServer(id); } catch { /* local file stays */ }
    }
    for (const id of createdSnippets) {
      try { await input.cloud.removeSnippet(id); } catch { /* local file stays */ }
    }
    for (const id of createdFolders) {
      try { await input.cloud.removeFolder(id); } catch { /* local file stays */ }
    }
  };

  try {
    let payload: LocalVaultDocument;
    if (input.sameMasterPassword) {
      payload = personalCopy(input.local);
    } else {
      nextVerifier = await input.createNextVerifier();
      payload = await reencrypt(input.local, input.crypto);
      switched = true;
    }

    const folderIds = new Map<string, string>();
    for (const folder of payload.folders) {
      const created = await input.cloud.createFolder({ ...folder, orgId: null });
      createdFolders.push(created.id);
      folderIds.set(folder.id, created.id);
    }

    const uploadedServers: Server[] = [];
    for (const server of payload.servers) {
      const folderId = server.folderId ? folderIds.get(server.folderId) ?? null : null;
      const created = await input.cloud.createServer({ ...server, orgId: null, folderId }, folderId);
      createdServers.push(created.id);
      uploadedServers.push({ ...created, folderId, orgId: null });
    }

    const uploadedSnippets: Snippet[] = [];
    for (const snippet of payload.snippets) {
      const created = await input.cloud.createSnippet(snippet);
      createdSnippets.push(created.id);
      uploadedSnippets.push(created);
    }

    const uploadedFolders = payload.folders.map((folder) => ({
      ...folder,
      id: folderIds.get(folder.id) ?? folder.id,
      orgId: null,
    }));
    const uploaded = {
      version: 1 as const,
      servers: uploadedServers,
      folders: uploadedFolders,
      snippets: uploadedSnippets,
    };

    const listed = await input.cloud.listPersonal();
    if (!listsMatch(uploaded, listed)) {
      await rollback();
      return { ok: false, reason: 'mismatch' };
    }

    const verifier = input.sameMasterPassword ? input.localVerifier : nextVerifier;
    if (verifier) {
      const existing = await input.cloud.getVerifier();
      if (!existing || !input.sameMasterPassword) {
        await input.cloud.setVerifier(verifier);
      }
    }

    await input.deleteLocalFile();
    try {
      await input.disableLocalMode();
    } catch {
      // The account copy is in place and the local file is already gone.
    }
    return { ok: true };
  } catch {
    await rollback();
    return { ok: false, reason: 'upload_failed' };
  }
}
